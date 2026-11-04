/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — "Email Users" route handlers (server-only).
 *
 * The App Router route files under `app/api/admin/email-announcements/**` are
 * thin wrappers around these handlers (the same convention as
 * `lib/competition-bulk-email-api.ts`). Every handler:
 *
 *   1. authenticates (NextAuth session) — the acting profile id comes from the
 *      SESSION, never from the request body,
 *   2. re-checks the ADMINISTRATOR capability (the same server-only
 *      `MULTI_TEAM_ADMIN_USER_ID` gate used by competition creation),
 *   3. validates the request body,
 *   4. calls the authorized server helper (which re-resolves the audience from
 *      the database),
 *   5. maps the discriminated result to an HTTP status,
 *   6. returns minimal JSON — COUNTS and the recipient's own preview only.
 *
 * The browser can never supply a recipient list, a recipient count, an address,
 * or another profile's identity.
 */

import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getAnnouncementAudience,
  isAnnouncementsAdmin,
  listAnnouncementCompetitionOptions,
  listEmailAnnouncementBatches,
  previewEmailAnnouncement,
  processEmailAnnouncementBatch,
  sendEmailAnnouncement,
} from "@/lib/email-announcements-server";
import {
  ANNOUNCEMENT_IMAGE_BUCKET,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_IMAGE_MIME_TYPES,
} from "@/types/email-announcement";

/** Resolve the authenticated profile id, or null. */
async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

/** The trusted request origin used to build absolute registration links. */
function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * ── GET /api/admin/email-announcements ───────────────────────────────────────
 * The composing panel's initial load: the selectable competitions, the CURRENT
 * all-users recipient count, and the recent batches. Sends nothing.
 */
export async function getAnnouncementsPanelHandler(
  _request: Request,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (!isAnnouncementsAdmin(profileId)) {
      return NextResponse.json(
        { error: "Not authorized to email users" },
        { status: 403 },
      );
    }

    const [events, audience, batches] = await Promise.all([
      listAnnouncementCompetitionOptions(),
      getAnnouncementAudience({
        actorProfileId: profileId,
        audienceType: "all_users",
        previousCompetitionId: null,
        promotionCompetitionId: null,
      }),
      listEmailAnnouncementBatches(profileId),
    ]);

    if (!events.ok) {
      return NextResponse.json({ error: events.error }, { status: events.status });
    }
    if (!audience.ok) {
      return NextResponse.json(
        { error: audience.error },
        { status: audience.status },
      );
    }
    if (!batches.ok) {
      return NextResponse.json(
        { error: batches.error },
        { status: batches.status },
      );
    }

    return NextResponse.json({
      events: events.data,
      audience: audience.data,
      batches: batches.data,
    });
  } catch (err) {
    console.error("Email announcements panel error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * ── POST /api/admin/email-announcements/audience ─────────────────────────────
 * The recipient count for the selected audience (after exclusions). Sends
 * nothing and stores nothing — called when the audience selection changes.
 */
export async function resolveAnnouncementAudienceHandler(
  request: Request,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await getAnnouncementAudience({
      actorProfileId: profileId,
      audienceType: body.audienceType,
      previousCompetitionId: body.previousCompetitionId,
      promotionCompetitionId: body.promotionCompetitionId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ audience: result.data });
  } catch (err) {
    console.error("Email announcements audience error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * ── POST /api/admin/email-announcements/preview ──────────────────────────────
 * A server-rendered preview of exactly what one recipient will receive (same
 * template, same renderer, same resolved registration link) plus the current
 * audience count. Sends nothing.
 */
export async function previewAnnouncementHandler(
  request: Request,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await previewEmailAnnouncement({
      actorProfileId: profileId,
      subject: body.subject,
      message: body.message,
      audienceType: body.audienceType,
      previousCompetitionId: body.previousCompetitionId,
      promotionCompetitionId: body.promotionCompetitionId,
      imageUrl: body.imageUrl,
      origin: requestOrigin(request),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ preview: result.data });
  } catch (err) {
    console.error("Email announcements preview error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * ── POST /api/admin/email-announcements ──────────────────────────────────────
 * Queue a send of one individual message per resolved recipient. The body
 * carries only the message, the audience selection and the idempotency
 * `requestId`; the audience is re-resolved server-side and the actor comes from
 * the session. A repeat of the same `requestId` returns the existing batch
 * instead of sending again.
 */
export async function sendAnnouncementHandler(
  request: Request,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await sendEmailAnnouncement({
      actorProfileId: profileId,
      subject: body.subject,
      message: body.message,
      audienceType: body.audienceType,
      previousCompetitionId: body.previousCompetitionId,
      promotionCompetitionId: body.promotionCompetitionId,
      imageUrl: body.imageUrl,
      requestId: body.requestId,
      origin: requestOrigin(request),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ batch: result.data }, { status: 201 });
  } catch (err) {
    console.error("Email announcements send error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * ── POST /api/admin/email-announcements/[batchId]/process ────────────────────
 * Drain the batch's REMAINING pending recipients (bounded, one message each).
 * Already-accepted or permanently failed recipients are never re-sent.
 */
export async function processAnnouncementHandler(
  _request: Request,
  batchId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await processEmailAnnouncementBatch(batchId, profileId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ batch: result.data });
  } catch (err) {
    console.error("Email announcements processing error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}


/**
 * ── POST /api/admin/email-announcements/image ────────────────────────────────
 * Upload an announcement image (administrator only).
 *
 * The image is stored in the dedicated PUBLIC bucket so the delivered email can
 * reference it with a plain `<img src="https://…">` (base64/data URIs and
 * temporary local paths are deliberately not used — Gmail strips data URIs).
 * The returned public URL is the only value the browser needs.
 */
export async function uploadAnnouncementImageHandler(
  request: Request,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (!isAnnouncementsAdmin(profileId)) {
      return NextResponse.json(
        { error: "Not authorized to upload announcement images" },
        { status: 403 },
      );
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No image was provided" },
        { status: 400 },
      );
    }

    if (
      !(ANNOUNCEMENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      return NextResponse.json(
        { error: "Only JPG, PNG, WebP and GIF images are allowed" },
        { status: 400 },
      );
    }

    if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        { error: "The image must be smaller than 5MB" },
        { status: 400 },
      );
    }

    const extensionFromName = file.name.split(".").pop()?.toLowerCase() ?? "";
    const extension = /^[a-z0-9]{1,5}$/.test(extensionFromName)
      ? extensionFromName
      : "png";
    const objectName = `announcements/${crypto.randomUUID()}.${extension}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(ANNOUNCEMENT_IMAGE_BUCKET)
      .upload(objectName, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Announcement image upload failed:", {
        name: uploadError.name,
        statusCode: (uploadError as { statusCode?: number }).statusCode,
      });
      return NextResponse.json(
        {
          error:
            "Failed to upload the image. Check that the announcement image storage bucket exists.",
        },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage
      .from(ANNOUNCEMENT_IMAGE_BUCKET)
      .getPublicUrl(objectName);

    return NextResponse.json({ url: publicUrl }, { status: 201 });
  } catch (err) {
    console.error("Announcement image upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}


/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — Hybrid promotion registration-link resolver
 * (server-only).
 *
 * The "Email Users" admin feature can OPTIONALLY promote an upcoming competition
 * by embedding a registration link in the announcement. This module resolves
 * that link safely and deterministically:
 *
 *   1. the promoted competition must exist and be OPEN for registration,
 *   2. an already-resolved, still-ACTIVE link is REUSED (no new link is created
 *      on every preview refresh),
 *   3. otherwise a new reusable join link is created for an ambassador of that
 *      competition,
 *   4. a competition with NO ambassador produces a clear, actionable error,
 *   5. the resolved URL is cached per competition so the preview and the
 *      delivered email always contain the EXACT SAME URL and concurrent
 *      preview/send calls cannot pile up duplicate links,
 *   6. raw join tokens are still only persisted as the existing SHA-256
 *      `token_hash` in `competition_join_links`. This feature does NOT add a
 *      plaintext token column and does NOT weaken the existing join-link rules.
 *
 * The existing creator-only `createCompetitionJoinLink` / join-link API and the
 * existing competition "Email Participants" pipeline are NOT modified.
 *
 * NOTE on reuse: because the raw token is never stored on `competition_join_links`
 * (by design), an active link created outside this feature cannot be re-read.
 * Reuse therefore applies to the link this feature resolved and cached. When no
 * reusable cached link exists a new one is created — never per preview refresh.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  buildCompetitionJoinUrl,
  generateJoinToken,
  hashJoinToken,
  isEventOpenForRegistration,
} from "@/lib/competition-join";
import {
  getCompetitionEvent,
  isCompetitionCreationAdmin,
  type CompetitionMutationResult,
} from "@/lib/competition-server";

const CACHE_TABLE = "email_announcement_promotion_links";
const JOIN_LINKS_TABLE = "competition_join_links";
const AMBASSADORS_TABLE = "competition_ambassadors";

/** A resolved, ready-to-email registration link. */
export interface ResolvedPromotionLink {
  eventId: string;
  /** The absolute join URL (`…/competitions/join/<token>`). */
  url: string;
  /** The `competition_join_links.id` backing the URL. */
  joinLinkId: string;
  /** True when this call created a brand-new join link. */
  created: boolean;
}

interface CachedLinkRow {
  event_id: string;
  join_link_id: string;
  raw_url: string;
  link: { id: string; revoked_at: string | null } | null;
}

/** Read this feature's cached resolved link for a competition, if any. */
async function readCachedLink(eventId: string): Promise<CachedLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from(CACHE_TABLE)
    .select("event_id, join_link_id, raw_url, link:join_link_id(id, revoked_at)")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as CachedLinkRow;
}

/** A cached link is reusable only while its backing join link is not revoked. */
function isCachedLinkUsable(row: CachedLinkRow | null): row is CachedLinkRow {
  return !!row && !!row.link && row.link.revoked_at == null;
}

/**
 * Create a new reusable join link for the promoted competition, owned by an
 * ambassador of that competition (the existing `competition_join_links`
 * `ambassador_id` requirement).
 *
 * This mirrors the existing join-link creation utility (same token generation,
 * same SHA-256 hashing, same table) but is authorized by the administrator
 * capability rather than by event ownership, because an administrator may not be
 * the creator of the promoted competition. The existing creator-only path is
 * untouched and remains the only route exposed to the competition UI.
 */
async function createJoinLinkForPromotion(
  eventId: string,
  origin: string,
): Promise<CompetitionMutationResult<{ joinLinkId: string; url: string }>> {
  const { data: ambassador, error: ambassadorError } = await supabaseAdmin
    .from(AMBASSADORS_TABLE)
    .select("id")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ambassadorError) {
    console.error("createJoinLinkForPromotion: ambassador lookup failed", {
      eventId,
      code: (ambassadorError as { code?: string }).code,
    });
    return { ok: false, error: "Failed to resolve the competition ambassador", status: 500 };
  }

  if (!ambassador) {
    return {
      ok: false,
      status: 409,
      error:
        "This competition has no ambassador assigned, so a registration link cannot be generated. Assign an ambassador to the competition, then try again.",
    };
  }

  const token = generateJoinToken();
  const tokenHash = hashJoinToken(token);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from(JOIN_LINKS_TABLE)
    .insert({
      event_id: eventId,
      ambassador_id: (ambassador as { id: string }).id,
      token_hash: tokenHash,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("createJoinLinkForPromotion: insert failed", {
      eventId,
      code: (insertError as { code?: string } | null)?.code,
    });
    return { ok: false, error: "Failed to create the registration link", status: 500 };
  }

  return {
    ok: true,
    data: {
      joinLinkId: (inserted as { id: string }).id,
      url: buildCompetitionJoinUrl(origin, token),
    },
  };
}

/** Discard a join link this call created but lost the cache race for. */
async function deleteUnusedJoinLink(linkId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(JOIN_LINKS_TABLE)
    .delete()
    .eq("id", linkId);

  if (error) {
    console.error("resolvePromotionJoinLink: duplicate link cleanup failed", {
      code: (error as { code?: string }).code,
    });
  }
}

/**
 * Resolve (reusing when possible) the registration link for a promoted
 * competition. Administrator-only; the acting profile id always comes from the
 * authenticated session.
 *
 * `origin` is the trusted request origin (never a client-supplied value), used to
 * build the absolute join URL.
 */
export async function resolvePromotionJoinLink(
  eventId: string,
  actorProfileId: string,
  origin: string,
): Promise<CompetitionMutationResult<ResolvedPromotionLink>> {
  if (!eventId || !actorProfileId || !origin) {
    return {
      ok: false,
      error: "Competition, administrator and origin are required",
      status: 400,
    };
  }

  if (!isCompetitionCreationAdmin(actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to generate registration links",
      status: 403,
    };
  }

  const event = await getCompetitionEvent(eventId);
  if (!event) {
    return { ok: false, error: "Promoted competition not found", status: 404 };
  }

  if (!isEventOpenForRegistration(event.status)) {
    return {
      ok: false,
      status: 409,
      error: `"${event.name}" is not currently accepting registrations, so a registration link cannot be included. Open the competition for registration first.`,
    };
  }

  // 1. Reuse an existing, still-active resolved link.
  const cached = await readCachedLink(eventId);
  if (isCachedLinkUsable(cached)) {
    return {
      ok: true,
      data: {
        eventId,
        url: cached.raw_url,
        joinLinkId: cached.join_link_id,
        created: false,
      },
    };
  }

  // 2. No reusable link — create one for an ambassador of the competition.
  const created = await createJoinLinkForPromotion(eventId, origin);
  if (!created.ok) return created;

  const { joinLinkId, url } = created.data;

  // 3a. A stale (revoked) cache entry exists: replace it with the new link.
  if (cached) {
    const { error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .update({
        join_link_id: joinLinkId,
        raw_url: url,
        created_by_profile_id: actorProfileId,
      })
      .eq("event_id", eventId);

    if (error) {
      // The link is valid and usable either way; only the cache refresh failed.
      console.error("resolvePromotionJoinLink: cache refresh failed", {
        eventId,
        code: (error as { code?: string }).code,
      });
    }

    return {
      ok: true,
      data: { eventId, url, joinLinkId, created: true },
    };
  }

  // 3b. First resolution for this competition: reserve the cache slot. The
  // `ignoreDuplicates` upsert means the FIRST concurrent caller wins, so two
  // simultaneous previews can never leave two cached links behind.
  const { data: cachedRows, error: cacheError } = await supabaseAdmin
    .from(CACHE_TABLE)
    .upsert(
      {
        event_id: eventId,
        join_link_id: joinLinkId,
        raw_url: url,
        created_by_profile_id: actorProfileId,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id, join_link_id, raw_url");

  if (cacheError) {
    console.error("resolvePromotionJoinLink: cache insert failed", {
      eventId,
      code: (cacheError as { code?: string }).code,
    });
    return {
      ok: false,
      error: "Failed to resolve the registration link",
      status: 500,
    };
  }

  const rows = (cachedRows ?? []) as {
    event_id: string;
    join_link_id: string;
    raw_url: string;
  }[];
  const winner = rows[0];

  if (!winner || winner.join_link_id === joinLinkId) {
    return { ok: true, data: { eventId, url, joinLinkId, created: true } };
  }

  // A concurrent caller won the race: drop the link we just created (it can
  // never have been used — it is seconds old and was never returned) and reuse
  // the winner's link, so no unnecessary duplicate join-link row survives.
  await deleteUnusedJoinLink(joinLinkId);

  return {
    ok: true,
    data: {
      eventId,
      url: winner.raw_url,
      joinLinkId: winner.join_link_id,
      created: false,
    },
  };
}


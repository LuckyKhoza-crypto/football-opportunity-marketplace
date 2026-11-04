import { uploadAnnouncementImageHandler } from "@/lib/email-announcements-api";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — POST /api/admin/email-announcements/image.
 *
 * Uploads an announcement image to the dedicated public storage bucket and
 * returns its persistent public URL, which the email references with a plain
 * `<img src="https://…">`. Administrator only (401 unauthenticated, 403
 * unauthorized, 400 unsupported format / too large).
 */
export async function POST(request: Request) {
  return uploadAnnouncementImageHandler(request);
}

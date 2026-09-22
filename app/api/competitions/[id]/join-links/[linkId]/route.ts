import { revokeJoinLinkHandler } from "@/lib/competition-join-api";

/**
 * COMP-003 — DELETE /api/competitions/[id]/join-links/[linkId].
 *
 * Revokes a join link (creator-only). Revocation preserves the row so the link
 * can no longer register participants while its history survives.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id, linkId } = await params;
  return revokeJoinLinkHandler(request, id, linkId);
}
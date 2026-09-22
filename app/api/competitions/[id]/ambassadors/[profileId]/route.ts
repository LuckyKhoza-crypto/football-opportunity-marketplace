import { removeAmbassadorHandler } from "@/lib/competition-api";

/**
 * COMP-002 — DELETE /api/competitions/[id]/ambassadors/[profileId].
 *
 * Removes a single ambassador association. Creator-only; all authorization is
 * verified server-side. Ambassadors are identified by their profiles.id.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; profileId: string }> },
) {
  const { id, profileId } = await params;
  return removeAmbassadorHandler(request, id, profileId);
}
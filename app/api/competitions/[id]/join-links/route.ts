import {
  createJoinLinkHandler,
  listJoinLinksHandler,
} from "@/lib/competition-join-api";

/**
 * COMP-003 — GET/POST /api/competitions/[id]/join-links.
 *
 * GET lists the event's ambassador join links and POST creates a new reusable
 * join link for one of the event's ambassadors. Both are creator-only; all
 * checks happen server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return listJoinLinksHandler(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return createJoinLinkHandler(request, id);
}
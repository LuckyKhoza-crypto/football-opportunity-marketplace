import { addAmbassadorHandler, listAmbassadorsHandler } from "@/lib/competition-api";

/**
 * COMP-002 — GET/POST /api/competitions/[id]/ambassadors.
 *
 * GET lists the event's ambassadors and POST adds an existing account as an
 * ambassador by email. Both are creator-only; ambassador management rights are
 * NOT granted to ambassadors. All checks happen server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return listAmbassadorsHandler(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return addAmbassadorHandler(request, id);
}
import {
  getDrawingHandler,
  startDrawingHandler,
} from "@/lib/competition-drawing-api";

/**
 * COMP-006 — /api/competitions/[id]/draw.
 *
 * GET  returns the drawing result (creator or assigned ambassador only).
 * POST starts the drawing. The request body is ignored: the winner is selected
 *      server-side and exactly one drawing per event is enforced at the
 *      database level. A second attempt is rejected with 409.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getDrawingHandler(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return startDrawingHandler(request, id);
}
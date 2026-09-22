import { mintPassTokenHandler } from "@/lib/competition-attempt-api";

/**
 * COMP-004 — POST /api/competitions/[id]/pass-token.
 *
 * Mints a fresh opaque verification token for the authenticated participant's
 * OWN participant row and stores only its SHA-256 digest. Returns the raw token
 * once so the participant pass can render a QR that encodes only the opaque
 * verification URL — never a profile id, participant id, email or event id.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mintPassTokenHandler(request, id);
}
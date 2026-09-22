import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyCompetitionParticipantByToken } from "@/lib/competition-attempt-server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, ShieldAlert } from "lucide-react";

/**
 * COMP-004 — QR verification landing page.
 *
 * The participant pass renders a QR that encodes ONLY this opaque verification
 * URL: /competitions/verify/<opaque-token>. The token is never a profile id,
 * participant id, email, event id or any other database id, and only its
 * SHA-256 digest is stored server-side.
 *
 * Scanning the QR opens this page. It resolves the token SERVER-SIDE, checks
 * the authenticated requester manages the resolved event (creator OR an
 * assigned ambassador), then hands the resolved participant off to the event's
 * participant-management screen (?verified=<participantId>). Any other user is
 * refused.
 */
export default async function CompetitionVerifyTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const callback = encodeURIComponent(`/competitions/verify/${token}`);
    redirect(`/login?callbackUrl=${callback}`);
  }

  const result = await verifyCompetitionParticipantByToken(
    session.user.id,
    token,
  );

  if (!result.ok) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mb-2 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <ShieldAlert className="h-7 w-7 text-destructive" />
              </div>
            </div>
            <CardTitle>Verification Failed</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Only the competition creator or an assigned ambassador can verify
              participants.
            </p>
            <Link href="/competitions">
              <Button variant="outline">Back to Competitions</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  redirect(
    `/competitions/${result.data.eventId}/participants?verified=${result.data.participantId}`,
  );
}
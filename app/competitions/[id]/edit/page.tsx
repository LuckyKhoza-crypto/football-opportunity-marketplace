import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCompetitionEvent,
  isEventManager,
} from "@/lib/competition-server";
import { EditCompetitionForm } from "./EditCompetitionForm";

/**
 * COMP-002 — Edit competition page.
 *
 * Authorization is verified SERVER-SIDE: only the event creator may reach the
 * edit form. An ambassador (or any unrelated user) is redirected away, so the
 * form is never even rendered for unauthorized viewers. The PATCH endpoint
 * independently re-checks authorization.
 */
export default async function EditCompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;

  if (!(await isEventManager(id, session.user.id))) {
    redirect(`/competitions/${id}`);
  }

  const event = await getCompetitionEvent(id);
  if (!event) {
    redirect("/competitions");
  }

  return <EditCompetitionForm event={event} />;
}
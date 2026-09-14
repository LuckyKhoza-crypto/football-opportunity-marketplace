import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ConversationDetail } from "./ConversationDetail";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const { conversationId } = await params;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  // Verify the user is a participant
  const { data: participant } = await supabaseAdmin
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", profile.id)
    .single();

  if (!participant) {
    redirect("/messages");
  }

  return <ConversationDetail conversationId={conversationId} />;
}
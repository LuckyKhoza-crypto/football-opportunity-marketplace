import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Server-side helper to get the conversation ID for an application.
 * Can be used in server components to pre-compute the conversation link.
 */
export async function getConversationIdForApplication(
  applicationId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "get_or_create_conversation_for_application",
      { p_application_id: applicationId },
    );

    if (error || !data?.success) {
      console.error("Failed to get conversation:", error ?? data?.error);
      return null;
    }

    return data.conversation_id as string;
  } catch {
    return null;
  }
}
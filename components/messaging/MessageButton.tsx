"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare, Loader2 } from "lucide-react";

interface MessageButtonProps {
  applicationId: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

/**
 * Button that navigates to the conversation for an application.
 * Uses the get_or_create_conversation_for_application RPC function
 * to ensure a conversation exists, handling recovery for existing
 * applications that may lack a conversation.
 */
export function MessageButton({
  applicationId,
  label = "Message",
  variant = "default",
  size = "default",
}: MessageButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/messages/get-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to open conversation");
        return;
      }

      // Navigate to the conversation
      router.push(`/messages/${data.conversation_id}`);
    } catch {
      setError("Failed to open conversation. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applicationId, router]);

  return (
    <div>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="mr-1 h-4 w-4" />
        )}
        {label}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}

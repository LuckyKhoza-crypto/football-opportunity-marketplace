"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { ContactPlayerDialog } from "./ContactPlayerDialog";

interface ContactPlayerButtonProps {
  playerProfileId: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  label?: string;
}

export function ContactPlayerButton({
  playerProfileId,
  variant = "default",
  size = "default",
  label = "Contact Player",
}: ContactPlayerButtonProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  // Only show for authenticated team users
  const roles = session?.user?.roles ?? [];
  if (!roles.includes("team")) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="mr-1 h-4 w-4" />
        {label}
      </Button>
      {open && (
        <ContactPlayerDialog
          playerProfileId={playerProfileId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
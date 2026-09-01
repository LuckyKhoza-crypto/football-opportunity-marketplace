"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, XCircle, Trash2, Users } from "lucide-react";

interface OpportunityActionsClientProps {
  opportunityId: string;
  status: string;
}

export function OpportunityActionsClient({
  opportunityId,
  status,
}: OpportunityActionsClientProps) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      {status === "active" && (
        <Link href={`/team/opportunities/${opportunityId}/players`}>
          <Button variant="default">
            <Users className="mr-2 h-4 w-4" />
            Find Players
          </Button>
        </Link>
      )}
      <Link href={`/team/opportunities/${opportunityId}/edit`}>
        <Button variant="outline">
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </Link>
      {status === "active" && (
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={async () => {
            if (
              !confirm(
                "Close this opportunity? It will no longer be available to players.",
              )
            )
              return;
            try {
              const res = await fetch(
                `/api/team/opportunities/${opportunityId}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "closed" }),
                },
              );
              if (res.ok) router.refresh();
            } catch (err) {
              console.error("Failed to close opportunity:", err);
            }
          }}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Close
        </Button>
      )}
      {(status === "draft" || status === "closed") && (
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={async () => {
            if (
              !confirm(
                "Delete this opportunity? This action cannot be undone.",
              )
            )
              return;
            try {
              const res = await fetch(
                `/api/team/opportunities/${opportunityId}`,
                { method: "DELETE" },
              );
              if (res.ok) router.push("/team/opportunities");
            } catch (err) {
              console.error("Failed to delete opportunity:", err);
            }
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      )}
    </div>
  );
}
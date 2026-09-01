"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertCircle, XCircle } from "lucide-react";

interface ApplicationDetailClientProps {
  applicationId: string;
  canWithdraw: boolean;
}

export function ApplicationDetailClient({
  applicationId,
  canWithdraw,
}: ApplicationDetailClientProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleWithdraw = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to withdraw application");
        return;
      }

      setSuccess(true);
      setShowConfirm(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Card className="border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Application Withdrawn
              </p>
              <p className="text-xs text-muted-foreground">
                This application is no longer active.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!canWithdraw) return null;

  if (showConfirm) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          Are you sure you want to withdraw this application?
        </p>
        <p className="text-xs text-muted-foreground">
          This action cannot be undone. Your application will remain visible in
          your history as "Withdrawn".
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={handleWithdraw}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : (
              <>
                <XCircle className="mr-2 h-4 w-4" />
                Yes, Withdraw Application
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowConfirm(false);
              setError(null);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button
        variant="outline"
        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
        onClick={() => setShowConfirm(true)}
      >
        <XCircle className="mr-2 h-4 w-4" />
        Withdraw Application
      </Button>
    </div>
  );
}
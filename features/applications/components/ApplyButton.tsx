"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  type ApplicationStatus,
} from "@/types";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogIn,
  UserPlus,
  UserX,
} from "lucide-react";

interface ApplyButtonProps {
  opportunityId: string;
  opportunityTitle: string;
}

interface EligibilityState {
  authenticated: boolean;
  has_player_role: boolean;
  has_player_profile: boolean;
  already_applied: boolean;
  existing_status: string | null;
  opportunity_active: boolean;
}

export function ApplyButton({ opportunityId, opportunityTitle }: ApplyButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [coverMessage, setCoverMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityState | null>(null);
  const [checking, setChecking] = useState(true);

  // Check eligibility on mount
  useEffect(() => {
    async function checkEligibility() {
      try {
        const res = await fetch(
          `/api/applications/eligibility?opportunity_id=${opportunityId}`,
        );
        const data = await res.json();
        setEligibility(data);
      } catch {
        setEligibility(null);
      } finally {
        setChecking(false);
      }
    }
    checkEligibility();
  }, [opportunityId]);

  const handleApply = async () => {
    if (!session?.user?.id) {
      signIn("google");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opportunityId,
          cover_message: coverMessage || undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 201) {
        setSuccess(true);
        setShowMessageInput(false);
        setCoverMessage("");
        setEligibility((prev) =>
          prev ? { ...prev, already_applied: true, existing_status: "pending" } : prev,
        );
        router.refresh();
      } else if (res.status === 409) {
        setEligibility((prev) =>
          prev
            ? { ...prev, already_applied: true, existing_status: data.existingStatus }
            : prev,
        );
        setError(data.error || "You have already applied to this opportunity");
      } else {
        setError(data.error || "Failed to submit application");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (checking) {
    return (
      <Button disabled className="w-full" size="lg" variant="outline">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Checking...
      </Button>
    );
  }

  // Not authenticated
  if (!session?.user?.id) {
    return (
      <Button
        onClick={() => signIn("google")}
        className="w-full"
        size="lg"
      >
        <LogIn className="mr-2 h-4 w-4" />
        Sign in to Apply
      </Button>
    );
  }

  // Opportunity not available
  if (eligibility && !eligibility.opportunity_active) {
    return (
      <Card className="border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Not accepting applications
              </p>
              <p className="text-xs text-muted-foreground">
                This opportunity is no longer available.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No player role
  if (eligibility && !eligibility.has_player_role) {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Player profile required
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                You need to set up a player profile to apply.
              </p>
            </div>
          </div>
          <Link href="/player/onboarding">
            <Button size="sm" variant="outline" className="mt-2 w-full">
              Create Player Profile
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Has player role but no player profile
  if (eligibility && eligibility.has_player_role && !eligibility.has_player_profile) {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Complete your profile
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Please complete your player profile before applying.
              </p>
            </div>
          </div>
          <Link href="/player/profile">
            <Button size="sm" variant="outline" className="mt-2 w-full">
              Complete Profile
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Already applied — show status
  if (eligibility?.already_applied) {
    const status = (eligibility.existing_status ?? "pending") as ApplicationStatus;
    const statusColor =
      APPLICATION_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800";
    const statusLabel = APPLICATION_STATUS_LABELS[status] ?? status;

    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Application Submitted
              </p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
              >
                {statusLabel}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-green-700 dark:text-green-400">
            You have applied to "{opportunityTitle}"
          </p>
        </CardContent>
      </Card>
    );
  }

  // Success state
  if (success) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Application Submitted Successfully!
              </p>
              <p className="text-xs text-green-700 dark:text-green-400">
                The team will review your application.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show message input
  if (showMessageInput) {
    return (
      <div className="space-y-3">
        <div>
          <label
            htmlFor="cover-message"
            className="mb-1 block text-sm font-medium text-foreground"
          >
            Add a message (optional)
          </label>
          <textarea
            id="cover-message"
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Tell the team why you're interested..."
            value={coverMessage}
            onChange={(e) => setCoverMessage(e.target.value)}
            maxLength={1000}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {coverMessage.length}/1000 characters
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleApply}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Application
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowMessageInput(false);
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

  // Initial state — show Apply button
  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        onClick={() => setShowMessageInput(true)}
        className="w-full"
        size="lg"
      >
        <UserPlus className="mr-2 h-4 w-4" />
        Apply for This Position
      </Button>
    </div>
  );
}
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  CompetitionParticipantWithState,
  ParticipantChallengeSummary,
  VerifiedCompetitionParticipant,
} from "@/types/competition-attempt";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  Target,
  Repeat,
  UserCheck,
  Trophy,
  Users,
  Clock,
} from "lucide-react";

/**
 * COMP-004 / COMP-005 — Organizer participant verification & challenge
 * recording.
 *
 * Event-day operations tool, usable by the event creator AND assigned
 * ambassadors. The browser NEVER decides:
 *   * which participant a code resolves to (server does),
 *   * the attempt number (server does),
 *   * whether an attempt passed (server does),
 *   * attempts remaining / threshold / max attempts (server does).
 *
 * Every mutation re-checks the caller is the event creator or an assigned
 * ambassador server-side, so this component is purely presentational + input
 * collection.
 */

interface ParticipantSummary {
  id: string;
  status: string;
  profile: { full_name: string | null } | null;
  verificationCode: string | null;
  attemptsUsed: number;
  attemptsRemaining: number;
  bestResult: number | null;
  lastResult: number | null;
  passed: boolean;
  challengeComplete: boolean;
  canAttempt: boolean;
}

interface EventConfig {
  id: string;
  name: string;
  challenge_name: string;
  challenge_threshold: number;
  max_attempts: number;
}

export function ParticipantManager({
  eventId,
  event,
  initialParticipants,
  verifiedParticipantId,
}: {
  eventId: string;
  event: EventConfig;
  initialParticipants: CompetitionParticipantWithState[];
  verifiedParticipantId: string | null;
}) {
  const router = useRouter();
  const [participants, setParticipants] = useState<ParticipantSummary[]>(
    initialParticipants,
  );
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [active, setActive] = useState<ParticipantSummary | null>(null);

  // A QR hand-off (?verified=<id>) opens that participant immediately.
  useEffect(() => {
    if (!verifiedParticipantId) return;
    const found = participants.find((p) => p.id === verifiedParticipantId);
    if (found) setActive(found);
    // Only react to the initial hand-off id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedParticipantId]);

  // Simple operational summary derived from the existing participant state.
  const summary = useMemo(() => {
    let qualified = 0;
    let notQualified = 0;
    for (const p of participants) {
      if (p.passed) qualified += 1;
      else if (p.attemptsRemaining <= 0) notQualified += 1;
    }
    return {
      total: participants.length,
      qualified,
      notQualified,
      pending: participants.length - qualified - notQualified,
    };
  }, [participants]);

  // Client-side filter over the already-loaded list (no server round-trip).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) => {
      const name = displayName(p).toLowerCase();
      const code = (p.verificationCode ?? "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [participants, query]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Verification failed");
      }
      const verified = data.participant as VerifiedCompetitionParticipant;
      const match = participants.find((p) => p.id === verified.participantId);
      setActive(match ?? toSummary(verified));
      setCode("");
      router.refresh();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setVerifying(false);
    }
  };

  const handleAttemptRecorded = (participantId: string, state: ParticipantChallengeSummary) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participantId
          ? {
              ...p,
              attemptsUsed: state.attemptsUsed,
              attemptsRemaining: state.attemptsRemaining,
              bestResult: state.bestResult,
              lastResult: state.lastResult,
              passed: state.passed,
              challengeComplete: state.challengeComplete,
              canAttempt: state.canAttempt,
              status: state.passed
                ? "qualified"
                : state.attemptsRemaining <= 0
                  ? "not_qualified"
                  : "challenge_pending",
            }
          : p,
      ),
    );
    setActive((prev) =>
      prev && prev.id === participantId
        ? {
            ...prev,
            attemptsUsed: state.attemptsUsed,
            attemptsRemaining: state.attemptsRemaining,
            bestResult: state.bestResult,
            lastResult: state.lastResult,
            passed: state.passed,
            challengeComplete: state.challengeComplete,
            canAttempt: state.canAttempt,
            status: state.passed
              ? "qualified"
              : state.attemptsRemaining <= 0
                ? "not_qualified"
                : "challenge_pending",
          }
        : prev,
    );
  };

  return (
    <div className="space-y-6">
      {/* Event-day summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Participants"
          value={summary.total}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Qualified"
          value={summary.qualified}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="text-green-600 dark:text-green-400"
        />
        <StatCard
          label="Still Pending"
          value={summary.pending}
          icon={<Clock className="h-4 w-4" />}
          accent="text-yellow-600 dark:text-yellow-400"
        />
        <StatCard
          label="Not Qualified"
          value={summary.notQualified}
          icon={<XCircle className="h-4 w-4" />}
          accent="text-red-600 dark:text-red-400"
        />
      </div>

      {/* Verification input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            Verify Participant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-3">
            <Label htmlFor="verification-code">
              Enter the participant's verification code
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="verification-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. ABCD-2345"
                autoComplete="off"
                autoCapitalize="characters"
                className="font-mono text-lg tracking-widest sm:text-xl"
              />
              <Button
                type="submit"
                size="lg"
                disabled={verifying || code.trim().length === 0}
              >
                {verifying ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <UserCheck className="mr-2 h-5 w-5" />
                )}
                Verify
              </Button>
            </div>
            {verifyError && (
              <p className="text-sm text-destructive">{verifyError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Verifying only confirms the participant is present — it does not
              record an attempt.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Active participant + attempt screen */}
      {active && (
        <AttemptPanel
          key={active.id}
          eventId={eventId}
          event={event}
          participant={active}
          onRecorded={handleAttemptRecorded}
        />
      )}

      {/* Participant list */}
      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-lg">
            Participants ({participants.length})
          </CardTitle>
          {participants.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or verification code"
              autoComplete="off"
              className="max-w-sm"
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No participants have registered yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No participants match your search.
            </p>
          ) : (
            filtered.map((p) => (
              <ParticipantRow
                key={p.id}
                participant={p}
                active={active?.id === p.id}
                onSelect={() => setActive(p)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small summary tile used by the event-day dashboard. */
function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${accent ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

/** Map a verified-participant payload to the local list row shape. */
function toSummary(v: VerifiedCompetitionParticipant): ParticipantSummary {
  return {
    id: v.participantId,
    status: v.status,
    profile: v.displayName ? { full_name: v.displayName } : null,
    verificationCode: v.verificationCode,
    attemptsUsed: v.attemptsUsed,
    attemptsRemaining: v.attemptsRemaining,
    bestResult: v.bestResult,
    lastResult: v.lastResult,
    passed: v.passed,
    challengeComplete: v.challengeComplete,
    canAttempt: v.canAttempt,
  };
}

function displayName(p: {
  profile: { full_name: string | null } | null;
}): string {
  return p.profile?.full_name || "Unknown participant";
}

function ParticipantRow({
  participant,
  active,
  onSelect,
}: {
  participant: ParticipantSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between ${
        active ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{displayName(participant)}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {participant.verificationCode ?? "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge participant={participant} />
        <span className="text-muted-foreground">
          {participant.attemptsUsed}/{participant.attemptsUsed + participant.attemptsRemaining} attempts
        </span>
        {participant.bestResult != null && (
          <span className="text-muted-foreground">Best {participant.bestResult}</span>
        )}
      </div>
    </button>
  );
}

function StatusBadge({ participant }: { participant: ParticipantSummary }) {
  if (participant.passed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        <Trophy className="h-3 w-3" /> Qualified
      </span>
    );
  }
  if (participant.attemptsRemaining <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Not Qualified
      </span>
    );
  }
  if (participant.attemptsUsed > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Attempting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
      Registered
    </span>
  );
}

function AttemptPanel({
  eventId,
  event,
  participant,
  onRecorded,
}: {
  eventId: string;
  event: EventConfig;
  participant: ParticipantSummary;
  onRecorded: (participantId: string, state: ParticipantChallengeSummary) => void;
}) {
  const [result, setResult] = useState("");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    { passed: boolean; attemptNumber: number } | null
  >(null);

  const nextAttemptNumber = participant.attemptsUsed + 1;
  const canAttempt =
    participant.canAttempt && !participant.challengeComplete && participant.attemptsRemaining > 0;

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recording) return; // guard against double-click
    const trimmed = result.trim();
    if (trimmed === "") {
      setError("Enter a result value.");
      return;
    }
    setRecording(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/competitions/${eventId}/participants/${participant.id}/attempts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // ONLY result_value is sent. attempt number / passed are server-side.
          body: JSON.stringify({ result_value: trimmed }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to record attempt");
      }
      const attempt = data.attempt as { attempt_number: number; passed: boolean };
      const state = data.state as ParticipantChallengeSummary;
      onRecorded(participant.id, state);
      setFeedback({ passed: attempt.passed, attemptNumber: attempt.attempt_number });
      setResult("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRecording(false);
    }
  };

  const thresholdLabel = useMemo(
    () => `${event.challenge_threshold} to qualify`,
    [event.challenge_threshold],
  );

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserCheck className="h-5 w-5 text-primary" />
          {displayName(participant)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Participant confirmation */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Detail label="Verification Code" value={participant.verificationCode ?? "—"} mono />
          <Detail label="Status" value={statusText(participant)} />
          <Detail
            label={event.challenge_name}
            value={thresholdLabel}
            icon={<Target className="h-4 w-4" />}
          />
          <Detail
            label="Attempts Remaining"
            value={`${participant.attemptsRemaining} of ${event.max_attempts}`}
            icon={<Repeat className="h-4 w-4" />}
          />
        </div>

        {/* Pass / fail feedback */}
        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              feedback.passed
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
            }`}
          >
            {feedback.passed ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Attempt #{feedback.attemptNumber}{" "}
            {feedback.passed
              ? "passed — participant qualified!"
              : "did not meet the threshold."}
          </div>
        )}

        {/* Attempt screen */}
        {canAttempt ? (
          <form onSubmit={handleRecord} className="space-y-3">
            <Label htmlFor="attempt-result">
              Attempt #{nextAttemptNumber} — enter the result
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="attempt-result"
                value={result}
                onChange={(e) => setResult(e.target.value)}
                inputMode="decimal"
                placeholder={`Result (${thresholdLabel})`}
                autoComplete="off"
                className="text-lg"
              />
              <Button type="submit" size="lg" disabled={recording}>
                {recording ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Trophy className="mr-2 h-5 w-5" />
                )}
                Record Attempt
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              The attempt number and pass/fail result are determined by the
              server.
            </p>
          </form>
        ) : (
          <div className="rounded-md bg-muted/50 px-3 py-3 text-sm">
            {participant.passed
              ? "This participant has qualified — no further attempts can be recorded."
              : "No attempts remaining for this participant."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function statusText(p: ParticipantSummary): string {
  if (p.passed) return "Qualified";
  if (p.attemptsRemaining <= 0) return "Not Qualified";
  if (p.attemptsUsed > 0) return "Attempting";
  return "Registered";
}

function Detail({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`font-medium ${mono ? "font-mono tracking-wide" : ""}`}>
        {value}
      </p>
    </div>
  );
}
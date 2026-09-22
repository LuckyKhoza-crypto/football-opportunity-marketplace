import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canManageEvent, getCompetitionEvent } from "@/lib/competition-server";
import {
  generateVerificationToken,
  hashVerificationToken,
} from "@/lib/competition-join";
import {
  computeParticipantChallengeState,
  getNextAttemptNumber,
  meetsChallengeThreshold,
  parseAttemptResultValue,
  resolveParticipantStatus,
  type AttemptSummary,
  type ParticipantChallengeState,
} from "@/lib/competition-attempt";
import type {
  CompetitionAttempt,
  CompetitionParticipantWithState,
  VerifiedCompetitionParticipant,
} from "@/types/competition-attempt";
import type {
  CompetitionEvent,
  CompetitionParticipant,
  CompetitionParticipantStatus,
} from "@/types";

/**
 * COMP-004 - Server-side participant verification & challenge-attempt helpers.
 *
 * Conventions: `server-only`, service-role client, discriminated-result error
 * handling, no thrown errors.
 *
 * Authorization (COMP-005): ALL operational operations here (list participants,
 * verify a participant, record an attempt, read event-wide attempts) are
 * authorized for the event's OPERATORS — the event CREATOR
 * (competition_events.created_by) OR an assigned AMBASSADOR
 * (competition_ambassadors). This is the shared `canManageEvent` rule from
 * COMP-001/002, reused so there is a single operational-access source of truth.
 *
 * Being an ambassador is a competition-specific relationship — it is NEVER
 * derived from profiles.role. Participants, unrelated authenticated users and
 * removed ambassadors gain NOTHING here.
 *
 * Creator-only administration (editing configuration, managing ambassadors,
 * lifecycle, deletion) deliberately stays in lib/competition-server.ts and is
 * NOT delegated to ambassadors.
 *
 * Never trusted from the browser: event ownership, profile id, participant
 * owner, attempt number, `passed`, attempts remaining, threshold, max attempts.
 */

export type CompetitionMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

interface AttemptRow {
  id: string;
  event_id: string;
  participant_id: string;
  attempt_number: number;
  result_value: number;
  passed: boolean;
}

interface ParticipantVerifyRow {
  id: string;
  event_id: string;
  profile_id: string;
  status: CompetitionParticipantStatus;
  checked_in_at: string | null;
  verification_code: string | null;
  profile: { full_name: string | null } | null;
}

/** List a participant's attempts (ascending attempt number). */
export async function getParticipantAttempts(
  eventId: string,
  participantId: string,
): Promise<CompetitionAttempt[]> {
  if (!eventId || !participantId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_attempts")
    .select("*")
    .eq("event_id", eventId)
    .eq("participant_id", participantId)
    .order("attempt_number", { ascending: true });

  if (error) {
    console.error("getParticipantAttempts: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as CompetitionAttempt[];
}

/** Load raw attempts for ALL participants of an event (event-wide view). */
async function getEventAttempts(eventId: string): Promise<AttemptRow[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_attempts")
    .select(
      "id, event_id, participant_id, attempt_number, result_value, passed",
    )
    .eq("event_id", eventId)
    .order("attempt_number", { ascending: true });

  if (error) {
    console.error("getEventAttempts: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as AttemptRow[];
}

function toSummaries(
  attempts: {
    attempt_number: number;
    result_value: number | string;
    passed: boolean;
  }[],
): AttemptSummary[] {
  return attempts.map((a) => ({
    attempt_number: a.attempt_number,
    result_value: Number(a.result_value),
    passed: a.passed,
  }));
}

/** Internal participant lookup scoped to a specific event. */
async function getParticipantById(
  eventId: string,
  participantId: string,
): Promise<CompetitionParticipant | null> {
  if (!eventId || !participantId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(
      "id, event_id, profile_id, status, checked_in_at, created_at, updated_at",
    )
    .eq("id", participantId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as CompetitionParticipant;
}

/** Look up a participant row by (eventId, profileId) - the owner's own row. */
async function getParticipantByProfile(
  eventId: string,
  profileId: string,
): Promise<CompetitionParticipant | null> {
  if (!eventId || !profileId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(
      "id, event_id, profile_id, status, checked_in_at, created_at, updated_at",
    )
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as CompetitionParticipant;
}

/** Derive a participant's full challenge state (null if not found). */
export async function getParticipantChallengeState(
  eventId: string,
  participantId: string,
): Promise<ParticipantChallengeState | null> {
  if (!eventId || !participantId) return null;

  const [event, participant, attempts] = await Promise.all([
    getCompetitionEvent(eventId),
    getParticipantById(eventId, participantId),
    getParticipantAttempts(eventId, participantId),
  ]);

  if (!event || !participant) return null;

  return computeParticipantChallengeState(
    participant,
    event,
    toSummaries(attempts),
  );
}

/**
 * List an event's participants joined with profile identity and derived
 * challenge state. Authorized for the event creator OR an assigned ambassador
 * (else []). Only operational data is returned — never account email addresses.
 */
export async function listCompetitionParticipantsWithState(
  eventId: string,
  operatorProfileId: string,
): Promise<CompetitionParticipantWithState[]> {
  if (!eventId || !operatorProfileId) return [];
  if (!(await canManageEvent(eventId, operatorProfileId))) return [];

  const event = await getCompetitionEvent(eventId);
  if (!event) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(
      "id, event_id, status, checked_in_at, created_at, verification_code, profile:profiles(full_name)",
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("listCompetitionParticipantsWithState: query failed", error);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    event_id: string;
    status: CompetitionParticipantStatus;
    checked_in_at: string | null;
    created_at: string;
    verification_code: string | null;
    profile: { full_name: string | null } | null;
  }[];

  const attempts = await getEventAttempts(eventId);
  const byParticipant = new Map<string, AttemptSummary[]>();
  for (const attempt of attempts) {
    const list = byParticipant.get(attempt.participant_id) ?? [];
    list.push({
      attempt_number: attempt.attempt_number,
      result_value: Number(attempt.result_value),
      passed: attempt.passed,
    });
    byParticipant.set(attempt.participant_id, list);
  }

  return rows.map((row) => {
    const state = computeParticipantChallengeState(
      { id: row.id, event_id: row.event_id, status: row.status },
      event,
      byParticipant.get(row.id) ?? [],
    );

    return {
      id: row.id,
      event_id: row.event_id,
      status: row.status,
      checked_in_at: row.checked_in_at,
      created_at: row.created_at,
      // Display name only — never an account id or email.
      profile: row.profile ? { full_name: row.profile.full_name } : null,
      verificationCode: row.verification_code,
      attemptsUsed: state.attemptsUsed,
      attemptsRemaining: state.attemptsRemaining,
      bestResult: state.bestResult,
      lastResult: state.lastResult,
      passed: state.passed,
      challengeComplete: state.challengeComplete,
      canAttempt: state.canAttempt,
    };
  });
}

function toVerifiedParticipant(
  participant: {
    id: string;
    event_id: string;
    status: CompetitionParticipantStatus;
    verification_code: string | null;
  },
  displayName: string | null,
  state: ParticipantChallengeState,
): VerifiedCompetitionParticipant {
  return {
    participantId: participant.id,
    eventId: participant.event_id,
    status: participant.status,
    verificationCode: participant.verification_code,
    displayName,
    attemptsUsed: state.attemptsUsed,
    attemptsRemaining: state.attemptsRemaining,
    bestResult: state.bestResult,
    lastResult: state.lastResult,
    passed: state.passed,
    challengeComplete: state.challengeComplete,
    canAttempt: state.canAttempt,
  };
}

/** Shared post-lookup step for both verification methods. */
async function markVerifiedAndBuildState(
  eventId: string,
  row: ParticipantVerifyRow,
): Promise<CompetitionMutationResult<VerifiedCompetitionParticipant>> {
  const patch: Record<string, unknown> = {};
  if (!row.checked_in_at) patch.checked_in_at = new Date().toISOString();
  // registered -> verified/attempting (the only status that represents it).
  if (row.status === "registered") patch.status = "challenge_pending";

  let status = row.status;
  if (Object.keys(patch).length > 0) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("competition_participants")
      .update(patch)
      .eq("id", row.id)
      .eq("event_id", eventId)
      .select("status")
      .maybeSingle();

    if (updateError) {
      console.error("markVerifiedAndBuildState: update failed", updateError);
    } else if (updated) {
      status = (updated as { status: CompetitionParticipantStatus }).status;
    }
  }

  const [event, attempts] = await Promise.all([
    getCompetitionEvent(eventId),
    getParticipantAttempts(eventId, row.id),
  ]);

  if (!event) return { ok: false, error: "Event not found", status: 404 };

  const state = computeParticipantChallengeState(
    { id: row.id, event_id: eventId, status },
    event,
    toSummaries(attempts),
  );

  const displayName = row.profile?.full_name || null;

  return {
    ok: true,
    data: toVerifiedParticipant(
      {
        id: row.id,
        event_id: eventId,
        status,
        verification_code: row.verification_code,
      },
      displayName,
      state,
    ),
  };
}

/** Normalise a human verification code (uppercase, strip spaces/dashes). */
export function normalizeVerificationCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

const VERIFY_SELECT =
  "id, event_id, profile_id, status, checked_in_at, verification_code, profile:profiles(full_name)";

/**
 * Verify a participant by human-readable verification code, scoped to THIS
 * event only (a code from another event never resolves). Authorized for the
 * event creator OR an assigned ambassador.
 */
export async function verifyCompetitionParticipantByCode(
  eventId: string,
  operatorProfileId: string,
  rawCode: string,
): Promise<CompetitionMutationResult<VerifiedCompetitionParticipant>> {
  if (!eventId || !operatorProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }
  if (!(await canManageEvent(eventId, operatorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to verify participants for this event",
      status: 403,
    };
  }

  const code = normalizeVerificationCode(rawCode);
  if (!code) {
    return { ok: false, error: "Enter a verification code.", status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(VERIFY_SELECT)
    .eq("event_id", eventId)
    .eq("verification_code", code)
    .maybeSingle();

  if (error) {
    console.error("verifyCompetitionParticipantByCode: query failed", error);
    return { ok: false, error: "Failed to verify participant", status: 500 };
  }
  if (!data) {
    return { ok: false, error: "No participant found for that code.", status: 404 };
  }

  return markVerifiedAndBuildState(eventId, data as unknown as ParticipantVerifyRow);
}

/**
 * Verify a participant from an opaque QR token. The token is hashed before
 * lookup (only the digest is stored). The resolved event must be one the
 * requester manages as creator or assigned ambassador. The QR never contains
 * any database id.
 */
export async function verifyCompetitionParticipantByToken(
  operatorProfileId: string,
  rawToken: string,
): Promise<CompetitionMutationResult<VerifiedCompetitionParticipant>> {
  if (!operatorProfileId || !rawToken) {
    return { ok: false, error: "A verification token is required", status: 400 };
  }

  const tokenHash = hashVerificationToken(rawToken.trim());

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(VERIFY_SELECT)
    .eq("verification_token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("verifyCompetitionParticipantByToken: query failed", error);
    return { ok: false, error: "Failed to verify participant", status: 500 };
  }
  if (!data) {
    return { ok: false, error: "That verification link is not valid.", status: 404 };
  }

  const row = data as unknown as ParticipantVerifyRow;
  if (!(await canManageEvent(row.event_id, operatorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to verify participants for this event",
      status: 403,
    };
  }

  return markVerifiedAndBuildState(row.event_id, row);
}

export interface RecordedAttemptData {
  attempt: CompetitionAttempt;
  state: ParticipantChallengeState;
}

/**
 * Record ONE physical challenge attempt. Browser supplies ONLY result_value.
 * attempt_number, `passed`, ownership and limits are all server-resolved.
 *
 * Authorized for the event creator OR an assigned ambassador.
 *
 * Concurrency/idempotency: UNIQUE(participant_id, attempt_number) -> 23505
 * mapped to 409; a passing attempt closes the challenge; a BEFORE INSERT
 * trigger independently rejects cross-event participants and >max_attempts.
 */
export async function recordCompetitionAttempt(
  eventId: string,
  operatorProfileId: string,
  participantId: string,
  rawResultValue: unknown,
): Promise<CompetitionMutationResult<RecordedAttemptData>> {
  if (!eventId || !operatorProfileId || !participantId) {
    return {
      ok: false,
      error: "Event, profile and participant are required",
      status: 400,
    };
  }
  if (!(await canManageEvent(eventId, operatorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to record attempts for this event",
      status: 403,
    };
  }

  const parsed = parseAttemptResultValue(rawResultValue);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const event = await getCompetitionEvent(eventId);
  if (!event) return { ok: false, error: "Event not found", status: 404 };

  const participant = await getParticipantById(eventId, participantId);
  if (!participant) {
    return {
      ok: false,
      error: "Participant not found for this event",
      status: 404,
    };
  }

  const attempts = await getParticipantAttempts(eventId, participantId);
  const summaries = toSummaries(attempts);
  const currentState = computeParticipantChallengeState(
    participant,
    event,
    summaries,
  );

  if (currentState.challengeComplete) {
    return {
      ok: false,
      error: "This participant has already qualified - no further attempts.",
      status: 409,
    };
  }
  if (currentState.attemptsRemaining <= 0) {
    return {
      ok: false,
      error: "This participant has used all of their attempts.",
      status: 409,
    };
  }

  const attemptNumber = getNextAttemptNumber(summaries);
  const passed = meetsChallengeThreshold(parsed.value, event.challenge_threshold);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("competition_attempts")
    .insert({
      event_id: eventId,
      participant_id: participantId,
      attempt_number: attemptNumber,
      result_value: parsed.value,
      passed,
      recorded_by_profile_id: operatorProfileId,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    const code = (insertError as { code?: string } | null)?.code;
    const message = (insertError as { message?: string } | null)?.message ?? "";
    if (code === "23505") {
      return {
        ok: false,
        error: "That attempt was already recorded. Please refresh.",
        status: 409,
      };
    }
    if (message.includes("competition_max_attempts_exceeded")) {
      return {
        ok: false,
        error: "This participant has used all of their attempts.",
        status: 409,
      };
    }
    if (message.includes("competition_participant_event_mismatch")) {
      return { ok: false, error: "Participant not found for this event", status: 404 };
    }
    console.error("recordCompetitionAttempt: insert failed", insertError);
    return { ok: false, error: "Failed to record attempt", status: 500 };
  }

  const attempt = inserted as unknown as CompetitionAttempt;

  const afterSummaries: AttemptSummary[] = [
    ...summaries,
    { attempt_number: attemptNumber, result_value: parsed.value, passed },
  ];
  const nextStatus = resolveParticipantStatus(
    participant.status,
    afterSummaries,
    event.max_attempts,
  );

  if (nextStatus !== participant.status) {
    const { error: statusError } = await supabaseAdmin
      .from("competition_participants")
      .update({ status: nextStatus })
      .eq("id", participantId)
      .eq("event_id", eventId);
    if (statusError) {
      console.error("recordCompetitionAttempt: status update failed", statusError);
    }
  }

  const state = computeParticipantChallengeState(
    { id: participant.id, event_id: eventId, status: nextStatus },
    event,
    afterSummaries,
  );

  return { ok: true, data: { attempt, state } };
}

/**
 * Mint a fresh opaque verification token for the authenticated participant's
 * OWN row (profile = session; row resolved by eventId+profileId). Only the
 * SHA-256 digest is stored; the raw token is returned once for the pass QR.
 */
export async function mintParticipantVerificationToken(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<{ token: string }>> {
  if (!eventId || !profileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  const participant = await getParticipantByProfile(eventId, profileId);
  if (!participant) {
    return { ok: false, error: "Participant not found", status: 404 };
  }

  const token = generateVerificationToken();
  const tokenHash = hashVerificationToken(token);

  const { error } = await supabaseAdmin
    .from("competition_participants")
    .update({ verification_token_hash: tokenHash })
    .eq("id", participant.id)
    .eq("event_id", eventId);

  if (error) {
    console.error("mintParticipantVerificationToken: update failed", error);
    return { ok: false, error: "Failed to generate verification token", status: 500 };
  }

  return { ok: true, data: { token } };
}

export type { CompetitionEvent };
/**
 * TOURN-001 — Public entry point for the FOM tournament-provider integration.
 *
 * Server code imports from `@/lib/integrations/tournament` and NEVER from
 * `@/lib/integrations/tournament/providers/*`. That rule is what keeps Challonge
 * replaceable: if a second provider is added, nothing outside this folder
 * changes.
 *
 *   FOM (competition server code / a later API + UI task)
 *          │
 *          ▼
 *   service.ts        orchestration: authorization, Supabase mapping, HTTP mapping
 *          │
 *          ▼
 *   registry.ts       "challonge" → ChallongeProvider
 *          │
 *          ▼
 *   providers/challonge.ts   ← the ONLY Challonge-aware module
 *
 * The service layer is server-side callable only. No HTTP routes are added by
 * this task: the tournament API surface will be designed together with the
 * tournament UI, around the real workflows this service exposes.
 *
 * TOURN-002A adds FOM-OWNED tournament configuration: a competition records the
 * format its tournament was created with (types.ts's `TournamentConfig`), the
 * adapter decides which formats it can actually create (`supportsFormat`), and
 * the service exposes that capability so neither the API nor the UI can offer —
 * or submit — a format the provider cannot honour.
 */

export type {
  CreateTournamentInput,
  ProviderParticipantView,
  ReportMatchResultInput,
  Tournament,
  TournamentConfig,
  TournamentFormat,
  TournamentMatch,
  TournamentMatchScore,
  TournamentMatchState,
  TournamentParticipant,
  TournamentParticipantRef,
  TournamentProvider,
  TournamentState,
  TournamentWinner,
} from "@/lib/integrations/tournament/types";

export {
  DEFAULT_TOURNAMENT_FORMAT,
  isMatchReference,
  isTournamentComplete,
  isTournamentFormat,
  isValidMatchScoreValue,
  MATCH_REFERENCE_PREFIX,
  participantDisplayName,
  TOURNAMENT_FORMATS,
  toMatchReference,
  toTournamentConfig,
} from "@/lib/integrations/tournament/contract";

export {
  TournamentProviderConfigError,
  TournamentProviderError,
} from "@/lib/integrations/tournament/errors";
export type { TournamentProviderErrorCode } from "@/lib/integrations/tournament/errors";

export {
  getChallongeApiKey,
  isChallongeConfigured,
} from "@/lib/integrations/tournament/config";

export {
  CHALLONGE_TOURNAMENT_PROVIDER_ID,
  DEFAULT_TOURNAMENT_PROVIDER,
  getDefaultTournamentProvider,
  isTournamentProviderId,
  resolveTournamentProvider,
  TOURNAMENT_PROVIDER_IDS,
} from "@/lib/integrations/tournament/registry";
export type { TournamentProviderId } from "@/lib/integrations/tournament/registry";

export {
  buildTournamentName,
  buildTournamentSlug,
} from "@/lib/integrations/tournament/slug";

export {
  addEventParticipantsToTournament,
  createEventTournament,
  finalizeEventTournament,
  getEventTournamentBracket,
  getEventTournamentFormatOptions,
  getEventTournamentSummary,
  reportEventMatchResult,
  startEventTournament,
} from "@/lib/integrations/tournament/service";
export type {
  CreateEventTournamentOptions,
  EventMatchResult,
  EventParticipantSync,
  EventTournamentBracket,
  EventTournamentFinalization,
  EventTournamentFormatOption,
  EventTournamentLink,
  EventTournamentParticipant,
  EventTournamentStart,
  EventTournamentSummary,
  ReportEventMatchResultInput,
} from "@/lib/integrations/tournament/service";

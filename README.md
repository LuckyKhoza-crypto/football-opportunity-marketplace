# Football Opportunity Marketplace

A two-sided marketplace connecting football players with team opportunities. Players create football profiles, discover matching opportunities, apply, and communicate with teams. Teams create profiles, post opportunities, discover matching players, review applicants, and communicate with players.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS v4 · shadcn/ui · Supabase (PostgreSQL + Storage + Realtime) · NextAuth v4 (Google OAuth) · Vitest · Vercel Analytics

**Path alias:** `@/*` → `./*`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Authentication & Authorization](#authentication--authorization)
4. [Database Schema](#database-schema)
5. [Matching Engine](#matching-engine)
6. [Routing Map](#routing-map)
7. [API Routes](#api-routes)
8. [Realtime System](#realtime-system)
9. [Notifications](#notifications)
10. [Email Infrastructure](#email-infrastructure)
11. [Team Context & Multi-Team](#team-context--multi-team)
12. [Key Data Flows](#key-data-flows)
13. [Environment Variables](#environment-variables)
14. [Testing](#testing)
15. [Development Commands](#development-commands)
16. [Roadmap & Current State](#roadmap--current-state)
17. [Change Guide — How to Make Future Changes](#change-guide--how-to-make-future-changes)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js 16 (App Router)                     │
│                                                                     │
│  app/ (pages + API routes)                                          │
│  ├── Server Components fetch data via supabaseAdmin (service role)  │
│  ├── Client Components fetch via /api/* route handlers              │
│  └── middleware.ts guards routes by auth + role                     │
│                                                                     │
│  lib/ (business logic)                                              │
│  ├── auth.ts / auth-helpers.ts      → NextAuth + role guards        │
│  ├── supabase*.ts                   → 3 Supabase clients            │
│  ├── matching/                      → deterministic match engine    │
│  ├── team-*.ts                      → invites, memberships, join    │
│  ├── notifications.ts               → server-side notification API  │
│  ├── realtime-broadcast.ts          → signed realtime channels      │
│  └── use-*.tsx                      → client hooks/providers        │
│                                                                     │
│  components/ (shared UI)                                            │
│  ├── layout/       → AppShell, TeamSwitcher                         │
│  ├── marketplace/  → opportunity/player/match cards                 │
│  ├── messaging/    → contact player buttons/dialogs                 │
│  ├── notifications/→ NotificationBell                               │
│  └── ui/           → shadcn/ui primitives                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            Supabase                                 │
│                                                                     │
│  PostgreSQL (23 migrations)  ·  Storage (photos/logos)  ·  Realtime │
│  RLS enabled on all tables (defense-in-depth)                       │
│  SECURITY DEFINER RPCs for atomic multi-table operations            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **NextAuth manages auth, not Supabase Auth.** The `profiles` table is the application-level user store. NextAuth's `signIn`/`jwt`/`session` callbacks sync Google account data into `profiles` using the service-role client. Supabase RLS policies exist as **defense-in-depth** but the real authorization layer is NextAuth + server-side checks.

2. **Three Supabase clients** (never mix them):
   - `lib/supabase.ts` — browser anon client (used by realtime subscriptions)
   - `lib/supabase-server.ts` — server anon client (`persistSession: false`)
   - `lib/supabase-admin.ts` — server service-role client (bypasses RLS, `server-only` import). **This is what almost all server code uses.**

3. **Server components + API routes do the data work.** Pages fetch data server-side with `supabaseAdmin` and pass serializable props to client components. Client components mutate data through `/api/*` route handlers, which re-verify auth and ownership server-side.

4. **Roles are capabilities, not mutually exclusive.** `profiles.role` is a `TEXT[]` — a user can be both `"player"` and `"team"`. The `AppViewProvider` (`lib/use-app-view.tsx`) manages a Player View / Team View toggle for dual-role users, auto-syncing based on route context.

5. **Multi-team architecture.** One user can own multiple `team_profiles` (the UNIQUE constraint on `user_id` was dropped in migration 0012). Every team-scoped query verifies ownership of the **specific** `team_profile_id`, never just the user's ID. The multi-team capability is gated by the `MULTI_TEAM_ADMIN_USER_ID` env var.

6. **Atomic multi-table operations live in PostgreSQL RPCs** (`SECURITY DEFINER` functions). The API layer calls these instead of doing multi-step inserts that could partially fail.

7. **Matching is deterministic and pure.** `lib/matching/` has zero I/O — same inputs always produce the same score. It is used server-side in pages and API routes.

---

## Directory Structure

```
football-opportunity-marketplace/
├── app/                          # Next.js App Router (pages + API)
│   ├── layout.tsx                # Root layout: Providers → AppShell → children
│   ├── providers.tsx             # SessionProvider → NotificationsProvider → AppViewProvider
│   ├── page.tsx                  # Home/landing page (server component)
│   ├── home-client.tsx           # Home page client UI
│   ├── middleware.ts             # (project root) Auth + role route guards
│   ├── api/                      # Route handlers (see API Routes section)
│   ├── dashboard/                # Legacy dashboard (redirects to /player or /team)
│   ├── login/ signup/ onboarding/  # Auth flow pages
│   ├── opportunities/            # Public opportunity marketplace + detail
│   ├── players/ teams/           # Public player/team profile pages
│   ├── player/                   # Player area (dashboard, profile, find-team, applications)
│   ├── team/                     # Team area (dashboard, profile, opportunities, players, invites, join)
│   ├── messages/ notifications/  # Shared messaging + notifications
│   └── acknowledgements/         # Photo credits
│
├── components/                   # Shared UI components
│   ├── layout/                   # AppShell, TeamSwitcher, TeamSwitcherWithContext
│   ├── marketplace/              # opportunity-card, match-details, recommendation-card,
│   │                             # roster-player-card, team-player-browse-card, team-player-card,
│   │                             # player-positions (collapsible position badges), current-team-card
│   ├── messaging/                # ContactPlayerButton, ContactPlayerDialog, MessageButton
│   ├── notifications/            # NotificationBell
│   └── ui/                       # shadcn/ui primitives (button, card, input, label, progress,
│                                 # select, textarea)
│
├── features/                     # Feature-scoped types + a few components
│   ├── applications/             # ApplyButton, ApplyButtonWrapper
│   ├── auth/ opportunities/ players/ teams/   # types.ts only (legacy scaffolding)
│
├── lib/                          # Business logic (see sections below)
│   ├── auth.ts                   # NextAuth config (Google OAuth, JWT, profile sync)
│   ├── auth-helpers.ts           # Server-side auth guards (requireAuth, requireRole, etc.)
│   ├── supabase.ts               # Browser anon client
│   ├── supabase-server.ts        # Server anon client
│   ├── supabase-admin.ts         # Server service-role client (bypasses RLS)
│   ├── matching/                 # Deterministic matching engine
│   │   ├── constants.ts          # Weights, thresholds, level hierarchy
│   │   ├── evaluators.ts         # Per-factor pure evaluators
│   │   ├── engine.ts             # matchPlayerToOpportunity orchestrator
│   │   ├── types.ts              # MatchResult, FactorScore, etc.
│   │   └── index.ts              # Barrel export
│   ├── team-context.ts           # Client team selection (localStorage, ?team= param)
│   ├── team-context-server.ts    # Server team selection (cookie, ownership verification)
│   ├── team-invite.ts            # Pure invite token generation/hashing/state
│   ├── team-invite-server.ts     # Server invite lookup by token
│   ├── team-membership.ts        # Pure membership helpers
│   ├── team-membership-server.ts # Server membership loaders (player's team, team's roster)
│   ├── team-join.ts              # Pure invite page state helpers
│   ├── competition.ts            # Pure competition helpers (COMP-001, no I/O)
│   ├── competition-server.ts     # Server competition helpers (COMP-001, auth + data)
│   ├── competition-api.ts        # COMP-002 competition route handlers
│   ├── competition-join.ts       # Pure join-link helpers (COMP-003, no I/O)
│   ├── competition-join-server.ts# Server join-link + registration (COMP-003)
│   ├── competition-join-api.ts   # COMP-003 join-link route handlers
│   ├── competition-attempt.ts    # Pure attempt/verification helpers (COMP-004, no I/O)
│   ├── competition-attempt-server.ts # Server verification + attempt recording (COMP-004/005)
│   ├── competition-attempt-api.ts    # COMP-004/005 route handlers
│   ├── competition-drawing.ts    # Pure drawing eligibility helpers (COMP-006, no I/O)
│   ├── competition-drawing-server.ts # Server drawing start/read (COMP-006, atomic RPC)
│   ├── competition-drawing-api.ts    # COMP-006 drawing route handlers
│   ├── tournament-api.ts         # TOURN-002/003 tournament route handlers (create/sync/start/read + result + finalize)
│   ├── competition-public-server.ts  # Public competition results query (COMP-007, public data boundary)
│   ├── team-profile.ts           # Team profile completeness calculator
│   ├── player-profile.ts         # Player profile completeness calculator
│   ├── multi-team.ts             # Multi-team admin capability check
│   ├── notifications.ts          # createNotification (server, dedup, realtime)
│   ├── message-conversation.ts   # Server conversation lookup for an application
│   ├── realtime-broadcast.ts     # HMAC-signed realtime channels + emit helpers
│   ├── route-context.ts          # Route → player/team/public/neutral classifier
│   ├── use-app-view.tsx          # AppViewProvider + useAppView (player/team toggle)
│   ├── use-notifications.tsx     # NotificationsProvider + useNotifications
│   ├── use-notifications-realtime.ts  # Realtime notification subscription hook
│   ├── use-conversation-realtime.ts   # Realtime conversation message hook
│   ├── invite-callback.ts        # Safe callbackUrl validation (open-redirect protection)
│   ├── integrations/             # Server-only third-party integrations
│   │   ├── challonge-poc/        # Isolated Challonge v1 POC (evidence artefact, not imported by the app)
│   │   └── tournament/           # TOURN-001 provider-neutral tournament integration
│   │       ├── types.ts          # TournamentProvider contract + FOM-neutral types
│   │       ├── contract.ts       # Pure provider-neutral helpers + format vocabulary (no I/O)
│   │       ├── slug.ts           # Deterministic, provider-safe slug/name derivation
│   │       ├── registry.ts       # Provider selection: "challonge" → ChallongeProvider
│   │       ├── service.ts        # FOM orchestration: authorization + Supabase mapping + HTTP mapping
│   │       ├── errors.ts         # Safe, typed provider errors (never the API key)
│   │       ├── config.ts         # CHALLONGE_API_KEY resolution (fails safely)
│   │       ├── providers/challonge.ts  # Challonge v1 adapter — the ONLY Challonge-aware module
│   │       └── index.ts          # Barrel export (the entry point feature code imports)
│   ├── email/                    # Transactional email infrastructure (EMAIL-001 / EMAIL-002)
│   │   ├── email-service.ts      # Server-only sendTransactionalEmail() entry point
│   │   ├── notification-delivery.ts  # Durable email notification outbox (enqueue + processor)
│   │   ├── config.ts             # BREVO_* env resolution (fails safely)
│   │   ├── errors.ts             # Safe, typed email errors
│   │   ├── types.ts              # Generic TransactionalEmail types
│   │   ├── providers/brevo.ts    # Brevo v3 REST transport (server-only, no SMTP)
│   │   ├── templates/fom-email-shell.ts  # Email-safe HTML shell + text fallback
│   │   ├── templates/outreach-message.ts # EMAIL-003 "team contacted you" email
│   │   ├── templates/application-status.ts # EMAIL-004 application status email
│   │   └── index.ts              # Barrel export
│   ├── colors.ts                 # Centralized color tokens
│   └── utils.ts                  # shadcn cn() helper
│
├── supabase/migrations/          # 25 SQL migrations (see Database Schema)
├── types/index.ts                # All shared TypeScript types + option constants
├── public/images/                # Static images
├── app_roadmap.md                # MVP-004 → MVP-022 tickets
├── task_progress.md              # Current sprint progress
└── package.json
```

---

## Authentication & Authorization

### Flow

```
Google OAuth → NextAuth signIn callback → creates profiles row (if new)
            → jwt callback → fetches latest id + role[] from profiles
            → session callback → injects id + roles into session.user
```

### Key Files

| File | Purpose |
|---|---|
| `lib/auth.ts` | NextAuth config. `signIn` creates a `profiles` row for new users via `supabaseAdmin`. `jwt` always re-fetches the latest `id` and `role` from `profiles` by email. `session` copies `token.id` → `session.user.id` and `token.roles` → `session.user.roles`. |
| `lib/auth-helpers.ts` | Server-only guards: `getSession()`, `requireAuth()`, `requireRole(allowedRoles)`, `redirectToDashboard(roles)`, `hasPlayerRole()`, `hasTeamRole()`, `canAccessPlayerArea()`, `canAccessTeamArea()`, `getUserRoles()`. |
| `middleware.ts` | NextAuth `withAuth` wrapper. Public routes: `/`, `/login`, `/signup`, `/api/auth`, `/_next`, `/favicon.ico`, `/players`, `/teams`, `/team/join`, `/competitions/join` (COMP-003) and `/competitions/results` (COMP-007). Protected: `/dashboard`, `/player`, `/team`, `/onboarding`, `/messages`, `/notifications`, `/opportunities`, `/competitions`. Role-based redirects: player routes require `player` role, team routes require `team` role; no roles → `/onboarding`. |
| `app/onboarding/page.tsx` | Client page where users pick their role(s). Calls `POST /api/auth/update-role` then `session.update()`. |
| `app/api/auth/update-role/route.ts` | Appends a role to `profiles.role` (never replaces). |
| `app/api/auth/profile/route.ts` | Returns the current user's `profiles` row. |

### Role Model

- `profiles.role` is `TEXT[]` with CHECK constraint `role <@ ARRAY['player','team']`.
- Roles are **capabilities**: a user can have both.
- `AppViewProvider` (`lib/use-app-view.tsx`) exposes `view` (`"player" | "team" | null`), `setView`, `isPlayerView`, `isTeamView`, and auto-syncs the view when navigating to player/team management routes (via `lib/route-context.ts`).

---

## Database Schema

All tables have RLS enabled. The application uses `supabaseAdmin` (service role) for most queries, so RLS is defense-in-depth. Migrations are in `supabase/migrations/` and must be applied in order.

### Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `profiles` | Application user accounts | `id`, `email` (UNIQUE), `full_name`, `avatar_url`, `role TEXT[]` |
| `player_profiles` | Football player details | `user_id` (FK profiles, UNIQUE), `positions TEXT[]`, `playing_level`, `preferred_foot`, `availability`, `willing_to_travel`, `willing_to_relocate`, `travel_radius`, `previous_clubs JSONB`, `stats JSONB`, `achievements TEXT[]`, `preferred_leagues TEXT[]`, `discoverable BOOLEAN` (default true) |
| `team_profiles` | Team details | `user_id` (FK profiles, **NOT unique** — multi-team), `team_name`, `logo_url`, `location`, `league`, `playing_level`, `description`, `website_url`, `social_links JSONB`, `contact_name` |
| `opportunities` | Team postings | `team_id` (FK team_profiles), `title`, `position`, `secondary_positions TEXT[]`, `role`, `formation`, `age_min`, `age_max`, `playing_level`, `league`, `location`, `radius`, `preferred_foot`, `availability`, `compensation`, `housing`, `travel_requirements`, `visa_requirements`, `contract_length`, `tryout_date`, `description`, `status` (`draft`/`active`/`closed`) |
| `applications` | Player applications | `opportunity_id` (FK), `player_profile_id` (FK), `status` (`pending`/`reviewing`/`accepted`/`rejected`/`withdrawn`), `cover_message`, UNIQUE(`opportunity_id`, `player_profile_id`) |
| `conversations` | Messaging thread per application/outreach | `application_id` (nullable, partial unique), `outreach_id` (nullable, partial unique), CHECK (at least one is set) |
| `conversation_participants` | Exactly two per conversation | `conversation_id`, `user_id`, `last_read_at`, UNIQUE(`conversation_id`, `user_id`) |
| `messages` | Chat messages | `conversation_id`, `sender_id`, `body` (1–5000 chars), permanent (no UPDATE/DELETE policies) |
| `notifications` | In-app notifications | `user_id`, `type` (`application_received`/`application_status_changed`/`message_received`/`player_joined_team`/`competition_registration_confirmed`), `title`, `body`, `link`, `source_id` (dedup), `read_at`, `data JSONB` (EMAIL-003/004 — non-sensitive typed presentation metadata, e.g. outreach context or application-status context) |
| `outreach` | Team-initiated contact | `opportunity_id`, `team_profile_id`, `player_profile_id`, `initial_message`, `status` (`pending`/`accepted`/`declined`/`withdrawn`), UNIQUE(`opportunity_id`, `team_profile_id`, `player_profile_id`) |
| `team_memberships` | Canonical "player is on team" | `team_profile_id`, `player_profile_id`, `position`, `role`, `status` (only `active`), UNIQUE index on `player_profile_id` (one-team-per-player MVP rule) |
| `team_invites` | Reusable shared recruitment links | `team_profile_id`, `token_hash` (SHA-256, UNIQUE), `created_by`, `expires_at`, `revoked_at`. **No status column** — state is derived from timestamps. |
| `competition_events` | Competition events (COMP-001) | `name`, `description`, `location`, `event_date TIMESTAMPTZ`, `status` (`draft`/`active`/`drawing`/`completed`/`cancelled`), `challenge_name`, `challenge_threshold`, `max_attempts`, `created_by` (FK profiles, authoritative manager), `provider` + `provider_tournament_id` + `tournament_format` (TOURN-001/002A — nullable external tournament mapping plus the FOM format it was created with; the provider columns are set together by a CHECK, and `tournament_format` is set in the same UPDATE as the mapping, backfilled to `single_elimination` for tournaments created before TOURN-002A) |
| `competition_participants` | A profile's participation in an event (COMP-001) | `event_id` (FK competition_events), `profile_id` (FK **profiles** — NOT player_profiles), `status` (`registered`/`challenge_pending`/`qualified`/`not_qualified`), `checked_in_at`, `provider_participant_id` (TOURN-001 — nullable provider participant mapping), UNIQUE(`event_id`, `profile_id`) |
| `competition_ambassadors` | Competition-specific ambassador authorization (COMP-001) | `event_id` (FK competition_events), `profile_id` (FK profiles), UNIQUE(`event_id`, `profile_id`). **Never derived from `profiles.role`.** |
| `competition_join_links` | Reusable ambassador join links / QR codes (COMP-003) | `event_id` (FK competition_events), `ambassador_id` (FK **competition_ambassadors** — the link owner is the ambassador relation, not a profile), `token_hash` (SHA-256 of the raw token, UNIQUE), `revoked_at`. The raw token is never stored. |
| `competition_attempts` | One physical challenge attempt per row (COMP-004) | `event_id` (FK competition_events), `participant_id` (FK competition_participants), `attempt_number` (server-assigned, 1-based), `result_value NUMERIC` (generic — no unit baked in), `passed` (server-computed), `recorded_by_profile_id` (FK profiles), UNIQUE(`participant_id`, `attempt_number`). A `BEFORE INSERT` trigger rejects cross-event participants and attempts beyond the event's `max_attempts`. |
| `competition_drawings` | One immutable drawing + single winner per event (COMP-006) | `event_id` (FK competition_events, **UNIQUE** — one drawing per event), `winner_participant_id` (FK competition_participants — the winner), `winner_profile_id` (FK profiles), `qualified_participant_count` (server-calculated snapshot, `>= 1`), `drawn_by_profile_id` (FK profiles — who started it), `drawn_at`. The winner is represented through the participant/profile relationships only — no personal data is copied. |

### Storage Buckets

- `player-profile-photos` — public bucket, files at `{user_id}/{uuid}.{ext}`. RLS policies in migration 00003.
- `team-logos` — public bucket, files at `{user_id}/{uuid}.{ext}`.

### SECURITY DEFINER RPC Functions

These perform atomic multi-table operations. The API layer calls them via `supabaseAdmin.rpc(...)`.

| Function | Purpose |
|---|---|
| `create_application_with_conversation` | Atomically creates application + conversation + 2 participants. Validates: opportunity active, not own team, no duplicate. Reuses an existing outreach conversation if one exists. |
| `ensure_conversation_for_application` | Creates a conversation for an application if missing (idempotent). |
| `get_or_create_conversation_for_application` | Returns existing or creates conversation for an application. |
| `get_conversation_unread_count` | Counts unread messages for a user in a conversation. |
| `create_outreach_with_initial_message` | Atomically creates outreach + conversation + participants + initial message. Accepts `p_team_profile_id` (multi-team safe). |
| `update_outreach_status` | Players can accept/decline; teams can withdraw. Validates current state. |
| `accept_team_invite` | Atomically creates a `team_memberships` row for a player accepting a shared invite link. Locks the invite row (`FOR UPDATE`), rejects revoked/expired, rejects players already on a different team, idempotent for same team. |
| `accept_application` | Atomically transitions an application to `accepted` AND creates/updates the player's `team_memberships` row. The **opportunity** is the authoritative source for team/position/role (never client-provided values). Idempotent for already-accepted. |
| `start_competition_drawing` | **COMP-006.** Runs the competition drawing in one transaction: locks the event row (`FOR UPDATE`), authorizes creator **or** assigned ambassador, rejects an existing drawing (`DRAWING_ALREADY_EXISTS`) and non-drawable states (`EVENT_NOT_DRAWABLE`), counts the **qualified** participants (`NO_QUALIFIED_PARTICIPANTS` when zero), selects exactly one at random (`ORDER BY random() LIMIT 1`), inserts `competition_drawings` and moves the event to `completed`. Returns a machine-readable JSONB summary. The browser never selects the winner or the count. |

### RLS Notes

- `profiles`: users can read/create/update their own (matched by `auth.uid()` or email claim).
- `player_profiles`: owner CRUD + "Anyone can read discoverable profiles" (migration 00007).
- `team_profiles`: owner CRUD.
- `opportunities`: owner CRUD + "Anyone can read active opportunities" (migration 00006).
- `applications`: player can create (with self-application + active checks), view own, withdraw own pending/reviewing; team can view/update for own opportunities.
- `conversations`/`participants`/`messages`: participants-only access.
- `notifications`: owner read/update only; **no client INSERT** (server-side only via service role).
- `outreach`: team can view/create/update own; player can view/update own.
- `team_memberships`: team can CRUD for own team profile; player can view own.
- `team_invites`: team can CRUD for own team profile.
- `competition_events` (COMP-001): creator read/update/delete; ambassadors can read. INSERT requires `created_by = auth.uid()`. Competition data is **never publicly writable**.
- `competition_participants` (COMP-001): a participant can read/self-register their own row; only the event creator or an event ambassador can update participant status (participants cannot promote themselves to `qualified`) or remove participants.
- `competition_ambassadors` (COMP-001): only the event creator can create/delete ambassador relationships (prevents arbitrary users authorizing themselves or others); creator and the ambassador can read.
- `competition_attempts` (COMP-004): the event creator, an assigned ambassador, and the owning participant can read; there is **no client INSERT/UPDATE/DELETE** — every write goes through the service-role server helpers, which authorize the creator **or** an assigned ambassador.
- `competition_drawings` (COMP-006): the event creator and an assigned ambassador can read; there is **no client INSERT/UPDATE/DELETE** — the only write path is the `start_competition_drawing` SECURITY DEFINER RPC. The drawing is immutable once created.

---

## Matching Engine

**Location:** `lib/matching/` — pure, deterministic, explainable. No I/O, no AI, no randomness.

### Public API

```ts
import { matchPlayerToOpportunity } from "@/lib/matching";

const result = matchPlayerToOpportunity(playerProfile, opportunity);
// result = {
//   score: 0–100,
//   reasons: ["✓ Position matches: ST", ...],
//   mismatches: ["⚠ Location mismatch: ...", ...],
//   classification: "excellent" | "strong" | "possible" | "weak" | "poor",
//   breakdown: { position, playing_level, location, age, availability,
//                travel, relocation, preferred_foot, league_preference }
// }
```

### Weights (must sum to 100 — validated at module load)

| Factor | Weight |
|---|---|
| Position | 30% |
| Playing Level | 20% |
| Location | 15% |
| Age | 10% |
| Availability | 10% |
| Travel | 3% |
| Relocation | 2% |
| Preferred Foot | 5% |
| League Preference | 5% |

### Level Hierarchy

```
recreational < amateur < competitive_amateur < semi_pro < academy < college < professional
```

Exact match → 1.0 · 1 level apart → 0.8 · 2 apart → 0.5 · 3 apart → 0.25 · 4+ apart → 0.1 · unknown → 0.5.

### Missing Data Behavior

- Missing optional info (foot, league) → **neutral** (no penalty).
- Missing critical info (position, level) → **unknown** (partial score).
- Missing player DOB when opportunity has age range → **neutral**.
- Missing data is never treated as a mismatch.

### Known Limitations (documented in `constants.ts`)

1. Location comparison is string-based (no geocoding).
2. Compensation is not scored.
3. Travel radius uses basic number comparison.
4. Scores are not persisted (computed on-the-fly).

### Where It's Used

- `app/page.tsx` — player recommendations + team player recommendations on the homepage.
- `app/player/page.tsx` — top 3 recommendations on the player dashboard.
- `app/player/find-team/page.tsx` — ranked opportunity list ("Find Me a Team").
- `app/opportunities/[id]/page.tsx` — personalized match banner on opportunity detail.
- `app/team/opportunities/[id]/players/page.tsx` — ranked player discovery per opportunity.
- `app/api/applications/route.ts` — match scores attached to application lists.
- `app/api/messages/[conversationId]/route.ts` — match score in conversation detail.

---

## Routing Map

### Public Routes (no auth required)

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Landing page. Logged-out: hero, marketplace cards, latest opportunities. Logged-in: personalized recommendations (player + team). |
| `/login` | `app/login/page.tsx` | Google sign-in. Validates `callbackUrl` via `lib/invite-callback.ts` (open-redirect protection). |
| `/signup` | `app/signup/page.tsx` | Redirects to `/login` (Google OAuth is the signup mechanism). |
| `/opportunities` | `app/opportunities/page.tsx` | Public opportunity marketplace. Server-side search/filter/sort/pagination. |
| `/opportunities/[id]` | `app/opportunities/[id]/page.tsx` | Opportunity detail. Only `active` opportunities are visible (others → 404). Shows match banner for logged-in players. |
| `/players` | `app/players/page.tsx` | Placeholder (future player discovery). |
| `/players/[id]` | `app/players/[id]/page.tsx` | Public player profile (discoverable players). Shows current team, bio, football details, stats, achievements. |
| `/teams/[id]` | `app/teams/[id]/page.tsx` | Public team profile. Shows roster + active opportunities. |
| `/team/join/[token]` | `app/team/join/[token]/page.tsx` | Public invite landing page. Resolves token server-side, shows team info + Accept button (or login CTA). |
| `/acknowledgements` | `app/acknowledgements/page.tsx` | Photo credits. |

### Onboarding / Auth Flow

| Route | File | Purpose |
|---|---|---|
| `/onboarding` | `app/onboarding/page.tsx` | Role selection (player / team / both). Calls `POST /api/auth/update-role`. |
| `/dashboard` | `app/dashboard/page.tsx` | Legacy dashboard — redirects to `/player` or `/team` based on roles. |

### Player Area (requires `player` role)

| Route | File | Purpose |
|---|---|---|
| `/player` | `app/player/page.tsx` | Player dashboard: profile summary, completeness %, top 3 recommendations, quick actions. |
| `/player/onboarding` | `app/player/onboarding/page.tsx` | 5-step player profile creation wizard (photo, DOB, location, positions, level, foot, availability, travel, clubs, stats, achievements, leagues, compensation, video). |
| `/player/profile` | `app/player/profile/page.tsx` | Full player profile view. Shows current team via `getActiveMembershipsForPlayer`. |
| `/player/profile/edit` | `app/player/profile/edit/page.tsx` | Edit player profile. |
| `/player/find-team` | `app/player/find-team/page.tsx` | "Find Me a Team" — all active opportunities ranked by match score. |
| `/player/applications` | `app/player/applications/page.tsx` | Player's application list (client component fetches `/api/applications?context=player`). |
| `/player/applications/[id]` | `app/player/applications/[id]/page.tsx` | Application detail. |

### Team Area (requires `team` role)

| Route | File | Purpose |
|---|---|---|
| `/team` | `app/team/page.tsx` | Team dashboard: profile summary, completeness %, opportunity counts, quick actions. |
| `/team/onboarding` | `app/team/onboarding/page.tsx` | 3-step team profile creation wizard (name, logo, location, level, league, contact, links). |
| `/team/profile` | `app/team/profile/page.tsx` | Team profile view. Shows roster via `getActiveMembershipsForTeam`. |
| `/team/profile/edit` | `app/team/profile/edit/page.tsx` | Edit team profile. |
| `/team/opportunities` | `app/team/opportunities/page.tsx` | Opportunity management (active/draft/closed sections). |
| `/team/opportunities/new` | `app/team/opportunities/new/page.tsx` | Create opportunity form (5 sections: opportunity, requirements, location, availability, compensation). |
| `/team/opportunities/[id]` | `app/team/opportunities/[id]/page.tsx` | Opportunity detail + actions (edit/close/delete). |
| `/team/opportunities/[id]/edit` | `app/team/opportunities/[id]/edit/page.tsx` | Edit opportunity form. |
| `/team/opportunities/[id]/players` | `app/team/opportunities/[id]/players/page.tsx` | Ranked player discovery for a specific opportunity. |
| `/team/find-players` | `app/team/find-players/page.tsx` | Opportunity selection for player discovery + link to browse all players. |
| `/team/players` | `app/team/players/page.tsx` | Browse all discoverable players (filterable). |
| `/team/applications` | `app/team/applications/page.tsx` | Team's application management (client component fetches `/api/applications?context=team`). |
| `/team/invites` | `app/team/invites/page.tsx` | Create/manage reusable invite links. |

### Shared (requires any role)

| Route | File | Purpose |
|---|---|---|
| `/messages` | `app/messages/page.tsx` | Conversation list. |
| `/messages/[conversationId]` | `app/messages/[conversationId]/page.tsx` | Conversation detail with realtime messages. |
| `/notifications` | `app/notifications/page.tsx` | Notification list. |

### Competitions (COMP-002 / COMP-007)

Authenticated-only management routes. They deliberately do **NOT** require the
`player`/`team` marketplace roles and do **NOT** require a `player_profiles` row —
competitions are built on `profiles` + the auth session only.

| Route | File | Purpose |
|---|---|---|
| `/competitions` | `app/competitions/page.tsx` | Management page: competitions created by the current profile + events they are an ambassador for. The **Create Competition** action is shown only to the competition-creation admin (COMP-007). |
| `/competitions/new` | `app/competitions/new/page.tsx` | Create a competition event (starts in `draft`). **COMP-007:** server-guarded — only the profile whose id equals `MULTI_TEAM_ADMIN_USER_ID` may render it; anyone else gets a `404`. |
| `/competitions/[id]` | `app/competitions/[id]/page.tsx` | Role-aware management page. Both creator and ambassador see event details, stats, the "Run Competition" (participant operations) entry point and the **Tournament panel** (TOURN-002/003: create → sync participants → start → report results → finalize → winner); only the creator additionally sees edit/lifecycle/ambassadors/join links. |
| `/competitions/[id]/edit` | `app/competitions/[id]/edit/page.tsx` | Edit event configuration (creator only; server-verified). |

### Public Competition Results (COMP-007)

A **public, no-auth** dashboard showing competition results.

| Route | File | Purpose |
|---|---|---|
| `/competitions/results` | `app/competitions/results/page.tsx` | Public results dashboard (listed in the main navigation for everyone, including logged-out visitors). Shows each competition's name, location, date, status, challenge, **qualified participants** (from the authoritative `competition_participants.status = 'qualified'` state) and the **persisted winner** from COMP-006. A qualified participant's name links to their existing public player profile (`/players/[id]`) only when they have one; participants without a `player_profiles` row are still shown (not linked). Never exposes management controls, participant ids, `profiles.id`, emails, verification codes/tokens or join tokens. |

### Competition Join (COMP-003)

Public player-facing entry flow. The join landing page is **public** so an
unauthenticated player can see the competition and be routed through the existing
auth flow (the join URL is preserved via a validated internal `callbackUrl`).

| Route | File | Purpose |
|---|---|---|
| `/competitions/join/[token]` | `app/competitions/join/[token]/page.tsx` | Public competition landing page. Resolves the token server-side, shows event/challenge details, and offers Enter/Sign In. Never exposes participant data. |
| `/competitions/join/[token]/pass` | `app/competitions/join/[token]/pass/page.tsx` | Private pre-entry pass for the registered participant (verification code, status, event details). Only rendered for the owning profile. |

---

### Participant Verification & Challenge (COMP-004 / COMP-005)

On-site, event-day operations flow, runnable by the **event creator or an assigned
ambassador** (operational delegation — see COMP-005 below). Any other user — including a
participant of the event — is redirected back to the event page. Verification and attempt
recording are **separate** actions; verifying a participant never records an attempt.

| Route | File | Description |
|---|---|---|
| `/competitions/[id]/participants` | `app/competitions/[id]/participants/page.tsx` | Event-day operations screen (creator **or** ambassador): event-day summary counts, participant list + derived challenge state, search, verification and attempt recording. Supports `?verified=<participantId>` to open a participant handed off by the QR flow. |
| `/competitions/verify/[token]` | `app/competitions/verify/[token]/page.tsx` | QR landing page. Resolves the opaque token server-side, checks the requester manages the resolved event (creator **or** ambassador), then redirects to the participant manager with the resolved participant selected. The QR encodes only this opaque URL — never a profile/participant/event id. |

## API Routes

All API routes verify auth via `getServerSession(authOptions)` and use `supabaseAdmin` for data access. They re-verify ownership server-side — never trust client-supplied IDs.

### Applications

| Route | Methods | Purpose |
|---|---|---|
| `/api/applications` | POST | Submit application. Validates player role, player profile, active opportunity, not own team, no duplicate. Calls `create_application_with_conversation` RPC. Creates `application_received` notification for the team. |
| `/api/applications` | GET | List applications. `?context=player` (own applications with match scores, sortable) or `?context=team` (applications for own opportunities, filterable by status/position/match_quality, sortable). |
| `/api/applications/[id]` | GET | Single application detail (player or team owner only). |
| `/api/applications/[id]` | PATCH | Update status. Players can only `withdrawn`. Teams can `reviewing`/`rejected`/`accepted`. **Acceptance** calls `accept_application` RPC (atomic status + membership). Creates `application_status_changed` notification. |
| `/api/applications/eligibility` | GET | Eligibility check for the Apply button: authenticated, has_player_role, has_player_profile, already_applied, opportunity_active. |

### Auth

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | ALL | NextAuth route handler. |
| `/api/auth/profile` | GET | Current user's `profiles` row. |
| `/api/auth/update-role` | POST | Append a role (`player`/`team`) to `profiles.role`. |

### Messages

| Route | Methods | Purpose |
|---|---|---|
| `/api/messages` | GET | List conversations for the current user with latest message, unread count, display name, opportunity context. |
| `/api/messages/[conversationId]` | GET | Conversation detail: messages (paginated via `?before=<messageId>`), participants, match score. |
| `/api/messages/[conversationId]` | POST | Send a message. Verifies participant. Broadcasts `message_new` to the conversation channel. Creates `message_received` notification for the other participant. |
| `/api/messages/[conversationId]` | PATCH | `{ action: "mark_read" }` — updates `last_read_at`. |
| `/api/messages/get-conversation` | POST | Get-or-create conversation for an application (verifies player/team access). |

### Notifications

| Route | Methods | Purpose |
|---|---|---|
| `/api/notifications` | GET | List user's notifications (paginated) + unread count. |
| `/api/notifications/[id]/read` | PATCH | Mark one notification read (ownership verified). Broadcasts `notification_read`. |
| `/api/notifications/read-all` | PATCH | Mark all read. Broadcasts `notifications_read_all`. |

### Outreach (Team → Player)

| Route | Methods | Purpose |
|---|---|---|
| `/api/outreach` | POST | Team contacts a player about an opportunity. Verifies team owns the opportunity. Calls `create_outreach_with_initial_message` RPC. Creates `message_received` notification for the player. |
| `/api/outreach` | GET | List outreach. `?context=player` (outreach sent to me) or `?context=team` (my outreach). |

### Player Profile

| Route | Methods | Purpose |
|---|---|---|
| `/api/player/profile` | POST | Create player profile. **`user_id` is forced from the session** — never from the client. Adds `player` role if missing. |
| `/api/player/profile` | PUT | Update player profile. |
| `/api/player/profile-data` | GET | Fetch current user's player profile. |
| `/api/player/upload-photo` | POST | Upload profile photo to `player-profile-photos` bucket (JPG/PNG/WebP, max 5MB). Returns public URL. |

### Team Profile

| Route | Methods | Purpose |
|---|---|---|
| `/api/team/profile` | POST | Create team profile. Normal users limited to one team; multi-team admin can create more. Adds `team` role if missing. |
| `/api/team/profile` | PUT | Update team profile (requires `team_id`, verifies ownership). |
| `/api/team/profile-data` | GET | Fetch team profile(s) for the user. `?team=<id>` fetches a specific one. |
| `/api/team/upload-logo` | POST | Upload team logo to `team-logos` bucket. |
| `/api/team/list` | GET | List user's teams + `can_create_team` flag. |

### Team Opportunities

| Route | Methods | Purpose |
|---|---|---|
| `/api/team/opportunities` | GET | List opportunities for the user's team (`?team_id=` optional). |
| `/api/team/opportunities` | POST | Create opportunity (draft or active). Validates title + status. |
| `/api/team/opportunities/[id]` | GET | Single opportunity (ownership verified). |
| `/api/team/opportunities/[id]` | PUT | Update opportunity (whitelisted fields). |
| `/api/team/opportunities/[id]` | DELETE | Delete opportunity. **Active opportunities must be closed first.** |

### Team Invites

| Route | Methods | Purpose |
|---|---|---|
| `/api/team/invites` | POST | Create invite for a specific team. Generates raw token server-side (returned once, never persisted), stores only SHA-256 hash. Returns `{ invite, token, join_url }`. |
| `/api/team/invites` | GET | List invites for a team (`?team_id=`). Never exposes `token_hash`. |
| `/api/team/invites/[id]/revoke` | POST | Revoke an invite (soft delete via `revoked_at`). Idempotent. |
| `/api/team/join` | POST | Accept a shared invite link. Hashes the raw token, calls `accept_team_invite` RPC. Creates `player_joined_team` notification only on successful creation. |

### Realtime

| Route | Methods | Purpose |
|---|---|---|
| `/api/realtime/channels` | GET | Returns an HMAC-signed channel name. `?type=notification` → `user:<id>` channel. `?type=conversation&conversationId=<id>` → `conversation:<id>` channel (verifies participant). |

### Competitions (COMP-002 / COMP-007)

| Route | Methods | Purpose |
|---|---|---|
| `/api/competitions` | GET | List competitions managed by the current profile + events they are an ambassador for. |
| `/api/competitions` | POST | Create an event. **`created_by` is resolved from the session** — a client-supplied value is ignored. Validates the challenge config; new events start in `draft`. **COMP-007:** creation is restricted to the configured `MULTI_TEAM_ADMIN_USER_ID` — a non-admin (ambassador or player) receives `403`, and the same fail-closed check is re-applied inside `createCompetitionEvent`. |
| `/api/competitions/[id]` | GET | Event detail + basic statistics. Creator **or** authorized ambassador only. |
| `/api/competitions/[id]` | PATCH | Update event configuration **or** perform a controlled lifecycle transition (`{ status }`). Creator only. Invalid transitions return `409`. |
| `/api/competitions/[id]/ambassadors` | GET | List the event's ambassadors (creator only). |
| `/api/competitions/[id]/ambassadors` | POST | Add an existing account as an ambassador by `email` (creator only). Friendly `404` when no account exists; duplicate returns `409`. |
| `/api/competitions/[id]/ambassadors/[profileId]` | DELETE | Remove an ambassador (creator only). |
| `/api/competitions/join` | POST | **Participant registration.** Body carries only the opaque `token`. The event, ambassador and profile are derived server-side (token + session). Validates: link exists, link not revoked, event `active`. Idempotent — returns the existing participant instead of a duplicate. Unauthenticated → `401`. |
| `/api/competitions/[id]/join-links` | GET | List an event's join links (creator only). Never returns the raw token — only the digest was ever stored. |
| `/api/competitions/[id]/join-links` | POST | Generate a reusable join link + QR for one of the event's ambassadors (creator only). Returns the raw token and absolute join URL **exactly once**. |
| `/api/competitions/[id]/join-links/[linkId]` | DELETE | Revoke a join link (creator only). Preserves the row (`revoked_at`) so history survives. |
| `/api/competitions/[id]/participants` | GET | List participants + derived challenge state (creator **or** assigned ambassador). Returns only operational data — never participant emails. |
| `/api/competitions/[id]/verify` | POST | Resolve a participant by `code` (or opaque `token`). Creator **or** assigned ambassador; the credential is resolved server-side and scoped to the event. Marks first-seen presence. |
| `/api/competitions/[id]/participants/[participantId]/attempts` | GET | A participant's attempt history (creator **or** assigned ambassador). |
| `/api/competitions/[id]/participants/[participantId]/attempts` | POST | Record one attempt. Body carries **only** `result_value`; attempt number, `passed`, ownership and limits are server-resolved. Creator **or** assigned ambassador. Duplicates → `409`. |
| `/api/competitions/[id]/pass-token` | POST | Mint the authenticated participant's own opaque verification token (stores only the SHA-256 digest; returns the raw token once for the pass QR). |
| `/api/competitions/verify-qr/[token]` | GET | **Public** hosted PNG of a participant's verification QR (COMP-EMAIL-001). Rendered server-side from the SAME opaque token as `/competitions/verify/[token]` (`buildCompetitionVerifyUrl`), so the emailed QR and the on-screen pass QR encode an **identical** payload. No auth (mail image proxies are anonymous); `Cache-Control: no-store`; the token is never logged or echoed. |
| `/api/competitions/[id]/draw` | GET | COMP-006. Return the drawing result (winner name, eligible count, timestamp — never database ids) if one exists. Creator **or** assigned ambassador only; an unrelated user gets an opaque `404`. |
| `/api/competitions/[id]/draw` | POST | COMP-006. **Start the drawing.** The request body is ignored — the winner is selected server-side by the `start_competition_drawing` RPC and the eligible count is calculated server-side. Creator **or** assigned ambassador. No qualified participants → `409`; a second drawing → `409`. |
| `/api/competitions/[id]/tournament` | POST | TOURN-002. **Create/link the external tournament.** Body ignored (provider, format, slug, name resolved server-side). Creator **or** assigned ambassador. Already linked → `409`. Returns the tournament's neutral status (`201`). |
| `/api/competitions/[id]/tournament` | GET | TOURN-002. Tournament status (state, completeness, open matches, champion participant id). `409` + `code: "not_linked"` means the competition has no tournament yet — a state, not an error. Creator **or** assigned ambassador. |
| `/api/competitions/[id]/tournament/participants` | POST | TOURN-002. **Sync participants**: pushes registered participants that are not yet mapped and stores the returned provider ids (existing service, idempotent). Responds with counts only — `{ synced, alreadyMapped, total }`, never provider ids. Creator **or** assigned ambassador. |
| `/api/competitions/[id]/tournament/start` | POST | TOURN-002. **Start the tournament** (generates the bracket). Idempotent (`started: false` when already started); completed/unrecognised provider state → `409`. No bracket state is copied into Supabase. Creator **or** assigned ambassador. |
| `/api/competitions/[id]/tournament/matches` | GET | TOURN-002/003. **Read-only bracket**: neutral tournament state, mapped participants (FOM participant id + name) and every match (round, both sides, score, state, winner, and FOM's own `matchRef` for a reportable match). Provider match ids, provider participant ids and raw provider score fields are never returned. Creator **or** assigned ambassador. |
| `/api/competitions/[id]/tournament/matches/[matchId]/result` | POST | TOURN-003. **Report a match result.** The body carries FOM-neutral data only — `winnerParticipantId` (a `competition_participants.id`) plus `participant1Score`/`participant2Score`; the `[matchId]` segment is FOM's own match reference (`r{round}:{id}:{id}`), never a provider id. Provider-specific fields in the body (`winner_id`, `scores_csv`, a provider match id, …) are ignored. The **provider** advances the winner — FOM performs no bracket calculation; the caller re-reads `GET …/matches` afterwards. Creator **or** assigned ambassador. `400` malformed body / draw / winner not in the match, `404` match not in this tournament, `409` not linked / not started / already complete / match already settled / match not ready. |
| `/api/competitions/[id]/tournament/finalize` | POST | TOURN-003. **Explicitly finalize** the tournament after the last result — the provider's engine can keep a fully-played bracket awaiting review, so finalization is a deliberate second step. The request body is ignored; whether the tournament may be finalized is the **provider's** verdict (a refusal is surfaced as an honest provider-neutral error). Idempotent for an already-complete tournament (`finalized: false`). Returns the neutral status plus the champion as a `competition_participants.id`. Creator **or** assigned ambassador. |

### Debug

| Route | Methods | Purpose |
|---|---|---|
| `/api/debug/players` | GET | Diagnostic endpoint for player_profiles queries (counts, discoverable filter, sample rows). |
| `/api/debug/email-test` | GET/POST | **Development-only** transactional-email smoke test (EMAIL-001). Fails **closed** (`404`) in production. Sends a **fixed** subject/body (`FOM Sports email test` / `Your FOM Sports Brevo integration is working.`); the caller may only supply a recipient (`?to=` or JSON `{ to, name? }`). Returns the Brevo `messageId`. Never a production email relay. |
| `/api/debug/registration-email` | GET/POST | **Development-only** registration-email rendering smoke test (COMP-EMAIL-001). Fails **closed** (`404`) in production. Sends the **real** confirmation template with the **hosted** QR image so Gmail rendering can be verified end-to-end; the caller may only supply a recipient (`?to=` or JSON `{ to, name? }`). The sample QR token verifies no real participant. Requires the app to be reachable at a **public** host (Gmail fetches the image through its own proxy). Never a production email relay. |
| `/api/email/deliveries/process` | GET/POST | **Server-only** email outbox processor (EMAIL-002). Requires `Authorization: Bearer $EMAIL_DELIVERY_SECRET` (or `x-email-delivery-secret`). Fails **closed** (`404`) when the secret is unset or wrong. Drains `email_notification_deliveries` (atomic claim) and sends via Brevo. Returns aggregate counts only — never recipient addresses or provider state. |

---

## Competitions (COMP-001 / COMP-002 / COMP-003 / COMP-004 / COMP-005 / COMP-006 / COMP-007)

Competitions are an additive feature layered on the existing auth system + `profiles`
table. Being a competition **ambassador** is a competition-specific authorization
relationship (`competition_ambassadors`) — it is **never** derived from `profiles.role`,
and participation never requires marketplace onboarding.

### Operational delegation (COMP-005)

The creator creates and **owns** the competition; an assigned ambassador **runs** it on
event day. There is no role/permission framework — one concept only:

```
competition event manager = event creator OR assigned ambassador
```

This is the shared server-side helper `canManageEvent(eventId, profileId)` in
`lib/competition-server.ts` (creator from `competition_events.created_by`, ambassador
from `competition_ambassadors`). It is reused by participant listing, verification,
attempt recording and the QR-verification flow so there is a single operational-access
source of truth. `competition_ambassadors` has **no status column** — an existing row is
an active assignment, and removing the row removes the access immediately (authorization
is always re-evaluated server-side; no cached client state).

There is no migration for COMP-005 — the existing schema (0017/0018/0019) already
supports the rule, and the existing RLS policies already let the creator **and** an
assigned ambassador read/update participants and read attempts.

- **Schema (`supabase/migrations/0017_competition_foundation.sql`):** `competition_events`,
  `competition_participants`, `competition_ambassadors`. Lifecycle status CHECK:
  `draft | active | drawing | completed | cancelled`.
- **Pure helpers (`lib/competition.ts`):** status narrowing, challenge-config validation,
  the lifecycle **transition map** (`COMPETITION_EVENT_TRANSITIONS` /
  `isValidEventTransition`), and `computeCompetitionStatistics`.
- **Server helpers (`lib/competition-server.ts`):** `getAuthenticatedProfileId`,
  `isEventManager`, `isEventAmbassador`, `canManageEvent`, `getCompetitionViewerRole`,
  listing helpers, `getCompetitionStatistics`, and the COMP-002 mutations
  (`createCompetitionEvent`, `updateCompetitionEvent`, `changeCompetitionEventStatus`,
  `addCompetitionAmbassador`, `removeCompetitionAmbassador`,
  `getCompetitionAmbassadorsWithProfiles`).
- **API handlers (`lib/competition-api.ts`):** the tested request handlers that the route
  files under `app/api/competitions/**` delegate to.

### Participant verification & challenge attempts (COMP-004)

`supabase/migrations/0019_competition_attempts.sql` adds `competition_attempts`.

- **Pure helpers (`lib/competition-attempt.ts`):** `parseAttemptResultValue` (rejects
  missing/NaN/Infinity/malformed/out-of-range values), `meetsChallengeThreshold`
  (**larger-is-better**: result `>=` threshold — the single place pass/fail is decided),
  `getNextAttemptNumber`, `computeParticipantChallengeState` (attempts used/remaining,
  best/last result, qualification) and `resolveParticipantStatus`.
- **Server helpers (`lib/competition-attempt-server.ts`):** `getCompetitionParticipants`
  (`listCompetitionParticipantsWithState`), `getParticipantChallengeState`,
  `verifyCompetitionParticipantByCode` / `...ByToken`, `recordCompetitionAttempt`,
  `getParticipantAttempts`, `mintParticipantVerificationToken`. The operational helpers
  authorize the event **creator OR an assigned ambassador** via the shared
  `canManageEvent` rule (`mintParticipantVerificationToken` remains self-only: a
  participant mints their own pass token).
- **API handlers (`lib/competition-attempt-api.ts`):** thin adapters used by
  `app/api/competitions/[id]/participants/**`, `.../verify` and `.../pass-token`.

### Public results & admin-only creation (COMP-007)

Two additions:

1. **A public, no-auth competition results dashboard** at `/competitions/results`
   (linked in the main navigation for everyone). It reads through the dedicated
   server helper `lib/competition-public-server.ts` → `getPublicCompetitionResults()`,
   which is the single **public data boundary**: it uses the service-role client
   (so no RLS loosening is required — `competition_participants`, `profiles` and
   `player_profiles` are **not** made public), joins participants → profiles →
   player_profiles → drawings in a handful of queries, and projects rows down to
   public-safe fields only (display name, avatar, `player_profiles.id` for linking,
   winner flag). Components never receive a raw row. It exposes no participant ids,
   `profiles.id`, emails, verification codes/tokens or join tokens.

   - **Qualified participants** come from the authoritative COMP-004 state
     (`competition_participants.status = 'qualified'`). Registered, failed or
     never-attempted participants are excluded.
   - **Winner** comes from the persisted COMP-006 drawing (`competition_drawings`);
     it is never randomly reselected and never computed on the client. Competitions
     with no drawing show **"Drawing pending"** — never a fake winner.
   - **Player profile links:** a qualified participant's name links to the existing
     public `/players/[id]` route **only** when a `player_profiles` row exists;
     otherwise the plain name is shown (no broken link). Participation does not
     require a player profile (COMP-003).

2. **A temporary admin-only competition-creation restriction.** Only the
   authenticated profile whose id equals the server-only env var
   `MULTI_TEAM_ADMIN_USER_ID` may create a competition.

   ```
   MULTI_TEAM_ADMIN_USER_ID
           ↓
   only matching authenticated user
           ↓
   can create competitions
   ```

   - Server helper `isCompetitionCreationAdmin(profileId)` in
     `lib/competition-server.ts` — one responsibility, **fails closed** when the env
     var is missing (never open to everyone). Never derived from `profiles.role` and
     never exposed to the browser (no `NEXT_PUBLIC_`).
   - Enforced in **three** places for one authoritative operation: the
     `POST /api/competitions` route (`403` for non-admins), the actual
     `createCompetitionEvent` helper (returns `null` for non-admins), and the
     `/competitions/new` server page (`404` for non-admins). The management page
     hides the **Create Competition** action for non-admins.
   - **Ambassador operational permissions are unchanged** (COMP-005): ambassadors can
     still manage assigned events, verify participants, record attempts, see
     qualification and start the drawing. The restriction applies to creating a
     **new** competition only.
   - **No migration** — the existing schema already supports the public query and the
     restriction.

### Drawing & winner selection (COMP-006)

`supabase/migrations/0020_competition_drawings.sql` adds `competition_drawings` and the
`start_competition_drawing` RPC. Once participants have been run and qualified, a manager
starts **one** drawing that selects **one** winner. The model is intentionally minimal —
no weighted entries, tickets, multiple winners or rerolls.

- **Eligibility** is the existing COMP-004 state: a participant is eligible when
  `competition_participants.status = 'qualified'`. The server counts them; the browser
  never supplies eligibility or a count.
- **Random selection** happens **server-side** inside the RPC (`ORDER BY random() LIMIT 1`
  over the qualified set) — never `Math.random()` in a component.
- **Persistence:** the drawing row stores only the winner relationships
  (`winner_participant_id`, `winner_profile_id`), the server-calculated
  `qualified_participant_count` snapshot, the initiator (`drawn_by_profile_id`) and
  `drawn_at`. Display names are resolved from the referenced profile at render time — no
  personal data is copied.
- **One drawing per event:** a `UNIQUE(event_id)` index plus the RPC's row lock
  (`FOR UPDATE`) guarantee that two simultaneous "Start Drawing" requests produce exactly
  one winner. The second request receives `409 DRAWING_ALREADY_EXISTS`.
- **Lifecycle:** the drawing moves the event to the terminal `completed` state. A drawing
  is only startable from `active` (or the prepared `drawing`) status.
- **Immutable:** there is no update/delete path for a drawing and no "Draw Again" action.
- **Pure helpers (`lib/competition-drawing.ts`):** `isEventDrawable`,
  `getDrawingUnavailableReason`.
- **Server helpers (`lib/competition-drawing-server.ts`):** `getQualifiedParticipantCount`
  (display-safe count), `getCompetitionDrawing` (creator-or-ambassador read),
  `startCompetitionDrawing` (re-checks authorization, then runs the atomic RPC).
- **API handlers (`lib/competition-drawing-api.ts`):** thin adapters used by
  `app/api/competitions/[id]/draw` (GET/POST).
- **UI:** the `DrawingPanel` (`app/competitions/[id]/DrawingPanel.tsx`) renders in the
  event page for the creator **and** assigned ambassadors. It shows a **Start Drawing**
  action with a confirmation step (including the eligible count) and, after the draw, the
  immutable winner result (name, eligible count, timestamp). Participants do not gain
  access to drawing management data.

Authorization for the operational endpoints is **creator OR assigned ambassador**
(COMP-005). Registration in `competition_ambassadors` is the sole source of ambassador
authority — it is never read from `profiles.role`, the browser, or a client-supplied
`event_id` / `profile_id`. No client-supplied profile/participant/event id, attempt
number, threshold or `passed` value is ever trusted, and the operator view never exposes
participant emails or other private profile fields.

Concurrency / idempotency: `UNIQUE(participant_id, attempt_number)` makes a duplicate
attempt number fail (`23505` → HTTP `409`); a passing attempt closes the challenge
(no further attempts); a `BEFORE INSERT` trigger independently rejects cross-event
participants and any attempt beyond `max_attempts`.

### Lifecycle (controlled)

Transitions are validated server-side — the client can never set an arbitrary status:

```
draft    → active | cancelled
active   → drawing | cancelled
drawing  → active | completed
completed (terminal)
cancelled (terminal)
```

`drawing` prepares the event for the future raffle ticket; **winner selection is out of
scope for COMP-002**. The transition map is the single, extensible place to change this if
a later ticket (e.g. COMP-007) must own `drawing → completed`.

### Authorization rules

| Capability | Event creator | Ambassador | Other user |
|---|---|---|---|
| View event / stats | ✅ | ✅ | ❌ |
| Edit event configuration | ✅ | ❌ | ❌ |
| Change lifecycle status | ✅ | ❌ | ❌ |
| Add / remove ambassadors | ✅ | ❌ | ❌ |

All checks run server-side; disabled UI is never the authorization boundary.

---

## Tournament Provider Integration (TOURN-001)

FOM runs competitive brackets on an **external tournament engine**. FOM does not know
*which* engine: every tournament operation goes through a provider-neutral contract, and
the only module in the codebase that knows Challonge exists is the Challonge adapter.

```
FOM competition code / service
        │
        ▼
TournamentProvider  (contract)      lib/integrations/tournament/types.ts
        │
        ▼
provider registry  ("challonge")    lib/integrations/tournament/registry.ts
        │
        ├── ChallongeProvider       providers/challonge.ts   ← implemented (v1)
        └── FutureProvider          ← not built, and nothing outside the folder changes
```

### Design rules

- **The rest of FOM never imports a provider.** Feature/server code imports
  `@/lib/integrations/tournament` (the service) and receives FOM-neutral objects. Nothing
  outside `providers/` may contain `challonge`, `scores_csv`, `player1_id`,
  `tournament_type`, `awaiting_review` or `api_key`.
- **Challonge is the source of truth for tournament state** — bracket structure, match
  progression, match state, scores and advancement. **FOM is the source of truth for users,
  profiles, competition registration, permissions and FOM metadata.** Only the identifiers
  needed to connect the two systems are stored in Supabase (no mirrored match/bracket tables).
- **Provider ids are strings.** FOM never assumes a provider uses numeric ids.
- **A failed provider call is never a successful FOM operation.** Every failure surfaces as a
  typed `TournamentProviderError` and a discriminated `{ ok: false, error, status }` result.
- **The API key never leaves the server**, is never logged, and is never included in an error
  message (provider error text is scrubbed of `api_key=...` as defence-in-depth).

### Provider contract

`lib/integrations/tournament/types.ts` — FOM's needs, not Challonge's API:

| Operation | Purpose |
|---|---|
| `supportsFormat(format)` | Whether this adapter can actually **create** that format (its own capability declaration — the UI and the service trust it instead of assuming) |
| `createTournament({ name, slug, config })` | Create the tournament on the provider, from FOM's neutral configuration (`{ format }`) |
| `getTournament(idOrSlug)` | Read state (`created` / `started` / `completed` / `unknown`); returns `null` only for a definitive "not found" |
| `addParticipants(id, [{ ref, displayName }])` | Add FOM participants, returning the provider id correlated by FOM's own `ref` |
| `getParticipants(id)` | List provider participants (reconciliation aid) |
| `startTournament(id)` | Start and generate the bracket |
| `getMatches(id)` | Read the bracket as FOM-neutral `TournamentMatch[]` |
| `reportMatchResult(id, { matchId, participant1Score, participant2Score, winnerParticipantId? })` | Submit a result in the provider's own match/participant ids (the service translates FOM's ids/reference into these before calling — see TOURN-003); advancement is the provider's job |
| `finalizeTournament(id)` | Finalize after the last result (idempotent) |
| `getWinner(id)` | Champion of a *completed* tournament (never a semi-finalist) |

FOM-neutral types: `Tournament`, `TournamentFormat`, `TournamentConfig` (`{ format }`),
`TournamentState`, `TournamentParticipant`, `ProviderParticipantView`, `TournamentMatch`
(`matchId`, `round`, `participant1Id`, `participant2Id`, `state`, `score`, `winnerParticipantId`),
`TournamentMatchState` (`pending` / `ready` / `completed` / `unknown`), `TournamentWinner`.
An unrecognised provider state maps to `unknown` — FOM refuses to *act* on it rather than
guessing.

Challonge v1 translation lives entirely in `providers/challonge.ts`:

| Challonge | FOM |
|---|---|
| `player1_id` / `player2_id` / `winner_id` (numbers) | `participant1Id` / `participant2Id` / `winnerParticipantId` (strings) |
| `scores_csv` (`"3-1"`, `"3-1,2-2"`) | `score: { participant1Score, participant2Score }` (first leg) |
| `state: pending / open / complete` | `state: pending / ready / completed` |
| `state: pending / underway / awaiting_review / complete` | `state: created / started / started / completed` |
| `tournament_type: "single elimination"` | `format: "single_elimination"` (creatable) |
| `tournament_type: "double elimination" / "round robin" / "swiss"` | `format: "double_elimination" / "round_robin" / "swiss"` (translate-only, see below) |

### Tournament formats and configuration (TOURN-002A)

The tournament format is a **FOM concept**, chosen by the organiser and stored by FOM; the
adapter decides how it is represented on the provider's side.

- **Modelled formats** (`TOURNAMENT_FORMATS`): `single_elimination`, `double_elimination`,
  `round_robin`, `swiss`, `group_stage_knockout` — the vocabulary FOM can represent.
  `DEFAULT_TOURNAMENT_FORMAT` is `single_elimination` (also what a competition with no
  recorded format is read as, which is what keeps pre-TOURN-002A tournaments working).
- **Creatable formats**: decided per adapter by `supportsFormat()`, derived from the same map
  the adapter uses to build its creation request (`CHALLONGE_TOURNAMENT_TYPES`), so the
  advertised capability and the wire mapping can never drift. The current Challonge adapter
  advertises **`single_elimination` only** (`CHALLONGE_SUPPORTED_FORMATS`).
- **Modelled ≠ creatable.** `round_robin`, `swiss`, `double_elimination` and
  `group_stage_knockout` are represented so they can be read and reported, but requesting one
  returns `400` — it is **never** substituted with a supported format. The UI shows them
  disabled as “Coming soon”.
- **Reading is not creating.** The adapter translates the provider `tournament_type` values FOM
  models (so a tournament FOM could not create is still described honestly instead of being
  reported as single elimination); anything else is an invalid provider response, never a guess.
- **Persistence:** `competition_events.tournament_format` (migration `0024`) — FOM's own value,
  written in the same conditional UPDATE as the provider mapping, constrained to the modelled
  formats, and NULL for a competition with no tournament. No provider request/response shape is
  ever stored and no provider-specific table exists.
- **Capability reporting:** `getEventTournamentFormatOptions(eventId, viewerProfileId)` returns
  `[{ format, supported }]` for every modelled format, and the summary endpoint reports that list
  on its `409 { code: "not_linked" }` response — the UI builds its format selector from it, so
  nothing is hard-coded in the browser.

### Challonge adapter (v1)

`lib/integrations/tournament/providers/challonge.ts` is the **only** Challonge-aware module.
It uses `fetch()` directly (no SDK dependency), authenticates with the server-only
`CHALLONGE_API_KEY` **as the v1 `api_key` query parameter**, and never logs the key or a URL
that contains it. Implemented against the behaviour verified live by the POC
(`lib/integrations/challonge-poc/`, kept untouched as the evidence artefact):

```
POST /v1/tournaments.json                                  create
GET  /v1/tournaments/{id}.json                             read (also by slug)
POST /v1/tournaments/{id}/participants/bulk_add.json       add participants
GET  /v1/tournaments/{id}/participants.json                list participants
POST /v1/tournaments/{id}/start.json                       start
GET  /v1/tournaments/{id}/matches.json                     read matches
PUT  /v1/tournaments/{id}/matches/{match_id}.json          submit a result
POST /v1/tournaments/{id}/finalize.json                    finalize
```

- Throttled (`429`) and server-error (`5xx`) responses are retried a bounded 2 times with
  backoff, honouring `retry-after` (capped). Every other non-2xx becomes a typed error.
- Error mapping: `401/403` → `provider_auth_failed`, `404` → `provider_not_found`,
  `422`/other `4xx` → `provider_invalid_request` (with the provider's own message, truncated
  and scrubbed), `5xx`/`429` → `provider_unavailable`, network failure →
  `provider_request_failed`, unparseable body → `provider_response_invalid`.
- A response that cannot be correlated (participant count/order mismatch, missing object) is
  **rejected** instead of being mapped to a guessed value.
- `finalize` is required to leave `awaiting_review` (the provider's `review_before_finalizing`
  setting); on an unfinalizable bracket the provider answers `400` with an **empty body**, which
  is surfaced as a clear "the bracket may still have unreported matches" error.
- The tournament `url`/slug accepts letters, numbers and underscores only (hyphens are
  rejected with `422`) — see the slug rules below.

### Registry (how a second provider would be added)

`registry.ts` is a deliberately tiny factory — no DI container, plugin loader, dynamic import
or configuration framework:

```ts
resolveTournamentProvider("challonge") // → ChallongeProvider
resolveTournamentProvider("nope")      // → throws provider_unknown
getDefaultTournamentProvider()         // → Challonge (default)
```

Resolution does **not** require credentials: the key is read lazily on the first actual call,
so a missing key fails closed at call time (`provider_not_configured`, HTTP `503`) instead of
silently degrading. Adding a provider means writing one adapter (including that adapter's own
`supportsFormat` capability declaration) and adding one `case` — no migration (the `provider`
column is free-form text) and no change to FOM.

### FOM ↔ provider mapping

| FOM | Stored | Provider |
|---|---|---|
| `competition_events` | `provider` (`"challonge"`) + `provider_tournament_id` + `tournament_format` | the tournament |
| `competition_participants` | `provider_participant_id` | the bracket entry for that participant |
| bracket / matches / scores / advancement | **not stored in FOM** | read live via `getEventTournamentBracket` / `getEventTournamentSummary` |

- **Competition → tournament:** `createEventTournament(eventId, profileId, { config })` derives the
  provider name from the competition, a deterministic slug from the competition id
  (`fom_evt_<competition-id-hex>`) and a display name from the competition name, creates the
  tournament in the requested (validated, provider-supported) format, and stores the two provider
  columns **and the format** on the event in one conditional UPDATE.
- **Participant → provider participant:** `addEventParticipantsToTournament(eventId, profileId)`
  pushes every *unmapped* `competition_participants` row (identity from FOM, display name from
  `profiles.full_name` with a positional fallback — never an email), then stores the returned
  `provider_participant_id` on that row. Already-mapped participants are skipped, so the call is
  safe to repeat. Participants are pushed in bounded batches of 64, and each batch's mapping is
  saved immediately after the provider confirms it.
- **Match → FOM match:** `getEventTournamentBracket(eventId, viewerProfileId)` returns
  FOM-neutral matches **plus** the provider-participant → `competition_participants.id` map, so
  no caller ever handles `player1_id` or `scores_csv`.

### Service functions (server-side only)

`lib/integrations/tournament/service.ts` — every function authorizes with the **existing**
competition rule (`canManageEvent` = event creator or assigned ambassador; never
`profiles.role`) and returns `CompetitionMutationResult<T>`
(`{ ok: true, data }` / `{ ok: false, error, status }`):

| Function | Does | Typical failures |
|---|---|---|
| `createEventTournament(eventId, profileId, { providerId?, config? })` | Creates the provider tournament in the requested format and stores the mapping **and** the format | `400` unsupported/uncreatable format, `403` not authorized, `404` competition, `409` already linked, `503` not configured, `502` provider |
| `getEventTournamentFormatOptions(eventId, viewerProfileId)` | Every modelled format with the provider's own `supported` flag (the UI's capability source) | `403`, `404`, `502/503` provider |
| `addEventParticipantsToTournament(eventId, profileId)` | Pushes unmapped participants + stores their provider ids | `409` not linked, `500` mapping not saved, `502` provider |
| `startEventTournament(eventId, profileId)` | Starts the bracket (idempotent) | `404` missing, `409` completed/already finished/unrecognised state, `502` provider |
| `getEventTournamentBracket(eventId, viewerProfileId)` | FOM-neutral bracket + participant map | `403`, `404`, `409` not linked, `502` provider |
| `reportEventMatchResult(eventId, profileId, { matchRef, winnerParticipantId, participant1Score, participant2Score })` | TOURN-003. Translates FOM's match reference + `competition_participants.id` into the provider's ids and submits the result (**advancement is the provider's**); returns the updated match + the participant map | `400` malformed input / draw / winner not in the match, `404` match not in this tournament, `409` not linked/not started/already complete/match already settled/not ready, `502` provider |
| `finalizeEventTournament(eventId, profileId)` | TOURN-003. Finalizes explicitly (idempotent) and returns the champion **resolved to a `competition_participants.id`** | `404`, `409` not started/unrecognised, `400` refused by the provider, `502` provider |
| `getEventTournamentSummary(eventId, viewerProfileId)` | State, completeness, open matches, champion resolved to a FOM participant | `403`, `404`, `409`, `502` |

Status mapping is provider-neutral: `provider_not_configured` → `503`,
`provider_auth_failed` / `provider_unavailable` / `provider_request_failed` /
`provider_response_invalid` → `502`, `provider_not_found` → `404`,
`provider_invalid_request` / `tournament_invalid_input` → `400`. Reads and writes
skip the bracket query entirely for a tournament that has not started, and a champion is
only resolved for a **completed** tournament.

**No HTTP routes or UI are part of TOURN-001** — it is server-side callable only, so the
tournament API surface and UI were designed together in **TOURN-002** around these real
workflows (next subsection).

### Tournament management API + panel (TOURN-002)

The first usable workflow on top of the service above: **create/link → sync participants → start →
read-only bracket**, exposed as thin App Router routes plus a panel on the existing competition
page. No new service layer and every operation calls exactly one service function;
**TOURN-002A** adds the organiser's format choice (migration `0024` + the small
`getEventTournamentFormatOptions` capability read it reports).

| Route | Method | Service call | Success | Failures |
|---|---|---|---|---|
| `/api/competitions/[id]/tournament` | POST | `createEventTournament` | `201 { tournament }` | `400` (malformed/unsupported format) + `403/404/409/500/502/503` |
| `/api/competitions/[id]/tournament` | GET | `getEventTournamentSummary` | `200 { tournament }` (incl. `format`) | `409 { code: "not_linked", formats }` state + `400/403/404/500/502/503` |
| `/api/competitions/[id]/tournament/participants` | POST | `addEventParticipantsToTournament` | `200 { synced, alreadyMapped, total }` | `400/403/404/409/500/502/503` |
| `/api/competitions/[id]/tournament/start` | POST | `startEventTournament` | `200 { started, tournament }` | `400/403/404/409/500/502/503` |
| `/api/competitions/[id]/tournament/matches` | GET | `getEventTournamentBracket` | `200 { tournamentState, participants, matches }` | `409 { code: "not_linked" }` + `400/403/404/500/502/503` |
| `/api/competitions/[id]/tournament/matches/[matchId]/result` | POST | `reportEventMatchResult` | `200 { match }` (FOM-neutral, its sides/winner resolved to participants) | `400/403/404/409/500/502/503` |
| `/api/competitions/[id]/tournament/finalize` | POST | `finalizeEventTournament` | `200 { finalized, winnerParticipantId, tournament }` | `400/403/404/409/500/502/503` |

- The handlers live in `lib/tournament-api.ts` (route files are thin wrappers, matching
  `lib/competition-api.ts` / `lib/competition-drawing-api.ts`): authenticate from the NextAuth
  session, delegate to one service function, and pass the service's own HTTP status through.
  **The create request's body is read for exactly one value — the format** (TOURN-002A): it is
  validated against FOM's modelled formats (`400` otherwise) and re-validated by the service. The
  provider, slug, tournament name, participants and bracket stay server-side, so the browser can
  neither influence nor discover which engine is used.
- **Provider-neutral payloads.** Before a response leaves `lib/tournament-api.ts`, the provider
  tournament id, provider participant ids, provider match ids and the provider `link` object are
  dropped. Each match side and winner becomes `{ participantId: <competition_participants.id>,
  name }`; a side that exists on the provider but is not mapped to a FOM participant is reported
  as `Unknown participant` rather than by its provider id.
- **Panel states** (`app/competitions/[id]/TournamentPanel.tsx`): *not linked* → **Tournament
  Format** selector + **Create Tournament** (the selector is built from the server's capability
  list: only formats the provider can create are selectable, the others appear as
  `… — Coming soon` and are disabled, Create is disabled when nothing is selectable, and a
  manipulated selector cannot make an unavailable format the selection);
  *linked, nothing synced* → the recorded format (`Format: Single Elimination`) + **Sync
  Participants**; *N participants synced* → **Start Tournament** plus **Sync Participants** (kept
  available so players registered after the first sync can be added — the sync is idempotent);
  *started* → the bracket, an inline **result form** on every playable match and **Finalize
  Tournament**; *completed* → the bracket, every result and the winner (the TOURN-003 states are
  described in the next subsection). The bracket is grouped by the rounds the provider reports
  (never a fixed round count or fixed round names).
  Loading, empty-bracket, unauthorized (`401/403`, no controls rendered) and provider-error
  (`404/5xx` + Retry) states each have their own view. Starting asks for confirmation.
- **Authorization is the TOURN-001 rule unchanged** (`canManageEvent` = creator **or** assigned
  ambassador). The panel is only reachable from the role-aware competition page, and every API call
  re-checks server-side; `profiles.role` and `MULTI_TEAM_ADMIN_USER_ID` are never consulted.
- **Deliberately not part of TOURN-002** (later tickets): result reporting, finalization,
  participant removal, a dedicated bracket visualization, polling/webhooks, notifications, and any
  match/round/standings table. (Result reporting and finalization are delivered by TOURN-003; the
  rest remain future work.)

### Match result reporting, advancement and finalization (TOURN-003)

The competition manager can now **report a result → the provider advances the winner → FOM re-reads
the bracket → FOM finalizes explicitly → FOM shows the champion**, without FOM ever knowing how a
bracket works.

- **FOM's own match reference.** The bracket reports a `matchRef` per match —
  `r{round}:{participant1Id}:{participant2Id}`, built by `toMatchReference`
  (`lib/integrations/tournament/contract.ts`) from the round the provider reported and the two
  `competition_participants.id` values the provider's sides resolved to. It is an **identifier, not
  bracket logic** (nothing is ever derived from it), it is opaque to the client, and it contains no
  provider id. It is `null` — and no result form is offered — while a side is undecided or is not
  mapped to a competition participant.
- **The translation boundary is the service.** `reportEventMatchResult` resolves the reference back
  to the provider's match (by recomposing the same reference from the provider's matches + the
  existing `competition_participants.provider_participant_id` mapping), translates the winning FOM
  participant id into the provider's id, and only then calls
  `TournamentProvider.reportMatchResult` (which still speaks the provider's own ids/format, with
  `scores_csv`/`winner_id` living exclusively in the adapter). The browser never sends or receives a
  provider id.
- **Server-side validation before anything is called:** the reference must be well formed, the
  scores must be whole and non-negative, a **draw is rejected** (FOM has no tie-break rule), a
  winner is required, the tournament must be linked and `started`, the match must belong to this
  tournament, must not already be settled (the current provider contract has no correction) and must
  be `ready`, and the selected winner must actually be one of the two sides.
- **Zero local advancement.** There is no code that computes a next round, a bracket position, a
  seed or a winner path — the service submits the result and returns what the provider reports; the
  panel then re-reads `GET …/matches`, so the newly populated next-round slot is whatever the engine
  decided.
- **Explicit finalization.** Finalization is a separate, deliberate action
  (`POST …/tournament/finalize`, body ignored): the provider's engine may keep a fully-played
  tournament awaiting review. Whether the tournament *may* be finalized is the provider's verdict —
  FOM does not count matches or reimplement an "all matches complete" rule, and a refusal is
  surfaced as a provider-neutral error. An already-complete tournament is handled idempotently
  (`finalized: false`).
- **The champion comes from the provider** (`getWinner()`, only for a completed tournament) and is
  resolved back to a `competition_participants.id`, so the panel shows `Winner: <player name>` from
  normal FOM participant data. The Finalize button disappears once the tournament is complete.
- **UI states.** A playable match shows the score inputs, a required winner choice and **Report
  Result**; a completed match shows its score and `Winner: <name>` and offers nothing; a TBD match
  (or one with an unmapped side) offers nothing. After a successful report the panel refreshes the
  summary and the bracket (no polling, no webhooks, no realtime sync). Provider errors are shown in
  FOM terms only (e.g. *"This match is not ready for a result yet"*, *"The selected winner is not a
  participant in this match"*, *"This match already has a result"*).
- **No database migration.** FOM still stores only identifiers/mappings: match state, scores,
  advancement, completion and the winner stay on the provider.

### Duplicate-creation protection (idempotency)

Creating a tournament is an external side effect that cannot be rolled back by a database
transaction. The minimum practical protection is implemented instead of a distributed
transaction:

1. **Pre-check** — a competition that already has `provider_tournament_id` is rejected with
   `409` before any provider call.
2. **Deterministic slug** — the slug is derived from the competition id
   (`fom_evt_<hex>`, letters/numbers/underscores only), so a retry after "created but crashed
   before saving" produces the *same* slug. The provider rejects duplicate slugs, so the
   service recognises the earlier creation and **adopts** the existing tournament
   (it re-reads it by slug) instead of creating a second one. This also resolves two
   concurrent create requests: both end up linked to the same tournament.
3. **Conditional write** — the mapping is written with `UPDATE ... WHERE
   provider_tournament_id IS NULL`; if 0 rows change, the service re-reads the row and
   succeeds only when it points at the *same* tournament (otherwise `409`).

`UNIQUE(provider, provider_tournament_id)` (and, per event,
`UNIQUE(event_id, provider_participant_id)`) enforce the same guarantees at the database level.
`startEventTournament` and `finalizeEventTournament` are idempotent.

**Limitation (not solved, by design):** if the external tournament is deleted on the provider
between attempts, a new one is created; if the provider confirms participants but the mapping
write fails, the call fails with `500` and the affected participant ids are logged for
reconciliation (`getParticipants` on the provider is the reconciliation tool). FOM never deletes
external tournaments, and there is no compensating transaction.

### Configuration

| Variable | Scope | Notes |
|---|---|---|
| `CHALLONGE_API_KEY` | server-only | Authenticates Challonge v1 for the POC **and** the production adapter. Never `NEXT_PUBLIC_`, never logged, never in an error message. Missing → `provider_not_configured` (`503`), no API call attempted. |

No provider-selection variable exists: a competition stores its own `provider` value, so
multiple providers can coexist per competition without any global switch.

### Known limitations

- **API v1 only.** The adapter targets Challonge **v1** (the version the POC authenticated
  against). The v2.1 probe in the POC is not used and no dual-version support exists; a v2
  migration is a deliberate future change.
- **No webhooks or polling.** Match state is read on demand. There is no background sync, so
  FOM cannot react to changes made directly in the Challonge UI, and there is no automatic
  completion trigger after the final result — the competition manager finalizes explicitly from the
  panel (TOURN-003), which then re-reads the bracket.
- **No participant removal.** The contract deliberately omits removal: the v1
  `DELETE /participants/{id}.json` endpoint was **not** verified by the POC and is not invented
  here. Removing a participant from a bracket is a follow-up.
- **Rate limits.** ~30 calls per tournament creation flow. A bounded retry with backoff covers
  `429`s, but a large roster sync (batches of 64) or a burst of result submissions could be
  throttled; there is no global rate limiter or queue.
- **No bracket tables in FOM.** Standings/advancement are only ever read live from the
  provider, so FOM cannot query its own tournament history offline. This is intentional:
  mirroring the engine would create two sources of truth.
- **Only single elimination can be CREATED today.** FOM models `single_elimination`,
  `double_elimination`, `round_robin`, `swiss` and `group_stage_knockout` (so they can be
  represented, read and reported), but the current Challonge adapter can only create
  `single_elimination` and advertises exactly that. Any other format is refused with `400` — it is
  never silently converted into a supported one, and the UI offers it disabled as “Coming soon”.
  A provider `tournament_type` FOM has no value for is still reported as an invalid provider
  response rather than guessed.
- **Format drift is not detected.** The format recorded by FOM is what the UI displays; if the
  bracket were changed on the provider's side afterwards, FOM would not notice (the provider stays
  the source of truth for the bracket, but there is no reconciliation of the two).
- **Known draw limitation.** A level score is rejected (`400`) at the API, in the service and in the
  adapter: FOM tournaments do not model draws, and submitting one would leave the provider's bracket
  stuck. No tie-break rule is invented.
- **No result correction.** A match the provider already reports as settled cannot be re-reported
  (`409`) — the current provider contract has no notion of correcting a settled result, so that is a
  later ticket rather than something FOM guesses at.
- **A match with an unmapped side cannot be reported.** FOM addresses a match by its two
  competition participants, so a bracket side that is not mapped to `competition_participants.id`
  has no `matchRef` and is read-only (shown as `Unknown participant`). The supported flow syncs every
  registered participant before starting, so this only occurs if a bracket is edited directly on the
  provider.
- **Multi-leg scores.** Only the first leg of a provider `scores_csv` is mapped; FOM submits a
  single leg.
- **Unrecognised provider states are refused.** If Challonge introduces a state FOM does not
  model, `start`/`finalize` refuse to act (`409`) rather than guessing.

### What is deliberately NOT built (separate later tickets)

Participant removal from a bracket, result **correction**, a dedicated bracket
dashboard/visualization, public tournament pages, standings UI, registration/QR changes, webhooks,
polling workers, realtime provider synchronization, notifications, email, payments,
group-stage/Swiss/double-elimination **mechanics** (TOURN-002A models and reports those formats, but
only `single_elimination` can be created), and any provider-specific tables for matches/rounds/
standings. TOURN-002 adds **no** new tournament abstraction, no provider import outside `providers/`,
and no duplicated provider state; TOURN-002A adds one FOM-owned configuration value
(`tournament_format`) and one capability read; TOURN-003 adds result reporting + explicit
finalization **on top of** the existing provider contract — it replaces neither abstraction and
implements **no** bracket engine, no advancement logic and no new table.

### Manual live check against Challonge

The unit tests mock the network. To exercise the **production adapter** against the real API,
an opt-in, clearly separated check exists (it never touches Supabase or FOM data):

```bash
# Read-only: verifies authentication, and reads a real tournament when you point at one.
# An unknown id is fine — a 404 must map to null, not an error.
TOURNAMENT_LIVE_TEST=1 \
CHALLONGE_LIVE_TOURNAMENT_ID=<tournament-id-or-slug> \
node --env-file=.env.local node_modules/vitest/vitest.mjs run \
  lib/integrations/tournament/providers/challonge.live.test.ts

# Full adapter flow: creates a real PRIVATE tournament, adds participants, starts it,
# reports results and finalizes it. Nothing is deleted afterwards; FOM data is untouched.
TOURNAMENT_LIVE_TEST=1 TOURNAMENT_LIVE_CREATE=1 \
CHALLONGE_LIVE_PARTICIPANTS="FOM Live One,FOM Live Two" \
node --env-file=.env.local node_modules/vitest/vitest.mjs run \
  lib/integrations/tournament/providers/challonge.live.test.ts
```

The end-to-end workflow (create → 16 participants → start → results → advancement → finalize →
winner) remains verified by the isolated POC:
`node lib/integrations/challonge-poc/run-poc.ts` (see its
[README](lib/integrations/challonge-poc/README.md)).

---

## Competition Join Links (COMP-003)

The player-facing entry flow: an ambassador shares a reusable join link / QR code,
a player scans it, authenticates through the **existing** NextAuth flow, and
registers for the competition.

```
Ambassador → get unique join link + QR → player scans → /competitions/join/[token]
  → (Sign in / create account if necessary, returning to the same URL)
  → Register → competition_participants row → pre-entry pass
```

- **Schema (`supabase/migrations/0018_competition_join_links.sql`):** adds
  `competition_join_links`, plus `verification_code` / `verification_token_hash`
  columns on `competition_participants`.
- **Join-link ownership:** a link belongs to an **event** (`event_id`) **and** an
  **ambassador relationship** (`ambassador_id` → `competition_ambassadors.id`),
  never directly to a profile. This records *which ambassador* shared the link.
- **Token security (`lib/competition-join.ts`):** the raw token is generated with
  `crypto.randomBytes(32)` (256 bits, base64url) and returned **once** for the URL /
  QR. Only its SHA-256 hex digest is stored (`token_hash`, UNIQUE). A DB leak never
  exposes active join URLs.
- **Reusable, not one-time:** the same link/QR may be scanned by many players. Each
  authenticated profile registers independently (enforced by UNIQUE(`event_id`,
  `profile_id`) on `competition_participants`).
- **Derived state:** `revoked_at != null → revoked`, else `active` (no status column).
- **Event eligibility (server-side):** only `status = active` accepts registration;
  `draft` / `drawing` / `completed` / `cancelled` are rejected by the mutation, not
  merely hidden in the UI.
- **Server helpers (`lib/competition-join-server.ts`):** `getCompetitionJoinByToken`
  (public resolution), `createCompetitionJoinLink` / `revokeCompetitionJoinLink`
  (creator-only), `getCompetitionJoinLinks`, `registerForCompetition` (idempotent),
  `getCompetitionPass`, `isRegisteredForEvent`.
- **API handlers (`lib/competition-join-api.ts`):** the tested handlers the route
  files under `app/api/competitions/**` delegate to.
- **Registration is lightweight:** it uses the existing auth system + `profiles`
  only. It **never** requires `player_profiles`, never redirects to player
  onboarding, and never creates a player profile automatically.
- **Initial participant status:** `registered` (from the COMP-001 status model).
- **Pre-entry pass:** after registration the participant sees a private pass
  (`/competitions/join/[token]/pass`) with a human-readable, random, UNIQUE
  `verification_code` (ambiguity-free alphabet) for the later ambassador flow. No
  email / profile id / player profile id is ever used as the public code.
- **QR codes:** rendered client-side with the `qrcode` library, encoding **only** the
  public join URL. No participant data, email, profile id, or private event info.
- **Auth continuation:** the join page is public; if not signed in it links to
  `/login?callbackUrl=<join path>`, and the existing safe-callback guard
  (`lib/invite-callback.ts`) prevents external redirect injection. The Google OAuth
  configuration is unchanged.

### Authorization rules (COMP-003)

| Capability | Event creator | Ambassador | Authenticated player | Anonymous |
|---|---|---|---|---|
| View public join page | ✅ | ✅ | ✅ | ✅ |
| Generate / revoke a join link | ✅ | ❌ | ❌ | ❌ |
| Register (active event, valid link) | ✅ | ✅ | ✅ | ❌ |
| View own pass | ✅ | ✅ | ✅ (own) | ❌ |

---

## Realtime System

### Architecture

```
Server (lib/realtime-broadcast.ts)
  emitToUser(userId, event, payload)          → channel "user:<userId>"
  emitToConversation(convId, event, payload)  → channel "conversation:<convId>"

Client
  GET /api/realtime/channels?type=...         → { channel, signature, expires_at }
  supabase.channel(channelName).on("broadcast", ...)
```

### Security

- Channel names are **HMAC-SHA256 signed** with `REALTIME_CHANNEL_SECRET` (5-minute TTL).
- The `/api/realtime/channels` endpoint verifies the user is a participant before signing a conversation channel.
- Clients verify the signature before subscribing (via `verifySignedChannel`).
- Broadcast payloads include the signature (`_signed`) so clients can validate.

### Client Hooks

| Hook | Purpose |
|---|---|
| `useNotifications` (`lib/use-notifications.tsx`) | Provider + hook. Fetches notifications, subscribes to `notification_new`/`notification_read`/`notifications_read_all` broadcasts, dedupes by ID, optimistic mark-read. |
| `useNotificationsRealtime` (`lib/use-notifications-realtime.ts`) | Standalone hook subscribing to `postgres_changes` INSERT on `notifications` filtered by `user_id`. |
| `useConversationRealtime` (`lib/use-conversation-realtime.ts`) | Subscribes to `message_new` broadcasts on a conversation channel. Dedupes by message ID. |

---

## Notifications

### Creation (server-side only)

`lib/notifications.ts` → `createNotification({ userId, type, title, body, link, sourceId, data? })`

- Uses `supabaseAdmin` (service role) — clients can never create notifications (no INSERT RLS policy).
- **Deduplication** via partial unique indexes:
  - `message_received` unique per `(user_id, source_id)` where source_id = message id.
  - `application_received` unique per `(user_id, source_id)` where source_id = application id.
  - `player_joined_team` unique per `(user_id, source_id)` where source_id = membership id.
  - `application_status_changed` intentionally has NO dedup (status can change multiple times).
- After insert, broadcasts `notification_new` to the recipient's `user:<id>` channel (best-effort).

### Where Notifications Are Created

| Event | Type | Recipient | Source |
|---|---|---|---|
| Player applies | `application_received` | Team owner | `POST /api/applications` |
| Team changes status | `application_status_changed` | Player | `PATCH /api/applications/[id]` |
| New message | `message_received` | Other participant | `POST /api/messages/[conversationId]` |
| Team outreach | `message_received` | Player | `POST /api/outreach` |
| Player joins via invite | `player_joined_team` | Team owner | `POST /api/team/join` |

---

## Email Infrastructure

Transactional email is delivered through **Brevo** behind a small, server-only
abstraction (EMAIL-001). EMAIL-002 adds a **durable email notification outbox**
decoupled from in-app notifications: email-enabled notifications enqueue a
delivery row, and a separate processor drains it and calls Brevo. No email is
ever sent synchronously from the notification path.

### Architecture

```
feature code
  └─ sendTransactionalEmail({ to, subject, html, text })   lib/email/email-service.ts
        └─ sendWithBrevo(...)                              lib/email/providers/brevo.ts
              └─ POST https://api.brevo.com/v3/smtp/email  (api-key header)

marketplace event ─► createNotification() ─► notifications row (canonical source)
                                              ├─ Supabase broadcast → in-app UI (unchanged)
                                              └─ email_notification_deliveries row (if email-enabled)
                                                        └─ processor (/api/email/deliveries/process)
                                                              └─ sendTransactionalEmail()
```

| File | Responsibility |
|---|---|
| `lib/email/types.ts` | Generic `TransactionalEmail` / `EmailRecipient` / result types — no Brevo concepts |
| `lib/email/errors.ts` | `EmailConfigError`, `EmailRecipientError`, `EmailProviderError`, `EmailProviderRequestError` — safe, typed, never carry secrets |
| `lib/email/config.ts` | `getEmailConfig()` reads `BREVO_API_KEY` / `BREVO_FROM_EMAIL` / `BREVO_FROM_NAME`; `isEmailConfigured()` for gating |
| `lib/email/providers/brevo.ts` | Brevo v3 REST transport via `fetch` (**not** SMTP). `server-only`. The sender always comes from the environment. |
| `lib/email/templates/fom-email-shell.ts` | `buildFomEmailShell({ title, bodyHtml, cta? })` → email-safe table HTML + plain-text fallback |
| `lib/email/templates/outreach-message.ts` | EMAIL-003 "team contacted you" email: `buildOutreachMessageEmail()` / `buildOutreachEmailSubject()` — team, opportunity, optional player name and a `View Conversation` CTA. Never exposes internal ids as visible copy. |
| `lib/email/templates/application-status.ts` | EMAIL-004 application-status email: `buildApplicationStatusEmail()` / `buildApplicationStatusEmailSubject()` — status-specific subject/copy (accepted/reviewing/withdrawn, and `rejected` phrased as "declined"), team/opportunity context and a `View Application` CTA. Never exposes internal ids as visible copy. |
| `lib/email/email-service.ts` | `sendTransactionalEmail()` — validates the recipient, calls the provider, logs safely, returns `{ success: true, messageId }` |
| `lib/email/notification-delivery.ts` | EMAIL-002 outbox: `enqueueEmailDeliveryForNotification()`, `processEmailDeliveries()`, `isEmailNotificationType()`, retry/backoff and safe error sanitisation. EMAIL-003/004: `buildNotificationEmail()` dispatches `kind: "outreach"` and `kind: "application_status_changed"` notifications to their specialized templates. EMAIL-002A: `scheduleEmailDeliveryProcessing()` kicks the existing processor for an immediate, best-effort first attempt via Next.js `after()`. `server-only`. |
| `lib/notification-data.ts` | EMAIL-003/004 typed notification `data` payload: `OutreachNotificationData` + `ApplicationStatusNotificationData`, `parseNotificationData()`, `isOutreachNotificationData()`, `isApplicationStatusNotificationData()`. Dependency-free (client + server). |
| `lib/email/index.ts` | Barrel export (`@/lib/email`) |
| `supabase/migrations/0021_email_notification_deliveries.sql` | EMAIL-002 delivery table, RLS (no client policies), indexes and the atomic claim / stale-recovery RPCs |
| `supabase/migrations/0022_notification_data.sql` | EMAIL-003 adds a nullable `notifications.data` JSONB column (JSON-object CHECK) for non-sensitive typed presentation metadata — RLS/indexes/realtime untouched |
| `supabase/migrations/0025_competition_registration_notification.sql` | COMP-EMAIL-001 widens the `notifications.type` CHECK to allow `competition_registration_confirmed` and adds its per-participant dedup partial unique index. The type is deliberately **not** email-enabled (the confirmation email's QR is built in memory; see below). No token/QR/email payload is persisted. |

### Scope (EMAIL-001 / EMAIL-002)

- One recipient, no CC/BCC, no attachments, no scheduling, no campaigns.
- EMAIL-002 adds a **durable PostgreSQL outbox** (`email_notification_deliveries`)
  with bounded exponential-backoff retries, concurrency-safe claiming and stale
  `sending` recovery. No Redis/BullMQ/Kafka — PostgreSQL is the queue.
- Email is enabled only for a small, centralized allowlist of notification types
  (`message_received`, `application_status_changed`) via
  `isEmailNotificationType()`. The list is intentionally easy to change.
- The integration point is only the existing `createNotification()` primitive.
  Applications, outreach, messaging, team membership, competitions and the
  notification UI/Realtime behaviour are otherwise untouched.
- **Immediate best-effort delivery (EMAIL-002A).** After `createNotification()`
  durably enqueues a *new* email delivery, it calls
  `scheduleEmailDeliveryProcessing()`, which runs the **existing** processor after
  the HTTP response via Next.js `after()` — so the marketplace request never waits
  on Brevo. Deduplicated/skipped enqueues do not trigger processing. This is the
  same processor/outbox/retry mechanism, **not** a second scheduler.
- **No scheduler ships in this ticket.** Immediate delivery is best-effort and runs
  through Next.js `after()`. Failed deliveries remain durably queued with their
  existing retry/backoff state. **Without a recurring scheduler, a future retry
  requires another invocation of the existing processing path** (the secret-protected
  endpoint below or another notification that drains the queue). Retries are therefore
  **not** guaranteed; this is an accepted limitation because no cron/scheduled
  processing is used. EMAIL-003 adds the outreach template; EMAIL-004 adds the
  application-status template.

### Team contacts player email (EMAIL-003)

When a team reaches out through the marketplace, the player's `message_received`
notification now carries an explicit, typed `data` payload (`{ kind: "outreach", teamName,
opportunityTitle?, opportunityRole?, playerName? }`). The outbox processor detects
`kind: "outreach"` and builds a dedicated **"team contacted you"** email
(`lib/email/templates/outreach-message.ts`) instead of generic notification copy.

- **How outreach is identified:** the `notifications.data.kind === "outreach"`
  discriminator set by `POST /api/outreach` — never inferred from message text, sender
  name or a fragile lookup. `parseNotificationData()` (`lib/notification-data.ts`)
  strictly narrows the JSONB value; anything unrecognized falls back to the generic
  EMAIL-002 email. Ordinary conversation `message_received` notifications carry no
  `data` and keep the generic copy.
- **Allowlist behavior:** `message_received` remains email-enabled (EMAIL-002 is
  unchanged). The specialization is purely presentational — only an
  outreach-originated `message_received` gets the outreach email; all other
  `message_received` notifications receive the generic notification email. This is
  the *smallest* behavior change and does not silently broaden coverage.
- **Email content:** player name (when present), team name, opportunity title/role, a
  clear "has contacted you… sent you a message" line and a **View Conversation** CTA
  that opens the existing `/messages/<conversationId>` route. Missing optional fields
  degrade gracefully; no internal ids are rendered as visible copy.
- **Schema:** migration `0022_notification_data.sql` adds a nullable
  `notifications.data` JSONB column (JSON-object CHECK). `createNotification()` now
  accepts an optional typed `data` payload and persists/broadcasts it. Realtime
  behavior and the EMAIL-002 outbox are unchanged.

### Application status email (EMAIL-004)

When a team (or the player) changes an application's status, the affected player's
`application_status_changed` notification now carries an explicit, typed `data`
payload, and the outbox processor builds a dedicated **application-status** email
(`lib/email/templates/application-status.ts`) instead of generic notification copy.

- **Status flow (unchanged):** `PATCH /api/applications/[id]` is the only status
  writer. Valid transitions — `pending → reviewing | rejected | accepted | withdrawn`
  and `reviewing → rejected | accepted | withdrawn`; `accepted`/`rejected`/`withdrawn`
  are terminal. Players may only `withdrawn`; teams may only
  `reviewing`/`rejected`/`accepted`. **Acceptance** runs the atomic `accept_application`
  RPC and skips the notification on idempotent re-acceptance; every other status uses a
  direct update. No status change happens without a notification, and the transition
  map + `already_accepted` guard prevent duplicate notifications (and therefore
  duplicate emails).
- **How it's identified:** the `notifications.data.kind === "application_status_changed"`
  discriminator set by the application route — never inferred from notification text.
  `parseNotificationData()` strictly narrows the JSONB value; the payload carries only
  presentation copy:
  `{ kind: "application_status_changed", status, teamName?, opportunityTitle?, opportunityRole?, playerName? }`.
- **Canonical status:** the stored `status` is the **actual enum value** (e.g.
  `"rejected"`). User-facing copy may phrase it differently — `rejected` reads as
  "declined", matching the existing application UI — but the payload never re-words the
  enum. An unknown/invalid `status` is dropped so the copy falls back gracefully.
- **Email content:** player name (when present), team name, opportunity title, a
  status-specific sentence and a **View Application** CTA that opens the existing
  `/player/applications/<id>` route (resolved to an absolute URL via `NEXTAUTH_URL`,
  the same mechanism as EMAIL-003). Missing optional fields degrade gracefully; no
  internal ids are rendered as visible copy.
- **Subject lines:** status-specific and concise, e.g.
  `Your application to <Team> was accepted` / `… was declined` / `… is being reviewed`
  / `… was withdrawn`, with `Your application status was updated` as the fallback.
- **Reuse, not new infrastructure:** EMAIL-004 only adds a specialized notification
  email type. It reuses the durable outbox, the atomic claim, the bounded
  exponential-backoff retries, the secret-protected processor and the EMAIL-002A
  `after()` immediate best-effort trigger. **No migration, scheduler, cron, polling or
  second outbox is added** — `notifications.data` (migration `0022`) already suffices,
  and `application_status_changed` was already email-enabled.
- **Failure isolation:** the status change never depends on email. Enqueue/`after()`/
  Brevo failures are swallowed by `createNotification()`, and the route already wraps
  notification creation in a guard, so the application update always succeeds.

### Competition registration confirmation email (COMP-EMAIL-001)

When a participant registers for a competition (via a join link) the confirmation
email contains their **actual registration pass QR** and their verification code.

- **Trigger / single mint:** the pass QR is minted exactly **once**, by the existing
  `POST /api/competitions/[id]/pass-token` flow (`mintParticipantVerificationToken`),
  when the registration success screen (`/competitions/join/[token]/pass`) renders.
  `mintPassTokenHandler` (`lib/competition-attempt-api.ts`) builds the verify URL from
  the **request origin** with the new pure helper
  `buildCompetitionVerifyUrl()` (`lib/competition-join.ts`), returns it as
  `{ token, verifyUrl }`, and passes that **exact same string** to the email path. The
  email path **never mints a second token** and never overwrites the stored token.
- **On-screen = emailed payload:** `PassQr.tsx` renders the QR from the server-returned
  `verifyUrl` (falling back to the same construction only if absent), so the QR shown on
  screen and the QR in the email encode the **identical** URL. Regression tests assert
  this equality end to end (`lib/competition-registration-notify.test.ts`,
  `lib/competition-attempt-api.test.ts`).
- **QR image (server-side, hosted):** the QR must **not** be embedded as an inline
  `data:` URI — Gmail ignores base64 `data:` images (confirmed against a real delivered
  message: the body carried a complete, valid `data:image/png;base64,…` yet the QR was
  invisible). Brevo cannot do Content-ID inline attachments either (its v3 API never sets
  a `Content-ID` MIME header), so the QR is served as a **hosted PNG**: the `qrcode`
  dependency renders the payload to PNG bytes in Node
  (`lib/email/qr.ts#renderVerificationQrPng`), a **public** app route serves it
  (`GET /api/competitions/verify-qr/[token]`), and the email references it with a plain
  `<img src="https://…/api/competitions/verify-qr/<token>">`. The route re-renders from
  the SAME opaque token as the pass (`buildCompetitionVerifyUrl`), so the emailed and
  on-screen QR encode an **identical** payload.
- **Public origin (required for the email):** the hosted image is fetched
  **anonymously** by the recipient's mail image proxy (Gmail routes images through
  `…googleusercontent.com/meips/…`), so the QR payload is built from a canonical **public**
  origin — `NEXT_PUBLIC_APP_URL` (preferred) or `NEXTAUTH_URL`, falling back to the request
  origin — via `resolvePublicAppOrigin` (`lib/competition-attempt-api.ts`). This keeps the
  payload off `localhost`, internal hosts and auth-protected Vercel **preview** deployments,
  which is the usual cause of a broken image plus a failed `meips` proxy request. The route
  is unauthenticated, sends `Cache-Control: no-store` and never logs the token; the visible
  verification code remains the fallback when a client blocks images.
- **Email content:** competition name, event date/time (**labelled UTC** — there is no
  event timezone field), `location`, organizer `description`, `challenge_name`, the
  **exact verification code** (`ABCD-1234` formatting), the QR image, and check-in copy
  (“present the QR code, or give staff your verification code”). Missing optional fields
  are omitted — the schema has **no** venue/address/map/parking/“what to bring” fields, so
  those are never fabricated. Sent via the existing EMAIL-001 Brevo service / FOM shell
  (`lib/email/templates/competition-registration.ts`).
- **Delivery & dedup:** the email is built **in memory** and sent best-effort after the
  response via Next.js `after()` (`lib/competition-registration-notify.ts`). Duplicate
  emails are prevented by reusing the notification dedup convention: a
  `competition_registration_confirmed` notification keyed by
  `source_id = competition_participants.id` (partial unique index, migration `0025`). The
  **first** mint emails; later mints (page refreshes / retries) are deduplicated and send
  nothing. The type is intentionally **not** in `EMAIL_ENABLED_NOTIFICATION_TYPES`, so the
  durable outbox never rebuilds/sends a token-less duplicate.
- **Failure isolation:** email-provider failures are logged safely (never the token or
  code) and can never fail the pass-token response or the registration.
- **Delivery guarantee (Option A):** the raw token / QR payload / rendered email are
  **never persisted** (not in `notifications.data`, not in any column, not in logs).
  Because the payload is not persisted, this path is **best-effort only — it does NOT get
  durable outbox retries**. Deduplication prevents duplicates; it does **not** guarantee
  successful delivery. See the follow-up below for a durable-retry design.

#### Follow-up (not implemented): durable delivery (Option B)

A future ticket could give this email durable outbox retries by extending the
server-only `email_notification_deliveries` table with a payload column holding the
**prebuilt** email (including the QR URL/image): the confirmation would be built once from
the exact pass token, then the immutable payload enqueued for the existing processor to
send and retry.

- **Tradeoff:** durable retry and consistent resend behaviour **versus persisting a
  sensitive verification token in the database** (today only its SHA-256 hash is stored).
  A DB leak would expose a token that, combined with an event-operator session, could
  verify that participant.
- **Requirements before implementation:** appropriate access controls (the table already
  has RLS with no client policies), retention limits, and safeguards so the payload can
  never leak through logs, API responses, or `notifications.data`; evaluate encrypting the
  sensitive payload at rest, or storing only the minimum necessary token/URL.
- **This requires a new migration and a dedicated security review.** It is intentionally
  **not** part of COMP-EMAIL-001.

### Environment variables

```env
BREVO_API_KEY=            # secret — server only, never NEXT_PUBLIC_
BREVO_FROM_EMAIL=notifications@fom-sports.com
BREVO_FROM_NAME=FOM Sports
NEXT_PUBLIC_APP_URL=      # canonical PUBLIC app URL (e.g. https://www.fom-sports.com) — used for participant QR links/emails
EMAIL_DELIVERY_SECRET=    # secret — server only; guards the EMAIL-002 processor endpoint
CHALLONGE_API_KEY=        # secret — server only; Challonge v1 (TOURN-001 adapter + isolated POC)
```

- `BREVO_API_KEY` is **secret and server-only** (guarded by `server-only`; there is
  no `NEXT_PUBLIC_` variant). It is never logged, never returned from an API route
  and never hard-coded.
- Values must be configured in the local `.env.local` (git-ignored — see `.gitignore`).
- Production / preview values belong in **Vercel → Project → Settings → Environment
  Variables**.
- The sender (`notifications@fom-sports.com`) and the `fom-sports.com` sending domain
  must remain **verified / authenticated in Brevo**, otherwise Brevo rejects the send.

### Failure behavior

`getEmailConfig()` throws an `EmailConfigError` listing only the **names** of the
missing variables (never their values), and no partial send is attempted. Provider
errors retain safe metadata only (HTTP status); the API key, auth headers and raw
provider bodies are never surfaced.

### Development test endpoint

`GET|POST /api/debug/email-test` is a **development-only** smoke test:

- Fails **closed** (`404`) whenever `NODE_ENV === "production"`.
- Sends a **fixed** subject/body — the caller may only supply a recipient (`?to=`),
  so it can never be used as an arbitrary production email relay.
- Returns the Brevo `messageId` on success.

```bash
# with `npm run dev` running
curl "http://localhost:3000/api/debug/email-test?to=you@example.com"
```

### Email delivery processor (EMAIL-002 / EMAIL-002A)

There are two ways the durable outbox is drained — both call the **same**
`processEmailDeliveries()` (there is no second processor):

1. **Immediate best-effort (EMAIL-002A).** A fresh enqueue in
   `createNotification()` schedules `processEmailDeliveries()` via Next.js
   `after()`. The callback runs *after* the response is sent, so the user-facing
   request never waits on Brevo. Failures in this path are logged safely and can
   never fail the marketplace operation.
2. **Manual / scheduled.** `GET|POST /api/email/deliveries/process` is **not**
   user-facing and fails **closed** (`404`) unless the caller presents the
   `EMAIL_DELIVERY_SECRET`:

```bash
# with EMAIL_DELIVERY_SECRET configured
curl -X POST "https://<host>/api/email/deliveries/process" \
  -H "Authorization: Bearer $EMAIL_DELIVERY_SECRET"
```

- **Immediate delivery is best-effort.** It performs the first attempt only.
  Failed deliveries remain durably queued with their existing retry/backoff state;
  without a recurring scheduler, a future retry requires another invocation of the
  existing processing path (the endpoint above, or another notification that drains
  the queue). Retries are **not** guaranteed under this design.
- Claiming is atomic (`FOR UPDATE SKIP LOCKED`), so overlapping invocations can
  never send the same email twice.
- Retries use exponential backoff (60s → 120s → 240s …, capped at 6h) via
  `available_at`, bounded by a **maximum of 5 total attempts** (attempt 5 failure →
  `failed`; a 6th attempt is impossible — enforced in both the processor and the
  claim RPC).
- A worker that crashes mid-send cannot strand a row: deliveries left in
  `sending` beyond a stale timeout are requeued automatically.
- `last_error` stores a short, sanitised reason only — never API keys, auth
  headers or raw provider payloads.

---

## Team Context & Multi-Team

### Team Selection

- **Client:** `lib/team-context.ts` — reads `?team=` from URL, persists to localStorage + cookie (`fom-selected-team`). `getSelectedTeamIdFromLocalStorage()`, `persistSelectedTeamId()`, `withTeamParam()`.
- **Server:** `lib/team-context-server.ts` — `getSelectedTeamIdFromCookie()`, `getSelectedTeamIdWithFallback(searchParams)` (URL param first, then cookie), `getUserTeams(userId)`, `verifyTeamOwnership(userId, teamId)`, `resolveSelectedTeam(userId, teamId)` (verifies specific team, falls back to first team).
- **UI:** `components/layout/TeamSwitcher.tsx` + `TeamSwitcherWithContext.tsx` — dropdown to switch teams, persists selection, updates `?team=` param.

### Multi-Team Capability

- `lib/multi-team.ts` — `canManageMultipleTeams(userId)` checks `MULTI_TEAM_ADMIN_USER_ID` env var (server-only, never `NEXT_PUBLIC_`).
- Normal users: one team profile (enforced in `POST /api/team/profile`).
- Multi-team admin: can create multiple team profiles.
- All team-scoped RPCs accept an explicit `p_team_profile_id` and verify ownership (never assume `team_profiles.user_id` is unique).

---

## Key Data Flows

### Player Journey

```
Landing → Google Sign-In → /onboarding (pick "player")
  → /player/onboarding (5-step profile wizard → POST /api/player/profile)
  → /player (dashboard)
  → /player/find-team (matchPlayerToOpportunity ranks all active opportunities)
  → /opportunities/[id] (detail + match banner)
  → Apply (ApplyButton → POST /api/applications → create_application_with_conversation RPC)
  → /player/applications (track status)
  → /messages/[conversationId] (chat with team, realtime)
```

### Team Journey

```
Landing → Google Sign-In → /onboarding (pick "team")
  → /team/onboarding (3-step wizard → POST /api/team/profile)
  → /team (dashboard)
  → /team/opportunities/new (create opportunity → POST /api/team/opportunities)
  → /team/opportunities/[id]/players (matchPlayerToOpportunity ranks discoverable players)
  → /team/applications (review applications → PATCH /api/applications/[id])
  → Accept → accept_application RPC (atomic status + team_memberships)
  → /messages/[conversationId] (chat with player)
  → /team/invites (create reusable invite links → POST /api/team/invites)
```

### Invite Acceptance Flow

```
Team creates invite → POST /api/team/invites → { token, join_url }
  → Player visits /team/join/[token] (public page, resolves invite server-side)
  → If not logged in → /login?callbackUrl=/team/join/[token] (safe callback validation)
  → AcceptInviteButton → POST /api/team/join
  → accept_team_invite RPC (locks invite, verifies player, creates team_memberships)
  → player_joined_team notification to team owner
```

### Application Acceptance Flow

```
Team reviews application → PATCH /api/applications/[id] { status: "accepted" }
  → accept_application RPC (locks application, resolves opportunity as authoritative
    source for team/position/role, creates/updates team_memberships, sets status)
  → application_status_changed notification to player
```

---

## Environment Variables

| Variable | Used By | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase clients | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server anon clients | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase-admin.ts` | **Secret** — server only |
| `GOOGLE_CLIENT_ID` | `lib/auth.ts` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | `lib/auth.ts` | Google OAuth |
| `NEXTAUTH_SECRET` | `lib/auth.ts` | JWT signing |
| `NEXTAUTH_URL` | NextAuth | Production URL |
| `NEXT_PUBLIC_APP_URL` | `lib/competition-attempt-api.ts` | Canonical **public** app URL (e.g. `https://www.fom-sports.com`). Used to build participant QR payloads (on-screen pass + confirmation email) so the emailed **hosted** QR image is reachable by mail image proxies (Gmail `meips`). Falls back to `NEXTAUTH_URL`, then the request origin. Not a secret. |
| `REALTIME_CHANNEL_SECRET` | `lib/realtime-broadcast.ts` | HMAC signing for realtime channels |
| `MULTI_TEAM_ADMIN_USER_ID` | `lib/multi-team.ts`, `lib/competition-server.ts` | profiles.id of the multi-team admin (server-only). COMP-007 reuses it as the **only** user allowed to create competitions — server-only, never `NEXT_PUBLIC_`, fails closed when unset. |
| `BREVO_API_KEY` | `lib/email/config.ts`, `lib/email/providers/brevo.ts` | **Secret** — server only (EMAIL-001). Authenticates the Brevo v3 transactional email API. Never `NEXT_PUBLIC_`, never logged. |
| `BREVO_FROM_EMAIL` | `lib/email/config.ts` | Verified Brevo sender address (e.g. `notifications@fom-sports.com`). Fails safely when unset. |
| `BREVO_FROM_NAME` | `lib/email/config.ts` | Sender display name (e.g. `FOM Sports`). Fails safely when unset. |
| `CHALLONGE_API_KEY` | `lib/integrations/tournament/config.ts`, `lib/integrations/challonge-poc/run-poc.ts` | **Secret** — server only. Authenticates the Challonge v1 Tournament API for the production TOURN-001 tournament integration and for the isolated POC. Never `NEXT_PUBLIC_`, never logged, never included in an error message. When unset the tournament service fails closed (`provider_not_configured` → `503`) without attempting an API call. See [Tournament Provider Integration](#tournament-provider-integration-tourn-001). |
| `EMAIL_TEST_RECIPIENT` | `app/api/debug/email-test/route.ts` | Optional. Default recipient for the **development-only** email smoke test when `?to=` is omitted. |

---

## Testing

**Framework:** Vitest + Testing Library + jsdom.

### Test Locations

| Location | What's Tested |
|---|---|
| `lib/*.test.ts` | Pure logic: team-invite, team-join, team-context, team-membership, multi-team, invite-callback, competition (COMP-001 + COMP-002 lifecycle/statistics) |
| `lib/competition-server.test.ts` | Competition server helpers: profile resolution, event ownership/ambassador authorization, participant lookups (COMP-001) |
| `lib/competition-management-server.test.ts` | COMP-002 server mutations: viewer role, list/create/update, lifecycle transitions (valid + invalid), ambassador add/remove/duplicate, statistics |
| `lib/competition-join.test.ts` | COMP-003 pure join helpers: token generation/hashing, derived link state, event eligibility, join-page state, URL/callback builders, verification codes |
| `lib/competition-join-server.test.ts` | COMP-003 server: token hashing on lookup, link create/revoke authorization, event eligibility enforcement, idempotent registration, pass retrieval |
| `lib/competition-attempt.test.ts` | COMP-004 pure helpers: result parsing, threshold/qualification, next attempt number, participant status resolution |
| `lib/competition-attempt-server.test.ts` | COMP-004/005 server: verification (code + QR), attempt recording/numbering/limits, creator-or-ambassador authorization (allowed + denied), participant privacy |
| `lib/competition-attempt-api.test.ts` | COMP-004/005 API handlers: session-derived identity, creator-or-ambassador outcomes mapped to HTTP statuses, server-owned fields not trusted from the body |
| `lib/competition-drawing.test.ts` | COMP-006 pure helpers: drawable status set, eligibility, unavailable reasons |
| `lib/competition-drawing-server.test.ts` | COMP-006 server: qualified count, creator/ambassador authorization (allowed + denied), server-side RPC selection, error mapping (already-drawn/no-qualified/not-drawable), display-safe result, no client-supplied winner/count |
| `lib/competition-drawing-api.test.ts` | COMP-006 API handlers: auth, server-selected result mapped to 201, ignored client body, duplicate/no-qualified → 409, opaque 404 for private drawing reads |
| `lib/competition-drawing-migration.test.ts` | COMP-006 migration (0020): table/RPC/unique-index/RLS shape, server-side random selection, one-drawing-per-event, immutability, no edits to prior migrations |
| `lib/competition-public-server.test.ts` | COMP-007 public results: no-auth access, qualified-only participants, persisted winner (and no winner before drawing), player-profile linking (and safe non-linking), public-safe field projection and privacy |
| `lib/competition-creation-auth.test.ts` | COMP-007 creation restriction: `isCompetitionCreationAdmin` (admin/ambassador/player/missing env), `createCompetitionEvent` allows only the admin and fails closed |
| `lib/integrations/tournament/contract.test.ts` | TOURN-001/002A/003 pure contract: modelled formats, default format, completion, match-score validation, participant display-name fallback, `toTournamentConfig` narrowing (default / valid / rejected — never converted), and TOURN-003 match references (composition from the provider's round + FOM participant ids, `null` for an undecided/unmapped side, and narrowing that rejects provider-shaped ids) |
| `lib/integrations/tournament/slug.test.ts` | TOURN-001 slug/name derivation: deterministic per competition, provider-safe charset (no hyphens, no separators), length bounds, blank-name fallback, unusable id rejected |
| `lib/integrations/tournament/registry.test.ts` | TOURN-001 provider selection: `"challonge"` resolves a full contract implementation, casing/whitespace normalisation, default provider, unknown id rejected, resolution requires no credentials |
| `lib/integrations/tournament/providers/challonge.test.ts` | TOURN-001/002A Challonge v1 adapter (mocked fetch): `api_key` query auth, create/participant/start/match/result/finalize/winner wire format, FOM-neutral translation, 401/404/422/429/5xx/network/malformed mapping, bounded retries, uncorrelated responses refused, no key leakage, and the TOURN-002A capability: only `single_elimination` is advertised/creatable (an unsupported format makes **no** request and is never substituted); other provider type names translate without inventing a supported format |
| `lib/integrations/tournament/providers/challonge.live.test.ts` | TOURN-001 opt-in LIVE check (skipped unless `TOURNAMENT_LIVE_TEST=1`): real authentication, 404→`null`, FOM-neutral reads, and with `TOURNAMENT_LIVE_CREATE=1` a real create→participants→start→results→finalize flow |
| `lib/integrations/tournament/service.test.ts` | TOURN-001/002A/003 service: `canManageEvent` authorization, mapping **and format** persistence, deterministic-slug adoption, concurrent-link handling, participant mapping + partial-failure honesty, idempotent start/finalize, champion resolution, `400/403/404/409/502/503` mapping, format validation (unmodellable → `400` before provider resolution; modelled-but-unsupported → `400` with **no** provider call), capability-driven creation (a provider that supports another format is honoured), the recorded format read back for existing/pre-TOURN-002A rows, and TOURN-003 result reporting (FOM reference → provider match/participant translation, no bracket write by FOM, guards for not-linked/not-started/completed/unknown, match not in this tournament, winner not in the match or not a FOM id, already-settled and not-ready matches, draw rejected, provider failure mapped honestly) plus finalization (champion resolved to a FOM participant, unmapped champion reported as `null`, idempotency, refusals) |
| `lib/tournament-provider-migration.test.ts` | TOURN-001 migration (0023): mapping columns, provider pair CHECK, unique indexes, and that no tournament-engine state is duplicated into Supabase |
| `lib/tournament-format-migration.test.ts` | TOURN-002A migration (0024): `tournament_format` column, backfill of existing linked tournaments to `single_elimination`, format CHECK + provider-pairing CHECK (applied **after** the backfill), no column DEFAULT, and no provider table/field (`tournament_type`/`scores_csv`/`api_key`) |
| `lib/tournament-api.test.ts` | TOURN-002/002A/003 tournament route handlers: `401` unauthenticated, `403` unauthorized manager, service invoked with the session-derived profile id, `400/404/409/500/502/503` mapping, create/sync/start/summary/matches payloads resolved to FOM participants, the `matchRef` on a reportable match, the format the client chose being forwarded (and an unmodellable/malformed format rejected with `400` **without** calling the service), the bodyless default, the capability list on the not-linked response, result reporting (malformed body / invalid reference / missing winner / invalid scores / draw → `400` with **no** service call, provider-specific body fields ignored, the neutral match returned) and finalization (`{ finalized, winnerParticipantId, tournament }`, idempotency, an unmapped champion as `null`, refusal surfaced), and that no provider identifier, provider match id or provider term can appear in a response |
| `app/api/competitions/[id]/tournament/__tests__/route.test.ts` | TOURN-002/003 route wiring: each route file exposes only its intended methods and forwards the awaited `[id]` (and `[matchId]`) segment to the matching handler (`GET`/`POST` summary+create, `POST` participants/start/result/finalize, `GET` matches) |
| `app/competitions/[id]/__tests__/TournamentPanel.test.tsx` | TOURN-002/002A/003 panel (jsdom): loading → not linked (format selector built from the server capability list, unsupported formats disabled and impossible to submit, nothing submittable when no format is supported, selected format submitted in the request body) → linked (recorded format displayed, no selector) → create → sync (counts, already-mapped feedback, failed sync) → start → bracket (rounds, sides, score, state, winner, `TBD`, empty state), completed champion, `403` hides every control, provider error + Retry, TOURN-003 result reporting (a form only for a playable match, none for a TBD, unmapped or settled match, winner is required, the score + winner submitted as FOM-neutral input, the bracket re-read afterwards so the provider-advanced round appears, a rejected result surfaced honestly) and finalization (offered only while running, the winner shown afterwards, the button disappearing, a refusal surfaced), and that no provider detail reaches the DOM |
| `lib/email/config.test.ts` | EMAIL-001 config: resolves `BREVO_*`, fails safely on each missing variable, treats whitespace as missing, lists only variable NAMES (never values) |
| `lib/email/providers/brevo.test.ts` | EMAIL-001 Brevo provider: payload (recipient/sender/subject/html/text), `api-key` header, mocked fetch success + message id, non-2xx, network failure, no key leakage |
| `lib/email/email-service.test.ts` | EMAIL-001 service: recipient validation, provider delegation, recipient trimming, `server-only` boundary enforcement |
| `app/api/debug/email-test/__tests__/route.test.ts` | EMAIL-001 dev test route: hard fail-closed `404` in production, fixed subject/body (client-supplied values ignored), recipient fallback, safe error mapping |
| `lib/email/notification-delivery.test.ts` | EMAIL-002/002A outbox: type allowlist, sanitisation, email build/escaping, enqueue + dedupe, processor (sent/retry/failed/missing-notification), the immediate `after()` trigger, and the bounded 5-attempt retry ladder (attempts 1–4 retryable, attempt 5 → `failed`, no 6th attempt) |
| `lib/email/notification-delivery-migration.test.ts` | EMAIL-002 migration 0021: table, UNIQUE(notification_id), status CHECK, indexes, RLS with no policies, atomic claim and stale recovery |
| `lib/email/notification-delivery-integration.test.ts` | EMAIL-002/002A `createNotification()` integration: enqueue on create, immediate trigger on a fresh enqueue only, no trigger on dedupe/skip, realtime unchanged, and enqueue/trigger failures never fail notification creation |
| `app/api/email/deliveries/process/__tests__/route.test.ts` | EMAIL-002 processor route: fail-closed `404`, secret auth (bearer + header), GET/POST, no internal leakage |
| `lib/notification-data.test.ts` | EMAIL-003/004 typed payload: outreach + application-status recognition/normalization, canonical status preserved, invalid status dropped, empty-field dropping, strict null fallback for unknown/non-object values |
| `lib/notification-data-migration.test.ts` | EMAIL-003 migration 0022: nullable `data` JSONB column, JSON-object CHECK, RLS/dedup/realtime untouched |
| `lib/email/outreach-message.test.ts` | EMAIL-003 outreach template: team/opportunity/player copy, dedicated subject, `View Conversation` CTA, no internal ids as visible copy, graceful missing-data, HTML escaping |
| `lib/email/templates/application-status.test.ts` | EMAIL-004 application-status template: status-specific subject/copy, team/opportunity/player copy, `View Application` CTA, no internal ids as visible copy, graceful missing-data, `rejected`→"declined" copy, HTML escaping |
| `lib/email/templates/competition-registration.test.ts` | COMP-EMAIL-001 confirmation template: name/date(UTC)/location/challenge/code/QR image, check-in copy, optional-field omission, HTML escaping |
| `lib/competition-registration-notify.test.ts` | COMP-EMAIL-001: emails the QR built from the EXACT pass verify URL (regression), sends once + dedupes on repeat, skips non-participants / missing email, provider failure never throws, `after()` scheduling |
| `lib/email/qr.test.ts` | COMP-EMAIL-001 server-side QR: base64 PNG data URI, deterministic per payload, rejects empty payload |
| `lib/competition-registration-notification-migration.test.ts` | COMP-EMAIL-001 migration 0025: type CHECK widened + dedup index, no token/QR/email persisted, competition tables/RLS/realtime/outbox untouched |
| `lib/matching/*.test.ts` | Matching engine: engine, applications, mvp014, player-experience, team-applications |
| `app/api/**/__tests__/` | API routes: applications (acceptance, withdrawal), messages, notifications, outreach, team invites, team join, competitions (create + event/ambassador handlers) |
| `app/homepage.test.ts` | Homepage rendering |
| `components/notifications/__tests__/` | NotificationBell |

### Commands

```bash
npm test          # Run all tests once
npm run test:watch  # Watch mode
```

---

## Development Commands

```bash
npm run dev       # Start dev server (next dev)
npm run build     # Production build
npm run start     # Start production server
npm run lint      # ESLint
npm test          # Vitest
```

---

## Roadmap & Current State

- **`app_roadmap.md`** — Contains MVP-004 through MVP-022 tickets (team profiles, opportunities, matching, applications, messaging, notifications, trust & safety, security audit, performance, QA, production launch).
- **`task_progress.md`** — Current sprint: **MVP-018 — Marketplace Homepage & Discovery UX** (homepage redesign, opportunity discovery preview, personalized recommendations, team discovery, navigation improvements, opportunity card enhancement, loading/empty/error states, testing).

### Implemented Features (as of this README)

- ✅ Google OAuth + role-based access (player/team/both)
- ✅ Player profile creation/editing + completeness tracking
- ✅ Team profile creation/editing + completeness tracking
- ✅ Opportunity creation/editing/close/delete (draft/active/closed)
- ✅ Public opportunity marketplace (search/filter/sort/pagination)
- ✅ Deterministic matching engine (player ↔ opportunity)
- ✅ Player "Find Me a Team" ranked discovery
- ✅ Team player discovery (per-opportunity + browse all)
- ✅ Applications (apply, withdraw, review, accept/reject) with atomic membership creation
- ✅ Messaging (conversations per application/outreach, realtime, unread counts)
- ✅ Team outreach (team-initiated contact)
- ✅ In-app notifications (4 types, realtime, dedup)
- ✅ Team invite links (reusable, token-hashed, revocable, expiring)
- ✅ Team memberships (canonical roster, one-team-per-player MVP rule)
- ✅ Multi-team support (admin-gated)
- ✅ Application status email notifications (EMAIL-004 — `application_status_changed` notifications carry an explicit typed `data` payload (`kind: "application_status_changed"`; canonical `status` enum plus team/opportunity/player copy) that the outbox processor uses to build a status-specific email via `lib/email/templates/application-status.ts` with a `View Application` CTA to the existing `/player/applications/<id>` route (`rejected` is phrased as "declined", matching the app UI). Reuses the existing EMAIL-002/002A outbox, `after()` immediate processing, retry/backoff and processor — no new migration, scheduler, outbox or template-dispatch system. Also adds the `position` field to the PATCH opportunity select so the email has correct position context.)
- ✅ Competition registration confirmation email (COMP-EMAIL-001 — on registration the participant's pass QR is minted once by the existing pass-token flow; the confirmation email references a **hosted** PNG rendered from that **exact** payload (identical encoded URL) via `GET /api/competitions/verify-qr/[token]` — a `data:` URI is stripped by Gmail and Brevo does not support Content-ID (`cid:`) inline images — plus the verification code, event details and check-in copy, sent via the existing EMAIL-001 Brevo service. Duplicate emails are prevented by the existing notification dedup (`competition_registration_confirmed`, `source_id` = participant id, migration `0025`). The raw token/QR/email are never persisted, so this path is best-effort with no durable retry (durable Option B is documented as a future, security-reviewed follow-up).)
- ✅ Homepage with personalized recommendations
- ✅ Competitions foundation (COMP-001 — data model, types, authorization, server helpers)
- ✅ Competitions management (COMP-002 — `/competitions` create/manage pages, event editing, controlled lifecycle, ambassador add/remove by email, basic statistics)
- ✅ Competition join links & QR entry flow (COMP-003 — reusable per-ambassador join links, QR codes, public `/competitions/join/[token]` landing page, existing-auth continuation, lightweight registration, pre-entry pass; challenge attempts/raffle/winners in later tickets)
- ✅ Participant verification & challenge attempts (COMP-004 — on-site participant verification by code/QR, server-assigned attempt numbering + pass/fail, event-day operations screen, event-wide statistics)
- ✅ Ambassador event-day operations (COMP-005 — ambassadors run an event: view participants, verify, record attempts and see qualification, via the shared `canManageEvent` creator-or-ambassador rule; creator-only administration preserved)
- ✅ Competition drawing & winner selection (COMP-006 — managers run one atomic, server-side drawing over qualified participants, selecting exactly one winner persisted immutably in `competition_drawings`; one drawing per event enforced at the database level; the winner is shown to the creator and assigned ambassador. No rerolls or prizes.)
- ✅ Public competition results dashboard + admin-only creation (COMP-007 — no-auth `/competitions/results` dashboard showing competitions, qualified participants and the persisted winner, with links to existing public player profiles; competition **creation** temporarily restricted to the `MULTI_TEAM_ADMIN_USER_ID` user, enforced server-side, while ambassador operational permissions are unchanged)
- ✅ Transactional email infrastructure (EMAIL-001 — server-only Brevo transport behind a small generic `sendTransactionalEmail()` abstraction, environment validation that fails safely, a reusable FOM email shell with a plain-text fallback, and a development-only test endpoint that fails closed in production. No marketplace flow integrates email yet.)
- ✅ Email notification outbox (EMAIL-002 — durable `email_notification_deliveries` table keyed one-per-notification, RLS with no client access, concurrency-safe atomic claiming (`FOR UPDATE SKIP LOCKED`), bounded exponential-backoff retries, stale `sending` recovery, a small centralized email-enabled type allowlist, integration only through `createNotification()`, and a secret-protected server-only processor endpoint. No scheduler ships; invoke the endpoint externally. Detailed templates are deferred to EMAIL-003/EMAIL-004.)
- ✅ Team contacts player email (EMAIL-003 — outreach-originated `message_received` notifications carry an explicit typed `data` payload (`kind: "outreach"`) that the outbox processor uses to build a dedicated "team contacted you" email with team name, opportunity title/role, optional player name and a `View Conversation` CTA to the existing conversation. Non-outreach `message_received` notifications keep the generic EMAIL-002 copy. Adds migration `0022_notification_data.sql` (nullable `notifications.data` JSONB).)
- ✅ Immediate email delivery & retry reliability (EMAIL-002A — a fresh enqueue in `createNotification()` kicks the **existing** EMAIL-002 processor via Next.js `after()`, so the first send attempt happens immediately after the response without the marketplace request ever waiting on Brevo. Attempts are bounded to a **maximum of 5 total** (attempt 5 failure → `failed`; a 6th attempt is impossible — enforced in both the processor and the claim RPC), and Brevo failures never fail the underlying marketplace operation. No new scheduler, cron, polling loop, outbox or processor is introduced; immediate delivery is best-effort and without a recurring scheduler a future retry requires another invocation of the existing processing path.)
- ✅ Tournament management workflow (TOURN-002 — the first usable tournament workflow on top of the TOURN-001 provider abstraction: create/link a competition's external tournament, sync the registered participants, start it, and view a **read-only, provider-neutral** bracket on the existing competition page (`/competitions/[id]`). Thin App Router routes under `app/api/competitions/[id]/tournament/**` delegate to the existing service; authorization stays the TOURN-001 `canManageEvent` creator-or-ambassador rule. No new tables, no mirrored bracket state, no provider import outside `providers/`.)
- ✅ Tournament result reporting, advancement & finalization (TOURN-003 — an authorized competition manager reports a match result with **FOM-neutral input only** (`matchRef` + winning `competition_participants.id` + scores), the provider advances the winner, FOM re-reads the bracket through the existing `GET …/matches`, and the manager **explicitly finalizes** once the provider permits it so the champion is shown. Adds `POST /api/competitions/[id]/tournament/matches/[matchId]/result` and `POST /api/competitions/[id]/tournament/finalize` (thin routes over `reportEventMatchResult` / `finalizeEventTournament`), `toMatchReference` in `lib/integrations/tournament/contract.ts`, and the panel's result form + Finalize button. **Zero local bracket calculation / advancement logic** — the provider remains the source of truth for match state, progression and the winner; draws, re-reporting a settled match and reporting an unready/unmapped match are refused server-side; no provider id, match id or provider term reaches the browser, and **no migration was needed** because no match state is mirrored into Supabase.)

---

## Change Guide — How to Make Future Changes

This section tells you **where to look** for common changes. Read the relevant section, make the change, and run `npm test` + `npm run lint` + `npm run build`.

### Adding a New Page

1. Create the route folder under `app/` (e.g. `app/player/foo/page.tsx`).
2. If it's a server component, fetch data with `supabaseAdmin` and pass serializable props to a client component.
3. If it needs auth, use `requireAuth()` / `requireRole([...])` from `lib/auth-helpers.ts` (server) or `useSession` (client).
4. If it's a team-scoped page, resolve the team with `getSelectedTeamIdWithFallback` + `resolveSelectedTeam` from `lib/team-context-server.ts`.
5. Add the route to `middleware.ts` if it needs protection or role gating.
6. Add the route prefix to `lib/route-context.ts` if it should auto-sync the AppView (player/team).

### Adding a New API Route

1. Create the route handler under `app/api/` (e.g. `app/api/foo/route.ts`).
2. Always start with `getServerSession(authOptions)` and return 401 if no session.
3. Use `supabaseAdmin` for all data access.
4. **Never trust client-supplied ownership IDs** — verify ownership server-side (e.g. `verifyTeamOwnership` pattern).
5. For multi-table operations, add a `SECURITY DEFINER` RPC in a new migration instead of doing multi-step inserts.
6. Add tests under `app/api/foo/__tests__/`.

### Adding a Database Migration

1. Create `supabase/migrations/XXXX_name.sql` (next number in sequence).
2. Follow the existing patterns: `CREATE TABLE IF NOT EXISTS`, RLS enabled, owner-scoped policies, `update_updated_at_column()` trigger, indexes for query patterns.
3. For atomic operations, add a `SECURITY DEFINER` RPC with `SET search_path = public`.
4. Apply the migration in the Supabase SQL Editor (or via `supabase/apply-migrations.sql`).

### Changing the Matching Engine

1. Weights/thresholds/level hierarchy → `lib/matching/constants.ts`.
2. Per-factor logic → `lib/matching/evaluators.ts` (each evaluator is a pure function returning `FactorScore`).
3. Orchestration → `lib/matching/engine.ts`.
4. Types → `lib/matching/types.ts`.
5. **Weights must sum to 100** (validated at module load — the app will crash if not).
6. Add/update tests in `lib/matching/`.

### Adding a New Notification Type

1. Add the type to the `notifications.type` CHECK constraint (new migration).
2. Add the type to `NotificationType` in `lib/notifications.ts` and `types/index.ts`.
3. Add a dedup partial unique index if the notification should be unique per source.
4. Call `createNotification(...)` from the relevant API route.
5. Decide whether the type should email: add it to `EMAIL_ENABLED_NOTIFICATION_TYPES`
   (`lib/email/notification-delivery.ts`) for a durable-outbox email, plus a `data.kind`
   branch in `buildNotificationEmail()`. Types that must carry a value that cannot be
   persisted (e.g. COMP-EMAIL-001's verification token) are deliberately **left out** of
   the allowlist and sent best-effort from their own request instead.

### Adding a New Role or Capability

1. Add the role to the `profiles.role` CHECK constraint (migration).
2. Add the role to `UserRole` in `types/index.ts`.
3. Add role checks in `lib/auth-helpers.ts` (e.g. `hasXRole()`, `canAccessXArea()`).
4. Add route prefixes to `middleware.ts` and `lib/route-context.ts`.
5. Update `AppViewProvider` (`lib/use-app-view.tsx`) if the role needs a view toggle.

### Changing the Team Selection / Multi-Team Behavior

1. Client selection → `lib/team-context.ts`.
2. Server resolution → `lib/team-context-server.ts`.
3. Multi-team admin gating → `lib/multi-team.ts` (env var `MULTI_TEAM_ADMIN_USER_ID`).
4. Team switcher UI → `components/layout/TeamSwitcher.tsx` + `TeamSwitcherWithContext.tsx`.

### Changing Realtime Behavior

1. Channel naming/signing → `lib/realtime-broadcast.ts`.
2. Channel issuance → `app/api/realtime/channels/route.ts`.
3. Client subscriptions → `lib/use-conversation-realtime.ts`, `lib/use-notifications-realtime.ts`, `lib/use-notifications.tsx`.

### Changing the Database Schema for Memberships

- The MVP enforces **one team per player** via a UNIQUE index on `team_memberships.player_profile_id`.
- To support a player on multiple teams: drop that index and replace it with `UNIQUE (team_profile_id, player_profile_id)`. No other schema redesign is required (documented in migration 0013).

### Changing Invite Behavior

- Invite state is **derived** from `revoked_at` / `expires_at` — never add a status column.
- Raw tokens are never persisted — only SHA-256 hashes (`lib/team-invite.ts`).
- Invites are **reusable shared links** — acceptances create `team_memberships` rows, never mutate the invite.

---

## Conventions Summary

| Convention | Rule |
|---|---|
| Data access | Server components + API routes use `supabaseAdmin`; browser uses anon client only for realtime |
| Auth | Always `getServerSession(authOptions)` server-side; never trust client claims |
| Ownership | Always verify the **specific** `team_profile_id` / `player_profile_id` server-side |
| Atomicity | Multi-table writes go through `SECURITY DEFINER` RPCs |
| Matching | Pure functions only — no I/O in `lib/matching/` |
| Invites | Token-hashed, derived state, reusable |
| Memberships | Canonical source is `team_memberships` — never derive from applications/outreach |
| Notifications | Server-side creation only, dedup via partial unique indexes |
| Email | Server-only (`lib/email`, `server-only`). Call `sendTransactionalEmail()`; never import the Brevo provider directly. Email delivery is queued via `email_notification_deliveries` (EMAIL-002) and drained by the secret-protected `/api/email/deliveries/process` processor. Secrets never `NEXT_PUBLIC_`, never logged. |
| Email outbox | `email_notification_deliveries` — one row per email-enabled notification (UNIQUE `notification_id`), RLS with **no client policies**, PostgreSQL as the durable queue. |
| Realtime | HMAC-signed channels, participant-verified |
| Colors | Use `lib/colors.ts` constants, not hardcoded Tailwind classes |
| Types | All shared types in `types/index.ts`; feature types in `features/<feature>/types.ts` |
| Tests | Vitest; pure logic tests in `lib/*.test.ts`, API tests in `app/api/**/__tests__/` |
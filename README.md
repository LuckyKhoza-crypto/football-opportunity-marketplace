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
10. [Team Context & Multi-Team](#team-context--multi-team)
11. [Key Data Flows](#key-data-flows)
12. [Environment Variables](#environment-variables)
13. [Testing](#testing)
14. [Development Commands](#development-commands)
15. [Roadmap & Current State](#roadmap--current-state)
16. [Change Guide — How to Make Future Changes](#change-guide--how-to-make-future-changes)

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
│  PostgreSQL (18 migrations)  ·  Storage (photos/logos)  ·  Realtime │
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
│   ├── colors.ts                 # Centralized color tokens
│   └── utils.ts                  # shadcn cn() helper
│
├── supabase/migrations/          # 18 SQL migrations (see Database Schema)
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
| `notifications` | In-app notifications | `user_id`, `type` (`application_received`/`application_status_changed`/`message_received`/`player_joined_team`), `title`, `body`, `link`, `source_id` (dedup), `read_at` |
| `outreach` | Team-initiated contact | `opportunity_id`, `team_profile_id`, `player_profile_id`, `initial_message`, `status` (`pending`/`accepted`/`declined`/`withdrawn`), UNIQUE(`opportunity_id`, `team_profile_id`, `player_profile_id`) |
| `team_memberships` | Canonical "player is on team" | `team_profile_id`, `player_profile_id`, `position`, `role`, `status` (only `active`), UNIQUE index on `player_profile_id` (one-team-per-player MVP rule) |
| `team_invites` | Reusable shared recruitment links | `team_profile_id`, `token_hash` (SHA-256, UNIQUE), `created_by`, `expires_at`, `revoked_at`. **No status column** — state is derived from timestamps. |
| `competition_events` | Competition events (COMP-001) | `name`, `description`, `location`, `event_date TIMESTAMPTZ`, `status` (`draft`/`active`/`drawing`/`completed`/`cancelled`), `challenge_name`, `challenge_threshold`, `max_attempts`, `created_by` (FK profiles, authoritative manager) |
| `competition_participants` | A profile's participation in an event (COMP-001) | `event_id` (FK competition_events), `profile_id` (FK **profiles** — NOT player_profiles), `status` (`registered`/`challenge_pending`/`qualified`/`not_qualified`), `checked_in_at`, UNIQUE(`event_id`, `profile_id`) |
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
| `/competitions/[id]` | `app/competitions/[id]/page.tsx` | Role-aware management page. Both creator and ambassador see event details, stats and the "Run Competition" (participant operations) entry point; only the creator additionally sees edit/lifecycle/ambassadors/join links. |
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
| `/api/competitions/[id]/draw` | GET | COMP-006. Return the drawing result (winner name, eligible count, timestamp — never database ids) if one exists. Creator **or** assigned ambassador only; an unrelated user gets an opaque `404`. |
| `/api/competitions/[id]/draw` | POST | COMP-006. **Start the drawing.** The request body is ignored — the winner is selected server-side by the `start_competition_drawing` RPC and the eligible count is calculated server-side. Creator **or** assigned ambassador. No qualified participants → `409`; a second drawing → `409`. |

### Debug

| Route | Methods | Purpose |
|---|---|---|
| `/api/debug/players` | GET | Diagnostic endpoint for player_profiles queries (counts, discoverable filter, sample rows). |

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

`lib/notifications.ts` → `createNotification({ userId, type, title, body, link, sourceId })`

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
| `REALTIME_CHANNEL_SECRET` | `lib/realtime-broadcast.ts` | HMAC signing for realtime channels |
| `MULTI_TEAM_ADMIN_USER_ID` | `lib/multi-team.ts`, `lib/competition-server.ts` | profiles.id of the multi-team admin (server-only). COMP-007 reuses it as the **only** user allowed to create competitions — server-only, never `NEXT_PUBLIC_`, fails closed when unset. |

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
- ✅ Homepage with personalized recommendations
- ✅ Competitions foundation (COMP-001 — data model, types, authorization, server helpers)
- ✅ Competitions management (COMP-002 — `/competitions` create/manage pages, event editing, controlled lifecycle, ambassador add/remove by email, basic statistics)
- ✅ Competition join links & QR entry flow (COMP-003 — reusable per-ambassador join links, QR codes, public `/competitions/join/[token]` landing page, existing-auth continuation, lightweight registration, pre-entry pass; challenge attempts/raffle/winners in later tickets)
- ✅ Participant verification & challenge attempts (COMP-004 — on-site participant verification by code/QR, server-assigned attempt numbering + pass/fail, event-day operations screen, event-wide statistics)
- ✅ Ambassador event-day operations (COMP-005 — ambassadors run an event: view participants, verify, record attempts and see qualification, via the shared `canManageEvent` creator-or-ambassador rule; creator-only administration preserved)
- ✅ Competition drawing & winner selection (COMP-006 — managers run one atomic, server-side drawing over qualified participants, selecting exactly one winner persisted immutably in `competition_drawings`; one drawing per event enforced at the database level; the winner is shown to the creator and assigned ambassador. No rerolls or prizes.)
- ✅ Public competition results dashboard + admin-only creation (COMP-007 — no-auth `/competitions/results` dashboard showing competitions, qualified participants and the persisted winner, with links to existing public player profiles; competition **creation** temporarily restricted to the `MULTI_TEAM_ADMIN_USER_ID` user, enforced server-side, while ambassador operational permissions are unchanged)

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
| Realtime | HMAC-signed channels, participant-verified |
| Colors | Use `lib/colors.ts` constants, not hardcoded Tailwind classes |
| Types | All shared types in `types/index.ts`; feature types in `features/<feature>/types.ts` |
| Tests | Vitest; pure logic tests in `lib/*.test.ts`, API tests in `app/api/**/__tests__/` |
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
│  PostgreSQL (16 migrations)  ·  Storage (photos/logos)  ·  Realtime │
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
├── supabase/migrations/          # 16 SQL migrations (see Database Schema)
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
| `middleware.ts` | NextAuth `withAuth` wrapper. Public routes: `/`, `/login`, `/signup`, `/api/auth`, `/_next`, `/favicon.ico`, `/players`, `/teams`, `/team/join`. Protected: `/dashboard`, `/player`, `/team`, `/onboarding`, `/messages`, `/notifications`, `/opportunities`. Role-based redirects: player routes require `player` role, team routes require `team` role; no roles → `/onboarding`. |
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

---

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

### Debug

| Route | Methods | Purpose |
|---|---|---|
| `/api/debug/players` | GET | Diagnostic endpoint for player_profiles queries (counts, discoverable filter, sample rows). |

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
| `MULTI_TEAM_ADMIN_USER_ID` | `lib/multi-team.ts` | profiles.id of the multi-team admin (server-only) |

---

## Testing

**Framework:** Vitest + Testing Library + jsdom.

### Test Locations

| Location | What's Tested |
|---|---|
| `lib/*.test.ts` | Pure logic: team-invite, team-join, team-context, team-membership, multi-team, invite-callback |
| `lib/matching/*.test.ts` | Matching engine: engine, applications, mvp014, player-experience, team-applications |
| `app/api/**/__tests__/` | API routes: applications (acceptance, withdrawal), messages, notifications, outreach, team invites, team join |
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
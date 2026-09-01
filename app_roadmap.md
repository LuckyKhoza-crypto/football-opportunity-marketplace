# Football Opportunity Marketplace — Remaining MVP Sprint Tickets

This document contains the remaining Cline tickets after MVP-003 (Player Profile & Onboarding).

## Product Goal

Build a two-sided football opportunity marketplace:
**Players**
- Create a football profile
- Find team opportunities
- Get matched with teams
- Apply to opportunities
- Communicate with teams

**Teams**
- Create a team profile
- Post player opportunities
- Find matching players
- Review applicants
- Communicate with players

---

# MVP-004 — Team Profile & Onboarding

## Goal

Allow authenticated users with the `team` role to create and manage their team profile.

## Requirements

Create a `team_profiles` table associated with the authenticated user.

Suggested fields:

- id
- user_id
- team_name
- logo_url
- location
- league
- playing_level
- description
- website_url
- social_links
- contact_name
- created_at
- updated_at

Build:

- `/team/onboarding`
- `/team/profile`
- `/team/profile/edit`
- Team dashboard at `/team`

Team onboarding should collect:

- Team name
- Logo
- Location
- League
- Playing level
- Description
- Website/social links
- Contact information

Implement:

- Validation
- Profile photo/logo upload
- RLS
- Profile completeness
- Role-based routing
- Loading/error/success states

A team without a profile should be redirected to onboarding.

Do not build opportunities yet.

## Testing

Verify:

- Team can create a profile.
- Team can edit its profile.
- Team cannot modify another team's profile.
- Players cannot access team profile management.
- Profile survives logout/login.
- Logo upload works.
- TypeScript, lint, and production build pass.

## Manual Steps

At the end of the response, list any Supabase Storage/database configuration that must be completed manually.

---

# MVP-005 — Opportunity Creation

## Goal

Allow teams to post football opportunities.

The opportunity is the fundamental marketplace object.

Create an `opportunities` table.

Suggested fields:

- id
- team_id
- title
- position
- secondary_positions
- role
- formation
- age_min
- age_max
- playing_level
- league
- location
- radius
- preferred_foot
- availability
- compensation
- housing
- travel_requirements
- visa_requirements
- contract_length
- tryout_date
- description
- status
- created_at
- updated_at

Status should support:

- draft
- active
- closed

Build:

- `/team/opportunities`
- `/team/opportunities/new`
- `/team/opportunities/[id]`
- `/team/opportunities/[id]/edit`

The team should be able to:

- Create an opportunity
- Save draft
- Publish
- Edit
- Close
- Delete where appropriate
- View its own opportunities

Build a clean opportunity form with sections for:

1. Position
2. Role
3. Requirements
4. Location
5. Availability
6. Compensation
7. Logistics
8. Tryout information
9. Description

Implement validation and RLS.

Only the owning team should be able to modify its opportunities.

## Testing

Test:

- Create draft
- Publish opportunity
- Edit opportunity
- Close opportunity
- Unauthorized modification prevention
- Validation
- Mobile layout
- Build/lint/type checks

## Manual Steps

List any manual database/storage/configuration steps.

---

# MVP-006 — Browse & Search Opportunities

## Goal

Allow players to discover active opportunities.

Create:

`/opportunities`

Players should see opportunity cards containing:

- Team
- Team logo
- Position
- Role
- League
- Playing level
- Location
- Distance where available
- Compensation
- Tryout date
- Availability

Implement filters:

- Position
- Playing level
- League
- Location
- Radius
- Availability
- Compensation where practical

Implement:

- Search
- Filter controls
- Sorting
- Empty state
- Loading state
- Error state

Create:

`/opportunities/[id]`

The detail page should show the complete opportunity and team information.

Only active opportunities should appear in the public/player marketplace.

Do not implement matching yet.

## Testing

Verify:

- Players can browse opportunities.
- Active/closed behavior works.
- Filters work correctly.
- Search works.
- Opportunity detail works.
- Team ownership information is correct.
- Unauthorized users cannot modify opportunities.
- Mobile experience works.

---

# MVP-007 — Player & Opportunity Matching Engine

## Goal

Build the first deterministic matching system.

Do NOT use AI yet.

Create reusable matching logic that evaluates a player against an opportunity.

Initial factors:

- Position
- Secondary position
- Playing level
- Age
- Location/radius
- Availability
- Preferred foot
- Willingness to travel
- Willingness to relocate
- Preferred league

Return:

- Match score
- Match reasons
- Potential mismatches

Example:

```text
94% Match

✓ Position matches
✓ Playing level matches
✓ Within travel radius
✓ Available for tryout
✓ League preference matches

⚠ Team prefers left-footed players
```

The score must be deterministic and explainable.

Do not claim the score represents actual football ability.

Create reusable functions so future matching improvements can be added without rewriting the marketplace.

## Testing

Create unit tests covering:

- Strong match
- Partial match
- Position mismatch
- Level mismatch
- Location mismatch
- Availability mismatch
- Missing profile data

Ensure the same inputs produce the same score.

---

# MVP-008 — Player Recommendations / "Find Me a Team"

## Goal

Turn the matching engine into the player's primary discovery experience.

Create:

`/player/find-team`

The player should see:

**Find Me a Team**

Display:

> Your best opportunities

Each opportunity card should include:

- Match %
- Team
- Position
- League
- Level
- Location
- Compensation
- Tryout date
- Match explanation

Sort primarily by match score, while considering opportunity status and relevance.

Include:

- Filter controls
- Search
- Empty state
- "View Opportunity"
- "Apply"

Update the player dashboard with:

**Find Me a Team**

and a small set of recommended opportunities.

Do not build applications beyond the basic CTA yet.

---

# MVP-009 — Team Player Discovery

## Goal

Allow teams to find players who match their opportunities.

Create:

`/team/find-players`

For each active opportunity, show:

**Players matching this opportunity**

Player cards should include:

- Profile photo
- Name
- Position
- Playing level
- Location
- Availability
- Match %
- Highlight video indicator
- Basic experience

Allow team users to:

- Select an opportunity
- View recommended players
- Filter players
- View full player profile

Only expose information intended for marketplace discovery.

Do not allow teams to edit player profiles.

## Testing

Verify:

- Team can see matching players.
- Match score is consistent.
- Team cannot modify player information.
- Player privacy/RLS rules are respected.
- Filters work.

---

# MVP-010 — Player Applications

## Goal

Allow players to apply to opportunities.

Create an `applications` table.

Suggested fields:

- id
- opportunity_id
- player_id
- status
- message
- created_at
- updated_at

Statuses:

- applied
- viewed
- interested
- rejected
- accepted

Player flow:

`Opportunity → Apply → Confirmation`

Allow an optional short message.

Prevent duplicate applications to the same opportunity.

Create:

`/player/applications`

Display:

- Team
- Opportunity
- Date applied
- Status

## Testing

Verify:

- Player can apply.
- Duplicate applications are prevented.
- Application belongs to correct player/opportunity.
- Player can see their applications.
- Unauthorized users cannot modify applications.

---

# MVP-011 — Team Applicant Management

## Goal

Allow teams to manage applications for their opportunities.

Create:

`/team/applications`

or an equivalent opportunity-specific applicant view.

For each applicant display:

- Player name
- Position
- Level
- Location
- Match %
- Application date
- Status

Team can:

- View player profile
- Mark application as viewed
- Mark interested
- Reject
- Accept

Do not allow teams to alter the player's underlying profile.

The application status should be visible to the player.

## Testing

Verify:

- Team only sees applications for its opportunities.
- Team can update application status.
- Player sees status changes.
- Unauthorized modification is prevented.
- Closed opportunities behave correctly.

---

# MVP-012 — Messaging

## Goal

Allow players and teams to communicate after an application or mutual interest.

Create appropriate conversation/message tables.

Suggested structure:

`conversations`

- id
- player_id
- team_id
- opportunity_id
- created_at
- updated_at

`messages`

- id
- conversation_id
- sender_user_id
- body
- created_at
- read_at

Build:

- Conversation list
- Conversation view
- Message composer
- Unread indicator

Messaging should be available only between relevant users.

Do not build real-time infrastructure unless it is straightforward with the existing stack. Supabase Realtime can be used if already configured.

## Testing

Verify:

- Player can message relevant team.
- Team can reply.
- Messages are associated with correct conversation.
- Users cannot access unrelated conversations.
- Unread state works.

---

# MVP-013 — Marketplace Landing Page

## Goal

Create the public-facing landing page around the marketplace concept.

Core headline:

**Find Your Next Football Opportunity**

Primary choices:

**I'm Looking for a Team**

**I'm Looking for Players**

Explain the two-sided marketplace simply.

Suggested sections:

1. Hero
2. How it works
3. For Players
4. For Teams
5. Example opportunities
6. Example player profiles
7. CTA

The landing page should communicate the product within seconds.

Do not add unnecessary marketing complexity.

---

# MVP-014 — Player Marketplace UX Polish

## Goal

Make the player experience coherent from signup through application.

Primary flow:

```text
Landing
↓
Google Sign-In
↓
Player onboarding
↓
Player profile
↓
Find Me a Team
↓
Opportunity
↓
Apply
↓
Application status
↓
Message team
```

Review and improve:

- Navigation
- Dashboard
- Profile completeness
- Opportunity cards
- Filters
- Match display
- Application flow
- Empty states
- Loading states
- Mobile responsiveness

Do not introduce new major functionality.

---

# MVP-015 — Team Marketplace UX Polish

## Goal

Make the team experience coherent.

Primary flow:

```text
Landing
↓
Google Sign-In
↓
Team onboarding
↓
Team profile
↓
Post Opportunity
↓
Recommended Players
↓
Review Applicant
↓
Message Player
```

Review and improve:

- Team dashboard
- Opportunity management
- Applicant management
- Player discovery
- Match explanations
- Empty states
- Loading states
- Mobile responsiveness

Do not introduce new major functionality.

---

# MVP-016 — Notifications

## Goal

Add basic in-app notifications.

Events:

- New application
- Application status changed
- New message
- Team interested
- Player accepted

Create a notification model.

Implement:

- Notification indicator
- Notification list
- Read/unread state
- Mark as read

Do not build email/push notifications yet unless already trivial.

---

# MVP-017 — Search, Filters & Discovery Improvements

## Goal

Improve marketplace discovery once real data exists.

Player filters:

- Position
- Level
- League
- Location
- Distance
- Availability
- Relocation
- Compensation

Team/player filters:

- Position
- Level
- Location
- Availability
- Preferred foot
- Travel radius

Keep filtering server-side where appropriate for scalability.

Do not build an overly complex search engine.

---

# MVP-018 — Trust, Safety & Verification Foundation

## Goal

Add basic mechanisms to make the marketplace safer and more credible.

Implement:

- Report player
- Report team
- Report opportunity
- Basic account blocking if appropriate
- Profile visibility controls
- Basic verification indicator architecture

Do not build a complicated verification system yet.

Add appropriate RLS and authorization checks.

---

# MVP-019 — Security & Privacy Audit

## Goal

Perform a full security review before launch.

Audit:

- Supabase RLS
- Authentication
- Role authorization
- API/server actions
- Storage policies
- Profile access
- Opportunity access
- Application access
- Messaging access
- Notifications
- Input validation
- File uploads
- URL handling
- Secrets/environment variables

Attempt to access other users' records intentionally during testing and verify authorization prevents it.

Do not expose sensitive account information unnecessarily.

---

# MVP-020 — Performance & Reliability Pass

## Goal

Prepare the MVP for real users.

Review:

- Database queries
- Indexes
- Server/client boundaries
- Loading states
- Error handling
- Image optimization
- Storage usage
- Pagination where needed
- Opportunity/player list performance

Avoid premature optimization.

Focus on obvious bottlenecks and poor user experiences.

---

# MVP-021 — End-to-End QA

## Goal

Test the entire marketplace as a real user.

### Player journey

```text
Google Sign-In
→ Player role
→ Player onboarding
→ Player profile
→ Find Me a Team
→ Browse opportunities
→ View opportunity
→ Apply
→ View application
→ Receive status
→ Message team
```

### Team journey

```text
Google Sign-In
→ Team role
→ Team onboarding
→ Team profile
→ Create opportunity
→ Publish opportunity
→ View matching players
→ Review applicant
→ Change status
→ Message player
```

Test:

- Desktop
- Mobile
- Logged out behavior
- Authorization
- Empty states
- Error states
- Slow network scenarios
- Refreshes
- Browser navigation

Fix issues discovered during QA.

---

# MVP-022 — Production Configuration & Launch

## Goal

Prepare the application for production.

Configure:

- Production environment variables
- Supabase production configuration
- Google OAuth production redirect URL
- Database migrations
- Storage
- RLS
- Domain
- HTTPS
- Error handling
- Production build

Verify:

- Google authentication works in production.
- Player flow works.
- Team flow works.
- Marketplace works.
- Applications work.
- Messaging works.
- No development secrets are exposed.

Document all production configuration.

---

# Definition of MVP Completion

The MVP is complete when this core loop works reliably:

## Player

```text
Sign in
↓
Create profile
↓
Find a team
↓
See matching opportunities
↓
Apply
↓
Team responds
↓
Message team
```

## Team

```text
Sign in
↓
Create team profile
↓
Post opportunity
↓
See matching players
↓
Review applications
↓
Respond
↓
Message player
```

The product should be usable without AI, payments, advanced scouting analytics, or a native mobile application.

---

# Features Explicitly Deferred Beyond MVP

Do not add these unless separately requested:

- AI scouting
- AI-generated player evaluations
- Video analysis
- Automated talent ratings
- Payments/subscriptions
- Contracts/e-signatures
- Payroll
- Agent accounts
- Complex league management
- Native iOS app
- Native Android app
- Advanced performance analytics
- GPS/tracking
- Team scheduling
- Training management
- Push notifications
- Automated recruiting campaigns
- International visa processing

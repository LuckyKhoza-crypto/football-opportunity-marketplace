# MVP-018 — Marketplace Homepage & Discovery UX

## Implementation Plan

### Phase 1: Core Homepage Redesign
- [ ] Create marketplace landing page (`/app/page.tsx`) with two-sided marketplace messaging
- [ ] Add "For Players" section with Find a Team CTA
- [ ] Add "For Teams" section with Find Players CTA
- [ ] Handle authenticated user experience (player-only, team-only, dual-role)
- [ ] Handle logged-out experience with public browsing

### Phase 2: Opportunity Discovery Preview
- [ ] Add "Latest Opportunities" section showing real database opportunities
- [ ] Add "View All Opportunities" link to existing discovery page
- [ ] Add match score display for logged-in players

### Phase 3: Personalized Recommendations
- [ ] Add "Recommended for You" section for authenticated players
- [ ] Use existing matching engine for recommendations
- [ ] Handle incomplete profile state with CTA

### Phase 4: Team Discovery
- [ ] Add "Players You May Be Looking For" section for team users
- [ ] Use existing team-side matching functionality
- [ ] Add "Find More Players" link

### Phase 5: Create Opportunity CTA
- [ ] Add "Post an Opportunity" CTA for team users
- [ ] Ensure proper authorization

### Phase 6: Navigation Improvements
- [ ] Update AppShell navigation to be role-aware
- [ ] Add Player View / Team View switcher for dual-role users
- [ ] Ensure mobile responsiveness

### Phase 7: Opportunity Card Enhancement
- [ ] Add match score support to opportunity card
- [ ] Standardize card structure

### Phase 8: Loading / Empty / Error States
- [ ] Add loading skeletons
- [ ] Add empty states for all sections
- [ ] Add error states

### Phase 9: Testing
- [ ] Add tests for logged-out homepage
- [ ] Add tests for player homepage
- [ ] Add tests for team homepage
- [ ] Add tests for dual-role homepage
- [ ] Add tests for role-aware navigation
- [ ] Add tests for player recommendations
- [ ] Add tests for team recommendations
- [ ] Add tests for empty/loading/error states

### Phase 10: Validation
- [ ] Run TypeScript type checking
- [ ] Run linting
- [ ] Run relevant tests
- [ ] Run production build
- [ ] Fix all errors
- [ ] Verify no regressions
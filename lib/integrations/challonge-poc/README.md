# Challonge Tournament API — FOM POC

An **isolated proof of concept** to determine whether Challonge can act as an
external tournament engine for FOM. This does **not** integrate with the FOM
competition/tournament system. It only exercises the Challonge API.

> **Status:** the production integration built on this POC now lives in
> `lib/integrations/tournament/` (TOURN-001). This POC is kept **unchanged** as the
> evidence artefact for the API behaviour, and is not imported by application code.
> For a live check through the production adapter see the TOURN-001 section of the
> root `README.md`.

## What this POC tests

1. Create a single-elimination tournament
2. Add 16 participants
3. Start the tournament
4. Retrieve the generated bracket/matches
5. Submit match results
6. Verify winners advance automatically
7. Drive the tournament to its completed state and read the winner

## Required environment variable

| Variable             | Scope        | Notes                                              |
| -------------------- | ------------ | -------------------------------------------------- |
| `CHALLONGE_API_KEY`  | server-only  | Never expose to the browser. Add to `.env.local`.  |

Add it to `.env.local` (which is gitignored):

```
CHALLONGE_API_KEY=your_key_here
```

The key is read only from `process.env`, never logged, and never sent to the
client. See `.env.example` for the placeholder.

## How to run

From the `football-opportunity-marketplace` project root (Node 22+):

```
node lib/integrations/challonge-poc/run-poc.ts
```

The script loads `.env.local` itself, probes which Challonge API version
authenticates, then runs the full workflow against the **live** Challonge API.
No responses are mocked. It exits non-zero only on a hard failure.

## API version

The script runs a single authenticated probe and uses the first version that
authenticates. With the current credential, **v1** authenticates
(`https://api.challonge.com/v1`, `api_key` query parameter). v2.1 was probed but
not used; no dual-version support is implemented.

## What it creates in Challonge

For each run, a **private** single-elimination tournament named
`FOM API POC fom_poc_<timestamp>` with 16 synthetic participants
(`POC Player 01`..`POC Player 16`). These are real objects on the Challonge
account and are **not** deleted automatically.

## API operations verified

- `POST /tournaments.json` — create (needs `name`, `url`, `tournament_type`)
- `POST /tournaments/{id}/participants/bulk_add.json` — add participants
- `POST /tournaments/{id}/start.json` — start tournament
- `GET  /tournaments/{id}.json` — read state
- `GET  /tournaments/{id}/matches.json` — read matches
- `PUT  /tournaments/{id}/matches/{match_id}.json` — submit result + winner
- `POST /tournaments/{id}/finalize.json` — finalize (see limitations)

## Limitations / discoveries

- **`url` is restricted**: only letters, numbers, and underscores (hyphens are
  rejected with HTTP 422).
- **Automatic finalization**: after the final result is submitted the tournament
  lands in `awaiting_review` (not `complete`). The `POST .../finalize.json`
  endpoint is required to reach `state=complete` and set `completed_at`. On a
  tournament that is not in a finalizable state it returns **HTTP 400 with an
  empty body** (no error detail).
- `review_before_finalizing` is reported as `true` and could not be changed at
  creation or via update (server-side setting), so `finalize` is always required.
- Score agreement is not required; `scores_csv` + `winner_id` on a match PUT is
  sufficient and advancement is automatic.
- No rate limiting was encountered at this scale (~30 calls/run). A small delay
  between writes is used as a precaution.
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { TournamentPanel } from "../TournamentPanel";

/**
 * TOURN-002 — competition tournament panel.
 *
 * The panel talks to the tournament API only, so these tests mock `fetch` and
 * assert the state machine the competition page shows:
 *
 *   loading → not linked → linked (create/sync/start) → read-only bracket
 *
 * Plus the failure states (unauthorized, provider error, failed action) and the
 * rule that no provider detail ever reaches the DOM.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUMMARY_URL = `/api/competitions/${EVENT_A}/tournament`;
const MATCHES_URL = `${SUMMARY_URL}/matches`;
const PARTICIPANTS_URL = `${SUMMARY_URL}/participants`;
const START_URL = `${SUMMARY_URL}/start`;
const FINALIZE_URL = `${SUMMARY_URL}/finalize`;

/** TOURN-003 — FOM's own reference for the playable `p1 vs p2` match. */
const MATCH_REF = "r1:p1:p2";
const RESULT_URL = `${MATCHES_URL}/${encodeURIComponent(MATCH_REF)}/result`;

const NOT_LINKED = {
  status: 409,
  body: {
    error: "This competition is not linked to an external tournament yet",
    code: "not_linked",
    // The capability list the server reports: only single elimination can be
    // created today, the rest are modelled but unavailable.
    formats: [
      { format: "single_elimination", supported: true },
      { format: "double_elimination", supported: false },
      { format: "round_robin", supported: false },
      { format: "swiss", supported: false },
      { format: "group_stage_knockout", supported: false },
    ],
  },
};

/** A "not linked" response with no capability list at all. */
const NOT_LINKED_WITHOUT_FORMATS = {
  status: 409,
  body: {
    error: "This competition is not linked to an external tournament yet",
    code: "not_linked",
  },
};

/**
 * A capability list reporting MORE than one creatable format — what a future
 * provider adapter would report. The panel must follow the server's answer
 * instead of assuming single elimination.
 */
const NOT_LINKED_WITH_TWO_FORMATS = {
  status: 409,
  body: {
    error: "This competition is not linked to an external tournament yet",
    code: "not_linked",
    formats: [
      { format: "single_elimination", supported: true },
      { format: "round_robin", supported: true },
      { format: "swiss", supported: false },
    ],
  },
};

type FakeReply = { status?: number; body?: unknown };

const fetchMock = vi.fn();

function reply({ status = 200, body = {} }: FakeReply): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function mockApi(handler: (method: string, url: string) => FakeReply) {
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = String(input);
      const fake = handler(method, url);
      return reply(fake);
    },
  );
}

function linkedSummary(state: string, extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      tournament: {
        name: "Sunday Cup",
        format: "single_elimination",
        state,
        isComplete: state === "completed",
        openMatchCount: 0,
        winnerParticipantId: null,
        completedAt: null,
        ...extra,
      },
    },
  };
}

const PARTICIPANTS = [
  { participantId: "p1", name: "Ada Lovelace" },
  { participantId: "p2", name: "Grace Hopper" },
];

function startedBracket(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      tournamentState: "started",
      participants: PARTICIPANTS,
      matches: [
        {
          matchRef: MATCH_REF,
          round: 1,
          state: "completed",
          participant1: { participantId: "p1", name: "Ada Lovelace" },
          participant2: { participantId: "p2", name: "Grace Hopper" },
          score: { participant1Score: 3, participant2Score: 1 },
          winner: { participantId: "p1", name: "Ada Lovelace" },
        },
        {
          // A side is still undecided, so FOM cannot address this match.
          matchRef: null,
          round: 2,
          state: "pending",
          participant1: { participantId: "p1", name: "Ada Lovelace" },
          participant2: { participantId: null, name: null },
          score: null,
          winner: null,
        },
      ],
      ...overrides,
    },
  };
}

/**
 * A started bracket with one PLAYABLE match (both sides known and mapped), one
 * TBD match, one match whose side is not mapped to a participant, and one that
 * already has a result.
 */
function reportableBracket(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      tournamentState: "started",
      participants: [
        ...PARTICIPANTS,
        { participantId: "p3", name: "Alan Turing" },
        { participantId: "p4", name: "Katherine Johnson" },
      ],
      matches: [
        {
          matchRef: MATCH_REF,
          round: 1,
          state: "ready",
          participant1: { participantId: "p1", name: "Ada Lovelace" },
          participant2: { participantId: "p2", name: "Grace Hopper" },
          score: null,
          winner: null,
        },
        {
          matchRef: "r1:p3:p4",
          round: 1,
          state: "completed",
          participant1: { participantId: "p3", name: "Alan Turing" },
          participant2: { participantId: "p4", name: "Katherine Johnson" },
          score: { participant1Score: 2, participant2Score: 0 },
          winner: { participantId: "p3", name: "Alan Turing" },
        },
        {
          // One side is unmapped, so this match cannot be reported either.
          matchRef: null,
          round: 2,
          state: "ready",
          participant1: { participantId: "p1", name: "Ada Lovelace" },
          participant2: { participantId: null, name: "Unknown participant" },
          score: null,
          winner: null,
        },
        {
          matchRef: null,
          round: 2,
          state: "pending",
          participant1: { participantId: null, name: null },
          participant2: { participantId: null, name: null },
          score: null,
          winner: null,
        },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TournamentPanel — not linked", () => {
  it("offers to create the tournament and says none exists yet", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return NOT_LINKED;
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText(
        "No tournament has been created for this competition.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create tournament/i }),
    ).toBeInTheDocument();
    // Nothing to sync or start before the tournament exists.
    expect(
      screen.queryByRole("button", { name: /sync participants/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /start tournament/i }),
    ).toBeNull();
    expect(screen.getByText("Tournament")).toBeInTheDocument();
  });

  it("offers the tournament format before creation, with unsupported formats disabled", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return NOT_LINKED;
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    const select = (await screen.findByLabelText(
      "Tournament Format",
    )) as HTMLSelectElement;

    // The list AND the selection come from the server's capability report.
    expect(select.value).toBe("single_elimination");
    expect(
      Array.from(select.options).map((option) => ({
        value: option.value,
        label: option.text,
        disabled: option.disabled,
      })),
    ).toEqual([
      {
        value: "single_elimination",
        label: "Single Elimination",
        disabled: false,
      },
      {
        value: "double_elimination",
        label: "Double Elimination — Coming soon",
        disabled: true,
      },
      { value: "round_robin", label: "Round Robin — Coming soon", disabled: true },
      { value: "swiss", label: "Swiss — Coming soon", disabled: true },
      {
        value: "group_stage_knockout",
        label: "Group Stage + Knockout — Coming soon",
        disabled: true,
      },
    ]);

    // A supported format is selected, so creation is possible.
    expect(
      screen.getByRole("button", { name: /create tournament/i }),
    ).toBeEnabled();
  });

  it("offers nothing to submit when the server reports no creatable format", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return NOT_LINKED_WITHOUT_FORMATS;
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText(/tournament formats could not be loaded/i),
    ).toBeInTheDocument();
    // Without a format the provider supports, nothing can be created.
    expect(screen.queryByLabelText("Tournament Format")).toBeNull();
    expect(
      screen.getByRole("button", { name: /create tournament/i }),
    ).toBeDisabled();
  });

  it("creates the tournament and then offers the participant sync", async () => {
    let linked = false;

    mockApi((method, url) => {
      if (method === "POST" && url === SUMMARY_URL) {
        linked = true;
        return { status: 201, body: linkedSummary("created").body };
      }
      if (method === "GET" && url === SUMMARY_URL) {
        return linked ? linkedSummary("created") : NOT_LINKED;
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: { tournamentState: "created", participants: [], matches: [] },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /create tournament/i }),
    );

    expect(
      await screen.findByText("Tournament created and linked."),
    ).toBeInTheDocument();
    // The create request carries ONLY the organiser's format choice.
    expect(fetchMock).toHaveBeenCalledWith(SUMMARY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "single_elimination" }),
    });
    expect(await screen.findByText("Tournament linked.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sync participants/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start tournament/i }),
    ).toBeNull();
  });

  it("cannot submit a format the server did not offer as creatable", async () => {
    mockApi((method, url) => {
      if (method === "POST" && url === SUMMARY_URL) {
        return { status: 201, body: linkedSummary("created").body };
      }
      if (method === "GET" && url === SUMMARY_URL) return NOT_LINKED;
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    const select = (await screen.findByLabelText(
      "Tournament Format",
    )) as HTMLSelectElement;

    // Even a manipulated selector cannot smuggle in an unavailable format.
    fireEvent.change(select, { target: { value: "double_elimination" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(SUMMARY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "single_elimination" }),
      }),
    );
  });

  it("submits the format the organiser selected", async () => {
    let linked = false;

    mockApi((method, url) => {
      if (method === "POST" && url === SUMMARY_URL) {
        linked = true;
        return { status: 201, body: linkedSummary("created").body };
      }
      if (method === "GET" && url === SUMMARY_URL) {
        return linked ? linkedSummary("created") : NOT_LINKED_WITH_TWO_FORMATS;
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: { tournamentState: "created", participants: [], matches: [] },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    const select = (await screen.findByLabelText(
      "Tournament Format",
    )) as HTMLSelectElement;

    // The organiser chooses explicitly — the backend never assumes a format.
    fireEvent.change(select, { target: { value: "round_robin" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(SUMMARY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "round_robin" }),
      }),
    );
  });
});

describe("TournamentPanel — linked tournament configuration", () => {
  it("shows the format the tournament was created with", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary("created");
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: { tournamentState: "created", participants: [], matches: [] },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText("Format: Single Elimination"),
    ).toBeInTheDocument();
    // The format is fixed once the tournament exists — nothing to choose here.
    expect(screen.queryByLabelText("Tournament Format")).toBeNull();
  });
});

describe("TournamentPanel — linked, participants not synced", () => {
  it("syncs participants and reports counts without duplicating them", async () => {
    let participants: typeof PARTICIPANTS = [];

    mockApi((method, url) => {
      if (method === "POST" && url === PARTICIPANTS_URL) {
        participants = PARTICIPANTS;
        return { status: 200, body: { synced: 2, alreadyMapped: 1, total: 3 } };
      }
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary("created");
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: { tournamentState: "created", participants, matches: [] },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /sync participants/i }),
    );

    expect(
      await screen.findByText("2 participants synced. 1 participant was already synced."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(PARTICIPANTS_URL, { method: "POST" });
    // The refreshed summary now shows the synced count and offers the start.
    expect(await screen.findByText("2 participants synced.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start tournament/i }),
    ).toBeInTheDocument();
    // The sync stays available for participants registered after a first sync.
    expect(
      screen.getByRole("button", { name: /sync participants/i }),
    ).toBeInTheDocument();
  });

  it("surfaces a failed sync without losing the panel", async () => {
    mockApi((method, url) => {
      if (method === "POST" && url === PARTICIPANTS_URL) {
        return {
          status: 500,
          body: {
            error:
              "Participants were added to the external tournament but could not be mapped in FOM. Reconcile them before retrying.",
          },
        };
      }
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary("created");
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: { tournamentState: "created", participants: [], matches: [] },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /sync participants/i }),
    );

    expect(await screen.findByText(/reconcile them before retrying/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sync participants/i }),
    ).toBeInTheDocument();
  });
});


describe("TournamentPanel — started (read-only bracket)", () => {
  it("starts the tournament and renders the provider-reported matches", async () => {
    let started = false;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockApi((method, url) => {
      if (method === "POST" && url === START_URL) {
        started = true;
        return {
          status: 200,
          body: { started: true, tournament: linkedSummary("started").body },
        };
      }
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary(started ? "started" : "created");
      }
      if (method === "GET" && url === MATCHES_URL) {
        return started
          ? startedBracket()
          : {
              status: 200,
              body: {
                tournamentState: "created",
                participants: PARTICIPANTS,
                matches: [],
              },
            };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /start tournament/i }),
    );

    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(START_URL, { method: "POST" });
    expect(await screen.findByText("Tournament started.")).toBeInTheDocument();
    expect(await screen.findByText("Tournament Started")).toBeInTheDocument();

    // The bracket is rendered from the provider-reported rounds.
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("3 – 1")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    // An undecided side is shown as TBD, never as a raw provider id.
    expect(screen.getByText("TBD")).toBeInTheDocument();
    expect(screen.getByText("winner")).toBeInTheDocument();
    // A completed match states its winner.
    expect(screen.getAllByText("Winner: Ada Lovelace").length).toBeGreaterThan(0);

    // TOURN-003: a running tournament can be finalized, but neither of these
    // matches is playable (one is completed, the other has a TBD side), so no
    // result can be reported for either.
    expect(
      screen.getByRole("button", { name: /finalize tournament/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /report result/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /start tournament/i }),
    ).toBeNull();

    // No provider-specific detail reaches the DOM.
    expect(document.body.textContent ?? "").not.toMatch(
      /challonge|scores_csv|player1_id|player2_id|api_key|provider tournament/i,
    );
  });

  it("shows the champion of a completed tournament", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary("completed", { winnerParticipantId: "p1" });
      }
      if (method === "GET" && url === MATCHES_URL) {
        return startedBracket({
          tournamentState: "completed",
          matches: [
            {
              round: 1,
              state: "completed",
              participant1: { participantId: "p1", name: "Ada Lovelace" },
              participant2: { participantId: "p2", name: "Grace Hopper" },
              score: { participant1Score: 3, participant2Score: 2 },
              winner: { participantId: "p1", name: "Ada Lovelace" },
            },
          ],
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(await screen.findByText("Tournament Completed")).toBeInTheDocument();
    // The champion is shown from the summary, and the completed match states its
    // own winner — nothing is derived from the bracket here.
    expect(screen.getAllByText("Winner: Ada Lovelace").length).toBeGreaterThan(0);
    // A completed tournament cannot be finalized again, and it has no result form.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders an empty bracket state when no matches exist yet", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return linkedSummary("started");
      }
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: {
            tournamentState: "started",
            participants: PARTICIPANTS,
            matches: [],
          },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText(/no matches yet/i),
    ).toBeInTheDocument();
  });
});

describe("TournamentPanel — loading, unauthorized and error states", () => {
  it("shows a loading state while the tournament is being loaded", async () => {
    let release: (() => void) | null = null;

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(reply(NOT_LINKED));
        }),
    );

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(screen.getByText(/loading tournament/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();

    await waitFor(() => expect(release).not.toBeNull());
    release!();

    expect(
      await screen.findByText(
        "No tournament has been created for this competition.",
      ),
    ).toBeInTheDocument();
  });

  it("hides every management control from an unauthorized viewer", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return {
          status: 403,
          body: {
            error: "Not authorized to manage this competition's tournament",
          },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText(
        "Not authorized to manage this competition's tournament",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Create Tournament")).toBeNull();
  });

  it("shows an error state with Retry and recovers", async () => {
    let firstCall = true;

    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        if (firstCall) {
          firstCall = false;
          return {
            status: 502,
            body: { error: "The tournament provider request failed" },
          };
        }
        return NOT_LINKED;
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(
      await screen.findByText("The tournament provider request failed"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create tournament/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText(
        "No tournament has been created for this competition.",
      ),
    ).toBeInTheDocument();
  });
});

describe("TournamentPanel — result reporting", () => {
  /** The bracket after the provider advanced Ada Lovelace into round 2. */
  function advancedBracket() {
    return {
      status: 200,
      body: {
        tournamentState: "started",
        participants: [...PARTICIPANTS],
        matches: [
          {
            matchRef: MATCH_REF,
            round: 1,
            state: "completed",
            participant1: { participantId: "p1", name: "Ada Lovelace" },
            participant2: { participantId: "p2", name: "Grace Hopper" },
            score: { participant1Score: 2, participant2Score: 1 },
            winner: { participantId: "p1", name: "Ada Lovelace" },
          },
          {
            // The round 2 slot is now populated — by the provider, not by FOM.
            matchRef: "r2:p1:p2",
            round: 2,
            state: "ready",
            participant1: { participantId: "p1", name: "Ada Lovelace" },
            participant2: { participantId: "p2", name: "Grace Hopper" },
            score: null,
            winner: null,
          },
        ],
      },
    };
  }

  it("offers a result form only for a playable match", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) return reportableBracket();
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    // Exactly one match is playable: both sides known AND mapped to FOM
    // participants. A completed match, a match with an unmapped side and a TBD
    // match offer no form.
    expect(
      await screen.findAllByRole("button", { name: /report result/i }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Score for Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByLabelText("Score for Grace Hopper")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grace Hopper" })).toBeInTheDocument();

    // No form for the unmapped side, and none for the TBD match.
    expect(screen.queryByLabelText("Score for Unknown participant")).toBeNull();
    expect(screen.getAllByText("TBD").length).toBeGreaterThan(0);
  });

  it("offers no result form while a side is still undecided", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) {
        return startedBracket({
          matches: [
            {
              matchRef: null,
              round: 1,
              state: "pending",
              participant1: { participantId: "p1", name: "Ada Lovelace" },
              participant2: { participantId: null, name: null },
              score: null,
              winner: null,
            },
          ],
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    expect(await screen.findByText("TBD")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report result/i })).toBeNull();
  });

  it("requires the winner to be selected before submitting", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) return reportableBracket();
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /report result/i }),
    );

    expect(
      await screen.findByText("Select the winning participant."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(RESULT_URL, expect.anything());
  });

  it("submits the score and winner, then re-reads the bracket", async () => {
    let reported = false;

    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) {
        return reported ? advancedBracket() : reportableBracket();
      }
      if (method === "POST" && url === RESULT_URL) {
        reported = true;
        return {
          status: 200,
          body: { match: { round: 1, state: "completed" } },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.change(await screen.findByLabelText("Score for Ada Lovelace"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Score for Grace Hopper"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Ada Lovelace" }));
    fireEvent.click(screen.getByRole("button", { name: /report result/i }));

    // FOM-neutral input only: FOM's match reference, a FOM participant id and
    // the two scores.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        RESULT_URL,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      ([url]) => String(url) === RESULT_URL,
    ) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(await screen.findByText("Result reported.")).toBeInTheDocument();

    // The bracket was re-read: the round the provider advanced into is visible
    // (FOM never calculated it) and the new slot is reportable.
    expect(await screen.findByText("2 – 1")).toBeInTheDocument();
    expect(
      await screen.findAllByRole("button", { name: /report result/i }),
    ).toHaveLength(1);

    // Still no provider detail in the DOM.
    expect(document.body.textContent ?? "").not.toMatch(
      /challonge|scores_csv|player_id|api_key|provider/i,
    );
  });

  it("reports a rejected result honestly without losing the panel", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) return reportableBracket();
      if (method === "POST" && url === RESULT_URL) {
        return {
          status: 409,
          body: { error: "This match is not ready for a result yet" },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.change(await screen.findByLabelText("Score for Ada Lovelace"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Score for Grace Hopper"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Ada Lovelace" }));
    fireEvent.click(screen.getByRole("button", { name: /report result/i }));

    expect(
      await screen.findByText("This match is not ready for a result yet"),
    ).toBeInTheDocument();
    // The bracket is still there and the form can be retried.
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /report result/i })).toBeEnabled();
  });
});

describe("TournamentPanel — finalization", () => {
  it("finalizes the tournament and shows the winner afterwards", async () => {
    let finalized = false;

    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) {
        return finalized
          ? linkedSummary("completed", { winnerParticipantId: "p1" })
          : linkedSummary("started");
      }
      if (method === "GET" && url === MATCHES_URL) return startedBracket();
      if (method === "POST" && url === FINALIZE_URL) {
        finalized = true;
        return {
          status: 200,
          body: {
            finalized: true,
            winnerParticipantId: "p1",
            tournament: {
              name: "Sunday Cup",
              format: "single_elimination",
              state: "completed",
              isComplete: true,
              completedAt: "2026-01-01T10:00:00Z",
            },
          },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    const finalizeButton = await screen.findByRole("button", {
      name: /finalize tournament/i,
    });
    fireEvent.click(finalizeButton);

    // The body is deliberately empty: the server decides which tournament.
    expect(fetchMock).toHaveBeenCalledWith(FINALIZE_URL, { method: "POST" });

    expect(await screen.findByText("Tournament finalized.")).toBeInTheDocument();
    expect(await screen.findByText("Tournament Completed")).toBeInTheDocument();
    expect(
      screen.getAllByText("Winner: Ada Lovelace").length,
    ).toBeGreaterThan(0);

    // The button is gone once the provider reports the tournament as complete.
    expect(
      screen.queryByRole("button", { name: /finalize tournament/i }),
    ).toBeNull();
  });

  it("does not offer finalization for a tournament that has not started", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("created");
      if (method === "GET" && url === MATCHES_URL) {
        return {
          status: 200,
          body: {
            tournamentState: "created",
            participants: PARTICIPANTS,
            matches: [],
          },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    // The panel offers the start (and the sync) instead.
    expect(
      await screen.findByRole("button", { name: /start tournament/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /finalize tournament/i }),
    ).toBeNull();
  });

  it("surfaces a refused finalization honestly", async () => {
    mockApi((method, url) => {
      if (method === "GET" && url === SUMMARY_URL) return linkedSummary("started");
      if (method === "GET" && url === MATCHES_URL) return startedBracket();
      if (method === "POST" && url === FINALIZE_URL) {
        return {
          status: 400,
          body: {
            error:
              "The tournament provider refused to finalize the tournament (HTTP 400). The bracket may still have unreported matches.",
          },
        };
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<TournamentPanel eventId={EVENT_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /finalize tournament/i }),
    );

    expect(
      await screen.findByText(/refused to finalize the tournament/i),
    ).toBeInTheDocument();
    // A refused finalization keeps the tournament running and the bracket intact.
    expect(screen.getByText("Tournament Started")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
  });
});


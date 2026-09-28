import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/** `process.env.NODE_ENV` is typed read-only; cast for test-time overrides. */
function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

// Partially mock the barrel so the real error classes / shell builder are kept
// while the network-calling service is replaced.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendTransactionalEmail: vi.fn() };
});

import {
  EmailConfigError,
  EmailProviderError,
  EmailProviderRequestError,
  sendTransactionalEmail,
} from "@/lib/email";
import { GET, POST } from "@/app/api/debug/email-test/route";

function getRequest(query: string) {
  return new Request(`http://localhost/api/debug/email-test${query}`);
}

describe("EMAIL-001: /api/debug/email-test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNodeEnv("test");
    delete process.env.EMAIL_TEST_RECIPIENT;
    vi.mocked(sendTransactionalEmail).mockResolvedValue({
      success: true,
      messageId: "brevo-msg-1",
    });
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV);
    delete process.env.EMAIL_TEST_RECIPIENT;
  });

  it("fails closed with 404 in production (never a public relay)", async () => {
    setNodeEnv("production");
    const response = await GET(getRequest("?to=attacker@example.com"));
    expect(response.status).toBe(404);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when no recipient is supplied", async () => {
    const response = await GET(getRequest(""));
    expect(response.status).toBe(400);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sends the fixed subject/body and returns the Brevo message id", async () => {
    const response = await GET(getRequest("?to=recipient@example.com"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe("brevo-msg-1");

    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(sent.subject).toBe("FOM Sports email test");
    expect(sent.to).toEqual({ email: "recipient@example.com" });
    expect(sent.text).toContain(
      "Your FOM Sports Brevo integration is working.",
    );
    expect(sent.html).toContain(
      "Your FOM Sports Brevo integration is working.",
    );
  });

  it("ignores caller-supplied subject/html (fixed body only)", async () => {
    await GET(
      getRequest("?to=recipient@example.com&subject=HACKED&html=%3Ch1%3EHACKED%3C%2Fh1%3E"),
    );
    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(sent.subject).toBe("FOM Sports email test");
    expect(sent.subject).not.toContain("HACKED");
    expect(sent.html).not.toContain("HACKED");
    expect(sent.to).toEqual({ email: "recipient@example.com" });
  });

  it("falls back to EMAIL_TEST_RECIPIENT when `to` is omitted", async () => {
    process.env.EMAIL_TEST_RECIPIENT = "env-recipient@example.com";
    const response = await GET(getRequest(""));
    expect(response.status).toBe(200);
    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(sent.to).toEqual({ email: "env-recipient@example.com" });
  });

  it("returns 500 listing missing variable NAMES when config is missing", async () => {
    vi.mocked(sendTransactionalEmail).mockRejectedValue(
      new EmailConfigError(["BREVO_API_KEY"]),
    );
    const response = await GET(getRequest("?to=recipient@example.com"));
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.missing).toEqual(["BREVO_API_KEY"]);
  });

  it("returns 502 with a safe provider status on a Brevo error", async () => {
    vi.mocked(sendTransactionalEmail).mockRejectedValue(
      new EmailProviderError("Invalid sender", { status: 401 }),
    );
    const response = await GET(getRequest("?to=recipient@example.com"));
    const data = await response.json();
    expect(response.status).toBe(502);
    expect(data.providerStatus).toBe(401);
    expect(JSON.stringify(data)).not.toContain("BREVO_API_KEY");
  });

  it("returns 502 when Brevo is unreachable", async () => {
    vi.mocked(sendTransactionalEmail).mockRejectedValue(
      new EmailProviderRequestError(),
    );
    const response = await GET(getRequest("?to=recipient@example.com"));
    expect(response.status).toBe(502);
  });

  it("POST accepts a JSON body and passes the recipient name through", async () => {
    const response = await POST(
      new Request("http://localhost/api/debug/email-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "recipient@example.com", name: "Alex" }),
      }),
    );
    expect(response.status).toBe(200);
    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(sent.to).toEqual({ email: "recipient@example.com", name: "Alex" });
  });

  it("POST fails closed with 404 in production", async () => {
    setNodeEnv("production");
    const response = await POST(
      new Request("http://localhost/api/debug/email-test", {
        method: "POST",
        body: JSON.stringify({ to: "attacker@example.com" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
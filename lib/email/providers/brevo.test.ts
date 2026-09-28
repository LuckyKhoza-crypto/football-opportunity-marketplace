import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  buildBrevoPayload,
  sendWithBrevo,
} from "@/lib/email/providers/brevo";
import {
  EmailConfigError,
  EmailProviderError,
  EmailProviderRequestError,
} from "@/lib/email/errors";
import type { TransactionalEmail } from "@/lib/email/types";

const API_KEY = "test-brevo-api-key-value";
const FROM_EMAIL = "notifications@fom-sports.com";
const FROM_NAME = "FOM Sports";

const EMAIL: TransactionalEmail = {
  to: { email: "recipient@example.com", name: "Recipient Name" },
  subject: "FOM Sports email test",
  html: "<p>Your FOM Sports Brevo integration is working.</p>",
  text: "Your FOM Sports Brevo integration is working.",
};

function setValidEnv() {
  process.env.BREVO_API_KEY = API_KEY;
  process.env.BREVO_FROM_EMAIL = FROM_EMAIL;
  process.env.BREVO_FROM_NAME = FROM_NAME;
}

function clearEnv() {
  delete process.env.BREVO_API_KEY;
  delete process.env.BREVO_FROM_EMAIL;
  delete process.env.BREVO_FROM_NAME;
}

/** Minimal Response-like object for the mocked fetch. */
function jsonResponse(
  body: unknown,
  init: { ok: boolean; status: number },
): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => body,
  } as Response;
}

describe("EMAIL-001: Brevo provider — payload construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setValidEnv();
  });
  afterEach(clearEnv);

  it("builds the correct recipient, sender, subject and bodies", () => {
    const payload = buildBrevoPayload(EMAIL);

    expect(payload.sender).toEqual({ name: FROM_NAME, email: FROM_EMAIL });
    expect(payload.to).toEqual([
      { email: "recipient@example.com", name: "Recipient Name" },
    ]);
    expect(payload.subject).toBe(EMAIL.subject);
    expect(payload.htmlContent).toBe(EMAIL.html);
    expect(payload.textContent).toBe(EMAIL.text);
  });

  it("omits the recipient name when not supplied", () => {
    const payload = buildBrevoPayload({
      ...EMAIL,
      to: { email: "recipient@example.com" },
    });
    expect(payload.to).toEqual([{ email: "recipient@example.com" }]);
  });

  it("omits textContent when no text is supplied", () => {
    const withoutText: TransactionalEmail = {
      to: EMAIL.to,
      subject: EMAIL.subject,
      html: EMAIL.html,
    };
    const payload = buildBrevoPayload(withoutText);
    expect(payload.textContent).toBeUndefined();
    expect("textContent" in payload).toBe(false);
  });
});

describe("EMAIL-001: Brevo provider — sending", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setValidEnv();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("POSTs to the v3 endpoint with the api-key header and returns the message id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ messageId: "<brevo-message-id@example>" }, { ok: true, status: 201 }),
    );

    const result = await sendWithBrevo(EMAIL);

    expect(result).toEqual({
      success: true,
      messageId: "<brevo-message-id@example>",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT);
    expect(init.method).toBe("POST");

    // Expected Brevo authentication header (value is the configured key).
    expect(init.headers["api-key"]).toBe(API_KEY);
    expect(init.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ name: FROM_NAME, email: FROM_EMAIL });
    expect(body.to).toEqual([
      { email: "recipient@example.com", name: "Recipient Name" },
    ]);
    expect(body.subject).toBe(EMAIL.subject);
    expect(body.htmlContent).toBe(EMAIL.html);
    expect(body.textContent).toBe(EMAIL.text);
  });

  it("throws EmailConfigError and never calls fetch when configuration is missing", async () => {
    clearEnv();
    await expect(sendWithBrevo(EMAIL)).rejects.toBeInstanceOf(EmailConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws EmailProviderError on a non-2xx response (status retained)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { code: "invalid_parameter", message: "Invalid sender" },
        { ok: false, status: 400 },
      ),
    );

    try {
      await sendWithBrevo(EMAIL);
      throw new Error("expected sendWithBrevo to throw");
    } catch (error) {
      const e = error as EmailProviderError;
      expect(e).toBeInstanceOf(EmailProviderError);
      expect(e.status).toBe(400);
      expect(e.message).toBe("Invalid sender");
      // The API key must never appear in the error.
      expect(JSON.stringify(e.message)).not.toContain(API_KEY);
    }
  });

  it("throws EmailProviderRequestError on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED 1.2.3.4:443"));
    await expect(sendWithBrevo(EMAIL)).rejects.toBeInstanceOf(
      EmailProviderRequestError,
    );
  });

  it("throws EmailProviderError when a 2xx response has no message id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({}, { ok: true, status: 201 }),
    );
    await expect(sendWithBrevo(EMAIL)).rejects.toBeInstanceOf(EmailProviderError);
  });

  it("never leaks the api key or auth header in a thrown network error", async () => {
    fetchMock.mockRejectedValue(new Error(`request failed with key ${API_KEY}`));
    try {
      await sendWithBrevo(EMAIL);
      throw new Error("expected sendWithBrevo to throw");
    } catch (error) {
      const e = error as EmailProviderRequestError;
      expect(e.message).not.toContain(API_KEY);
    }
  });
});
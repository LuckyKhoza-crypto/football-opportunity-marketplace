import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/email/providers/brevo", () => ({
  sendWithBrevo: vi.fn(),
}));

import { sendWithBrevo } from "@/lib/email/providers/brevo";
import {
  isValidRecipientEmail,
  sendTransactionalEmail,
} from "@/lib/email/email-service";
import { EmailRecipientError } from "@/lib/email/errors";
import type { TransactionalEmail } from "@/lib/email/types";

const EMAIL: TransactionalEmail = {
  to: { email: "recipient@example.com", name: "Recipient Name" },
  subject: "FOM Sports email test",
  html: "<p>Your FOM Sports Brevo integration is working.</p>",
  text: "Your FOM Sports Brevo integration is working.",
};

describe("EMAIL-001: email service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendWithBrevo).mockResolvedValue({
      success: true,
      messageId: "msg-123",
    });
  });

  it("validates recipient email addresses", () => {
    expect(isValidRecipientEmail("a@b.com")).toBe(true);
    expect(isValidRecipientEmail("  a@b.com  ")).toBe(true);
    expect(isValidRecipientEmail("")).toBe(false);
    expect(isValidRecipientEmail("not-an-email")).toBe(false);
    expect(isValidRecipientEmail("missing@domain")).toBe(false);
    expect(isValidRecipientEmail("two@@at.com")).toBe(false);
  });

  it("delegates to the provider and returns its result", async () => {
    const result = await sendTransactionalEmail(EMAIL);
    expect(result).toEqual({ success: true, messageId: "msg-123" });
    expect(sendWithBrevo).toHaveBeenCalledTimes(1);
    expect(sendWithBrevo).toHaveBeenCalledWith(EMAIL);
  });

  it("trims the recipient before sending", async () => {
    await sendTransactionalEmail({ ...EMAIL, to: { email: "  a@b.com  " } });
    const arg = vi.mocked(sendWithBrevo).mock.calls[0][0];
    expect(arg.to.email).toBe("a@b.com");
  });

  it("rejects a malformed recipient without calling the provider", async () => {
    await expect(
      sendTransactionalEmail({ ...EMAIL, to: { email: "nope" } }),
    ).rejects.toBeInstanceOf(EmailRecipientError);
    expect(sendWithBrevo).not.toHaveBeenCalled();
  });

  it("does not log the API key when sending", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.BREVO_API_KEY = "secret-should-not-log";
    await sendTransactionalEmail(EMAIL);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain("secret-should-not-log");
    infoSpy.mockRestore();
    delete process.env.BREVO_API_KEY;
  });
});

describe("EMAIL-001: server-only enforcement", () => {
  const files = [
    "lib/email/email-service.ts",
    "lib/email/providers/brevo.ts",
  ];

  it.each(files)("%s declares the server-only boundary", (relPath) => {
    const source = readFileSync(resolve(process.cwd(), relPath), "utf8");
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("no email module exposes a NEXT_PUBLIC_ Brevo variable", () => {
    const index = readFileSync(
      resolve(process.cwd(), "lib/email/index.ts"),
      "utf8",
    );
    expect(index).not.toContain("NEXT_PUBLIC_BREVO");
  });
});
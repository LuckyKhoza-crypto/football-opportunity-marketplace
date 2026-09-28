import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getEmailConfig, isEmailConfigured } from "@/lib/email/config";
import { EmailConfigError } from "@/lib/email/errors";

const ENV_KEYS = [
  "BREVO_API_KEY",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
] as const;

const VALID = {
  BREVO_API_KEY: "test-brevo-api-key-value",
  BREVO_FROM_EMAIL: "notifications@fom-sports.com",
  BREVO_FROM_NAME: "FOM Sports",
};

function setEnv(overrides: Partial<Record<string, string | undefined>>) {
  for (const key of ENV_KEYS) {
    const value =
      key in overrides ? overrides[key] : VALID[key as keyof typeof VALID];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("EMAIL-001: email configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("returns the resolved configuration when every variable is present", () => {
    setEnv({});
    const config = getEmailConfig();
    expect(config).toEqual({
      apiKey: VALID.BREVO_API_KEY,
      fromEmail: VALID.BREVO_FROM_EMAIL,
      fromName: VALID.BREVO_FROM_NAME,
    });
  });

  it("fails safely when BREVO_API_KEY is missing", () => {
    setEnv({ BREVO_API_KEY: undefined });
    expect(() => getEmailConfig()).toThrow(EmailConfigError);
    try {
      getEmailConfig();
    } catch (error) {
      const e = error as EmailConfigError;
      expect(e.code).toBe("email_config_missing");
      expect(e.missing).toEqual(["BREVO_API_KEY"]);
    }
  });

  it("fails safely when BREVO_FROM_EMAIL is missing", () => {
    setEnv({ BREVO_FROM_EMAIL: undefined });
    try {
      getEmailConfig();
      throw new Error("expected getEmailConfig to throw");
    } catch (error) {
      const e = error as EmailConfigError;
      expect(e).toBeInstanceOf(EmailConfigError);
      expect(e.missing).toEqual(["BREVO_FROM_EMAIL"]);
    }
  });

  it("fails safely when BREVO_FROM_NAME is missing", () => {
    setEnv({ BREVO_FROM_NAME: undefined });
    try {
      getEmailConfig();
      throw new Error("expected getEmailConfig to throw");
    } catch (error) {
      const e = error as EmailConfigError;
      expect(e).toBeInstanceOf(EmailConfigError);
      expect(e.missing).toEqual(["BREVO_FROM_NAME"]);
    }
  });

  it("treats whitespace-only values as missing", () => {
    setEnv({ BREVO_API_KEY: "   " });
    expect(() => getEmailConfig()).toThrow(EmailConfigError);
  });

  it("lists only variable NAMES in the error — never secret values", () => {
    setEnv({ BREVO_API_KEY: undefined, BREVO_FROM_EMAIL: undefined });
    try {
      getEmailConfig();
      throw new Error("expected getEmailConfig to throw");
    } catch (error) {
      const e = error as EmailConfigError;
      expect(e.message).not.toContain(VALID.BREVO_API_KEY);
      expect(e.message).not.toContain(VALID.BREVO_FROM_NAME);
      expect(e.missing).toEqual(["BREVO_API_KEY", "BREVO_FROM_EMAIL"]);
    }
  });

  it("isEmailConfigured reflects presence of all variables", () => {
    setEnv({});
    expect(isEmailConfigured()).toBe(true);

    setEnv({ BREVO_API_KEY: undefined });
    expect(isEmailConfigured()).toBe(false);
  });
});
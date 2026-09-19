import { describe, it, expect } from "vitest";
import { isSafeCallbackUrl, getSafeCallbackUrl } from "@/lib/invite-callback";

describe("TEAM-003: safe callback URL validation", () => {
  describe("isSafeCallbackUrl", () => {
    it("accepts relative internal paths", () => {
      expect(isSafeCallbackUrl("/team/join/abc123")).toBe(true);
      expect(isSafeCallbackUrl("/team/join/abc123?foo=bar")).toBe(true);
      expect(isSafeCallbackUrl("/dashboard")).toBe(true);
    });

    it("rejects absolute external URLs", () => {
      expect(isSafeCallbackUrl("https://malicious-site.com")).toBe(false);
      expect(isSafeCallbackUrl("http://malicious-site.com")).toBe(false);
    });

    it("rejects protocol-relative URLs", () => {
      expect(isSafeCallbackUrl("//malicious-site.com")).toBe(false);
    });

    it("rejects backslash tricks", () => {
      expect(isSafeCallbackUrl("\\/\\/malicious-site.com")).toBe(false);
    });

    it("rejects javascript: scheme", () => {
      expect(isSafeCallbackUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects values not starting with /", () => {
      expect(isSafeCallbackUrl("team/join/abc")).toBe(false);
    });

    it("rejects empty/whitespace/null/undefined", () => {
      expect(isSafeCallbackUrl("")).toBe(false);
      expect(isSafeCallbackUrl("   ")).toBe(false);
      expect(isSafeCallbackUrl(null)).toBe(false);
      expect(isSafeCallbackUrl(undefined)).toBe(false);
    });

    it("rejects scheme embedded in path", () => {
      expect(isSafeCallbackUrl("/team/join/https://evil.com")).toBe(false);
    });
  });

  describe("getSafeCallbackUrl", () => {
    it("returns safe URL when valid", () => {
      expect(getSafeCallbackUrl("/team/join/abc", "/dashboard")).toBe("/team/join/abc");
    });

    it("returns fallback for external/protocol-relative/null/empty", () => {
      expect(getSafeCallbackUrl("https://malicious-site.com", "/dashboard")).toBe("/dashboard");
      expect(getSafeCallbackUrl("//malicious-site.com", "/dashboard")).toBe("/dashboard");
      expect(getSafeCallbackUrl(null, "/dashboard")).toBe("/dashboard");
      expect(getSafeCallbackUrl("", "/dashboard")).toBe("/dashboard");
    });

    it("trims whitespace from valid URL", () => {
      expect(getSafeCallbackUrl("  /team/join/abc  ", "/dashboard")).toBe("/team/join/abc");
    });
  });
});
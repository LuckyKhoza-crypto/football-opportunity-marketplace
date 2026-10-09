import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderVerificationQrPng } from "@/lib/email/qr";

/**
 * COMP-EMAIL-001 — server-side QR rendering.
 *
 * The QR is rendered in Node (via the `qrcode` dependency's bundled PNG
 * renderer) so the hosted email QR (and the public `verify-qr` route) encode the
 * exact payload shown on the participant pass without adding a dependency.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("COMP-EMAIL-001: server-side verification QR", () => {
  it("renders PNG bytes (not a data URI)", async () => {
    const png = await renderVerificationQrPng(
      "https://fom-sports.com/competitions/verify/tok",
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.length).toBeGreaterThan(100);
    // Not a base64 data URI — the unsupported embedding is gone.
    expect(png.toString("utf8").startsWith("data:image")).toBe(false);
  });

  it("is deterministic for the same payload and differs for another", async () => {
    const a = await renderVerificationQrPng(
      "https://fom-sports.com/competitions/verify/aaa",
    );
    const b = await renderVerificationQrPng(
      "https://fom-sports.com/competitions/verify/aaa",
    );
    const c = await renderVerificationQrPng(
      "https://fom-sports.com/competitions/verify/bbb",
    );
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("rejects an empty payload", async () => {
    await expect(renderVerificationQrPng("")).rejects.toThrow();
    await expect(renderVerificationQrPng("   ")).rejects.toThrow();
  });
});


import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/email/qr", () => ({
  renderVerificationQrPng: vi.fn(),
}));

import { renderVerificationQrPng } from "@/lib/email/qr";
import { GET } from "../[token]/route";

/**
 * COMP-EMAIL-001 — public hosted verification-QR image route.
 *
 * The route must render the QR from the EXACT pass payload (canonical public
 * origin + token) so the emailed QR matches the on-screen pass, and must never
 * leak the token.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TOKEN = "opaque-token-123";

function png() {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from("qr-bytes")]);
}

function call(token: string, url = `http://localhost/api/competitions/verify-qr/${token}`) {
  return GET(new Request(url), {
    params: Promise.resolve({ token }),
  });
}

const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const prevNextUrl = process.env.NEXTAUTH_URL;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderVerificationQrPng).mockResolvedValue(png());
});

afterEach(() => {
  if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  if (prevNextUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = prevNextUrl;
});

describe("COMP-EMAIL-001 route: GET /api/competitions/verify-qr/[token]", () => {
  it("renders the QR from the exact pass payload (origin + token)", async () => {
    const res = await call(TOKEN);

    expect(res.status).toBe(200);
    expect(renderVerificationQrPng).toHaveBeenCalledTimes(1);
    expect(renderVerificationQrPng).toHaveBeenCalledWith(
      `http://localhost/competitions/verify/${TOKEN}`,
    );

    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it("falls back to the fetch origin when no public URL is configured", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    await call(TOKEN, `https://fom-sports.com/api/competitions/verify-qr/${TOKEN}`);
    expect(renderVerificationQrPng).toHaveBeenCalledWith(
      `https://fom-sports.com/competitions/verify/${TOKEN}`,
    );
  });

  it("uses the configured PUBLIC origin so the emailed QR matches the pass (even behind a redirect)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.fom-sports.com";
    // Fetched via a different host (e.g. apex that 308-redirects to www)…
    await call(TOKEN, `https://fom-sports.com/api/competitions/verify-qr/${TOKEN}`);
    // …but the encoded payload still uses the canonical public origin.
    expect(renderVerificationQrPng).toHaveBeenCalledWith(
      `https://www.fom-sports.com/competitions/verify/${TOKEN}`,
    );
  });

  it("returns 404 and does not render when the token is empty", async () => {
    const res = await call("   ");
    expect(res.status).toBe(404);
    expect(renderVerificationQrPng).not.toHaveBeenCalled();
  });

  it("returns 404 (never leaking the token) when rendering fails", async () => {
    vi.mocked(renderVerificationQrPng).mockRejectedValue(new Error("boom"));
    const res = await call(TOKEN);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
  });

  it("never echoes the token in the image filename/header", async () => {
    const res = await call(TOKEN);
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="registration-qr.png"',
    );
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/email/notification-delivery", () => ({
  processEmailDeliveries: vi.fn(),
}));

import { processEmailDeliveries } from "@/lib/email/notification-delivery";
import { POST, GET } from "../route";

const SECRET = "test-delivery-secret-value";

function request(
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request("http://localhost/api/email/deliveries/process", {
    method,
    headers,
  });
}

describe("EMAIL-002: delivery processor route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_DELIVERY_SECRET = SECRET;
    vi.mocked(processEmailDeliveries).mockResolvedValue({
      claimed: 2,
      sent: 1,
      retried: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it("fails closed with 404 when no secret is configured", async () => {
    delete process.env.EMAIL_DELIVERY_SECRET;
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(404);
    expect(processEmailDeliveries).not.toHaveBeenCalled();
  });

  it("rejects requests without a matching secret (404)", async () => {
    const res = await POST(request());
    expect(res.status).toBe(404);
    expect(processEmailDeliveries).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret (404)", async () => {
    const res = await POST(request({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(404);
    expect(processEmailDeliveries).not.toHaveBeenCalled();
  });

  it("processes deliveries with a valid bearer secret", async () => {
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, claimed: 2, sent: 1, retried: 1 });
    expect(processEmailDeliveries).toHaveBeenCalledTimes(1);
  });

  it("accepts the x-email-delivery-secret header", async () => {
    const res = await POST(request({ "x-email-delivery-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(processEmailDeliveries).toHaveBeenCalledTimes(1);
  });

  it("supports GET invocation for schedulers", async () => {
    const res = await GET(request({ authorization: `Bearer ${SECRET}` }, "GET"));
    expect(res.status).toBe(200);
    expect(processEmailDeliveries).toHaveBeenCalledTimes(1);
  });

  it("returns 500 without leaking internal details on processor failure", async () => {
    vi.mocked(processEmailDeliveries).mockRejectedValueOnce(
      new Error("internal secret detail"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("internal secret detail");
    errSpy.mockRestore();
  });

  it("never exposes recipient email or provider state in the response", async () => {
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["claimed", "failed", "retried", "sent", "skipped", "success"].sort(),
    );
  });
});
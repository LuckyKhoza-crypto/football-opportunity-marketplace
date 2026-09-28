import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");
const MIGRATION_FILE = "0021_email_notification_deliveries.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

describe("EMAIL-002: email notification deliveries migration (0021)", () => {
  const sql = readMigration();

  it("creates the email_notification_deliveries table", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS email_notification_deliveries",
    );
  });

  it("links delivery to notifications and enforces one per notification", () => {
    expect(sql).toContain(
      "notification_id UUID NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE",
    );
  });

  it("stores the required lifecycle columns", () => {
    expect(sql).toContain("recipient_email TEXT NOT NULL");
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'");
    expect(sql).toContain("attempts INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("available_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(sql).toContain("sent_at TIMESTAMPTZ");
    expect(sql).toContain("last_error TEXT");
    expect(sql).toContain("provider_message_id TEXT");
    expect(sql).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(sql).toContain("updated_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("constrains status to the allowed lifecycle values", () => {
    expect(sql).toContain(
      "CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'))",
    );
  });

  it("indexes status and available_at for the delivery worker", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS email_notification_deliveries_status_available_at_idx",
    );
    expect(sql).toContain("ON email_notification_deliveries (status, available_at)");
  });

  it("enables RLS without exposing the table to clients", () => {
    expect(sql).toContain(
      "ALTER TABLE email_notification_deliveries ENABLE ROW LEVEL SECURITY",
    );
    // No client policy may be created for this sensitive table.
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("maintains updated_at via the shared trigger function", () => {
    expect(sql).toContain(
      "CREATE TRIGGER set_email_notification_deliveries_updated_at",
    );
    expect(sql).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });

  it("claims deliveries atomically with FOR UPDATE SKIP LOCKED", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION claim_next_email_delivery");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("SET search_path = public");
  });

  it("only claims eligible rows and increments attempts on claim", () => {
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("available_at <= now()");
    expect(sql).toContain("attempts < p_max_attempts");
    expect(sql).toContain("attempts = attempts + 1");
  });

  it("recovers stale 'sending' rows via a stale-claim timeout", () => {
    expect(sql).toContain("requeue_stale_email_deliveries");
    expect(sql).toContain("status = 'sending'");
    expect(sql).toContain("make_interval(secs => p_stale_seconds)");
  });

  it("does not touch marketplace tables, the notification UI, or realtime", () => {
    expect(sql).not.toMatch(/ALTER TABLE notifications/i);
    expect(sql).not.toContain("ALTER PUBLICATION supabase_realtime");
    expect(sql).not.toMatch(/ALTER TABLE (applications|outreach|messages)/i);
  });
});
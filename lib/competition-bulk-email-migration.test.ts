import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0028_competition_bulk_email.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * T-BULK-1 — migration 0028.
 *
 * Adds the bulk-email persistence the host/ambassador "Email Participants"
 * action needs: one batch table + one per-recipient outbox table + ONE atomic
 * claim RPC that mirrors the EMAIL-002 outbox. Additive only: it creates new
 * objects and never drops/relaxes anything that already exists.
 */

describe("T-BULK-1: bulk email migration (0028)", () => {
  const sql = readMigration();

  it("creates the batch table keyed to the competition", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS competition_bulk_emails");
    expect(sql).toContain(
      "event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE",
    );
    expect(sql).toContain(
      "sent_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL",
    );
    expect(sql).toMatch(/request_id TEXT NOT NULL/);
    expect(sql).toMatch(/subject TEXT NOT NULL/);
    expect(sql).toMatch(/body_text TEXT NOT NULL/);
  });

  it("makes the send idempotent per (competition, request id)", () => {
    expect(sql).toMatch(
      /CONSTRAINT competition_bulk_emails_request_key UNIQUE \(event_id, request_id\)/,
    );
  });

  it("records the server-observed audience snapshot on the batch", () => {
    expect(sql).toContain("eligible_count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("invalid_count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("duplicate_count INTEGER NOT NULL DEFAULT 0");
    expect(
      sql.match(/CHECK \((eligible_count|invalid_count|duplicate_count) >= 0\)/g)
        ?.length,
    ).toBe(3);
  });

  it("creates the per-recipient outbox (one row per individual message)", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS competition_bulk_email_recipients",
    );
    expect(sql).toContain(
      "batch_id UUID NOT NULL REFERENCES competition_bulk_emails(id) ON DELETE CASCADE",
    );
    expect(sql).toContain(
      "profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL",
    );
    expect(sql).toMatch(/recipient_email TEXT NOT NULL/);
    expect(sql).toMatch(/\brecipient_name TEXT/);
    expect(sql).toMatch(/last_error TEXT/);
    expect(sql).toMatch(/provider_message_id TEXT/);
    // The delivery lifecycle can never include a "delivered" claim.
    expect(sql).toContain(
      "CHECK (status IN ('pending', 'sending', 'sent', 'failed'))",
    );
    expect(sql).toContain("attempts INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("available_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("prevents duplicate messages within a batch at the database level", () => {
    expect(sql).toMatch(
      /CONSTRAINT competition_bulk_email_recipients_batch_email_key\s+UNIQUE \(batch_id, recipient_email\)/,
    );
  });

  it("indexes the worker access path and the FK columns", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS competition_bulk_email_recipients_batch_status_idx",
    );
    expect(sql).toContain(
      "ON competition_bulk_email_recipients (batch_id, status, available_at)",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS competition_bulk_email_recipients_profile_id_idx",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS competition_bulk_emails_event_created_idx",
    );
  });

  it("maintains updated_at with the shared trigger function", () => {
    expect(sql).toContain("EXECUTE FUNCTION update_updated_at_column();");
    expect(sql).toContain("FOR EACH ROW");
  });

  it("never exposes recipient addresses to clients (RLS, no policies)", () => {
    expect(sql).toContain(
      "ALTER TABLE competition_bulk_emails ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE competition_bulk_email_recipients ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("T-BULK-1: bulk email claim RPC (0028)", () => {
  const sql = readMigration();

  it("adds the atomic claim RPC (concurrency-safe, bounded attempts)", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION claim_next_bulk_email_recipient(",
    );
    expect(sql).toContain("p_batch_id UUID");
    expect(sql).toContain("p_stale_seconds INTEGER DEFAULT 300");
    expect(sql).toContain("p_max_attempts INTEGER DEFAULT 5");
    expect(sql).toContain("RETURNS SETOF competition_bulk_email_recipients");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("attempts < p_max_attempts");
    expect(sql).toContain("available_at <= now()");
    // Stranded 'sending' rows are recovered and the claim increments attempts.
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("attempts = attempts + 1");
  });

  it("scopes the claim to one batch (no cross-competition draining)", () => {
    expect(sql).toContain("WHERE batch_id = p_batch_id");
    expect(sql).toContain("IF p_batch_id IS NULL THEN");
  });

  it("restricts the claim RPC to the service role", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION claim_next_bulk_email_recipient(uuid, integer, integer) FROM PUBLIC",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION claim_next_bulk_email_recipient(uuid, integer, integer) TO service_role",
    );
  });
});

describe("T-BULK-1: migration 0028 is additive", () => {
  const sql = readMigration();

  it("drops, truncates and rewrites nothing that already exists", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_participants/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_events/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_drawings/i);
  });

  it("does not become a second notification delivery path", () => {
    // The EMAIL-002 notification outbox stays the only notification-driven
    // delivery table: this migration never touches `notifications` or
    // `email_notification_deliveries`, and adds no notification column.
    expect(sql).not.toMatch(/ALTER TABLE notifications/i);
    expect(sql).not.toMatch(/ALTER TABLE email_notification_deliveries/i);
    expect(sql).not.toMatch(/notification_id UUID/);
    expect(sql).not.toMatch(/REFERENCES notifications/i);
    expect(sql).not.toMatch(/SELECT[^;]*FROM notifications/i);
  });
});


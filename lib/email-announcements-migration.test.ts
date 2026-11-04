import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0030_email_announcements.sql";
const STORAGE_FILE = "0031_email_announcement_image_storage.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

function readStorage(): string {
  return readFileSync(join(MIGRATIONS_DIR, STORAGE_FILE), "utf-8");
}

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — migration 0030 (+ the storage SQL 0031).
 *
 * Adds the announcement persistence the admin "Email Users" feature needs: one
 * batch table, one per-recipient outbox table, one resolved-promotion-link cache
 * and ONE atomic claim RPC that mirrors the EMAIL-002 outbox. Additive only: it
 * creates new objects and never drops/relaxes anything that already exists.
 */

describe("FOM-EMAIL-ANNOUNCEMENTS-001: announcement migration (0030)", () => {
  const sql = readMigration();

  it("creates the batch table with the audience model", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS email_announcement_batches",
    );
    expect(sql).toContain(
      "CHECK (audience_type IN ('all_users', 'previous_competition'))",
    );
    expect(sql).toContain(
      "previous_event_id UUID REFERENCES competition_events(id) ON DELETE SET NULL",
    );
    expect(sql).toContain(
      "promotion_event_id UUID REFERENCES competition_events(id) ON DELETE SET NULL",
    );
    expect(sql).toMatch(/promotion_url TEXT/);
    expect(sql).toMatch(/image_url TEXT/);
    expect(sql).toContain(
      "sent_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL",
    );
    expect(sql).toMatch(/request_id TEXT NOT NULL/);
    expect(sql).toMatch(/subject TEXT NOT NULL/);
    expect(sql).toMatch(/body_text TEXT NOT NULL/);
  });

  it("makes the send idempotent per request id", () => {
    expect(sql).toMatch(
      /CONSTRAINT email_announcement_batches_request_key UNIQUE \(request_id\)/,
    );
  });

  it("records the server-observed audience snapshot (incl. the exclusions)", () => {
    expect(sql).toContain("eligible_count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("invalid_count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("duplicate_count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain(
      "excluded_registered_count INTEGER NOT NULL DEFAULT 0",
    );
    expect(
      sql.match(
        /CHECK \((eligible_count|invalid_count|duplicate_count|excluded_registered_count) >= 0\)/g,
      )?.length,
    ).toBe(4);
  });

  it("creates the per-recipient outbox (one row per individual message)", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS email_announcement_recipients",
    );
    expect(sql).toContain(
      "batch_id UUID NOT NULL REFERENCES email_announcement_batches(id) ON DELETE CASCADE",
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
      /CONSTRAINT email_announcement_recipients_batch_email_key\s+UNIQUE \(batch_id, recipient_email\)/,
    );
  });

  it("caches ONE resolved promotion link per competition (reuse, no duplicates)", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS email_announcement_promotion_links",
    );
    expect(sql).toContain(
      "event_id UUID PRIMARY KEY REFERENCES competition_events(id) ON DELETE CASCADE",
    );
    expect(sql).toContain(
      "join_link_id UUID NOT NULL REFERENCES competition_join_links(id) ON DELETE CASCADE",
    );
    expect(sql).toMatch(/raw_url TEXT NOT NULL/);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: announcement migration (0030) continued", () => {
  const sql = readMigration();

  it("indexes the worker access path and the FK columns", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS email_announcement_recipients_batch_status_idx",
    );
    expect(sql).toContain(
      "ON email_announcement_recipients (batch_id, status, available_at)",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS email_announcement_batches_created_idx",
    );
  });

  it("maintains updated_at with the shared trigger function", () => {
    expect(sql).toContain("EXECUTE FUNCTION update_updated_at_column();");
    expect(sql).toContain("FOR EACH ROW");
  });

  it("never exposes recipient addresses to clients (RLS, no policies)", () => {
    expect(sql).toContain(
      "ALTER TABLE email_announcement_batches ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE email_announcement_recipients ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE email_announcement_promotion_links ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("adds the atomic claim RPC (concurrency-safe, bounded attempts)", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION claim_next_announcement_recipient(",
    );
    expect(sql).toContain("p_batch_id UUID");
    expect(sql).toContain("p_stale_seconds INTEGER DEFAULT 300");
    expect(sql).toContain("p_max_attempts INTEGER DEFAULT 5");
    expect(sql).toContain("RETURNS SETOF email_announcement_recipients");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("attempts < p_max_attempts");
    expect(sql).toContain("available_at <= now()");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("attempts = attempts + 1");
  });

  it("restricts the claim RPC to the service role", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION claim_next_announcement_recipient(uuid, integer, integer) FROM PUBLIC",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION claim_next_announcement_recipient(uuid, integer, integer) TO service_role",
    );
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: migrations are additive", () => {
  const sql = readMigration();

  it("drops, truncates and rewrites nothing that already exists", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });

  it("does NOT modify the competition bulk-email pipeline (T-BULK-1)", () => {
    expect(sql).not.toMatch(/CREATE TABLE[^;]*competition_bulk_email/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_bulk_email/i);
    expect(sql).not.toMatch(/INSERT INTO competition_bulk_email/i);
    expect(sql).not.toMatch(/FUNCTION claim_next_bulk_email_recipient/);
  });

  it("does NOT touch the notification path or join-link security", () => {
    expect(sql).not.toMatch(/ALTER TABLE notifications/i);
    expect(sql).not.toMatch(/ALTER TABLE email_notification_deliveries/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_join_links/i);
    // No plaintext token column is ever added.
    expect(sql).not.toMatch(/token TEXT/);
    expect(sql).not.toMatch(/raw_token/);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: image storage SQL (0031)", () => {
  const sql = readStorage();

  it("creates the public announcement image bucket idempotently", () => {
    expect(sql).toContain("INSERT INTO storage.buckets (id, name, public)");
    expect(sql).toContain("'email-announcement-images'");
    expect(sql).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("allows public reads but no client writes", () => {
    expect(sql).toContain(
      'CREATE POLICY "Anyone can view announcement images"',
    );
    expect(sql).toContain("FOR SELECT");
    expect(sql).not.toMatch(/FOR INSERT/i);
    expect(sql).not.toMatch(/FOR UPDATE/i);
    expect(sql).not.toMatch(/FOR DELETE/i);
  });
});


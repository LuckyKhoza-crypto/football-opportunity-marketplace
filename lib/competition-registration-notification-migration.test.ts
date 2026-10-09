import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0025_competition_registration_notification.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

describe("COMP-EMAIL-001: registration notification migration (0025)", () => {
  const sql = readMigration();

  it("widens the notifications type CHECK to allow the new type", () => {
    expect(sql).toContain(
      "ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check",
    );
    expect(sql).toContain(
      "ALTER TABLE notifications ADD CONSTRAINT notifications_type_check",
    );
    expect(sql).toContain("'competition_registration_confirmed'");
    // The previously-allowed types must be preserved.
    expect(sql).toContain("'player_joined_team'");
    expect(sql).toContain("'application_status_changed'");
    expect(sql).toContain("'message_received'");
    expect(sql).toContain("'application_received'");
  });

  it("adds a per-participant dedup index for the new type", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS notifications_competition_registration_dedup_idx",
    );
    expect(sql).toContain("ON notifications (user_id, source_id)");
    expect(sql).toContain("WHERE type = 'competition_registration_confirmed'");
  });

  it("does not persist any token, QR or rendered email", () => {
    expect(sql).not.toMatch(/verification_token/i);
    expect(sql).not.toMatch(/notification_token/i);
    expect(sql).not.toMatch(/qr_/i);
    expect(sql).not.toMatch(/payload/i);
    expect(sql).not.toMatch(/ADD COLUMN/i);
  });

  it("does not touch competition tables, RLS policies or the realtime publication", () => {
    expect(sql).not.toMatch(/ALTER TABLE competition_/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toContain("ALTER PUBLICATION");
    expect(sql).not.toMatch(/email_notification_deliveries/i);
  });
});

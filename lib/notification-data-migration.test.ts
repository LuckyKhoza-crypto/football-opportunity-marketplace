import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0022_notification_data.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

describe("EMAIL-003: notification data migration (0022)", () => {
  const sql = readMigration();

  it("adds a nullable data JSONB column to notifications", () => {
    expect(sql).toContain("ALTER TABLE notifications");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS data JSONB");
  });

  it("guards that any present payload is a JSON object", () => {
    expect(sql).toContain("notifications_data_is_object");
    expect(sql).toContain("jsonb_typeof(data) = 'object'");
  });

  it("does not touch RLS, dedup indexes, or the realtime publication", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX/i);
    expect(sql).not.toContain("ALTER PUBLICATION");
    expect(sql).not.toMatch(/ALTER TABLE (applications|outreach|messages)/i);
  });
});
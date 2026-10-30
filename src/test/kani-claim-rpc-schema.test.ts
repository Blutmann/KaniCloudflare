import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("claim_appointment_notification RPC Contract & Regression Protection", () => {
  it("migration file 20261030210000 defines recipient_phone in RETURNS TABLE and all query branches", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20261030210000_kani_fix_claim_appointment_notification_recipient_phone.sql",
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, "utf-8");

    // 1. RETURNS TABLE definition must include recipient_phone text
    expect(sql).toMatch(/returns table\s*\([\s\S]*?recipient_email text,\s*recipient_phone text,\s*client_name text/i);

    // 2. ALREADY_SENT branch must select v_event.recipient_phone in exact order
    expect(sql).toMatch(/if v_event\.status = 'SENT' then[\s\S]*?select v_event\.id, v_event\.notification_type, v_event\.recipient_email,\s*v_event\.recipient_phone,/i);

    // 3. IN_PROGRESS branch must select v_event.recipient_phone in exact order
    expect(sql).toMatch(/if v_event\.status = 'SENDING'[\s\S]*?select v_event\.id, v_event\.notification_type, v_event\.recipient_email,\s*v_event\.recipient_phone,/i);

    // 4. READY branch must select v_event.recipient_phone in exact order
    expect(sql).toMatch(/return query\s*select v_event\.id, v_event\.notification_type, v_event\.recipient_email,\s*v_event\.recipient_phone,/i);

    // 5. Must drop function first to allow return type change in PostgreSQL
    expect(sql).toMatch(/drop function if exists public\.claim_appointment_notification\(uuid, text\);/i);

    // 6. Must restore grants to service_role, authenticated, and anon
    expect(sql).toMatch(/grant execute on function public\.claim_appointment_notification\(uuid, text\) to anon, authenticated, service_role;/i);
  });
});

import { NextResponse } from "next/server";

export async function POST() {
  const results: string[] = [];

  try {
    const { db } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");

    // Add missing columns to bk_app_users
    await db.execute(sql`ALTER TABLE bk_app_users
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS display_name text,
      ADD COLUMN IF NOT EXISTS last_name text,
      ADD COLUMN IF NOT EXISTS created_by text`);
    results.push("bk_app_users: added missing columns");

    // Add nickname column to bk_ledger_entities if missing
    await db.execute(sql`ALTER TABLE bk_ledger_entities
      ADD COLUMN IF NOT EXISTS nickname text`);
    results.push("bk_ledger_entities: added nickname");

    // Add access_level to bk_entity_access if missing
    await db.execute(sql`ALTER TABLE bk_entity_access
      ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'read'`);
    results.push("bk_entity_access: added access_level");

    // Ensure bk_audit_log exists
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_email text NOT NULL,
      actor_role text NOT NULL,
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      action text NOT NULL,
      target_type text,
      target_id text,
      summary text,
      detail jsonb,
      reviewed boolean NOT NULL DEFAULT false,
      reviewed_at timestamptz,
      reviewed_by text,
      created_at timestamptz DEFAULT now()
    )`);
    await db.execute(sql`ALTER TABLE bk_audit_log ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_audit_log FROM anon, authenticated`);
    results.push("bk_audit_log: ensured exists with RLS");

    // Verify the home page query now works
    const { eq } = await import("drizzle-orm");
    const { schema } = await import("@/lib/db/client");
    const rows = await db
      .select({ firstName: schema.bkAppUsers.firstName, displayName: schema.bkAppUsers.displayName })
      .from(schema.bkAppUsers)
      .where(eq(schema.bkAppUsers.email, "services@themerakipartnership.com"))
      .limit(1);
    results.push(`verify bk_app_users query: ok (${rows.length} rows)`);

    return NextResponse.json({ status: "ok", results });
  } catch (e: unknown) {
    return NextResponse.json({
      status: "error",
      results,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}

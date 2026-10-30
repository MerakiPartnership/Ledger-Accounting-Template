import { NextResponse } from "next/server";

function errDetail(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const pg = e as Error & { code?: string; detail?: string; severity?: string; cause?: unknown };
  const parts = [pg.message];
  if (pg.code) parts.push(`code=${pg.code}`);
  if (pg.severity) parts.push(`severity=${pg.severity}`);
  if (pg.detail) parts.push(`detail=${pg.detail}`);
  if (pg.cause) parts.push(`cause=${String(pg.cause)}`);
  return parts.join(' | ');
}

export async function GET() {
  const results: Record<string, string> = {};

  // 0. Env var check
  results.SUPABASE_DB_URL = process.env.SUPABASE_DB_URL ? `set (${process.env.SUPABASE_DB_URL.length} chars)` : "MISSING";
  results.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ? `set (${process.env.NEXT_PUBLIC_SUPABASE_URL.length} chars)` : "MISSING";
  results.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? `set (${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length} chars)` : "MISSING";
  results.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? `set (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)` : "MISSING";

  // 1. Test DB connection
  try {
    const { db, schema } = await import("@/lib/db/client");
    results.db_connect = "ok";

    // 1b. Test raw query
    try {
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`SELECT 1 as test`);
      results.raw_query = `ok`;
    } catch (e: unknown) {
      results.raw_query = `ERROR: ${errDetail(e)}`;
    }

    // 2. Test bk_app_users
    try {
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ email: schema.bkAppUsers.email })
        .from(schema.bkAppUsers)
        .limit(1);
      results.bk_app_users = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_app_users = `ERROR: ${errDetail(e)}`;
    }

    // 3. Test bk_ledger_entities
    try {
      const rows = await db
        .select({ id: schema.bkLedgerEntities.id })
        .from(schema.bkLedgerEntities)
        .limit(1);
      results.bk_ledger_entities = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_ledger_entities = `ERROR: ${errDetail(e)}`;
    }

    // 4. Test bk_plaid_transactions
    try {
      const rows = await db
        .select({ id: schema.bkPlaidTransactions.id })
        .from(schema.bkPlaidTransactions)
        .limit(1);
      results.bk_plaid_transactions = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_plaid_transactions = `ERROR: ${errDetail(e)}`;
    }

    // 5. Test bk_audit_log
    try {
      const rows = await db
        .select({ id: schema.bkAuditLog.id })
        .from(schema.bkAuditLog)
        .limit(1);
      results.bk_audit_log = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_audit_log = `ERROR: ${errDetail(e)}`;
    }
  } catch (e: unknown) {
    results.db_connect = `ERROR: ${errDetail(e)}`;
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}

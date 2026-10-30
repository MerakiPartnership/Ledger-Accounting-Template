import { NextResponse } from "next/server";

export async function GET() {
  const results: Record<string, string> = {};

  // 1. Test DB connection
  try {
    const { db, schema } = await import("@/lib/db/client");
    results.db_connect = "ok";

    // 2. Test bk_app_users
    try {
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ email: schema.bkAppUsers.email })
        .from(schema.bkAppUsers)
        .limit(1);
      results.bk_app_users = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_app_users = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 3. Test bk_ledger_entities
    try {
      const rows = await db
        .select({ id: schema.bkLedgerEntities.id })
        .from(schema.bkLedgerEntities)
        .limit(1);
      results.bk_ledger_entities = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_ledger_entities = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 4. Test bk_plaid_transactions
    try {
      const rows = await db
        .select({ id: schema.bkPlaidTransactions.id })
        .from(schema.bkPlaidTransactions)
        .limit(1);
      results.bk_plaid_transactions = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_plaid_transactions = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 5. Test bk_audit_log
    try {
      const rows = await db
        .select({ id: schema.bkAuditLog.id })
        .from(schema.bkAuditLog)
        .limit(1);
      results.bk_audit_log = `ok (${rows.length} rows)`;
    } catch (e: unknown) {
      results.bk_audit_log = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 6. Test getCurrentUser
    try {
      const { getCurrentUser } = await import("@/lib/supabase/auth-server");
      const user = await getCurrentUser();
      results.getCurrentUser = user ? `ok (${user.email})` : "null (not authenticated)";
    } catch (e: unknown) {
      results.getCurrentUser = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 7. Test full home page flow
    try {
      const { getCurrentUser } = await import("@/lib/supabase/auth-server");
      const { accessibleEntityIds, isAdmin } = await import("@/lib/ledger/access");
      const user = await getCurrentUser();
      if (user) {
        const admin = await isAdmin(user.email);
        results.isAdmin = `ok (${admin})`;
        const ids = await accessibleEntityIds(user.email);
        results.accessibleEntityIds = `ok (${ids === "all" ? "all" : ids.size})`;
      } else {
        results.home_flow = "skipped (no user)";
      }
    } catch (e: unknown) {
      results.home_flow = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 8. Test pendingCountsByEntity
    try {
      const { pendingCountsByEntity } = await import("@/lib/plaid/review-data");
      const counts = await pendingCountsByEntity("all", {
        settledOnly: true,
        excludeQueueHidden: true,
      });
      results.pendingCountsByEntity = `ok (${counts.size} entities)`;
    } catch (e: unknown) {
      results.pendingCountsByEntity = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 9. Test unreviewedCount
    try {
      const { unreviewedCount } = await import("@/lib/ledger/audit-review");
      const n = await unreviewedCount();
      results.unreviewedCount = `ok (${n})`;
    } catch (e: unknown) {
      results.unreviewedCount = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  } catch (e: unknown) {
    results.db_connect = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}

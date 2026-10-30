import { NextResponse } from "next/server";

function errDetail(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const pg = e as Error & { code?: string; detail?: string; severity?: string; cause?: unknown; stack?: string };
  const parts = [pg.message];
  if (pg.code) parts.push(`code=${pg.code}`);
  if (pg.severity) parts.push(`severity=${pg.severity}`);
  if (pg.detail) parts.push(`detail=${pg.detail}`);
  if (pg.cause) parts.push(`cause=${String(pg.cause)}`);
  if (pg.stack) parts.push(`stack=${pg.stack.slice(0, 500)}`);
  return parts.join(' | ');
}

export async function GET() {
  const results: Record<string, string> = {};

  // 0. Env var check
  results.SUPABASE_DB_URL = process.env.SUPABASE_DB_URL ? `set (${process.env.SUPABASE_DB_URL.length} chars)` : "MISSING";
  results.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ? `set (${process.env.NEXT_PUBLIC_SUPABASE_URL.length} chars)` : "MISSING";
  results.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? `set (${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length} chars)` : "MISSING";
  results.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? `set (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)` : "MISSING";

  // 1. Test DB connection + raw query
  try {
    const { db, schema } = await import("@/lib/db/client");
    const { eq, asc, sql } = await import("drizzle-orm");
    results.db_connect = "ok";

    try {
      await db.execute(sql`SELECT 1 as test`);
      results.raw_query = "ok";
    } catch (e: unknown) {
      results.raw_query = `ERROR: ${errDetail(e)}`;
    }

    // 2. Test getCurrentUser
    try {
      const { getCurrentUser } = await import("@/lib/supabase/auth-server");
      const user = await getCurrentUser();
      results.getCurrentUser = user ? `ok (${user.email})` : "null (not authenticated via cookie)";

      if (user) {
        // 3. Simulate the EXACT home page queries
        try {
          const userRows = await db
            .select({
              firstName: schema.bkAppUsers.firstName,
              displayName: schema.bkAppUsers.displayName,
            })
            .from(schema.bkAppUsers)
            .where(eq(schema.bkAppUsers.email, user.email ?? ""))
            .limit(1);
          results.step1_userRows = `ok (${userRows.length} rows)`;
        } catch (e: unknown) {
          results.step1_userRows = `ERROR: ${errDetail(e)}`;
        }

        try {
          const allEntities = await db
            .select({
              id: schema.bkLedgerEntities.id,
              name: schema.bkLedgerEntities.name,
              nickname: schema.bkLedgerEntities.nickname,
            })
            .from(schema.bkLedgerEntities)
            .orderBy(asc(schema.bkLedgerEntities.name));
          results.step2_entities = `ok (${allEntities.length} rows)`;
        } catch (e: unknown) {
          results.step2_entities = `ERROR: ${errDetail(e)}`;
        }

        try {
          const { isAdmin } = await import("@/lib/ledger/access");
          const admin = await isAdmin(user.email);
          results.step3_isAdmin = `ok (${admin})`;
        } catch (e: unknown) {
          results.step3_isAdmin = `ERROR: ${errDetail(e)}`;
        }

        try {
          const { accessibleEntityIds } = await import("@/lib/ledger/access");
          const ids = await accessibleEntityIds(user.email);
          results.step4_entityIds = `ok (${ids === "all" ? "all" : ids.size})`;
        } catch (e: unknown) {
          results.step4_entityIds = `ERROR: ${errDetail(e)}`;
        }

        try {
          const { pendingCountsByEntity } = await import("@/lib/plaid/review-data");
          const { accessibleEntityIds } = await import("@/lib/ledger/access");
          const ids = await accessibleEntityIds(user.email);
          const counts = await pendingCountsByEntity(ids, {
            settledOnly: true,
            excludeQueueHidden: true,
          });
          results.step5_pending = `ok (${counts.size} entities)`;
        } catch (e: unknown) {
          results.step5_pending = `ERROR: ${errDetail(e)}`;
        }

        try {
          const { unreviewedCount } = await import("@/lib/ledger/audit-review");
          const n = await unreviewedCount();
          results.step6_unreviewed = `ok (${n})`;
        } catch (e: unknown) {
          results.step6_unreviewed = `ERROR: ${errDetail(e)}`;
        }

        try {
          const { isEntityCreator } = await import("@/lib/ledger/access");
          const canCreate = isEntityCreator(user.email);
          results.step7_entityCreator = `ok (${canCreate})`;
        } catch (e: unknown) {
          results.step7_entityCreator = `ERROR: ${errDetail(e)}`;
        }
      }
    } catch (e: unknown) {
      results.getCurrentUser = `ERROR: ${errDetail(e)}`;
    }
  } catch (e: unknown) {
    results.db_connect = `ERROR: ${errDetail(e)}`;
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}

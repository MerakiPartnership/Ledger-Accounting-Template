import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, unknown> = {};

  // 1. Check env vars are present (values redacted)
  checks.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "MISSING";
  checks.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "MISSING";
  checks.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING";
  checks.SUPABASE_DB_URL = process.env.SUPABASE_DB_URL ? "set" : "MISSING";
  checks.AUTH_ADMIN_EMAILS = process.env.AUTH_ADMIN_EMAILS ?? "MISSING";
  checks.AUTH_ALLOWED_EMAILS = process.env.AUTH_ALLOWED_EMAILS ?? "MISSING";
  checks.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "MISSING";

  // 2. Test DB connection (Drizzle/postgres.js)
  try {
    const { db } = await import("@/lib/db/client");
    const { bkAppUsers } = await import("@/lib/db/schema");
    const rows = await db.select().from(bkAppUsers).limit(1);
    checks.db_test = `OK — ${rows.length} row(s)`;
  } catch (e: unknown) {
    checks.db_test = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 3. Test isEmailAllowed
  try {
    const { isEmailAllowed } = await import("@/lib/ledger/access");
    const email = process.env.AUTH_ADMIN_EMAILS?.split(",")[0]?.trim();
    if (email) {
      const allowed = await isEmailAllowed(email);
      checks.is_email_allowed = allowed ? "OK — allowed" : "BLOCKED";
    } else {
      checks.is_email_allowed = "SKIP — no admin email configured";
    }
  } catch (e: unknown) {
    checks.is_email_allowed = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4. Test Supabase Auth reachability
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url) {
      const res = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      });
      checks.auth_reachable = res.ok ? "OK" : `FAILED: HTTP ${res.status}`;
    } else {
      checks.auth_reachable = "SKIP — no URL";
    }
  } catch (e: unknown) {
    checks.auth_reachable = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(checks, {
    headers: { "Cache-Control": "no-store" },
  });
}

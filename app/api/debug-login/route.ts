import { NextResponse } from "next/server";
import { isEmailAllowed, isEnvAdmin } from "@/lib/ledger/access";

// TEMPORARY diagnostic endpoint — remove after login is fixed
export async function GET() {
  const email = "services@themerakipartnership.com";
  const checks: Record<string, unknown> = {};

  // 1. Check env vars exist (don't leak values)
  checks.AUTH_ADMIN_EMAILS_set = !!process.env.AUTH_ADMIN_EMAILS;
  checks.AUTH_ADMIN_EMAILS_length = (process.env.AUTH_ADMIN_EMAILS ?? "").length;
  checks.AUTH_ALLOWED_EMAILS_set = !!process.env.AUTH_ALLOWED_EMAILS;
  checks.SUPABASE_DB_URL_set = !!process.env.SUPABASE_DB_URL;
  checks.SUPABASE_DB_URL_length = (process.env.SUPABASE_DB_URL ?? "").length;
  checks.NEXT_PUBLIC_SUPABASE_URL_set = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  checks.NEXT_PUBLIC_SUPABASE_ANON_KEY_set = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  checks.OWNER_EMAIL_set = !!process.env.OWNER_EMAIL;

  // 2. Check isEnvAdmin
  checks.isEnvAdmin = isEnvAdmin(email);

  // 3. Check isEmailAllowed (includes DB check)
  try {
    checks.isEmailAllowed = await isEmailAllowed(email);
  } catch (err) {
    checks.isEmailAllowed_error = String(err);
  }

  return NextResponse.json(checks);
}

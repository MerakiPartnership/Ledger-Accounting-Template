import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { fetch as undiciFetch } from "undici";
import { randomUUID } from "node:crypto";
import { isEmailAllowed } from "@/lib/ledger/access";
import { limitAction, loginIdentity } from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/supabase/auth-server";

/**
 * POST /api/auth/login — authenticates via Supabase and sets session cookies.
 *
 * Uses a Route Handler instead of a Server Action so we construct the response
 * ourselves with clean headers. On Vercel, Server Actions inherit a response
 * context polluted with non-Latin1 headers (e.g. x-vercel-ip-city with Unicode
 * city names), and any interaction with Next.js's cookies() API on that context
 * throws "Cannot convert argument to a ByteString". By reading cookies from the
 * raw request and writing them onto a fresh NextResponse, we avoid that entirely.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const rl = await limitAction("login", loginIdentity(request.headers));
  if (rl) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  let allowed: boolean;
  try {
    allowed = await isEmailAllowed(email);
  } catch {
    allowed = false;
  }

  // Read cookies from the raw request — no cookies() API, no ByteString risk.
  const reqCookies = request.cookies.getAll().map((c) => ({
    name: c.name,
    value: c.value,
  }));

  // Accumulate cookies the Supabase client wants to write.
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return reqCookies;
        },
        setAll(cookiesToSet) {
          pendingCookies.length = 0;
          cookiesToSet.forEach((c) =>
            pendingCookies.push({
              name: c.name,
              value: c.value,
              options: c.options ?? {},
            })
          );
        },
      },
      global: {
        fetch: (input, init) =>
          undiciFetch(
            input as Parameters<typeof undiciFetch>[0],
            init as Parameters<typeof undiciFetch>[1]
          ) as unknown as Promise<Response>,
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: allowed ? password : randomUUID(),
  });

  if (error || !allowed) {
    return NextResponse.json(
      { error: "Invalid email or password.", _debug: error?.message?.slice(0, 120) ?? (allowed ? null : "not_allowed") },
      { status: 401 }
    );
  }

  // Build a fresh redirect response — clean headers, no ByteString.
  const redirectUrl = new URL(next, request.url);
  const response = NextResponse.redirect(redirectUrl, { status: 303 });

  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Parameters<NextResponse["cookies"]["set"]>[2]);
  }

  return response;
}

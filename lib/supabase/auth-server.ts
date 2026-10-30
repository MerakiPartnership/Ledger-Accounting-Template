import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fetch as undiciFetch } from "undici";

/**
 * Cookie-bound Supabase client for server components, server actions, and route
 * handlers. Uses the ANON key (RLS/auth context = the signed-in user), distinct
 * from `getServerSupabase()` which is the service-role data client. Auth here is
 * the LOGIN gate (is this a known user?). WHICH entities a signed-in user may see
 * is a separate authorization layer in `lib/ledger/access.ts` (admins see all;
 * others are scoped by `bk_entity_access`). This is still not DB-level RLS — the
 * service-role data client bypasses it; enforcement is in pages/actions/routes.
 */
export async function getAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          try {
            return cookieStore.getAll();
          } catch {
            return [];
          }
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component or ByteString — middleware refreshes the session
          }
        },
      },
      global: {
        fetch: (input, init) => {
          // Next.js's patched global fetch merges request-context headers
          // (including Vercel-injected non-Latin1 ones like x-vercel-ip-city)
          // into outgoing requests, crashing with "Cannot convert argument to
          // a ByteString". Bypass the patched fetch entirely by using undici's
          // native fetch which has no async-context header forwarding.
          return undiciFetch(input as Parameters<typeof undiciFetch>[0], init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
        },
      },
    }
  );
}

/** The current signed-in user (validated against the Auth server), or null. */
export async function getCurrentUser() {
  try {
    const supabase = await getAuthClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

/**
 * Sanitize a post-login `next` redirect target. Only same-origin absolute paths
 * are allowed: must start with a single "/" and not "//" (protocol-relative,
 * resolves to another host) or "/\" (which some browsers also treat as a host).
 * Anything else falls back to "/" — closes the open-redirect/phishing vector.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}


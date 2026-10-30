"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { getAuthClient, safeNextPath } from "@/lib/supabase/auth-server";
import { isEmailAllowed } from "@/lib/ledger/access";
import { limitAction, loginIdentity } from "@/lib/security/rate-limit";

export type SignInState = { error: string | null };

export async function signIn(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  if (!email || !password) return { error: "Email and password are required." };

  // ── TEMPORARY: isolate which step throws ByteString ──
  let step = "0:init";
  try {
    step = "1:headers";
    const h = await headers();
    step = "2:rateLimit";
    const rl = await limitAction("login", loginIdentity(h));
    if (rl) return { error: rl.error };
    step = "3:isAllowed";
    let allowed: boolean;
    try { allowed = await isEmailAllowed(email); } catch { allowed = false; }
    step = "4:getAuthClient";
    const supabase = await getAuthClient();
    step = "5:signIn";
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: allowed ? password : randomUUID(),
    });
    step = "6:done";
    if (error) return { error: `[DIAG@${step}] ${error.message}` };
    if (!allowed) return { error: "Invalid email or password." };
    redirect(next);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `[CRASH@${step}] ${msg.slice(0, 120)}` };
  }
}

export async function signOut() {
  const supabase = await getAuthClient();
  await supabase.auth.signOut();
  redirect("/login");
}

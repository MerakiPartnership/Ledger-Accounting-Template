"use server";

import { redirect } from "next/navigation";
import { getAuthClient } from "@/lib/supabase/auth-server";

export async function signOut() {
  const supabase = await getAuthClient();
  await supabase.auth.signOut();
  redirect("/login");
}

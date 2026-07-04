import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function AuthStatus() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const email = data.user && "email" in data.user ? String(data.user.email ?? "") : "";

  return (
    <div className="mb-4 flex items-center justify-end gap-3 text-xs text-slate-500">
      <span>{email ? `Signed in: ${email}` : "Not signed in"}</span>
      <Link href={email ? "/logout" : "/login"} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">
        {email ? "Logout" : "Login"}
      </Link>
    </div>
  );
}

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const config = getSupabasePublicConfig();
  if (!config.hasUrl) redirect("/login?error=supabase_url_missing");
  if (!config.hasPublicKey) redirect("/login?error=supabase_public_key_missing");
  if (!email) redirect("/login?error=email_missing");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=supabase_public_key_missing");
  if (password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) redirect("/login?error=password_invalid");
    redirect("/sourcing-engine/settings");
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback` } });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/login?sent=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const params = await searchParams;
  return (
    <>
      <PageHeader title="Login" description="Sign in to sync sourcing cards and feedback with Supabase server storage." />
      <form action={signIn} className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">Email<input name="email" type="email" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <label className="mt-4 block text-sm font-semibold text-slate-700">Password <span className="font-normal text-slate-400">(optional for magic link)</span><input name="password" type="password" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        <button className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Sign in / Send magic link</button>
        {params.sent ? <p className="mt-3 text-sm font-semibold text-emerald-700">Magic link sent. Check your email.</p> : null}
        {params.error ? <p className="mt-3 text-sm font-semibold text-red-700">{getLoginErrorMessage(params.error)}</p> : null}
      </form>
    </>
  );
}

function getLoginErrorMessage(error: string) {
  switch (error) {
    case "supabase_url_missing":
      return "Supabase URL이 설정되지 않았습니다. NEXT_PUBLIC_SUPABASE_URL 환경 변수를 확인해 주세요.";
    case "supabase_public_key_missing":
      return "Supabase public key가 설정되지 않았습니다. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY 환경 변수를 확인해 주세요.";
    case "email_missing":
      return "이메일을 입력해 주세요.";
    case "password_invalid":
      return "비밀번호가 올바르지 않습니다.";
    default:
      return decodeURIComponent(error);
  }
}

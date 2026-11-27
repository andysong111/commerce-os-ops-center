import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";
import { clearOpsAuthCookiesBeforeSignIn } from "@/lib/supabase/resetSession";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeOpsAuthRedirect } from "@/lib/supabase/session";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const intent = String(formData.get("intent") ?? "password");
  const nextPath = getSafeOpsAuthRedirect(String(formData.get("next") ?? ""));
  await clearOpsAuthCookiesBeforeSignIn();
  const supabase = await createSupabaseServerClient();
  const loginUrl = (error: string) =>
    `/login?error=${encodeURIComponent(error)}&next=${encodeURIComponent(nextPath)}`;
  if (!supabase || !email) redirect(loginUrl("missing_config_or_email"));

  if (intent === "password") {
    if (!password) redirect(loginUrl("missing_password"));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) redirect(loginUrl(error.message));
    redirect(nextPath);
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", nextPath);
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callbackUrl.toString() } });
  if (error) redirect(loginUrl(error.message));
  redirect(`/login?sent=1&next=${encodeURIComponent(nextPath)}`);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; force?: string; sent?: string; next?: string }> }) {
  const params = await searchParams;
  const nextPath = getSafeOpsAuthRedirect(params.next);
  const { user } = await getOpsCurrentUser();
  if (user && params.force !== "1") redirect(nextPath);

  const errorMessage =
    params.error === "login_required"
      ? "로그인이 필요한 페이지입니다."
      : params.error === "missing_password"
        ? "기존 비밀번호를 입력하세요. 비밀번호가 아직 없다면 매직링크 받기를 누르세요."
        : params.error === "missing_config_or_email"
          ? "이메일 또는 로그인 설정을 확인하세요."
          : params.error;

  return (
    <>
      <PageHeader
        title="로그인"
        description="기존 비밀번호로 로그인하거나, 비밀번호가 아직 없다면 매직링크를 받을 수 있습니다."
      />
      <form action={signIn} className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <input type="hidden" name="next" value={nextPath} />
        <label className="block text-sm font-semibold text-slate-700">
          이메일
          <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
        </label>
        <label className="mt-4 block text-sm font-semibold text-slate-700">
          기존 비밀번호
          <input name="password" type="password" autoComplete="current-password" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
          <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">
            새 비밀번호를 만드는 칸이 아닙니다.
          </span>
        </label>
        <button
          name="intent"
          value="password"
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          비밀번호로 로그인
        </button>
        <Link href="/forgot-password" className="mt-2 block py-2 text-center text-sm font-semibold text-blue-700 underline">
          비밀번호를 잊으셨나요?
        </Link>
        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          또는
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <button
          name="intent"
          value="magic_link"
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          매직링크 받기
        </button>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          매직링크는 이메일 발송 제한이 있으므로 필요한 경우에만 한 번 누르세요.
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          로그인은 개인 기기에서 최대 180일 유지되며, 사용 중에는 자동으로
          갱신됩니다. 공용 기기에서는 사용 후 로그아웃하세요.
        </p>
        {params.sent ? <p className="mt-3 text-sm font-semibold text-emerald-700">매직링크를 보냈습니다. 이메일을 확인하세요.</p> : null}
        {errorMessage ? <p className="mt-3 text-sm font-semibold text-red-700">{errorMessage}</p> : null}
      </form>
    </>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const messages = {
  email: "이메일 주소를 확인해 주세요.",
  limited: "메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  unavailable: "지금은 재설정 메일을 요청할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  link: "재설정 링크가 만료됐거나 이 브라우저에서 확인할 수 없습니다. 이 화면에서 새 메일을 요청하세요.",
};

async function requestRecovery(form: FormData) {
  "use server";
  const email = String(form.get("email") ?? "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/forgot-password?error=email");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/forgot-password?error=unavailable");

  // Email links must return to a configured origin, independent of request headers.
  const origin = process.env.MOBILE_WORK_CENTER_ORIGIN || (process.env.VERCEL_ENV === "production"
    ? "https://commerce-os-ops-center.vercel.app"
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/auth/recovery", origin).href,
  });
  if (error?.status === 429) redirect("/forgot-password?error=limited");
  if (error && error.code !== "user_not_found") redirect("/forgot-password?error=unavailable");
  redirect("/forgot-password?sent=1");
}

export default async function ForgotPasswordPage({ searchParams }: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const message = error && Object.hasOwn(messages, error) ? messages[error as keyof typeof messages] : null;
  return (
    <>
      <PageHeader title="비밀번호 재설정" description="운영 계정 이메일로 새 비밀번호를 설정할 링크를 받습니다." />
      <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {sent === "1" ? (
          <div role="status" className="space-y-3 text-sm leading-6 text-slate-700">
            <h2 className="text-lg font-bold text-slate-900">이메일을 확인하세요</h2>
            <p>입력한 주소에 계정이 있으면 재설정 메일이 발송됩니다. 받은편지함과 스팸함을 확인하세요.</p>
            <p>메일의 링크를 요청할 때 사용한 브라우저에서 열어 주세요.</p>
            <Link className="block py-2 font-semibold text-blue-700 underline" href="/forgot-password">다시 요청하기</Link>
          </div>
        ) : (
          <form action={requestRecovery} className="space-y-4">
            {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
            <p className="text-sm leading-6 text-slate-600">휴대폰에서는 Safari 또는 Chrome에서 메일을 요청하고, 메일 링크도 같은 브라우저에서 열어 주세요.</p>
            <label className="block text-sm font-semibold text-slate-700">운영 계정 이메일
              <input type="email" name="email" required maxLength={254} autoComplete="email" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white">비밀번호 재설정 메일 받기</button>
          </form>
        )}
        <Link href="/login?next=%2Fmobile-work-center" className="mt-4 block py-2 text-center text-sm font-semibold text-slate-600 underline">로그인으로 돌아가기</Link>
      </section>
    </>
  );
}

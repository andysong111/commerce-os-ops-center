import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordSettingsForm } from "@/components/account/PasswordSettingsForm";
import { PageHeader } from "@/components/PageHeader";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export const dynamic = "force-dynamic";

export default async function AccountPasswordPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const recovering = (await searchParams).recovery === "1";
  const { user } = await getOpsCurrentUser();

  if (!user) {
    redirect("/login?error=login_required&next=%2Faccount%2Fpassword");
  }

  return (
    <>
      <PageHeader
        title={recovering ? "새 비밀번호 설정" : "로그인 설정"}
        description={recovering ? "아래 계정에 사용할 새 비밀번호를 입력하세요." : "현재 로그인된 계정에 비밀번호를 추가하거나 변경합니다."}
        actions={
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            대시보드로
          </Link>
        }
      />

      <div className="mx-auto max-w-xl space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            현재 로그인 계정
          </p>
          <p className="mt-2 break-all text-sm font-bold text-slate-950">
            {user.email ?? "이메일 확인 불가"}
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-950">
            비밀번호 설정·변경
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            현재 로그인 세션의 사용자 ID는 바뀌지 않습니다. 새 계정을 만들거나
            기존 사용자를 삭제하지 않습니다.
          </p>
          <div className="mt-6">
            <PasswordSettingsForm accountId={user.id} recovering={recovering} />
          </div>
        </section>
      </div>
    </>
  );
}

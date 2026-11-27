import type { Metadata } from "next";
import Link from "next/link";
import { mobileWorkCenterConfig, verifyMobileWorkCenterOwner } from "@/lib/mobileWorkCenterAuth";
import { MobileWorkCenter } from "./MobileWorkCenter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Commerce OS 모바일 업무센터",
  applicationName: "Commerce OS 업무센터",
  description: "내 Windows PC에서 Commerce OS 업무를 실행하고 상태를 확인합니다.",
  manifest: "/mobile-work-center/manifest.webmanifest",
  robots: { index: false, follow: false },
  icons: { apple: "/mobile-work-center/home-icon" },
  appleWebApp: { capable: true, title: "Commerce OS 업무센터" },
};

export default async function MobileWorkCenterPage() {
  const config = mobileWorkCenterConfig();
  const access = config ? await verifyMobileWorkCenterOwner(config.ownerId) : 503;
  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5">
        <p className="text-sm font-semibold text-emerald-700">Commerce OS</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">모바일 업무센터</h1>
      </header>
      {access === 200 ? <MobileWorkCenter /> : (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm leading-6 text-slate-700">
            {access === 503 ? "모바일 업무센터 연결을 준비 중입니다." :
              access === 403 ? "이 계정에는 모바일 업무 실행 권한이 없습니다." : "업무 실행 권한이 있는 Commerce OS 계정으로 로그인하세요."}
          </p>
          {access !== 503 && <Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 font-semibold text-white"
            href={`/login?next=%2Fmobile-work-center${access === 403 ? "&force=1" : ""}`}>운영 계정으로 로그인</Link>}
        </div>
      )}
    </div>
  );
}

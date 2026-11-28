import Link from "next/link";
import {
  mobileWorkCenterConfig,
  verifyMobileWorkCenterOwner,
} from "@/lib/mobileWorkCenterAuth";
import { RestockAlerts } from "./RestockAlerts";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "고객 입고알림 · Commerce OS",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const config = mobileWorkCenterConfig(),
    access = config ? await verifyMobileWorkCenterOwner(config.ownerId) : 503;
  const { draft } = await searchParams;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-slate-950">고객 입고알림</h1>
      {access === 200 ? (
        <RestockAlerts draft={typeof draft === "string" ? draft : ""} />
      ) : (
        <div className="rounded-xl border bg-white p-5">
          {access === 503 ? (
            "운영 계정 연결이 필요합니다."
          ) : (
            <Link
              className="text-blue-700 underline"
              href="/login?next=%2Frestock-alerts&force=1"
            >
              운영 계정으로 로그인
            </Link>
          )}
        </div>
      )}
    </main>
  );
}

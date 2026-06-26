import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

const repoName = "andysong111/commerce-os-warehouse-location-sync";

const modeItems = [
  "점검 모드",
  "dry-run",
  "실제 샵플링 반영 없음",
  "OPS Center 연결 준비 완료",
];

const moduleChecks = [
  "위치코드 입력",
  "적용계획",
  "이력",
  "롤백계획",
  "API 사전검증",
];

export default function WarehouseLocationSyncPage() {
  const moduleUrl = process.env.NEXT_PUBLIC_WAREHOUSE_LOCATION_SYNC_URL?.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="창고 위치코드 관리"
        description="모델번호와 위치코드 입력 후 샵플링 반영 전 검증하는 독립 모듈 연결 화면입니다."
      />

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
            점검 모드
          </span>
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
            실제 반영 차단
          </span>
        </div>
        <p className="mt-4 font-semibold">
          현재는 점검 모드입니다. 샵플링 실제 쓰기/수정 API는 호출하지 않습니다.
        </p>
        <p className="mt-2">
          위치코드 입력, 적용계획, 이력, 롤백계획, API 사전검증을 독립 모듈에서 확인합니다.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">독립 모듈 연결</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Warehouse Location Sync 코드는 OPS Center로 복사하지 않고, 독립 모듈을 기준으로 점검합니다.
            </p>
          </div>
          {moduleUrl ? (
            <Link
              href={moduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              창고 위치코드 모듈 열기
            </Link>
          ) : null}
        </div>

        {moduleUrl ? (
          <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
            독립 모듈 주소가 설정되어 있습니다. 버튼을 누르면 새 탭에서 점검 화면을 엽니다.
          </p>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">WAREHOUSE_LOCATION_SYNC_URL이 아직 설정되지 않았습니다.</p>
            <p className="mt-1">
              Vercel 환경변수 NEXT_PUBLIC_WAREHOUSE_LOCATION_SYNC_URL에 독립 모듈 주소를 입력해 주세요.
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">확인할 기능</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {moduleChecks.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-blue-600">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">현재 모드</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-slate-700">GitHub 저장소</dt>
              <dd className="mt-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                {repoName}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-700">상태</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {modeItems.map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {item}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}

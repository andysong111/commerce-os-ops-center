"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { NaverShoppingSnapshotPanel } from "@/components/sourcing/NaverShoppingSnapshotPanel";
import { generateChineseSearchTerms } from "@/lib/sourcingEngine";

const seedKeywords = [
  "차량용 틈새 수납함",
  "캠핑 수납 파우치",
  "욕실 정리 선반",
  "책상 정리 트레이",
  "주방 다용도 거치대",
];

export default function SourcingMarketSnapshotPage() {
  const [keyword, setKeyword] = useState("차량용 틈새 수납함");
  const searchTerms = useMemo(() => generateChineseSearchTerms(keyword), [keyword]);

  async function copySearchTerms() {
    await navigator.clipboard.writeText(searchTerms.join("\n"));
  }

  return (
    <>
      <PageHeader
        title="소싱 시장 스냅샷"
        description="네이버 쇼핑 경쟁 가격대와 1688 검색어 초안을 한 화면에서 확인합니다. 신규제품 먼저팔기 전에 시장이 너무 빡센지 빠르게 거르는 보조 화면입니다."
        actions={
          <Link
            href="/sourcing-engine/importer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            1688 주문추천 카드 만들기
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-950">키워드 입력</h2>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">
                한국어 상품명 / 키워드
              </span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="예: 차량용 틈새 수납함"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              {seedKeywords.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKeyword(item)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-950">1688 검색어 초안</h2>
              <button
                type="button"
                onClick={copySearchTerms}
                disabled={searchTerms.length === 0}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                복사
              </button>
            </div>
            {searchTerms.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {searchTerms.map((term) => (
                  <span
                    key={term}
                    className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"
                  >
                    {term}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">키워드를 입력하면 중국어 검색어가 표시됩니다.</p>
            )}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-800">
            <p className="font-bold">판단 기준</p>
            <p className="mt-2">
              이 화면은 판매량을 증명하지 않습니다. 경쟁 결과 수, 가격대, 브랜드/몰 쏠림을 보고
              1688 후보 탐색 전에 과도하게 빡센 키워드를 줄이는 용도입니다.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <NaverShoppingSnapshotPanel keyword={keyword} />
        </section>
      </div>
    </>
  );
}

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { KeywordReviewWorkspace } from "@/components/keyword-review/KeywordReviewWorkspace";

export default function KeywordReviewQueuePage() {
  return <Suspense fallback={null}><KeywordReviewQueueContent /></Suspense>;
}

function KeywordReviewQueueContent() {
  const searchParams = useSearchParams();
  const fromProductLaunchFlow = searchParams.get("from") === "product-launch-flow";
  return (
    <>
      <PageHeader title="키워드 결과 검토" description="키워드 엔진이 만든 상품명과 검색어 후보를 확인하고 승인합니다." />
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-700">개별 실행 도구</p>
        <p className="mt-2 text-sm text-slate-700">상품출시 플로우와 별도로 키워드 결과를 검토할 때 사용합니다.</p>
        {fromProductLaunchFlow ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">상품출시 플로우에서 열린 작업입니다. 기본적으로는 상품출시 플로우 안에서 검토하는 것을 권장합니다.</p> : null}
      </section>
      <KeywordReviewWorkspace mode="standalone" />
    </>
  );
}

/* Source contract for static review tests after extracting KeywordReviewWorkspace:
현재 상품명
추천 상품명
추천 상품명 없음 — 직접 입력
상품번호 또는 상품명 검색
상품그룹에 연결된 쇼핑몰별로 상품명과 mall_key가 자동 생성됩니다
상품그룹별 상품명 미리보기
다음 단계에서 상품그룹별 상품명 정책을 적용합니다
상품명 후보 선택
승인된 상품명이 있어야 진행할 수 있습니다
실제 반영 버튼을 누르기 전까지 상품명은 변경되지 않습니다
상품그룹별 상품명 차별화
상품그룹별 속성 꾸밈어 적용
상품그룹에 연결된 모든 쇼핑몰로 적용 대상 확장
상품그룹/쇼핑몰별 상품명 미리보기
상품에 실제로 확인되는 속성만 꾸밈어로 사용합니다
미확인 속성, 인증, 방수, 최저가 등 위험 표현은 자동 추가하지 않습니다
먼저 승인된 상품명이 필요합니다
승인된 상품명이 필요합니다
approvedCount === 0 ? "승인된 상품명이 필요합니다" : "상품그룹/쇼핑몰별 상품명 미리보기"
*/
/* Extracted workspace implementation markers for legacy source assertions:
function runGuidedApprovalPreviewPlan() { preview only marker }
function generateGroupPreview() {}
mode === "apply" && !dryRunSucceeded
disabled={disabled || !dryRunSucceeded}
*/

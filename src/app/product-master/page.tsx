"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  getProductMasterItems,
  getProductMasters,
} from "@/lib/productMaster";
import {
  exportProductMasterItemsToCsv,
  exportProductMasterItemsToJson,
  previewProductMasterCsv,
  type ProductMasterImportValidationResult,
} from "@/lib/productMasterImportExport";
import type { ProductStatus } from "@/types/productMaster";

const statusLabels: Record<ProductStatus, string> = {
  active: "활성",
  inactive: "비활성",
  discontinued: "단종",
};

const statusStyles: Record<ProductStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  inactive: "bg-slate-100 text-slate-600 ring-slate-500/20",
  discontinued: "bg-red-50 text-red-700 ring-red-600/20",
};

const unitCostFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

type StatusFilter = "all" | ProductStatus;

export default function ProductMasterPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const productMasters = useMemo(() => getProductMasters(), []);
  const productMasterItems = useMemo(() => getProductMasterItems(), []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] =
    useState<ProductMasterImportValidationResult | null>(null);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return productMasters.filter((product) => {
      const matchesSearch =
        normalizedQuery.length === 0 ||
        product.modelNo.toLowerCase().includes(normalizedQuery) ||
        product.modelName.toLowerCase().includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || product.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [productMasters, searchQuery, statusFilter]);

  const totalOptionCount = productMasters.reduce(
    (total, product) => total + product.options.length,
    0,
  );
  const activeProductCount = productMasters.filter(
    (product) => product.status === "active",
  ).length;

  function previewImport() {
    setImportPreview(previewProductMasterCsv(importText));
  }

  function downloadExport(format: "csv" | "json") {
    const text =
      format === "csv"
        ? exportProductMasterItemsToCsv(productMasterItems)
        : exportProductMasterItemsToJson(productMasterItems);
    const blob = new Blob([text], {
      type:
        format === "csv"
          ? "text/csv;charset=utf-8"
          : "application/json;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `product-master.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <PageHeader
        title="상품 마스터"
        description="모델번호를 기준으로 상품·옵션 등 안정적인 기준정보와 참고 원가를 조회합니다."
      />

      <section
        className="mb-6 grid gap-3 sm:grid-cols-3"
        aria-label="상품 마스터 요약"
      >
        <SummaryCard label="전체 상품 수" value={`${productMasters.length}개`} />
        <SummaryCard label="전체 옵션 수" value={`${totalOptionCount}개`} />
        <SummaryCard
          label="활성 상품 수"
          value={`${activeProductCount}개`}
          emphasized
        />
      </section>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">참고 원가 안내</span>
        <span className="ml-2 text-amber-800">
          참고 원가는 과거 또는 기준값일 뿐이며, 실제 발주 원가는 원가계산기에서 회차별로 입력합니다.
        </span>
      </div>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-bold text-slate-950">CSV 가져오기 · 내보내기</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              CSV 내용을 먼저 검증하고 미리보기합니다. 미리보기는 현재 상품
              마스터를 변경하지 않으며, 영구 저장소가 추가되기 전까지 기존
              메모리 데이터는 임시 데이터입니다.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => downloadExport("csv")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              CSV 내보내기
            </button>
            <button
              type="button"
              onClick={() => downloadExport("json")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              JSON 내보내기
            </button>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">
            CSV 가져오기 미리보기
          </span>
          <textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportPreview(null);
            }}
            rows={7}
            placeholder={
              "modelNo,modelName,optionName,barcode,origin,displayName,memo\nPM-001,상품명,옵션명,,MADE IN CHINA,표시명,"
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={previewImport}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            가져오기 미리보기
          </button>
          <p className="text-xs text-slate-500">
            중복 모델번호는 여러 옵션일 수 있으므로 경고로 표시하고, 자동
            저장하지 않습니다.
          </p>
        </div>

        {importPreview && (
          <ImportPreview result={importPreview} />
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(240px,420px)_180px]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">
                상품 검색
              </span>
              <div className="relative">
                <SearchIcon />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="모델번호 또는 모델명 검색"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">
                상태
              </span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="inactive">비활성</option>
                <option value="discontinued">단종</option>
              </select>
            </label>
          </div>
          <p className="text-sm text-slate-500">
            검색 결과 <strong className="font-semibold text-slate-900">{filteredProducts.length}</strong>개
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="border-b border-slate-200 px-5 py-3 font-semibold">모델번호</th>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">모델명</th>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">카테고리</th>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">상태</th>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">대표 이미지</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">옵션 수</th>
                <th className="border-b border-slate-200 px-5 py-3 font-semibold">메모</th>
              </tr>
            </thead>
            {filteredProducts.map((product) => (
                <tbody key={product.modelNo}>
                  <tr className="bg-white">
                    <td className="px-5 pb-3 pt-5 font-mono text-sm font-semibold text-blue-700">
                      {product.modelNo}
                    </td>
                    <td className="px-4 pb-3 pt-5 font-semibold text-slate-950">
                      {product.modelName}
                    </td>
                    <td className="px-4 pb-3 pt-5 text-slate-600">{product.category}</td>
                    <td className="px-4 pb-3 pt-5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyles[product.status]}`}>
                        {statusLabels[product.status]}
                      </span>
                    </td>
                    <td className="px-4 pb-3 pt-5 text-slate-500">
                      {product.mainImageUrl ? (
                        <span
                          role="img"
                          aria-label={`${product.modelName} 대표 이미지`}
                          className="block size-10 rounded-md border border-slate-200 bg-cover bg-center"
                          style={{ backgroundImage: `url(${product.mainImageUrl})` }}
                        />
                      ) : (
                        "미등록"
                      )}
                    </td>
                    <td className="px-4 pb-3 pt-5 text-right font-semibold tabular-nums text-slate-700">
                      {product.options.length}개
                    </td>
                    <td className="px-5 pb-3 pt-5 text-slate-500">{product.memo || "-"}</td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="border-b border-slate-200 px-5 pb-5 pt-1">
                      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          옵션 · 참고 원가(CNY)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {product.options.map((option) => (
                            <div
                              key={option.optionId}
                              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"
                            >
                              <span className="font-medium text-slate-700">{option.optionName}</span>
                              <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
                              <span className="font-semibold tabular-nums text-blue-700">
                                {option.referenceUnitCostCny === undefined
                                  ? "미등록"
                                  : `¥ ${unitCostFormatter.format(option.referenceUnitCostCny)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
            ))}
          </table>
        </div>

        {filteredProducts.length === 0 && (
          <div className="border-t border-slate-200 px-6 py-16 text-center">
            <p className="font-medium text-slate-700">검색 조건에 맞는 상품이 없습니다.</p>
            <p className="mt-1 text-sm text-slate-500">검색어나 상태 필터를 변경해 보세요.</p>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        현재 상품 마스터는 조회 전용 샘플 데이터입니다. 편집, 저장, 이미지 업로드 및 외부 데이터 연동은 추후 제공됩니다.
      </p>
    </>
  );
}

function ImportPreview({
  result,
}: {
  result: ProductMasterImportValidationResult;
}) {
  const { summary } = result;

  return (
    <div className="mt-4 border-t border-slate-200 pt-4" aria-live="polite">
      <div className="grid gap-2 sm:grid-cols-5">
        <PreviewCount label="전체 행" value={summary.totalRows} />
        <PreviewCount label="유효" value={summary.validCount} />
        <PreviewCount label="오류" value={summary.invalidCount} />
        <PreviewCount label="경고" value={summary.warningCount} />
        <PreviewCount label="중복 모델번호" value={summary.duplicateCount} />
      </div>

      {result.invalidRows.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <h3 className="text-sm font-semibold text-red-900">수정이 필요한 행</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-800">
            {result.invalidRows.map((row) => (
              <li key={row.rowNumber}>
                {row.rowNumber}행: {row.messages.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-900">확인할 경고</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {result.warnings.map((warning) => (
              <li key={`${warning.modelNo}-${warning.rowNumbers.join("-")}`}>
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.totalRows === 0 && (
        <p className="mt-3 text-sm text-slate-600">
          미리보기할 데이터 행이 없습니다. 헤더와 CSV 내용을 확인해 주세요.
        </p>
      )}
    </div>
  );
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${emphasized ? "border-blue-200" : "border-slate-200"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${emphasized ? "text-blue-700" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

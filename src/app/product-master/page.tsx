"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { getProductMasterItems, getProductMasters } from "@/lib/productMaster";
import {
  exportProductMasterCsv,
  exportProductMasterJson,
  parseProductMasterCsv,
  validateProductMasterImport,
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] =
    useState<ProductMasterImportValidationResult>();
  const productMasterItems = useMemo(() => getProductMasterItems(), []);
  const exportCsv = useMemo(
    () => exportProductMasterCsv(productMasterItems),
    [productMasterItems],
  );
  const exportJson = useMemo(
    () => exportProductMasterJson(productMasterItems),
    [productMasterItems],
  );

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
        <div>
          <h2 className="font-semibold text-slate-950">CSV / JSON 가져오기·내보내기</h2>
          <p className="mt-1 text-sm text-slate-600">
            가져오기는 미리보기와 검증만 수행하며 기존 데이터를 변경하지 않습니다. 현재 상품 마스터 저장소는 영구 저장소가 추가되기 전까지 임시 메모리입니다.
          </p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor="product-master-csv" className="text-xs font-semibold text-slate-600">
              CSV 가져오기 미리보기
            </label>
            <textarea
              id="product-master-csv"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={"modelNo,modelName,optionName,barcode,origin,displayName,memo\nAAA001,샘플 상품,기본,,MADE IN CHINA,샘플 상품,"}
              className="mt-1.5 min-h-40 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={() =>
                setImportPreview(
                  validateProductMasterImport(parseProductMasterCsv(importText)),
                )
              }
              className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              가져오기 미리보기
            </button>

            {importPreview && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800">
                  전체 {importPreview.summary.totalRows} · 유효 {importPreview.summary.validCount} · 오류 {importPreview.summary.invalidCount} · 경고 {importPreview.summary.warningCount} · 중복 모델번호 {importPreview.summary.duplicateCount}
                </p>
                {importPreview.invalidRows.map((issue) => (
                  <p key={`invalid-${issue.rowNumber}`} className="mt-2 text-red-700">
                    {issue.rowNumber}행: {issue.messages.join(" ")}
                  </p>
                ))}
                {importPreview.warnings.map((warning) => (
                  <p key={`warning-${warning.rowNumber}`} className="mt-2 text-amber-700">
                    {warning.rowNumber}행: {warning.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <ExportTextArea label="현재 데이터 CSV" value={exportCsv} />
            <ExportTextArea label="현재 데이터 JSON" value={exportJson} />
          </div>
        </div>
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

function ExportTextArea({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <textarea
        readOnly
        value={value}
        className="mt-1.5 min-h-32 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-700"
        onFocus={(event) => event.currentTarget.select()}
      />
    </label>
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

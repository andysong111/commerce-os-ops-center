"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  productLaunchSalePriceFromUnitCostKrw,
  roundUpProductLaunchPriceKrw,
} from "@/lib/productLaunchPricePolicy";

const ITEM_API = "/api/product-launch-tracker/normalized-optimized";
const TRANSIENT_STATUSES = new Set([409, 408, 425, 429, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 300, 900];
const OPTION_BARCODE_PATTERN = /^\d{12}$/;

type UnknownRecord = Record<string, unknown>;

type OrderOption = UnknownRecord & {
  id: string;
  optionName: string;
  saleOption: string;
  chinaOption: string;
  barcode: string;
  optionBarcodeNo: string;
  baseSalePriceKrw: number;
  unitCostKrw: number;
};

type EditorItem = UnknownRecord & {
  id: string;
  workBatch: string;
  warehouseLocation: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  shoplingCategory: string;
  selfCodeBase: string;
  notes: string;
  orderOptions: OrderOption[];
  chinaProductLinks: string[];
  detailPageAsset: UnknownRecord;
};

type FormState = {
  workBatch: string;
  warehouseLocation: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  shoplingCategory: string;
  selfCodeBase: string;
  notes: string;
  chinaProductLinks: string;
  detailHtml: string;
  mainImageUrl: string;
  additionalImageUrls: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function nonNegativeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.ceil(numeric));
}

function salePriceFromUnitCost(value: unknown) {
  return productLaunchSalePriceFromUnitCostKrw(value);
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeOption(value: unknown, index: number): OrderOption {
  const row = record(value);
  return {
    ...row,
    id: text(row.id) || `option-${index + 1}`,
    optionName: text(row.optionName) || "옵션",
    saleOption: text(row.saleOption ?? row.value),
    chinaOption: text(row.chinaOption),
    barcode: normalizeBarcode(row.barcode),
    optionBarcodeNo: OPTION_BARCODE_PATTERN.test(text(row.optionBarcodeNo))
      ? text(row.optionBarcodeNo)
      : "",
    baseSalePriceKrw: roundUpProductLaunchPriceKrw(row.baseSalePriceKrw),
    unitCostKrw: nonNegativeInteger(row.unitCostKrw),
  };
}

function normalizeItem(value: unknown): EditorItem {
  const row = record(value);
  const asset = record(row.detailPageAsset);
  const links = Array.isArray(row.chinaProductLinks)
    ? row.chinaProductLinks.map(text).filter(Boolean).slice(0, 5)
    : [];
  return {
    ...row,
    id: text(row.id),
    workBatch: text(row.workBatch),
    warehouseLocation: text(row.warehouseLocation),
    barcode: normalizeBarcode(row.barcode),
    modelNumber: text(row.modelNumber).toUpperCase(),
    productName: text(row.productName),
    shoplingCategory: text(row.shoplingCategory),
    selfCodeBase: text(row.selfCodeBase),
    notes: text(row.notes),
    orderOptions: Array.isArray(row.orderOptions)
      ? row.orderOptions.map(normalizeOption)
      : [],
    chinaProductLinks: links,
    detailPageAsset: asset,
  };
}

function formFromItem(item: EditorItem): FormState {
  const asset = record(item.detailPageAsset);
  return {
    workBatch: item.workBatch,
    warehouseLocation: item.warehouseLocation,
    barcode: item.barcode,
    modelNumber: item.modelNumber,
    productName: item.productName,
    shoplingCategory: item.shoplingCategory,
    selfCodeBase: item.selfCodeBase,
    notes: item.notes,
    chinaProductLinks: item.chinaProductLinks.join("\n"),
    detailHtml: String(asset.html ?? ""),
    mainImageUrl: text(asset.mainImageUrl),
    additionalImageUrls: Array.isArray(asset.additionalImageUrls)
      ? asset.additionalImageUrls.map(text).filter(Boolean).join("\n")
      : "",
  };
}

function splitLines(value: string, limit: number) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function sleep(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function requestJson<T extends UnknownRecord>(
  url: string,
  init: RequestInit = {},
  retryable = true,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      const response = await fetch(url, {
        ...init,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      const body = (await response.json().catch(() => ({}))) as T;
      if (response.ok && body.ok === true) return body;
      const message = text(body.message) || text(body.error) || `HTTP ${response.status}`;
      if (!retryable || !TRANSIENT_STATUSES.has(response.status) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw new Error(message);
      }
      lastError = new Error(message);
    } catch (error) {
      lastError = error;
      const isNetwork = error instanceof TypeError;
      if (!retryable || (!isNetwork && !(error instanceof Error)) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("요청에 실패했습니다.");
}

function optionMatches(left: OrderOption, right: OrderOption, index: number, options: OrderOption[]) {
  return (
    options.find((entry) => left.id && entry.id === left.id) ||
    options.find((entry) => left.barcode && entry.barcode === left.barcode) ||
    options[index] ||
    right
  );
}

function verifySaved(expectedForm: FormState, expectedOptions: OrderOption[], actual: EditorItem) {
  const scalarPairs: Array<[string, string, string]> = [
    ["작업 묶음", expectedForm.workBatch.trim(), actual.workBatch],
    ["창고위치", expectedForm.warehouseLocation.trim(), actual.warehouseLocation],
    ["기준 바코드", normalizeBarcode(expectedForm.barcode), actual.barcode],
    ["모델번호", expectedForm.modelNumber.trim().toUpperCase(), actual.modelNumber],
    ["모델명", expectedForm.productName.trim(), actual.productName],
    ["샵플링 카테고리", expectedForm.shoplingCategory.trim(), actual.shoplingCategory],
    ["비고", expectedForm.notes.trim(), actual.notes],
  ];
  for (const [label, expected, saved] of scalarPairs) {
    if (expected !== saved) throw new Error(`${label} 저장 확인 실패`);
  }

  if (expectedOptions.length !== actual.orderOptions.length) {
    throw new Error(`옵션 개수 저장 확인 실패 · 입력 ${expectedOptions.length} / 저장 ${actual.orderOptions.length}`);
  }
  expectedOptions.forEach((left, index) => {
    const fallback = actual.orderOptions[index] ?? normalizeOption({}, index);
    const right = optionMatches(left, fallback, index, actual.orderOptions);
    if (left.optionName !== right.optionName) throw new Error(`옵션 ${index + 1} 옵션명 저장 확인 실패`);
    if (left.saleOption !== right.saleOption) throw new Error(`옵션 ${index + 1} 옵션값 저장 확인 실패`);
    if (left.chinaOption !== right.chinaOption) throw new Error(`옵션 ${index + 1} 중국옵션 저장 확인 실패`);
    if (left.barcode !== right.barcode) throw new Error(`옵션 ${index + 1} B코드 저장 확인 실패`);
    if (left.baseSalePriceKrw !== right.baseSalePriceKrw) throw new Error(`옵션 ${index + 1} 기준판매가 저장 확인 실패`);
    if (left.unitCostKrw !== right.unitCostKrw) throw new Error(`옵션 ${index + 1} 원가 저장 확인 실패`);
    if (left.optionBarcodeNo && left.optionBarcodeNo !== right.optionBarcodeNo) {
      throw new Error(`옵션 ${index + 1} 옵션바코드NO 저장 확인 실패`);
    }
  });
}

function Field({
  label,
  value,
  onChange,
  readOnly = false,
  span = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  span?: boolean;
}) {
  return (
    <label className={span ? "space-y-1 md:col-span-2" : "space-y-1"}>
      <span className="text-xs font-black text-slate-600">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-blue-500 ${readOnly ? "border-slate-200 bg-slate-100 text-slate-500" : "border-slate-300 bg-white"}`}
      />
    </label>
  );
}

export default function ProductLaunchStandaloneEditor({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<EditorItem | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [options, setOptions] = useState<OrderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [verifiedAt, setVerifiedAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: "item", id: itemId });
      const body = await requestJson<{ ok?: boolean; item?: unknown }>(`${ITEM_API}?${params.toString()}`);
      const next = normalizeItem(body.item);
      if (!next.id) throw new Error("상품을 불러오지 못했습니다.");
      setItem(next);
      setForm(formFromItem(next));
      setOptions(next.orderOptions);
      setVerifiedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = (key: keyof FormState, value: string) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSuccess("");
  };

  const updateOption = (index: number, patch: Partial<OrderOption>) => {
    setOptions((current) => current.map((option, optionIndex) => (
      optionIndex === index ? { ...option, ...patch } : option
    )));
    setSuccess("");
  };

  const updateUnitCost = (index: number, value: unknown) => {
    const unitCostKrw = nonNegativeInteger(value);
    updateOption(index, {
      unitCostKrw,
      baseSalePriceKrw: salePriceFromUnitCost(unitCostKrw),
    });
  };

  const addOption = () => {
    setOptions((current) => [
      ...current,
      normalizeOption({ id: crypto.randomUUID(), optionName: "옵션", saleOption: "단품" }, current.length),
    ]);
    setSuccess("");
  };

  const canSave = Boolean(form && item && !saving && !loading && form.modelNumber.trim() && form.productName.trim());
  const pricedOptionCount = useMemo(
    () => options.filter((option) => option.baseSalePriceKrw > 0 || option.unitCostKrw > 0).length,
    [options],
  );

  const save = async () => {
    if (!form || !item || !canSave) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const expectedOptions = options.map((option, index) => normalizeOption(option, index));
    const existingAsset = record(item.detailPageAsset);
    const patch = {
      workBatch: form.workBatch.trim(),
      warehouseLocation: form.warehouseLocation.trim(),
      barcode: normalizeBarcode(form.barcode),
      modelNumber: form.modelNumber.trim().toUpperCase(),
      productName: form.productName.trim(),
      shoplingCategory: form.shoplingCategory.trim(),
      selfCodeBase: form.selfCodeBase.trim(),
      notes: form.notes.trim(),
      orderOptions: expectedOptions,
      chinaProductLinks: splitLines(form.chinaProductLinks, 5),
      detailPageAsset: {
        ...existingAsset,
        html: form.detailHtml,
        mainImageUrl: form.mainImageUrl.trim(),
        additionalImageUrls: splitLines(form.additionalImageUrls, 10),
      },
    };

    try {
      await requestJson<{ ok?: boolean }>(ITEM_API, {
        method: "PATCH",
        body: JSON.stringify({
          operation: "patch_item",
          itemId: item.id,
          patch,
          updatedBy: "상품상세 독립 편집기",
        }),
      });

      const params = new URLSearchParams({ mode: "item", id: item.id });
      const verifyBody = await requestJson<{ ok?: boolean; item?: unknown }>(`${ITEM_API}?${params.toString()}`);
      const saved = normalizeItem(verifyBody.item);
      verifySaved(form, expectedOptions, saved);
      setItem(saved);
      setForm(formFromItem(saved));
      setOptions(saved.orderOptions);
      setVerifiedAt(new Date().toLocaleTimeString("ko-KR"));
      setSuccess(
        pricedOptionCount
          ? `저장 완료 · 기준판매가/원가 ${pricedOptionCount}개 옵션 서버 반영 확인`
          : "저장 완료 · 서버 재조회 확인",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !form) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500 shadow-sm">
          상품 1건만 불러오는 중…
        </div>
      </main>
    );
  }

  if (!form || !item) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <h1 className="font-black">상품상세 편집기를 열지 못했습니다.</h1>
          <p className="mt-2 text-sm">{error || "상품을 다시 선택해 주세요."}</p>
          <button onClick={() => void load()} className="mt-4 rounded-xl bg-rose-700 px-4 py-2 text-sm font-black text-white">다시 불러오기</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-5 py-6 pb-28 text-slate-900">
      <header className="sticky top-0 z-40 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.15em] text-blue-700">COMMERCE OS · ISOLATED ITEM EDITOR</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black">{form.modelNumber || "모델번호 없음"}</h1>
              <span className="text-sm font-semibold text-slate-500">{form.productName}</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">단건 독립 저장</span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">원가 × 2 후 10원 올림</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">목록/SEO/Shopling 로딩과 분리 · 마지막 서버 확인 {verifiedAt || "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/product-launch-tracker" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">목록으로</Link>
            <Link href={`/product-launch-tracker?detailPageItem=${encodeURIComponent(item.id)}`} className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">기존 상세화면</Link>
            <button type="button" onClick={() => void load()} disabled={saving} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-800 disabled:opacity-40">서버 다시 읽기</button>
            <button type="button" onClick={() => void save()} disabled={!canSave} className="rounded-xl bg-blue-700 px-6 py-2 text-sm font-black text-white shadow disabled:opacity-40">
              {saving ? "저장·검증 중…" : "저장"}
            </button>
          </div>
        </div>
        {success ? (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-black text-emerald-900 shadow-sm">
            ✓ {success}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900">
            저장/조회 실패 · {error}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-black">상품 기본정보</h2>
        <p className="mt-1 text-xs text-slate-500">이 화면은 상품 1건만 읽고 저장합니다.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="작업 묶음" value={form.workBatch} onChange={(value) => updateForm("workBatch", value)} />
          <Field label="창고위치" value={form.warehouseLocation} onChange={(value) => updateForm("warehouseLocation", value)} />
          <Field label="기준 바코드" value={form.barcode} onChange={(value) => updateForm("barcode", value)} />
          <Field label="모델번호" value={form.modelNumber} onChange={(value) => updateForm("modelNumber", value)} />
          <Field label="모델명" value={form.productName} onChange={(value) => updateForm("productName", value)} span />
          <Field label="샵플링 표준 카테고리" value={form.shoplingCategory} onChange={(value) => updateForm("shoplingCategory", value)} span />
          <Field label="자사상품 기본코드" value={form.selfCodeBase} readOnly />
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-black text-slate-600">비고·보류 사유</span>
            <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black">옵션 · 기준판매가 · 원가</h2>
            <p className="mt-1 text-xs text-slate-500">원가를 입력하거나 수정하면 기준판매가는 원가 × 2 후 10원 단위로 올림됩니다. 직접 입력한 가격도 저장할 때 같은 기준이 적용됩니다.</p>
            <p className="mt-1 text-xs text-slate-500">이 표의 값이 저장 요청의 직접 원천입니다. 저장 후 서버값을 다시 읽어 일치해야 성공 처리합니다.</p>
          </div>
          <button type="button" onClick={addOption} className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-black text-blue-800">+ 옵션 추가</button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">옵션명</th>
                <th className="px-3 py-2 text-left">옵션값</th>
                <th className="px-3 py-2 text-left">중국옵션</th>
                <th className="px-3 py-2 text-left">B코드</th>
                <th className="px-3 py-2 text-left">옵션바코드NO</th>
                <th className="px-3 py-2 text-left">기준판매가</th>
                <th className="px-3 py-2 text-left">원가</th>
                <th className="w-16 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {options.map((option, index) => (
                <tr key={option.id || index} className="border-t border-slate-100">
                  <td className="p-2"><input value={option.optionName} onChange={(event) => updateOption(index, { optionName: event.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-2" /></td>
                  <td className="p-2"><input value={option.saleOption} onChange={(event) => updateOption(index, { saleOption: event.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-2" /></td>
                  <td className="p-2"><input value={option.chinaOption} onChange={(event) => updateOption(index, { chinaOption: event.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-2" /></td>
                  <td className="p-2"><input value={option.barcode} onChange={(event) => updateOption(index, { barcode: normalizeBarcode(event.target.value) })} className="w-full rounded-lg border border-slate-200 px-2 py-2 font-mono" /></td>
                  <td className="p-2"><input value={option.optionBarcodeNo || "저장 시 자동발급"} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-100 px-2 py-2 font-mono text-slate-500" /></td>
                  <td className="p-2"><input type="number" min={0} step={1} value={option.baseSalePriceKrw || ""} onChange={(event) => updateOption(index, { baseSalePriceKrw: nonNegativeInteger(event.target.value) })} className="w-full rounded-lg border border-blue-300 bg-blue-50 px-2 py-2 text-right font-black" /></td>
                  <td className="p-2"><input type="number" min={0} step={1} value={option.unitCostKrw || ""} onChange={(event) => updateUnitCost(index, event.target.value)} className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-2 text-right font-black" /></td>
                  <td className="p-2 text-center"><button type="button" onClick={() => { setOptions((current) => current.filter((_, i) => i !== index)); setSuccess(""); }} className="rounded-lg bg-rose-50 px-2 py-2 text-xs font-black text-rose-700">삭제</button></td>
                </tr>
              ))}
              {!options.length ? (
                <tr><td colSpan={8} className="p-8 text-center text-sm font-bold text-slate-400">옵션이 없습니다. 옵션 추가를 눌러 직접 입력할 수 있습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black">중국 상품링크</h2>
          <p className="mt-1 text-xs text-slate-500">최대 5개 · 줄바꿈으로 입력</p>
          <textarea value={form.chinaProductLinks} onChange={(event) => updateForm("chinaProductLinks", event.target.value)} rows={8} className="mt-4 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black">상세페이지 이미지</h2>
          <label className="mt-4 block space-y-1">
            <span className="text-xs font-black text-slate-600">대표이미지 URL</span>
            <input value={form.mainImageUrl} onChange={(event) => updateForm("mainImageUrl", event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block space-y-1">
            <span className="text-xs font-black text-slate-600">부가이미지 URL · 최대 10개</span>
            <textarea value={form.additionalImageUrls} onChange={(event) => updateForm("additionalImageUrls", event.target.value)} rows={5} className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-black">상세페이지 HTML</h2>
        <textarea value={form.detailHtml} onChange={(event) => updateForm("detailHtml", event.target.value)} rows={10} className="mt-4 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500" />
      </section>

      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
        <span className="hidden text-xs font-bold text-slate-500 md:inline">상품 1건만 저장 · 서버 재조회 검증</span>
        <button type="button" onClick={() => void save()} disabled={!canSave} className="rounded-xl bg-blue-700 px-7 py-3 text-sm font-black text-white disabled:opacity-40">
          {saving ? "저장·검증 중…" : "저장"}
        </button>
      </div>
    </main>
  );
}

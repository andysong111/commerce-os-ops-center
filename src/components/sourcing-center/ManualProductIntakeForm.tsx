"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type StorageSize = "" | "S" | "L";
type ResultCandidate = { conceptId?: string; saleOption?: string; chinaOption?: string; storageSize?: "S" | "L" };
type Result = { ok?: boolean; code?: string; message?: string; productName?: string; candidates?: ResultCandidate[] };
type VariantDraft = { id: string; saleOption: string; chinaOption: string; storageSize: StorageSize; unitPriceCny: string; moq: string };
type ProductDraft = { id: string; sourceUrl: string; productName: string; supplierName: string; variants: VariantDraft[]; error: string };
type StagedCandidate = { conceptId: string; productName: string; saleOption: string; chinaOption: string; storageSize: "S" | "L" };
type Props = { embedded?: boolean; formId?: string; calculationFormId?: string };

const DRAFT_STORAGE_PREFIX = "commerce-os.manual-sourcing-intake.v1";
const MAX_STORED_PRODUCTS = 30;
const MAX_STORED_VARIANTS = 30;

const normalizeOption = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
const optionalNumber = (value: string) => value.trim() ? Number(value.trim()) : null;
const emptyVariant = (id: string): VariantDraft => ({
  id,
  saleOption: "",
  chinaOption: "",
  storageSize: "",
  unitPriceCny: "",
  moq: "",
});
const emptyProduct = (id: string, variantId: string): ProductDraft => ({
  id,
  sourceUrl: "",
  productName: "",
  supplierName: "",
  variants: [emptyVariant(variantId)],
  error: "",
});

function storedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function draftStorageKey(formId?: string, calculationFormId?: string) {
  const params = new URLSearchParams(window.location.search);
  const context = params.get("replace")?.trim() || params.get("draftId")?.trim() || params.get("date")?.trim() || "default";
  return [
    DRAFT_STORAGE_PREFIX,
    window.location.pathname,
    formId || "manual",
    calculationFormId || "standalone",
    context,
  ].join(":");
}

function completedCandidateIdsFromLocation() {
  return new Set(new URLSearchParams(window.location.search).getAll("source").map((value) => value.trim()).filter(Boolean));
}

function hasManualDraftContent(products: ProductDraft[], stagedCandidates: StagedCandidate[]) {
  if (stagedCandidates.length || products.length > 1 || products.some((product) => product.variants.length > 1)) return true;
  return products.some((product) => (
    product.sourceUrl || product.productName || product.supplierName || product.error ||
    product.variants.some((variant) => (
      variant.saleOption || variant.chinaOption || variant.storageSize || variant.unitPriceCny || variant.moq
    ))
  ));
}

export function ManualProductIntakeForm({ embedded = false, formId, calculationFormId }: Props) {
  const productSequence = useRef(1);
  const variantSequence = useRef(1);
  const storageKey = useRef("");
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [products, setProducts] = useState<ProductDraft[]>(() => [emptyProduct("manual-product-0", "manual-variant-0")]);
  const [stagedCandidates, setStagedCandidates] = useState<StagedCandidate[]>([]);
  const optionCount = products.reduce((sum, product) => sum + product.variants.length, 0);

  const makeVariant = (): VariantDraft => emptyVariant(`manual-variant-${variantSequence.current++}`);
  const makeProduct = (): ProductDraft => emptyProduct(
    `manual-product-${productSequence.current++}`,
    `manual-variant-${variantSequence.current++}`,
  );

  useEffect(() => {
    const key = draftStorageKey(formId, calculationFormId);
    storageKey.current = key;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as { version?: unknown; products?: unknown; stagedCandidates?: unknown };
      if (saved.version !== 1) return;

      const restoredProducts = (Array.isArray(saved.products) ? saved.products : [])
        .slice(0, MAX_STORED_PRODUCTS)
        .map((rawProduct) => {
          const product = rawProduct && typeof rawProduct === "object" ? rawProduct as Record<string, unknown> : {};
          const restoredVariants = (Array.isArray(product.variants) ? product.variants : [])
            .slice(0, MAX_STORED_VARIANTS)
            .map((rawVariant) => {
              const variant = rawVariant && typeof rawVariant === "object" ? rawVariant as Record<string, unknown> : {};
              const rawStorageSize = storedText(variant.storageSize, 1);
              return {
                id: `manual-variant-${variantSequence.current++}`,
                saleOption: storedText(variant.saleOption, 200),
                chinaOption: storedText(variant.chinaOption, 300),
                storageSize: rawStorageSize === "S" || rawStorageSize === "L" ? rawStorageSize : "" as StorageSize,
                unitPriceCny: storedText(variant.unitPriceCny, 30),
                moq: storedText(variant.moq, 30),
              } satisfies VariantDraft;
            });
          return {
            id: `manual-product-${productSequence.current++}`,
            sourceUrl: storedText(product.sourceUrl, 2_000),
            productName: storedText(product.productName, 240),
            supplierName: storedText(product.supplierName, 200),
            variants: restoredVariants.length ? restoredVariants : [emptyVariant(`manual-variant-${variantSequence.current++}`)],
            error: storedText(product.error, 500),
          } satisfies ProductDraft;
        });
      const completed = completedCandidateIdsFromLocation();
      const restoredStaged = (Array.isArray(saved.stagedCandidates) ? saved.stagedCandidates : [])
        .slice(0, MAX_STORED_PRODUCTS * MAX_STORED_VARIANTS)
        .flatMap((rawCandidate) => {
          const candidate = rawCandidate && typeof rawCandidate === "object" ? rawCandidate as Record<string, unknown> : {};
          const conceptId = storedText(candidate.conceptId, 100).trim();
          const rawStorageSize = storedText(candidate.storageSize, 1);
          if (!conceptId || completed.has(conceptId) || (rawStorageSize !== "S" && rawStorageSize !== "L")) return [];
          return [{
            conceptId,
            productName: storedText(candidate.productName, 240),
            saleOption: storedText(candidate.saleOption, 200),
            chinaOption: storedText(candidate.chinaOption, 300),
            storageSize: rawStorageSize,
          } satisfies StagedCandidate];
        });
      if (restoredProducts.length) setProducts(restoredProducts);
      if (restoredStaged.length) setStagedCandidates(restoredStaged);
      if (restoredProducts.length || restoredStaged.length) {
        const restoredOptionCount = restoredProducts.reduce((sum, product) => sum + product.variants.length, 0);
        setNotice(`임시저장 복원 · 상품 ${restoredProducts.length}종 · 입력 옵션 ${restoredOptionCount}개 · 계산 대기 ${restoredStaged.length}개`);
      }
    } catch {
      window.localStorage.removeItem(key);
    } finally {
      setStorageReady(true);
    }
  }, [calculationFormId, formId]);

  useEffect(() => {
    if (!storageReady || !storageKey.current) return;
    try {
      if (!hasManualDraftContent(products, stagedCandidates)) {
        window.localStorage.removeItem(storageKey.current);
        return;
      }
      window.localStorage.setItem(storageKey.current, JSON.stringify({
        version: 1,
        products,
        stagedCandidates,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // The form remains usable even when browser storage is unavailable or full.
    }
  }, [products, stagedCandidates, storageReady]);

  function resetNotice() { setNotice(""); setFailed(false); }
  function addProduct() { setProducts((current) => [...current, makeProduct()]); resetNotice(); }
  function removeProduct(productId: string) { setProducts((current) => current.filter((product) => product.id !== productId)); resetNotice(); }
  function updateProduct(productId: string, key: "sourceUrl" | "productName" | "supplierName", value: string) {
    setProducts((current) => current.map((product) => product.id === productId ? { ...product, [key]: value, error: "" } : product));
  }
  function addVariant(productId: string) {
    setProducts((current) => current.map((product) => product.id === productId
      ? { ...product, variants: [...product.variants, makeVariant()], error: "" }
      : product));
    resetNotice();
  }
  function removeVariant(productId: string, variantId: string) {
    setProducts((current) => current.map((product) => product.id === productId
      ? { ...product, variants: product.variants.filter((variant) => variant.id !== variantId), error: "" }
      : product));
    resetNotice();
  }
  function updateVariant(productId: string, variantId: string, key: keyof Omit<VariantDraft, "id">, value: string) {
    setProducts((current) => current.map((product) => product.id === productId ? {
      ...product,
      error: "",
      variants: product.variants.map((variant) => variant.id === variantId ? { ...variant, [key]: value } : variant),
    } : product));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = products.map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant })), error: "" }));
    const validated = submitted.map((product) => {
      const keys = product.variants.map((variant) => normalizeOption(variant.chinaOption || variant.saleOption));
      return new Set(keys).size !== keys.length
        ? { ...product, error: "같은 상품 안에 중복된 옵션이 있습니다. 중국 옵션명을 서로 다르게 입력하세요." }
        : product;
    });
    if (validated.some((product) => product.error)) {
      setProducts(validated); setFailed(true); setNotice("중복 옵션을 확인한 뒤 다시 저장하세요."); return;
    }

    setBusy(true); setNotice(""); setFailed(false);
    const failedProducts: ProductDraft[] = [];
    const staged = new Map<string, StagedCandidate>();
    const completedCandidateIds = completedCandidateIdsFromLocation();
    let completedProducts = 0, completedOptions = 0, alreadyCalculated = 0;
    for (let index = 0; index < submitted.length; index += 1) {
      const product = submitted[index];
      setNotice(`상품 ${index + 1}/${submitted.length} · 옵션 ${product.variants.length}개 저장 중...`);
      try {
        const response = await fetch("/api/sourcing-center/manual-product", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sourceUrl: product.sourceUrl,
            productName: product.productName,
            supplierName: product.supplierName,
            variants: product.variants.map((variant) => ({
              saleOption: variant.saleOption,
              chinaOption: variant.chinaOption,
              storageSize: variant.storageSize,
              unitPriceCny: optionalNumber(variant.unitPriceCny),
              moq: optionalNumber(variant.moq),
            })),
          }),
        });
        const result = await response.json().catch(() => ({})) as Result;
        if (!response.ok || !result.ok || !Array.isArray(result.candidates) || result.candidates.length !== product.variants.length) {
          failedProducts.push({ ...product, error: result.message || `후보 저장 실패 · ${result.code || response.status}` });
          continue;
        }
        completedProducts += 1;
        completedOptions += result.candidates.length;
        result.candidates.forEach((candidate, candidateIndex) => {
          const conceptId = String(candidate.conceptId ?? "").trim();
          const variant = product.variants[candidateIndex];
          if (!calculationFormId || !conceptId) return;
          if (completedCandidateIds.has(conceptId)) { alreadyCalculated += 1; return; }
          staged.set(conceptId, {
            conceptId,
            productName: result.productName || product.productName || "신규상품",
            saleOption: candidate.saleOption || variant.saleOption,
            chinaOption: candidate.chinaOption || variant.chinaOption,
            storageSize: candidate.storageSize || variant.storageSize as "S" | "L",
          });
        });
      } catch {
        failedProducts.push({ ...product, error: "소싱엔진에 연결하지 못했습니다. 주문이나 결제는 실행되지 않았습니다." });
      }
    }
    if (staged.size) setStagedCandidates((current) => {
      const merged = new Map(current.map((candidate) => [candidate.conceptId, candidate]));
      staged.forEach((candidate, conceptId) => merged.set(conceptId, candidate));
      return [...merged.values()];
    });
    setProducts(failedProducts.length ? failedProducts : [makeProduct()]);
    if (failedProducts.length) {
      setFailed(true);
      setNotice(`${completedProducts}상품·${completedOptions}옵션 추가 완료 · ${failedProducts.length}상품 실패. 실패 입력만 남겼습니다.`);
    } else if (calculationFormId) {
      setNotice(`${completedProducts}상품·${completedOptions}옵션 후보 추가 완료${alreadyCalculated ? ` · 이미 계산된 후보 ${alreadyCalculated}옵션` : ""}. 아직 발주안은 계산하지 않았습니다.`);
    } else {
      setNotice(`${completedProducts}상품·${completedOptions}옵션 후보를 저장했습니다.`);
    }
    setBusy(false);
  }

  return (
    <form id={formId} onSubmit={submit} aria-busy={busy} className={embedded ? "min-w-0 bg-white py-5 xl:border-l xl:border-slate-200 xl:pl-6" : "border-y border-slate-200 bg-white py-5"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black text-emerald-700">직접 신규상품 추가</p>
          {embedded ? <h3 className="mt-1 text-lg font-black text-slate-950">1688 상품·옵션 일괄 등록</h3> : <h2 className="mt-1 text-xl font-black text-slate-950">1688 상품·옵션 일괄 등록</h2>}
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">링크와 모델명은 상품별로 한 번만 입력하고, 같은 상품의 옵션은 아래에서 추가하세요. 각 옵션에 별도 B코드와 수납공간이 배정됩니다.</p>
          <p className="mt-1 text-xs font-bold text-sky-700">입력 중인 상품과 계산 대기 후보는 이 브라우저에 자동 임시저장됩니다.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">상품 {products.length}종 · 옵션 {optionCount}개</span>
      </div>

      <div className="mt-5 grid gap-5">
        {products.map((product, productIndex) => (
          <fieldset key={product.id} disabled={busy} className="min-w-0 border-y border-slate-200 py-5">
            <legend className="sr-only">신규상품 {productIndex + 1}</legend>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-black text-slate-950">상품 {productIndex + 1} 공통정보</p>
              {products.length > 1 ? <button type="button" onClick={() => removeProduct(product.id)} className="text-xs font-bold text-slate-600 underline hover:text-rose-700">상품 삭제</button> : null}
            </div>
            <div className={`mt-3 grid gap-4 ${embedded ? "md:grid-cols-2" : "lg:grid-cols-2"}`}>
              <label className="text-sm font-bold text-slate-900">1688 상품 링크<input data-manual-source-url value={product.sourceUrl} onChange={(event) => updateProduct(product.id, "sourceUrl", event.target.value)} type="url" required placeholder="https://detail.1688.com/offer/...html" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-bold text-slate-900">상품명·모델명<input value={product.productName} onChange={(event) => updateProduct(product.id, "productName", event.target.value)} required maxLength={240} placeholder="예: 접이식 주방 수납선반" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-bold text-slate-900">공급업체명 <span className="font-normal text-slate-500">(선택)</span><input value={product.supplierName} onChange={(event) => updateProduct(product.id, "supplierName", event.target.value)} maxLength={200} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-3"><p className="text-sm font-black text-slate-950">옵션별 B코드·수납 설정</p><span className="text-xs font-bold text-slate-500">{product.variants.length}개</span></div>
              <div className="mt-3 grid gap-3">
                {product.variants.map((variant, variantIndex) => (
                  <fieldset key={variant.id} className="min-w-0 border border-slate-200 bg-slate-50 p-4">
                    <legend className="sr-only">옵션 {variantIndex + 1}</legend>
                    <div className="flex items-center justify-between gap-3"><p className="text-sm font-black">옵션 {variantIndex + 1}</p>{product.variants.length > 1 ? <button type="button" onClick={() => removeVariant(product.id, variant.id)} className="text-xs font-bold text-slate-600 underline hover:text-rose-700">옵션 삭제</button> : null}</div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-bold">판매 옵션명<input value={variant.saleOption} onChange={(event) => updateVariant(product.id, variant.id, "saleOption", event.target.value)} required maxLength={200} placeholder="예: 화이트 대형" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                      <label className="text-sm font-bold">1688 중국 옵션<input value={variant.chinaOption} onChange={(event) => updateVariant(product.id, variant.id, "chinaOption", event.target.value)} required maxLength={300} placeholder="예: 白色加大款" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <fieldset><legend className="text-sm font-black">수납 공간</legend><div className="mt-2 flex flex-wrap gap-2"><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><input type="radio" name={`storage.${variant.id}`} checked={variant.storageSize === "S"} onChange={() => updateVariant(product.id, variant.id, "storageSize", "S")} required />소형</label><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><input type="radio" name={`storage.${variant.id}`} checked={variant.storageSize === "L"} onChange={() => updateVariant(product.id, variant.id, "storageSize", "L")} required />대형</label></div></fieldset>
                      <label className="text-sm font-bold">1688 단가(위안) <span className="font-normal text-slate-500">(선택)</span><input value={variant.unitPriceCny} onChange={(event) => updateVariant(product.id, variant.id, "unitPriceCny", event.target.value)} type="number" min="0.01" step="0.01" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                      <label className="text-sm font-bold">최소주문수량 <span className="font-normal text-slate-500">(선택)</span><input value={variant.moq} onChange={(event) => updateVariant(product.id, variant.id, "moq", event.target.value)} type="number" min="1" step="1" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                    </div>
                  </fieldset>
                ))}
              </div>
              <button type="button" onClick={() => addVariant(product.id)} className="mt-3 min-h-11 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:border-emerald-600">+ 같은 상품 옵션 추가</button>
            </div>
            {product.error ? <p role="alert" className="mt-3 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{product.error}</p> : null}
          </fieldset>
        ))}
      </div>

      <button type="button" onClick={addProduct} disabled={busy} className="mt-4 min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:border-slate-500 disabled:cursor-wait disabled:opacity-50">+ 다른 상품 추가</button>

      {calculationFormId && stagedCandidates.length ? (
        <section className="mt-5 border-y border-emerald-200 bg-emerald-50 px-3 py-3" aria-label="계산 대기 수동 후보">
          <p className="text-xs font-black text-emerald-900">계산 대기 옵션 {stagedCandidates.length}개</p>
          <div className="mt-2 grid gap-2">{stagedCandidates.map((candidate) => (
            <div key={candidate.conceptId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0"><strong className="block truncate">{candidate.productName} · {candidate.saleOption}</strong><span className="text-xs text-emerald-800">1688 {candidate.chinaOption} · {candidate.storageSize === "S" ? "소형" : "대형"}</span></span>
              <button type="button" onClick={() => setStagedCandidates((current) => current.filter((item) => item.conceptId !== candidate.conceptId))} className="shrink-0 text-xs font-bold text-slate-600 underline">제외</button>
              <input type="hidden" name="source" value={candidate.conceptId} form={calculationFormId} />
              <input type="hidden" name={`storage.${candidate.conceptId}`} value={candidate.storageSize} form={calculationFormId} />
            </div>
          ))}</div>
        </section>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-emerald-700 px-5 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-wait disabled:bg-slate-300">
          {busy ? "상품·옵션 저장 중..." : calculationFormId ? `상품 ${products.length}종 · 옵션 ${optionCount}개 후보 목록에 추가` : `상품 ${products.length}종 · 옵션 ${optionCount}개 후보 저장`}
        </button>
        {notice ? <p role={failed ? "alert" : "status"} className={`text-sm font-bold ${failed ? "text-rose-700" : "text-emerald-800"}`}>{notice}</p> : null}
      </div>
    </form>
  );
}

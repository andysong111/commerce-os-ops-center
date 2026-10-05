"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Result = {
  ok?: boolean;
  code?: string;
  message?: string;
  conceptId?: string;
  duplicate?: boolean;
  productName?: string;
};

export function ManualProductIntakeForm() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setNotice("");
    setFailed(false);
    const form = new FormData(formElement);
    const optionalNumber = (key: string) => {
      const raw = String(form.get(key) ?? "").trim();
      return raw ? Number(raw) : null;
    };
    try {
      const response = await fetch("/api/sourcing-center/manual-product", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sourceUrl: String(form.get("sourceUrl") ?? ""),
          productName: String(form.get("productName") ?? ""),
          storageSize: String(form.get("storageSize") ?? ""),
          unitPriceCny: optionalNumber("unitPriceCny"),
          moq: optionalNumber("moq"),
          supplierName: String(form.get("supplierName") ?? ""),
          chinaOption: String(form.get("chinaOption") ?? ""),
        }),
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) {
        setFailed(true);
        setNotice(result.message || `후보 저장 실패 · ${result.code || response.status}`);
        return;
      }
      setNotice(
        result.duplicate
          ? "이미 등록된 1688 상품입니다. 기존 후보의 최신 관찰값만 갱신했습니다."
          : `${result.productName || "신규상품"} 후보를 저장했습니다. 자동 검증을 통과하면 다음 발주 준비 화면에 나타납니다.`,
      );
      formElement.reset();
    } catch {
      setFailed(true);
      setNotice("소싱엔진에 연결하지 못했습니다. 주문이나 결제는 실행되지 않았습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-y border-slate-200 bg-white py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black text-emerald-700">직접 신규상품 추가</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">1688 링크로 후보 등록</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            링크와 상품명을 넣으면 기존 소싱 검증 흐름에 합류합니다. B코드·모델번호·상품출시 카드는 발주 Draft에 최종 포함될 때 생성되며, 여기서는 주문·결제를 실행하지 않습니다.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">후보 저장</span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-bold text-slate-900">
          1688 상품 링크
          <input name="sourceUrl" type="url" required placeholder="https://detail.1688.com/offer/...html" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm font-bold text-slate-900">
          상품명·모델명
          <input name="productName" required maxLength={240} placeholder="예: 접이식 주방 수납선반" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-black text-slate-900">어느 수납 공간을 사용합니까?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><input type="radio" name="storageSize" value="S" required />소형 수납</label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><input type="radio" name="storageSize" value="L" required />대형 수납</label>
        </div>
      </fieldset>

      <details className="mt-4 border-t border-slate-100 pt-3 text-sm">
        <summary className="cursor-pointer font-bold text-slate-700">알고 있는 공급정보 추가</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="font-bold">1688 단가(위안)<input name="unitPriceCny" type="number" min="0.01" step="0.01" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="font-bold">최소주문수량<input name="moq" type="number" min="1" step="1" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="font-bold">중국 옵션<input name="chinaOption" maxLength={300} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="font-bold">공급업체명<input name="supplierName" maxLength={200} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-emerald-700 px-5 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-wait disabled:bg-slate-300">
          {busy ? "후보 저장 중..." : "신규상품 후보 저장"}
        </button>
        {notice ? <p role={failed ? "alert" : "status"} className={`text-sm font-bold ${failed ? "text-rose-700" : "text-emerald-800"}`}>{notice}</p> : null}
      </div>
    </form>
  );
}

"use client";

import { isPickingBcode, type PickingObservation } from "@/lib/pickingInventoryInput";
import { invoiceGroups, type InvoiceGroups } from "../../../../shared/mobile-work-center.mjs";
import { useEffect, useMemo, useRef, useState } from "react";

type ItemDetails = {
  modelNames?: string[];
  modelNumbers?: string[];
  productNames?: string[];
  optionNames?: string[];
};

type Item = ItemDetails & {
  barcode: string;
  quantity: number;
  picked: boolean;
};

type DeltaItem = ItemDetails & {
  barcode: string;
  quantityToPick: number;
};

type Receipt = {finishedAt:string; selections:PickingObservation[]; stockouts:{barcode:string; state:string}[];
  invoiceTask?: (InvoiceGroups & {status:string; code:string|null}) | null};
const invoiceStates: Record<string,string> = {
  waiting:"PC 실행 대기", running:"PC에서 실행 중", completed:"처리 완료", needs_pc:"PC 확인 필요",
  failed:"시작 실패", ambiguous:"처리 결과 확인 필요", acknowledged:"결과 확인 처리됨", expired:"당일 실행 시간 만료",
};
const splitInvoices = (text:string) => text.trim().split(/[\s,]+/).filter(Boolean);
const invoiceDraftKey = (id:string) => "commerce-os:picking-invoices:" + id;
type Draft = Record<string,{soldOut:boolean; count:string}>;
const dispatchLabels:Record<string,string> = {QUEUED:"PC 전송 대기", CHECK_PC:"PC 접수 확인 중", STARTED:"전송 중", SUCCEEDED:"접수 완료", FAILED:"전송 실패", UNCERTAIN:"접수 확인 필요"};
type Picking = {
  snapshotId: string;
  inventoryFinished?: boolean;
  date: string;
  createdAt: string;
  source: string;
  status: string;
  summary: Record<string, number>;
  items: Item[];
  delta: {
    addedQuantity: number;
    changedQuantity: number;
    removedQuantity: number;
    quantityToPick: number;
    addedOrderCount: number;
    changedOrderCount: number;
    removedOrderCount: number;
    toPickItems: DeltaItem[];
  };
  unresolved: Array<{ reason?: string; productName?: string; optionName?: string; quantity?: number }>;
};

function listText(values: string[] | undefined, fallback: string) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : fallback;
}

function ItemDetailsText({ item }: { item: ItemDetails }) {
  return (
    <span className="mt-2 grid gap-1 text-xs leading-5 text-slate-600 sm:grid-cols-2">
      <span className="min-w-0"><strong className="text-slate-800">모델명</strong> {listText(item.modelNames, "미확인")}</span>
      <span className="min-w-0"><strong className="text-slate-800">모델번호</strong> {listText(item.modelNumbers, "미확인")}</span>
      <span className="min-w-0 sm:col-span-2"><strong className="text-slate-800">옵션명</strong> {listText(item.optionNames, "단품")}</span>
    </span>
  );
}

export default function PickingClient({ token }: { token: string }) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"full" | "delta">("full");
  const [busy, setBusy] = useState("");

  const [draft, setDraft] = useState<Draft>({});
  const [invoices, setInvoices] = useState({soldOut:"",shortage:""});
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const actionLock = useRef(false);
  const draftKey = (id:string) => "commerce-os:picking-inventory:" + id;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/picking/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error("피킹 목록을 열 수 없습니다.");
        let saved:Draft = {};
        try { saved = JSON.parse(localStorage.getItem(draftKey(body.picking.snapshotId)) || "{}") || {}; } catch {}
        setDraft(saved);
        let invoiceDraft = {soldOut:"",shortage:""};
        try {
          const stored = JSON.parse(sessionStorage.getItem(invoiceDraftKey(body.picking.snapshotId)) || "null");
          if (typeof stored?.soldOut === "string" && typeof stored?.shortage === "string") invoiceDraft = stored;
        } catch {}
        setInvoices(invoiceDraft);
        setPicking(body.picking);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "피킹 목록을 열 수 없습니다.");
      });
    return () => controller.abort();
  }, [token]);

  const itemsByCode = useMemo(() => new Map(picking?.items.map(item => [item.barcode,item])),[picking]);
  const pickedCount = useMemo(() => picking?.items.filter((item) => item.picked).length || 0, [picking]);

  const frozen = Boolean(receipt || picking?.inventoryFinished);
  useEffect(() => {
    if (!frozen) return;
    const controller = new AbortController();
    let timer:number;
    async function refresh() {
      try {
        const response = await fetch("/api/picking/" + encodeURIComponent(token) + "/finish",{cache:"no-store",signal:controller.signal});
        const body = await response.json();
        if (response.status === 401 || response.status === 403) { setNeedsLogin(true); return; }
        if (!response.ok || !body.receipt) throw new Error(body.message || "품절 접수 결과를 조회하지 못했습니다.");
        if (controller.signal.aborted) return;
        setReceipt(body.receipt);
        if (!["waiting","running","ambiguous"].includes(body.receipt.invoiceTask?.status) &&
          body.receipt.stockouts.every((item:{state:string}) => ["SUCCEEDED","FAILED"].includes(item.state))) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) timer=window.setTimeout(() => void refresh(), 12000);
    }
    void refresh();
    return () => {controller.abort();window.clearTimeout(timer);};
  }, [frozen,token]);

  function edit(barcode:string, soldOut:boolean, count:string) {
    if (!picking || frozen || actionLock.current) return;
    const next = {...draft};
    if (soldOut || count !== "") next[barcode]={soldOut,count};
    else delete next[barcode];
    setDraft(next);
    setError("");
    try {localStorage.setItem(draftKey(picking.snapshotId),JSON.stringify(next));}
    catch {setError("휴대폰 임시저장이 꺼져 있습니다. 완료 전까지 이 화면을 열어 두세요.");}
  }

  function editInvoices(field:"soldOut"|"shortage", value:string) {
    if (!picking || frozen || actionLock.current) return;
    const next = {...invoices,[field]:value};
    setInvoices(next);
    setError("");
    try { sessionStorage.setItem(invoiceDraftKey(picking.snapshotId),JSON.stringify(next)); } catch {}
  }

  async function finish() {
    if (!picking || frozen || actionLock.current) return;
    actionLock.current=true;
    setBusy("finish");
    setError("");
    try {
      const groups = invoiceGroups(splitInvoices(invoices.soldOut),splitInvoices(invoices.shortage));
      const observations = Object.entries(draft).map(([barcode,row]) => {
        if (!row.soldOut && !/^\d+$/.test(row.count)) throw new Error(barcode + "의 남은 수량을 정수로 입력해 주세요.");
        return {barcode,soldOut:row.soldOut,quantity:row.soldOut ? null : Number(row.count)};
      });
      const response=await fetch("/api/picking/" + encodeURIComponent(token) + "/finish",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({snapshotId:picking.snapshotId,observations,...groups}),
      });
      const body=await response.json();
      if (response.status === 401 || response.status === 403) setNeedsLogin(true);
      if (!response.ok || !body.receipt) throw new Error(body.message || "피킹 완료 결과를 확인하지 못했습니다.");
      setReceipt(body.receipt);
      try {sessionStorage.removeItem(invoiceDraftKey(picking.snapshotId));} catch {}
      try {localStorage.removeItem(draftKey(picking.snapshotId));} catch {}
    } catch(reason) {
      setError(reason instanceof Error ? reason.message : "연결을 확인하고 다시 눌러 주세요.");
    } finally {actionLock.current=false;setBusy("");}
  }

  async function toggle(item: Item, completed: boolean) {
    if (actionLock.current || frozen) return;
    actionLock.current=true;
    setBusy(item.barcode);
    try {
      const response = await fetch(`/api/picking/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: item.barcode, completed, snapshotId:picking?.snapshotId }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("완료 상태를 저장하지 못했습니다.");
      setPicking((current) => current ? {
        ...current,
        items: current.items.map((row) => row.barcode === item.barcode ? { ...row, picked: completed } : row),
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "완료 상태를 저장하지 못했습니다.");
    } finally {
      actionLock.current=false;
      setBusy("");
    }
  }

  if (error && !picking) return <main className="mx-auto min-h-screen max-w-3xl bg-white p-6 text-slate-900"><h1 className="text-xl font-bold">피킹 목록</h1><p className="mt-5 border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p></main>;
  if (!picking) return <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">피킹 목록을 불러오는 중입니다.</main>;

  const unavailable = Object.values(draft).filter(row => row.soldOut).length;
  const counts = Object.values(draft).filter(row => !row.soldOut && row.count !== "").length;
  function checkbox(item:Item) {
    return <input type="checkbox" checked={item.picked} aria-label={item.barcode + " 피킹 체크"}
      disabled={!!busy || frozen || !!draft[item.barcode]?.soldOut}
      onChange={(event) => void toggle(item,event.target.checked)} className="mt-1 h-5 w-5 accent-emerald-700" />;
  }
  function controls(item:Item | undefined) {
    if (!item || !isPickingBcode(item.barcode) || frozen) return null;
    const row = draft[item.barcode];
    return <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <button type="button" aria-pressed={!!row?.soldOut} disabled={!!busy || item.picked}
        className="min-h-10 rounded border px-3 aria-pressed:border-red-600 aria-pressed:bg-red-50 aria-pressed:text-red-800 disabled:opacity-50"
        onClick={() => edit(item.barcode,!row?.soldOut,"")}>재고없음</button>
      <label className="flex items-center gap-2">피킹 후 남은 수량
        <input aria-label={item.barcode + " 남은 수량"} type="text" inputMode="numeric" placeholder="선택" maxLength={7}
          disabled={!!busy || !!row?.soldOut} value={row?.count ?? ""} onChange={event => edit(item.barcode,false,event.target.value)}
          className="w-20 rounded border p-2" /></label>
    </div>;
  }
  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-white text-slate-900">
      <header className="border-b-4 border-orange-500 bg-emerald-950 px-5 py-5 text-white">
        <h1 className="text-xl font-black">오늘의 피킹 목록</h1>
        <p className="mt-1 text-xs text-emerald-100">{picking.date} · {picking.source === "SHOPLING_API" ? "샵플링 공식 API" : "B7 엑셀 대체"}</p>
      </header>
      <section className="grid grid-cols-2 border-b sm:grid-cols-4">
        {[
          ["주문 행", picking.summary.filteredOrderRecordCount],
          ["전체 수량", picking.summary.totalQuantity],
          ["피킹 완료", `${pickedCount}/${picking.items.length}`],
          ["확인 필요", picking.summary.unresolvedRecordCount],
        ].map(([label, value]) => <div key={String(label)} className="border-r p-4 last:border-r-0"><div className="text-xs text-slate-500">{label}</div><strong className="mt-1 block text-xl">{value}</strong></div>)}
      </section>
      <div className="flex gap-2 border-b p-3">
        <button type="button" onClick={() => setTab("full")} className={`border px-3 py-2 text-sm font-bold ${tab === "full" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>전체 목록</button>
        <button type="button" onClick={() => setTab("delta")} className={`border px-3 py-2 text-sm font-bold ${tab === "delta" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>변경분</button>
      </div>
      {tab === "full" ? (
        <ul className="divide-y">
          {picking.items.map((item) => (
            <li key={item.barcode} className={item.picked ? "bg-slate-50 p-4 text-slate-500" : "p-4"}>
              <label className="flex cursor-pointer items-start gap-3">
                {checkbox(item)}
                <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-3"><strong className="text-base">{item.barcode}</strong><strong className="text-lg">{item.quantity}개</strong></span><span className="mt-1 block text-sm">{listText(item.productNames, "상품명 미확인")}</span><ItemDetailsText item={item} /></span>
              </label>
              {controls(item)}
            </li>
          ))}
        </ul>
      ) : (
        <section className="p-4">
          <div className="grid grid-cols-2 gap-px border bg-slate-200 text-sm sm:grid-cols-4">
            {[["신규 주문", picking.delta.addedOrderCount], ["변경 주문", picking.delta.changedOrderCount], ["취소·제외", picking.delta.removedOrderCount], ["이번 피킹", `${picking.delta.quantityToPick}개`]].map(([label, value]) => <div key={String(label)} className="bg-white p-3"><span className="text-xs text-slate-500">{label}</span><strong className="mt-1 block">{value}</strong></div>)}
          </div>
          <ul className="mt-4 divide-y border">
            {picking.delta.toPickItems.length ? picking.delta.toPickItems.map((item) => {
              const fullItem = itemsByCode.get(item.barcode);
              return <li key={item.barcode} className="p-3 text-sm">
                <label className="flex items-start gap-3">
                  {fullItem && checkbox(fullItem)}
                  <span className="min-w-0 flex-1"><span className="flex justify-between gap-4"><strong>{item.barcode}</strong><strong>{item.quantityToPick}개</strong></span>
                    <span className="mt-1 block text-xs text-slate-500">{listText(item.productNames,"상품명 미확인")}</span><ItemDetailsText item={item}/></span>
                </label>
                {controls(fullItem)}
              </li>;
            }) : <li className="p-6 text-center text-sm text-slate-500">추가 피킹 대상이 없습니다.</li>}
          </ul>
        </section>
      )}
      {picking.unresolved.length > 0 && <section className="border-t bg-amber-50 p-4"><h2 className="font-bold text-amber-900">확인 필요 {picking.unresolved.length}건</h2><ul className="mt-2 space-y-2 text-sm text-amber-900">{picking.unresolved.map((item, index) => <li key={`${item.reason}-${index}`}>{item.reason} · {item.productName || "상품명 미확인"} · {item.quantity || 0}개</li>)}</ul></section>}
      <section className="space-y-3 border-t p-4">
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {needsLogin && <a className="block font-bold underline" href={"/login?force=1&next=" + encodeURIComponent("/picking/" + token)}>운영자 로그인 후 돌아오기</a>}
        {frozen ? <div role="status"><strong>피킹 완료</strong>
          {picking.unresolved.length > 0 && <p className="text-sm">확인 필요 {picking.unresolved.length}건은 별도로 확인해 주세요.</p>}
          {receipt && <><p className="my-2 text-sm">실사 재고 {receipt.selections.filter(row => !row.soldOut).length}건 반영 · 품절 {receipt.stockouts.length}건</p>
            {receipt.invoiceTask && <div className="my-3 rounded border p-3 text-sm">
              <strong>4번 미발송 송장 처리 · {receipt.invoiceTask.code === "KAKAO_CAPTCHA" ? "카카오톡 인증 대기" : invoiceStates[receipt.invoiceTask.status] || "확인 필요"}</strong>
              <p className="mt-1 break-words">품절 처리 · {receipt.invoiceTask.invoiceNumbers.join(", ") || "없음"}</p>
              <p className="break-words">재고부족(품절 제외) · {receipt.invoiceTask.inventoryShortageInvoiceNumbers.join(", ") || "없음"}</p>
              {["ambiguous","needs_pc","failed","expired"].includes(receipt.invoiceTask.status) && <a className="mt-2 inline-block underline" href="/mobile-work-center">업무센터에서 결과 확인</a>}
            </div>}
            <ul className="text-sm">{receipt.stockouts.map(item => <li key={item.barcode}>{item.barcode} · {dispatchLabels[item.state] || "확인 필요"}</li>)}
              {receipt.selections.filter(row => !row.soldOut).map(row => <li key={row.barcode}>{row.barcode} · 남은 재고 {row.quantity}개</li>)}</ul></>}
        </div> : <><fieldset disabled={!!busy} className="space-y-3">
          <legend className="font-bold">4번 미발송 송장 처리</legend>
          <p className="text-sm">12자리 송장번호를 줄바꿈 또는 쉼표로 구분하세요. 두 칸 합계 최대 50개입니다.</p>
          <label className="block text-sm font-semibold">품절 처리할 미발송 송장번호
            <textarea className="mt-1 block w-full rounded border p-2 text-base font-normal" rows={2} value={invoices.soldOut}
              onChange={e=>editInvoices("soldOut",e.target.value)} /></label>
          <label className="block text-sm font-semibold">재고부족 미발송 송장번호 (품절 제외)
            <textarea className="mt-1 block w-full rounded border p-2 text-base font-normal" rows={2} value={invoices.shortage}
              onChange={e=>editInvoices("shortage",e.target.value)} /></label>
          <p className="text-sm">{invoices.soldOut.trim() || invoices.shortage.trim()
            ? "피킹 완료를 누르면 입력한 송장으로 4번 업무를 실제 실행합니다."
            : "입력한 송장이 없으면 피킹만 완료합니다."}</p>
        </fieldset><p className="text-sm">완료 시 재고없음 {unavailable}건을 품절 전송하고 실사 재고 {counts}건을 반영합니다.</p>
          <button type="button" disabled={!!busy} onClick={() => void finish()} className="w-full rounded bg-emerald-900 p-3 font-bold text-white disabled:opacity-50">
            {busy === "finish" ? "반영 중…" : "피킹 완료"}</button></>}
      </section>
    </main>
  );
}

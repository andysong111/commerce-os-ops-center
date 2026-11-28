"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  blankRestock,
  composeRestock,
  estimatedSmsBytes,
  statusLabels,
  type RestockDetails,
} from "@/lib/restockAlertCore";

type Settings = { sender: string; mode: string; opt_out: string };
type Entry = {
  id: string;
  barcode: string;
  phone: string;
  market: string;
  marketItem: string;
  status: string;
  created: string;
  note: string;
  details?: RestockDetails;
};
type Data = { items: Entry[]; settings: Settings; total: number; asOf: string };
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-950";
const button =
  "rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {title}
      {children}
    </label>
  );
}
async function request(url: string, options?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...options });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
const post = (payload: unknown) =>
  request("/api/restock-alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
export function RestockAlerts({ draft }: { draft: string }) {
  const [form, setForm] = useState({ ...blankRestock, barcode: "", phone: "" }),
    key = useRef("");
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false),
    [version, reload] = useState(0),
    [offset, page] = useState(0);
  const [editing, setEditing] = useState("");
  const [rechecked, setRechecked] = useState(false);
  const [lookup, setLookup] = useState<{
    key: string;
    name: string;
    url: string;
  } | null>(null);
  const barcode = form.barcode.trim().toUpperCase(),
    lookupKey = barcode + "|" + form.storeUrl;
  useEffect(() => {
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) return;
    const ctrl = new AbortController(),
      timer = setTimeout(() => {
        request(
          "/api/restock-alerts?" +
            new URLSearchParams({ lookup: barcode, store: form.storeUrl }),
          { signal: ctrl.signal },
        )
          .then((r) => {
            if (!ctrl.signal.aborted)
              setLookup({
                key: lookupKey,
                name: r.product?.name || "",
                url: r.product?.url || "",
              });
          })
          .catch(() => {
            if (!ctrl.signal.aborted)
              setLookup({ key: lookupKey, name: "", url: "" });
          });
      }, 650);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [barcode, form.storeUrl, lookupKey]);
  useEffect(() => {
    const controller = new AbortController();
    request(
      "/api/restock-alerts?" +
        new URLSearchParams({ draft, offset: String(offset) }),
      { signal: controller.signal },
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [draft, offset, version]);
  const set = (name: string, value: string | boolean | number) =>
    setForm((f) => ({ ...f, [name]: value }));
  async function save(payload: unknown, success: string, clear = false) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await post(payload);
      setFeedback(success);
      if (clear) {
        setEditing("");
        setRechecked(false);
        setForm({ ...blankRestock, barcode: "", phone: "" });
        key.current = "";
        page(0);
      }
      reload((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const now = new Date(data?.asOf || 0);
  const match = lookup?.key === lookupKey ? lookup : null;
  const preview = composeRestock(
    {
      ...form,
      comparedAt: editing && !rechecked ? form.comparedAt : now.toISOString(),
    },
    match?.name || "상품명·옵션",
    form.storeUrl || match?.url || "[자사몰 상품 링크]",
    now,
    data?.settings.opt_out || "",
  );
  function register(e: FormEvent) {
    e.preventDefault();
    if (!key.current) key.current = crypto.randomUUID();
    void save(
      {
        ...form,
        rechecked,
        id: editing || key.current,
        action: editing ? "edit" : "register",
      },
      editing ? "신청 내용을 수정했습니다." : "입고알림 신청을 등록했습니다.",
      true,
    );
  }
  return (
    <>
      <div className="grid items-start gap-5 md:grid-cols-[3fr_2fr]">
        <form
          onSubmit={register}
          className="space-y-4 rounded-xl border bg-white p-5"
        >
          <h2 id="restock-form" className="text-lg font-bold">
            {editing ? "입고알림 수정" : "입고알림 신청"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="상품 B코드">
              <input
                required
                readOnly={!!editing}
                autoCapitalize="characters"
                className={inputClass}
                placeholder="예: BBA7-3"
                value={form.barcode}
                onChange={(e) => set("barcode", e.target.value)}
              />
            </Field>
            <Field title="고객 휴대폰 번호">
              <input
                required
                readOnly={!!editing}
                inputMode="tel"
                autoComplete="off"
                type="tel"
                className={inputClass}
                placeholder="010-0000-0000"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </div>
          <Field title="도소매사우루스 상품 링크">
            <input
              type="url"
              className={inputClass}
              placeholder="비워두면 B코드로 찾습니다"
              value={form.storeUrl}
              onChange={(e) => set("storeUrl", e.target.value)}
            />
          </Field>
          {match && (
            <p aria-live="polite" className="text-xs text-slate-600">
              {match.name
                ? "연결된 상품 · " + match.name
                : "신청을 저장하면 입고 시 상품 연결을 다시 조회합니다."}
            </p>
          )}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              원래 구매한 마켓 추가 · 선택
            </summary>
            <div className="mt-3 grid gap-3">
              <p className="text-xs text-slate-600">
                고객이 두 구매처의 안내를 원할 때 입력하세요.
              </p>
              <Field title="마켓명">
                <input
                  className={inputClass}
                  list="restock-markets"
                  placeholder="예: 도매꾹, 스마트스토어"
                  value={form.marketName}
                  onChange={(e) => set("marketName", e.target.value)}
                />
              </Field>
              <datalist id="restock-markets">
                {[
                  "도매꾹",
                  "도매매",
                  "오너클랜",
                  "스마트스토어",
                  "쿠팡",
                  "지마켓",
                  "옥션",
                  "11번가",
                ].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Field title="원구매처 상품 링크">
                <input
                  type="url"
                  className={inputClass}
                  value={form.marketUrl}
                  onChange={(e) => set("marketUrl", e.target.value)}
                />
              </Field>
              <Field title="원구매처 상품번호">
                <input
                  className={inputClass}
                  placeholder="링크와 상품번호 중 하나만 입력해도 됩니다"
                  value={form.marketItem}
                  onChange={(e) => set("marketItem", e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.promotion}
                  onChange={(e) => set("promotion", e.target.checked)}
                />
                고객이 가격 추천 문자에도 동의했고, 동일 옵션·수량·배송 조건의
                가격을 확인했습니다.
              </label>
              {form.promotion && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {(["marketPrice", "ownPrice"] as const).map((f, i) => (
                      <Field
                        key={f}
                        title={i ? "자사몰 가격 (원)" : "원구매처 가격 (원)"}
                      >
                        <input
                          type="number"
                          required
                          min="1"
                          className={inputClass}
                          value={form[f] || ""}
                          onChange={(e) => set(f, Number(e.target.value))}
                        />
                      </Field>
                    ))}
                  </div>
                  <p className="text-xs text-slate-600">
                    확인 후 24시간 이내, 오전 8시~오후 9시에 무료수신거부 번호가
                    설정된 경우 가격을 함께 안내합니다. 그 외에는 기본 입고
                    안내를 보냅니다.
                  </p>
                </>
              )}
              {editing && form.promotion && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rechecked}
                    onChange={(e) => setRechecked(e.target.checked)}
                  />
                  지금 두 가격을 다시 확인했습니다.
                </label>
              )}
            </div>
          </details>
          <Field title="알림메시지 초안">
            <textarea
              className={inputClass}
              rows={3}
              maxLength={450}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <button className={button} disabled={busy}>
            {editing ? "수정 저장" : "신청 등록"}
          </button>
          {editing && (
            <button
              type="button"
              className="ml-3 text-sm"
              onClick={() => {
                setEditing("");
                setForm({ ...blankRestock, barcode: "", phone: "" });
              }}
            >
              수정 닫기
            </button>
          )}
        </form>
        <aside className="rounded-xl border bg-slate-50 p-5">
          <h2 className="font-bold">문자 미리보기</h2>
          <p className="my-3 whitespace-pre-line break-words rounded-lg border bg-white p-4 text-sm leading-6">
            {preview}
          </p>
          <p className="text-xs text-slate-600">
            {estimatedSmsBytes(preview)}바이트 예상 · 샵플링 기준 단문 1건,
            90바이트 초과 장문 3건 차감
          </p>
        </aside>
      </div>
      <div aria-live="polite">
        {(error || feedback) && (
          <p className={error ? "text-red-800" : "text-emerald-800"}>
            {error || feedback}
          </p>
        )}
      </div>
      <section className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">
            {draft ? "이번 차시에 연결된 신청" : "신청·발송 내역"}{" "}
            {data?.total ?? ""}
          </h2>
          <div className="flex gap-3 text-sm text-blue-700">
            {draft && <Link href="/restock-alerts">전체 신청</Link>}
            <button
              onClick={() => {
                setError("");
                reload((v) => v + 1);
              }}
            >
              새로고침
            </button>
          </div>
        </div>
        {!data ? (
          <p className="py-4 text-sm">불러오는 중</p>
        ) : !data.items.length ? (
          <p className="py-4 text-sm text-slate-600">등록된 신청이 없습니다.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {data.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <b>{row.barcode}</b> · {row.phone}
                  <p className="text-xs text-slate-600">
                    {new Date(row.created).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}{" "}
                    {row.market} {row.marketItem}
                  </p>
                </div>
                <div>
                  {statusLabels[row.status]}{" "}
                  {row.details && (
                    <button
                      type="button"
                      className="ml-3 text-blue-700"
                      onClick={() => {
                        setEditing(row.id);
                        setRechecked(false);
                        setForm({
                          ...row.details!,
                          barcode: row.barcode,
                          phone: row.phone,
                        });
                        document
                          .getElementById("restock-form")
                          ?.scrollIntoView();
                      }}
                    >
                      수정
                    </button>
                  )}
                  {["READY", "WAITING"].includes(row.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      className="ml-3 text-blue-700"
                      onClick={() =>
                        void save(
                          { action: "cancel", id: row.id },
                          "신청을 취소했습니다.",
                        )
                      }
                    >
                      신청 취소
                    </button>
                  )}
                  {row.note && (
                    <p className="text-xs text-slate-600">{row.note}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 30 && (
          <div className="flex justify-end gap-3 text-sm">
            <button disabled={!offset} onClick={() => page(offset - 30)}>
              이전
            </button>
            <button
              disabled={offset + 30 >= data.total}
              onClick={() => page(offset + 30)}
            >
              다음
            </button>
          </div>
        )}
      </section>
      {data && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer font-semibold">
            샵플링 문자 설정 ·{" "}
            {
              { off: "발송 꺼짐", pilot: "운영자 시험", live: "자동 발송" }[
                data.settings.mode
              ]
            }
          </summary>
          <form
            key={JSON.stringify(data.settings)}
            className="mt-4 grid max-w-lg gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const p = Object.fromEntries(new FormData(e.currentTarget));
              void save(
                { ...p, action: "settings" },
                "문자 설정을 저장했습니다.",
              );
            }}
          >
            <Field title="샵플링 등록 발신번호">
              <input
                required
                type="tel"
                name="sender"
                defaultValue={data.settings.sender}
                className={inputClass}
              />
            </Field>
            <Field title="발송 모드">
              <select
                name="mode"
                defaultValue={data.settings.mode}
                className={inputClass}
              >
                <option value="off">발송 꺼짐</option>
                <option value="pilot">운영자 번호로만 시험</option>
                <option value="live">신청 고객에게 자동 발송</option>
              </select>
            </Field>
            <Field title="가격 추천용 무료수신거부 번호 · 선택">
              <input
                name="optOut"
                type="tel"
                placeholder="080 번호"
                defaultValue={data.settings.opt_out}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-slate-600">
              시험 모드에서 운영자 번호로 신청하고 휴대폰 수신과 상품 링크를
              확인한 뒤 고객 자동 발송을 켜세요.
            </p>
            <button className={button} disabled={busy}>
              발송 설정 저장
            </button>
          </form>
        </details>
      )}
    </>
  );
}

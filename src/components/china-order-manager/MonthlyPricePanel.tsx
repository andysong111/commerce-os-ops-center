"use client";

import { useEffect, useRef, useState } from "react";
import { MONTHLY_PRICE_BRIDGE, MONTHLY_PRICE_POLICY, MONTHLY_PRICE_EXTENSION_VERSION } from "@/lib/monthlyPriceContract";
import type { MonthlyPriceCandidate, MonthlyPricePlan } from "@/lib/monthlyPriceCore";

type Transmission = { token: string; fingerprint: string; claimedAt: string; batchId?: string; result?: string };
type Item = { id: string; goodsKey: string; state: string; candidate: MonthlyPriceCandidate; plan: MonthlyPricePlan | null; writeIndex: number; errorCode: string | null; transmission: Transmission | null };
type Snapshot = { run: { id: string; month: string; policy: string; warnings: string[] } | null; items: Item[] };
type BridgeReply = { ok: boolean; error?: string; version?: string; observation?: unknown; report?: Record<string, unknown> };
const endpoint = "/api/china-order-manager/monthly-price";
const STATE: Record<string, string> = { QUEUED: "대기", PREPARED: "예상 변경안 준비됨", WRITING: "반영 결과 확인 필요", VERIFY_PENDING: "가격 재조회 중", VERIFIED: "샵플링 반영 확인", RESENDING: "쇼핑몰 수정전송 중", TRANSMITTED: "전송 종료 · 마켓 확인 대기", HELD: "현재가 유지 · 인하 보호", BLOCKED: "변경 제외 · 확인 필요", UNCERTAIN: "불확실 · 재전송 차단" };
function describe(code: string) {
  if (/EXTENSION|HISTORY_MISSING/.test(code)) return `A21 확장프로그램 ${MONTHLY_PRICE_EXTENSION_VERSION} 설치·새로고침이 필요하거나 이전 전송기록을 확인해야 합니다.`;
  if (/SOURCE_CHANGED|CLOSED_DRAFT_CHANGED/.test(code)) return "입고·원가 근거가 실행 시작 후 변경되었습니다. 이전 변경 결과를 확인한 뒤 새 기준으로 진행해야 합니다.";
  if (/RECEIPT|FINAL_COST|CONFIRMED_COST|CAPTURED_COST/.test(code)) return "입고확정 수량과 최종 원가 근거를 대조하지 못했습니다. 가격을 임의로 계산하지 않았습니다.";
  if (/GROUP|MAPPING|SCOPE|UNITS|OPTION/.test(code)) return "가격그룹·상품/옵션 연결·묶음 수량을 안전하게 확정하지 못해 변경을 제외했습니다.";
  if (/BUSY/.test(code)) return "다른 창 또는 다른 월에서 같은 상품을 처리 중입니다. 중복 실행하지 않았습니다.";
  if (/PREVIEW_REQUIRED/.test(code)) return "아직 예상 변경안을 만들지 않은 상품이 있습니다. 먼저 모든 대상의 예상 가격을 확인하세요.";
  if (/RELIST_REQUIRED/.test(code)) return "A21 판매가/옵션 전송이 200개 묶음 → 소묶음 → 개별 3단계까지 실패했습니다. 이 상품은 삭제 후 재등록 대상으로 분리했습니다.";
  if (/READBACK|UNCERTAIN|MARKET_RESULT/.test(code)) return "실제 반영 결과를 확정하지 못했습니다. 완료 처리하거나 무조건 다시 전송하지 않습니다.";
  if (/LOGIN|DOM|BROWSER|CURRENT_PRICE|MALL|SHOPLING_TAB/.test(code)) return "샵플링 로그인 세션 또는 현재 가격행을 확인하지 못했습니다. 가격 변경을 보호했습니다.";
  return "자동 처리를 멈췄습니다. 아래 확인 코드를 확인하세요.";
}
export function monthlyPriceBridge(command: string, payload: Record<string, unknown> = {}, timeoutMs = 40000): Promise<BridgeReply> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { window.removeEventListener("message", receive); window.clearTimeout(timer); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== MONTHLY_PRICE_BRIDGE || event.data.direction !== "response" || event.data.requestId !== requestId) return;
      cleanup();
      const response = event.data.response as BridgeReply;
      if (!response?.ok) reject(new Error(response?.error || "MONTHLY_PRICE_EXTENSION_FAILED")); else resolve(response);
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("MONTHLY_PRICE_EXTENSION_NOT_CONNECTED")); }, timeoutMs);
    window.addEventListener("message", receive);
    window.postMessage({ channel: MONTHLY_PRICE_BRIDGE, direction: "request", requestId, command, payload }, location.origin);
  });
}
async function api(payload: Record<string, unknown>) {
  const result = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, policy: MONTHLY_PRICE_POLICY }), signal: AbortSignal.timeout(65000), cache: "no-store" });
  const data = await result.json();
  if (!result.ok || !data.ok) throw new Error(data.code || "MONTHLY_PRICE_REQUEST_FAILED");
  return data;
}
export function MonthlyPricePanel({ month, ready }: { month: string; ready: boolean }) {
  return <MonthlyPricePanelForMonth key={month} month={month} ready={ready} />;
}
function MonthlyPricePanelForMonth({ month, ready }: { month: string; ready: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ run: null, items: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const generation = useRef(0), running = useRef(false);
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    running.current = false;
    void fetch(`${endpoint}?month=${encodeURIComponent(month)}`, { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (generation.current === current && data.ok) setSnapshot(data);
    }).catch(() => {});
    return () => { generation.current += 1; running.current = false; };
  }, [month]);
  function update(item: Item) { setSnapshot((value) => ({ ...value, items: value.items.map((old) => old.id === item.id ? item : old) })); }
  async function bridgeReady() {
    setProgress("확장프로그램 연결 확인");
    const bridge = await monthlyPriceBridge("PING", {}, 3000);
    if (bridge.version !== MONTHLY_PRICE_EXTENSION_VERSION) {
      throw new Error("MONTHLY_PRICE_EXTENSION_UPDATE_REQUIRED");
    }
  }
  async function refreshRun(runId?: string) {
    const suffix = runId ? `&runId=${encodeURIComponent(runId)}` : "";
    const result = await fetch(`${endpoint}?month=${encodeURIComponent(month)}${suffix}`, { cache: "no-store" });
    const data = await result.json();
    if (!result.ok || !data.ok) throw new Error(data.code || "MONTHLY_PRICE_REQUEST_FAILED");
    setSnapshot(data);
    return data as Snapshot;
  }
  async function preparePreview() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setProgress("");
    const current = generation.current;
    const active = () => running.current && generation.current === current;
    try {
      await bridgeReady();
      if (!active()) return;
      setProgress("입고 원장·실제 원가·현재 판매가를 읽어 예상 변경안을 계산합니다. 아직 가격은 변경하지 않습니다.");
      const data = await api({ action: "start", month }) as Snapshot;
      if (!active()) return;
      setSnapshot(data);
      if (!data.run) throw new Error("MONTHLY_PRICE_RUN_REQUIRED");
      const runId = data.run.id;
      for (const initial of data.items) {
        if (!active()) break;
        if (initial.state !== "QUEUED") continue;
        let item = initial;
        setProgress(`예상가 계산 · ${item.candidate.productName} · ${item.goodsKey}`);
        try {
          const observation = (await monthlyPriceBridge("READ", { goodsKey: item.goodsKey })).observation;
          if (!active()) break;
          const result = await api({ action: "prepare", itemId: item.id, runId, observation });
          item = { ...item, ...result.item };
          if (generation.current === current) update(item);
        } catch (itemError) {
          const code = itemError instanceof Error ? itemError.message : "MONTHLY_PRICE_ITEM_FAILED";
          if (generation.current === current) {
            setError(code);
            setProgress(`${item.goodsKey} · ${describe(code)}`);
          }
          break;
        }
      }
      if (active()) {
        const latest = await refreshRun(runId);
        const pending = latest.items.filter((item) => item.state === "QUEUED").length;
        const prepared = latest.items.filter((item) => item.state === "PREPARED").length;
        setProgress(pending
          ? `예상가 계산이 중단되었습니다. 남은 ${pending}상품을 다시 확인하면 이어서 계산합니다.`
          : `예상 변경안 준비 완료 · 실제 변경 예정 ${prepared}상품 · 아래 예상값을 확인한 뒤 실행하세요.`);
      }
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "MONTHLY_PRICE_FAILED");
    } finally {
      if (generation.current === current) { running.current = false; setBusy(false); }
    }
  }
  async function applyChanges(resumeExistingRun = false) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setProgress("");
    const current = generation.current;
    const active = () => running.current && generation.current === current;
    try {
      await bridgeReady();
      if (!active()) return;
      let data = resumeExistingRun && snapshot.run
        ? await api({ action: "resumePreflight", month, runId: snapshot.run.id }) as Snapshot
        : await refreshRun(snapshot.run?.id);
      if (resumeExistingRun && generation.current === current) setSnapshot(data);
      if (!data.run) throw new Error("MONTHLY_PRICE_RUN_REQUIRED");
      const runId = data.run.id;
      const unpreviewed = data.items.filter((item) => item.state === "QUEUED").length;
      if (unpreviewed && !resumeExistingRun) throw new Error("MONTHLY_PRICE_PREVIEW_REQUIRED");

      let historyMissingSkipped = 0;
      const newBatchId = crypto.randomUUID();
      const newBatchItems: Item[] = [];
      const existingBatchIds = new Set<string>();
      const legacyResending: Item[] = [];

      const updateFromApi = (result: { item?: Partial<Item> & { id?: string; duplicate?: boolean } }, fallback: Item) => {
        const next = { ...fallback, ...(result.item ?? {}) } as Item;
        if (generation.current === current) update(next);
        return next;
      };

      for (const initial of data.items) {
        if (!active()) break;
        let item = initial;
        const step = async (action: string, extra: Record<string, unknown> = {}, read = true) => {
          const observation = read ? (await monthlyPriceBridge("READ", { goodsKey: item.goodsKey })).observation : undefined;
          if (!active()) return { ...item, duplicate: undefined as boolean | undefined };
          const result = await api({ action, itemId: item.id, runId, observation, ...extra });
          item = updateFromApi(result, item);
          return { ...item, duplicate: result.item?.duplicate as boolean | undefined };
        };

        if (item.state === "BLOCKED" || item.state === "HELD" || item.state === "TRANSMITTED") continue;
        setProgress(`${item.candidate.productName} · ${item.goodsKey} · 샵플링 원장 가격 반영`);
        try {
          if (item.state === "QUEUED") {
            if (!resumeExistingRun) continue;
            await step("prepare");
          }
          while (active() && item.state === "PREPARED") await step("write");
          if (!active()) break;
          if (["VERIFY_PENDING", "UNCERTAIN", "WRITING"].includes(item.state)) await step("verify");
          if (!active()) break;

          if (item.state === "VERIFIED") {
            const claim = await step("resendClaim", { batchId: newBatchId }, true);
            if (claim.duplicate === false && item.transmission?.batchId === newBatchId) newBatchItems.push(item);
          } else if (item.state === "RESENDING" && item.transmission) {
            if (item.transmission.batchId) existingBatchIds.add(item.transmission.batchId);
            else legacyResending.push(item);
          }
        } catch (itemError) {
          const code = itemError instanceof Error ? itemError.message : "MONTHLY_PRICE_ITEM_FAILED";
          if (generation.current === current) {
            setError(code);
            setProgress(`${item.goodsKey} · ${describe(code)}`);
          }
          break;
        }
      }

      const applyTerminalBatchReport = async (report: Record<string, unknown>, batchItems: Item[]) => {
        const rows = Array.isArray(report.items) ? report.items as Record<string, unknown>[] : [];
        const byId = new Map(batchItems.map((item) => [item.id, item]));
        for (const row of rows) {
          const itemId = String(row.itemId ?? "");
          const local = byId.get(itemId);
          if (!local) continue;
          const result = await api({ action: "resendReport", itemId, runId, report: row });
          updateFromApi(result, local);
        }
      };

      const markBatchMissing = async (batchItems: Item[]) => {
        for (const item of batchItems) {
          if (!item.transmission) continue;
          const report = {
            token: item.transmission.token,
            fingerprint: item.transmission.fingerprint,
            goodsKey: item.goodsKey,
            itemId: item.id,
            batchId: item.transmission.batchId,
            state: "MISSING",
            priceOnly: false,
            priceAndOption: false,
            saleStatusActivated: false,
            saleStatusRestored: false,
            saleStatusRolledBack: false,
          };
          const result = await api({ action: "resendReport", itemId: item.id, runId, report });
          updateFromApi(result, item);
          historyMissingSkipped += 1;
        }
      };

      const runBatch = async (batchId: string, batchItems: Item[], startNew: boolean) => {
        let reply = startNew
          ? await monthlyPriceBridge("BATCH_START", {
              month,
              runId,
              batchId,
              newClaim: true,
              items: batchItems.map((item) => ({
                itemId: item.id,
                token: item.transmission?.token,
                fingerprint: item.transmission?.fingerprint,
                goodsKey: item.goodsKey,
              })),
            }, 65000)
          : await monthlyPriceBridge("BATCH_STATUS", { batchId }, 10000);

        for (let polls = 0; active() && polls < 1200; polls += 1) {
          const report = reply.report;
          if (!report) throw new Error("MONTHLY_PRICE_EXTENSION_REPORT_REQUIRED");
          if (report.state === "MISSING") {
            await markBatchMissing(batchItems);
            return;
          }
          if (report.state !== "RUNNING" && report.state !== "STARTING") {
            await applyTerminalBatchReport(report, batchItems);
            return;
          }
          const phase = String(report.phase ?? "");
          const activeWindows = Number(report.activeWindows ?? 0);
          const total = Number(report.itemCount ?? batchItems.length);
          const phaseText = phase === "PRICE" ? "판매가" : phase === "OPTION" ? "옵션" : phase === "STATUS_SELLING" ? "품절→판매중" : phase === "STATUS_SOLD_OUT" ? "상태 복구" : "마켓 수정전송";
          setProgress(`마켓 일괄전송 ${total}개 · ${phaseText} 단계 · 작업창 ${activeWindows}개 병렬 · 판매가 전체 완료 후 옵션 진행`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!active()) return;
          reply = await monthlyPriceBridge("BATCH_STATUS", { batchId }, 10000);
        }
        throw new Error("MONTHLY_PRICE_BATCH_STATUS_TIMEOUT");
      };

      if (active() && newBatchItems.length) {
        setProgress(`마켓 수정전송 준비 · ${newBatchItems.length}개 GOODSKEY · 200개 단위 · 최대 4개 창 병렬`);
        await runBatch(newBatchId, newBatchItems, true);
      }

      if (active() && existingBatchIds.size) {
        const refreshed = await refreshRun(runId);
        for (const batchId of existingBatchIds) {
          if (!active()) break;
          const batchItems = refreshed.items.filter((item) => item.state === "RESENDING" && item.transmission?.batchId === batchId);
          if (batchItems.length) await runBatch(batchId, batchItems, false);
        }
      }

      // Backward compatibility for old single-item transmissions created before v0.5.4.
      for (let item of legacyResending) {
        if (!active() || !item.transmission) break;
        const transmission = item.transmission;
        try {
          let reply = await monthlyPriceBridge("START", {
            month, runId, itemId: item.id, token: transmission.token,
            fingerprint: transmission.fingerprint, newClaim: false,
          });
          for (let polls = 0; active() && polls < 1000; polls += 1) {
            const report = reply.report;
            if (!report) throw new Error("MONTHLY_PRICE_EXTENSION_REPORT_REQUIRED");
            if (report.state !== "RUNNING" && report.state !== "STARTING") {
              const result = await api({ action: "resendReport", itemId: item.id, runId, report });
              item = updateFromApi(result, item);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (!active()) break;
            reply = await monthlyPriceBridge("STATUS", {
              token: transmission.token, fingerprint: transmission.fingerprint, goodsKey: item.goodsKey,
            });
          }
        } catch (itemError) {
          const code = itemError instanceof Error ? itemError.message : "MONTHLY_PRICE_ITEM_FAILED";
          if (code === "MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING") {
            await markBatchMissing([item]);
            continue;
          }
          throw itemError;
        }
      }

      if (active()) {
        data = await refreshRun(runId);
        setProgress(historyMissingSkipped
          ? `자동 처리 종료 · 이전 전송기록 없음 ${historyMissingSkipped}건은 재전송하지 않고 보류 · 나머지 상품 처리 완료`
          : "자동 처리 종료 · 판매가→옵션 단계 일괄전송 완료 · 보호·확인 필요 항목을 확인하세요.");
      }
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "MONTHLY_PRICE_FAILED");
    } finally {
      if (generation.current === current) { running.current = false; setBusy(false); }
    }
  }
  async function reviewLegacyTransmissions() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setProgress("");
    const current = generation.current;
    const active = () => running.current && generation.current === current;
    try {
      await bridgeReady();
      if (!active()) return;
      let data = await refreshRun(snapshot.run?.id);
      if (!data.run) throw new Error("MONTHLY_PRICE_RUN_REQUIRED");
      const runId = data.run.id;
      const targets = data.items.filter((item) =>
        item.state === "RESENDING" &&
        item.errorCode === "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED" &&
        item.transmission &&
        !item.transmission.batchId
      );
      if (!targets.length) {
        setProgress("과거 전송결과 확인 대상이 없습니다.");
        return;
      }

      const batchId = crypto.randomUUID();
      const retryItems: Item[] = [];
      let matched = 0;

      for (let index = 0; active() && index < targets.length; index += 1) {
        const initial = targets[index];
        setProgress(`과거 전송결과 확인 ${index + 1}/${targets.length} · ${initial.candidate.productName} · 실제 등록 쇼핑몰 판매가 조회`);
        const observation = (await monthlyPriceBridge("MARKET_READ", { goodsKey: initial.goodsKey }, 65000)).observation;
        if (!active()) break;
        const result = await api({
          action: "reviewLegacyTransmission",
          itemId: initial.id,
          runId,
          nextBatchId: batchId,
          observation,
        });
        const next = { ...initial, ...(result.item ?? {}) } as Item;
        if (generation.current === current) update(next);
        if (next.state === "TRANSMITTED") matched += 1;
        else if (result.item?.requeued === true && next.transmission?.batchId === batchId) retryItems.push(next);
      }

      if (active() && retryItems.length) {
        setProgress(`실제 미반영 ${retryItems.length}개 GOODSKEY만 재전송 · 200 → 20 → 개별 3단계 안전 재시도`);
        let reply = await monthlyPriceBridge("BATCH_START", {
          month,
          runId,
          batchId,
          newClaim: true,
          items: retryItems.map((item) => ({
            itemId: item.id,
            token: item.transmission?.token,
            fingerprint: item.transmission?.fingerprint,
            goodsKey: item.goodsKey,
          })),
        }, 65000);

        for (let polls = 0; active() && polls < 1200; polls += 1) {
          const report = reply.report;
          if (!report) throw new Error("MONTHLY_PRICE_EXTENSION_REPORT_REQUIRED");
          if (report.state === "MISSING") {
            for (const item of retryItems) {
              if (!item.transmission) continue;
              const missingReport = {
                token: item.transmission.token,
                fingerprint: item.transmission.fingerprint,
                goodsKey: item.goodsKey,
                itemId: item.id,
                batchId,
                state: "MISSING",
                priceOnly: false,
                priceAndOption: false,
                saleStatusActivated: false,
                saleStatusRestored: false,
                saleStatusRolledBack: false,
              };
              const result = await api({ action: "resendReport", itemId: item.id, runId, report: missingReport });
              const next = { ...item, ...(result.item ?? {}) } as Item;
              if (generation.current === current) update(next);
            }
            break;
          }
          if (report.state !== "RUNNING" && report.state !== "STARTING") {
            const rows = Array.isArray(report.items) ? report.items as Record<string, unknown>[] : [];
            const byId = new Map(retryItems.map((item) => [item.id, item]));
            for (const row of rows) {
              const itemId = String(row.itemId ?? "");
              const local = byId.get(itemId);
              if (!local) continue;
              const result = await api({ action: "resendReport", itemId, runId, report: row });
              const next = { ...local, ...(result.item ?? {}) } as Item;
              if (generation.current === current) update(next);
            }
            break;
          }
          const phase = String(report.phase ?? "");
          const activeWindows = Number(report.activeWindows ?? 0);
          const retryingCount = Number(report.retryingCount ?? 0);
          const phaseText = phase === "PRICE" ? "판매가" : phase === "OPTION" ? "옵션" : phase === "STATUS_SELLING" ? "품절→판매중" : phase === "STATUS_SOLD_OUT" ? "상태 복구" : "마켓 수정전송";
          setProgress(`미반영 ${retryItems.length}개 재전송 · ${phaseText} 단계 · 작업창 ${activeWindows}개 · 재시도 작업 ${retryingCount}개`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!active()) return;
          reply = await monthlyPriceBridge("BATCH_STATUS", { batchId }, 10000);
        }
      }

      if (active()) {
        data = await refreshRun(runId);
        const remaining = data.items.filter((item) => item.state === "RESENDING" && item.errorCode === "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED").length;
        const relist = data.items.filter((item) => item.state === "RESENDING" && item.errorCode === "MONTHLY_PRICE_RELIST_REQUIRED").length;
        setProgress(`과거 전송결과 정리 완료 · 이미 정상 ${matched}건 · 실제 미반영 재전송 ${retryItems.length}건 · 확인 보류 ${remaining}건 · 재등록 필요 ${relist}건`);
      }
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "MONTHLY_PRICE_FAILED");
    } finally {
      if (generation.current === current) { running.current = false; setBusy(false); }
    }
  }

  const count = (states: string[]) => snapshot.items.filter((item) => states.includes(item.state)).length;
  const queuedCount = count(["QUEUED"]);
  const preparedCount = count(["PREPARED"]);
  const transmissionReviewCount = snapshot.items.filter((item) =>
    item.state === "RESENDING" && item.errorCode === "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED"
  ).length;
  const relistRequiredCount = snapshot.items.filter((item) =>
    item.state === "RESENDING" && item.errorCode === "MONTHLY_PRICE_RELIST_REQUIRED"
  ).length;
  const activeExecutionCount = snapshot.items.filter((item) =>
    ["WRITING", "VERIFY_PENDING", "VERIFIED", "UNCERTAIN"].includes(item.state) ||
    (item.state === "RESENDING" && !["MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED", "MONTHLY_PRICE_RELIST_REQUIRED"].includes(item.errorCode ?? ""))
  ).length;
  const retryablePrewriteBlockCount = snapshot.items.filter((item) =>
    item.state === "BLOCKED" &&
    ["MONTHLY_PRICE_GROUP_REQUIRED", "MONTHLY_PRICE_INACTIVE_LISTING", "MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED", "MONTHLY_PRICE_OPTION_BARCODE_CONFLICT"].includes(item.errorCode ?? "") &&
    item.writeIndex === 0 &&
    item.plan === null &&
    item.transmission === null
  ).length;
  // Every explicit continuation of an old run goes through resumePreflight.
  // This also exposes a recovery path when stale GROUP_REQUIRED or
  // INACTIVE_LISTING rows are the only unfinished work.
  const existingRunResume = Boolean(snapshot.run) && (activeExecutionCount > 0 || retryablePrewriteBlockCount > 0);
  const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
  const shortReason = (code: string | null) => {
    if (!code) return "확인 필요";
    if (/GROUP/.test(code)) return "가격그룹 미확인";
    if (/MAPPING|SCOPE|OPTION/.test(code)) return "상품·옵션 연결 확인 필요";
    if (/CONFIRMED_COST|FINAL_COST|RECEIPT|CAPTURED_COST/.test(code)) return "확정 원가 근거 부족";
    if (/UNITS/.test(code)) return "묶음 수량 확인 필요";
    return "자동변경 제외";
  };
  type BCodePreviewRow = {
    key: string;
    barcode: string;
    productName: string;
    before: number | null;
    target: number | null;
    basis: string;
    tone: "change" | "hold" | "blocked";
  };
  const bCodeRows = snapshot.items.flatMap<BCodePreviewRow>((item) => {
    const base = item.plan?.targets.find((row) => row.mallKey === null) ?? null;
    if (base?.options?.length) {
      const candidateByCode = new Map(item.candidate.options.map((option) => [option.barcode, option]));
      return base.options.map((option) => {
        const candidate = candidateByCode.get(option.barcode);
        const changed = option.targetFinalSellPrice > option.beforeFinalSellPrice;
        const protectedCost = candidate?.protectedCostKrw ?? 0;
        const basis = changed
          ? `보호원가 ${money(protectedCost)} · ${item.plan?.productGroup ?? item.candidate.productGroup} 기준`
          : option.policyTargetSellPrice < option.beforeFinalSellPrice
            ? `현재가 보호 · 기준가 ${money(option.policyTargetSellPrice)}`
            : "변경 필요 없음";
        return {
          key: `${item.id}:${option.optionId}`,
          barcode: option.barcode,
          productName: candidate?.productName || item.candidate.productName,
          before: option.beforeFinalSellPrice,
          target: option.targetFinalSellPrice,
          basis,
          tone: changed ? "change" : "hold",
        };
      });
    }
    if (item.state === "BLOCKED") {
      return item.candidate.options.map((option) => ({
        key: `${item.id}:${option.barcode}:blocked`,
        barcode: option.barcode,
        productName: option.productName || item.candidate.productName,
        before: null as number | null,
        target: null as number | null,
        basis: shortReason(item.errorCode),
        tone: "blocked" as const,
      }));
    }
    return [];
  });
  const changedBCodeCount = bCodeRows.filter((row) => row.tone === "change").length;
  const heldBCodeCount = bCodeRows.filter((row) => row.tone === "hold").length;
  const blockedBCodeCount = bCodeRows.filter((row) => row.tone === "blocked").length;
  return <section id="monthly-price" className="rounded-xl border border-cyan-700 bg-slate-900 p-3" data-testid="monthly-price-panel">
    <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-xs font-black text-slate-950">6</span><h3 className="font-black text-white">입고 후 가격조정</h3></div>
    <p className="mt-2 text-xs leading-5 text-slate-300">{month} 입고상품만 처리합니다. 구재고·혼재 원가는 현재가를 보호하고, 검증된 원가 기준 인상만 실행합니다. 재고수량·과거 원가는 변경하지 않습니다. 옵션별 최종 판매가는 각 B코드의 보호원가로 재계산하며 현재 최종가격보다 낮추지 않습니다.</p>
    {existingRunResume ? (
      <button type="button" onClick={() => void applyChanges(true)} disabled={!ready || busy} className="mt-3 w-full rounded-lg bg-amber-300 px-3 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {busy
          ? "기존 가격조정 이어가는 중…"
          : retryablePrewriteBlockCount > 0
            ? `이전 실행 재확인·이어가기 (${retryablePrewriteBlockCount}건 재평가)`
            : "미완료 가격조정 이어가기"}
      </button>
    ) : transmissionReviewCount > 0 || relistRequiredCount > 0 ? (
      <div className="mt-3 space-y-1.5 rounded-lg border border-amber-700 bg-amber-950/70 px-3 py-2.5 text-xs leading-5 text-amber-100">
        {transmissionReviewCount > 0 && <>
          <p>이전 전송결과 확인 필요 {transmissionReviewCount}건은 실제 등록 쇼핑몰 판매가를 다시 읽어 목표가와 다른 GOODSKEY만 재전송할 수 있습니다.</p>
          <button type="button" onClick={() => void reviewLegacyTransmissions()} disabled={!ready || busy} className="w-full rounded-md bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "실제 마켓가격 확인 중…" : `과거 ${transmissionReviewCount}건 실제 가격 확인 · 미반영만 재전송`}
          </button>
        </>}
        {relistRequiredCount > 0 && <p>3단계 재전송까지 실패한 {relistRequiredCount}건은 삭제 후 재등록 대상으로 분리했습니다.</p>}
      </div>
    ) : (
      <>
        <button type="button" onClick={() => void preparePreview()} disabled={!ready || busy || (snapshot.run !== null && queuedCount === 0)} className="mt-3 w-full rounded-lg bg-cyan-300 px-3 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "예상 가격 계산 중…" : snapshot.run && queuedCount > 0 ? `예상 가격 계산 계속 (${queuedCount}상품)` : snapshot.run ? "예상 변경안 계산 완료" : "예상 가격 확인"}
        </button>
        {preparedCount > 0 && (
          <button type="button" onClick={() => void applyChanges(false)} disabled={!ready || busy || queuedCount > 0} className="mt-2 w-full rounded-lg bg-emerald-400 px-3 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "가격 반영 중…" : `이대로 가격조정 실행 (${preparedCount}상품)`}
          </button>
        )}
      </>
    )}
    {!ready && <p className="mt-2 text-xs text-amber-200">입고확정과 배송대행 실제비용 저장 후 실행할 수 있습니다. 실제 원가 근거는 실행 시 다시 검증합니다.</p>}
    {busy && <button type="button" onClick={() => { running.current = false; setProgress("다음 작업 중지 요청 · 이미 전송한 작업은 결과 확인이 필요합니다."); }} className="mt-2 text-xs underline text-slate-300">이후 작업 중지</button>}
    <div role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-cyan-100">{progress}</div>
    {snapshot.run && <p className="mt-2 text-xs leading-5 text-slate-300">대상 {snapshot.items.length} · 예상변경 준비 {preparedCount} · 대기 {queuedCount} · 샵플링 반영 확인 {count(["VERIFIED", "RESENDING", "TRANSMITTED"])} · 현재가 보호 {count(["HELD"])} · 확인 필요 {count(["BLOCKED", "UNCERTAIN", "WRITING"])} · 전송결과 확인 {transmissionReviewCount} · 재등록 필요 {relistRequiredCount} · 전송 종료 {count(["TRANSMITTED"])}</p>}
    {bCodeRows.length > 0 && (
      <div className="mt-3 rounded-lg border border-cyan-800 bg-slate-950/70 p-2 text-xs text-slate-200" data-testid="monthly-price-preview">
        <div className="flex flex-wrap items-center gap-2 font-bold">
          <span className="text-cyan-100">B코드별 예상 가격</span>
          <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-emerald-300">변경 {changedBCodeCount}</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">유지 {heldBCodeCount}</span>
          <span className="rounded-full bg-amber-950 px-2 py-0.5 text-amber-300">확인 {blockedBCodeCount}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">현재 최종판매가 → 예상 최종판매가 · 핵심 근거만 표시합니다. 이 단계에서는 실제 가격을 변경하지 않습니다.</p>
        <div className="mt-2 max-h-72 overflow-auto rounded border border-slate-800">
          {bCodeRows.map((row) => (
            <div key={row.key} className="grid grid-cols-[minmax(128px,1.15fr)_minmax(118px,0.9fr)_minmax(0,1.35fr)] items-center gap-2 border-b border-slate-800 px-2.5 py-2 last:border-b-0">
              <div className="min-w-0">
                <b className={row.tone === "blocked" ? "block font-mono text-amber-300" : "block font-mono text-cyan-200"}>{row.barcode}</b>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400" title={row.productName}>{row.productName}</span>
              </div>
              <div className="whitespace-nowrap font-bold">
                {row.before === null || row.target === null ? (
                  <span className="text-amber-300">변경 제외</span>
                ) : (
                  <>
                    <span className="text-slate-400">{money(row.before)}</span>
                    <span className="mx-1.5 text-slate-500">→</span>
                    <span className={row.target > row.before ? "text-emerald-300" : "text-slate-200"}>{money(row.target)}</span>
                  </>
                )}
              </div>
              <span className={row.tone === "blocked" ? "truncate text-amber-200" : "truncate text-slate-400"} title={row.basis}>{row.basis}</span>
            </div>
          ))}
        </div>
      </div>
    )}
    <p className="mt-2 text-[11px] leading-4 text-slate-400">전송창 종료와 각 쇼핑몰의 최종 반영 확인은 다릅니다. 전송 종료 항목은 ‘마켓 확인 대기’로 남습니다. 창을 닫으면 자동 진행이 멈추며, 다시 클릭하면 저장된 단계부터 확인합니다.</p>
    {error && <div role="alert" className="mt-3 rounded-lg border border-amber-700 bg-amber-950 p-2 text-xs text-amber-100">{describe(error)}<code className="mt-1 block break-all text-[10px]">{error}</code></div>}
    <a href="/api/shopling-a21-price-option-resend/download" className="mt-3 inline-block text-xs text-cyan-200 underline">A21 확장프로그램 {MONTHLY_PRICE_EXTENSION_VERSION} 받기</a>
    {snapshot.run?.warnings?.length ? <details className="mt-2 text-xs text-amber-200"><summary>원가 근거 확인 필요 ({snapshot.run.warnings.length})</summary>{snapshot.run.warnings.map((warning) => <p className="mt-1 break-all" key={warning}>{warning}</p>)}</details> : null}
    {snapshot.items.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-bold text-slate-200">상품별 결과·제외 사유</summary><div className="mt-2 max-h-80 space-y-2 overflow-auto">{snapshot.items.map((item) => <div key={item.id} className="rounded border border-slate-700 p-2"><b>{item.goodsKey} · {item.candidate.productName}</b><p>{STATE[item.state] || item.state}</p>{item.errorCode && <><p className="text-amber-200">{describe(item.errorCode)}</p><code className="break-all text-[10px] text-slate-400">{item.errorCode}</code></>}{item.plan && <p className="text-slate-400">가격 변경 {item.plan.writes.length}행 · 옵션 변경 {item.plan.optionChangeCount}개 · 인하 보호 {item.plan.protectedDecreaseCount}행</p>}</div>)}</div></details>}
  </section>;
}

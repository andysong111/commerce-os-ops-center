"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LITE_API = "/api/legacy-seo-run-jobs-lite?items=true";
const RECOVERY_API = "/api/legacy-seo-source-recovery?apply=1";

const CONFIRMED_MODELS = [
  "AAA012",
  "AAA030",
  "AAA031",
  "AAA032",
  "AAA034",
  "AAA037",
  "AAA038",
  "AAA039",
  "AAA040",
  "AAA042",
  "AAA043",
  "AAA044",
  "AAA048",
  "AAA049",
  "AAA057",
  "AAA058",
  "AAA059",
  "AAA065",
  "AAA068",
  "AAA069",
  "AAA071",
  "AAA074",
  "AAA074-1",
  "AAA075",
  "AAA077",
  "AAA078",
  "AAA079",
  "AAA080",
  "AAA083",
  "AAA086",
  "AAA090",
  "AAA092",
  "AAA093",
  "AAA094",
  "AAA095",
  "AAA098",
  "AAA103",
  "AAA137",
  "AAA147",
  "AAA161",
  "AAA220",
  "AAA225",
  "AAA229",
  "AAA274",
  "AAA360",
  "AAA361",
] as const;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? record(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

async function missingConfirmedModels() {
  const response = await fetch(LITE_API, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message) || `목록 확인 실패 HTTP ${response.status}`);
  }
  const present = new Set(
    (Array.isArray(body.items) ? body.items : [])
      .map((value) => normalizeModel(record(value).modelNumber))
      .filter(Boolean),
  );
  return CONFIRMED_MODELS.filter((model) => !present.has(model));
}

export default function LegacySeoSourceRecoveryEnhancer() {
  const startedRef = useRef(false);
  const [missingCount, setMissingCount] = useState(0);
  const [state, setState] = useState<"checking" | "recovering" | "idle" | "error">(
    "checking",
  );
  const [message, setMessage] = useState("");

  const recover = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setState("checking");
    setMessage("");
    try {
      const missing = await missingConfirmedModels();
      setMissingCount(missing.length);
      if (!missing.length) {
        setState("idle");
        return;
      }

      setState("recovering");
      const response = await fetch(RECOVERY_API, {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await readJson(response);
      if (!response.ok || body.ok !== true) {
        throw new Error(
          text(body.message) || text(body.code) || `자동 복구 실패 HTTP ${response.status}`,
        );
      }

      const report = record(body.report);
      const created = Number(report.createCount) || 0;
      const promoted = Number(report.promoteExistingCount) || 0;
      setMessage(
        `누락 이전상품 자동 복구 완료 · 신규 ${created}개 · 기존상태 복구 ${promoted}개`,
      );
      window.setTimeout(() => window.location.reload(), 1_200);
    } catch (error) {
      startedRef.current = false;
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "누락 이전상품 자동 복구에 실패했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    void recover();
  }, [recover]);

  if (state === "idle") return null;

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
        state === "error"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-violet-200 bg-violet-50 text-violet-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">
            {state === "checking"
              ? "실재고 사전 이전상품 누락 여부 확인 중…"
              : state === "recovering"
                ? `누락 이전상품 ${missingCount}개 자동 복구 중…`
                : "누락 이전상품 자동 복구 실패"}
          </div>
          {message ? <div className="mt-1 text-xs">{message}</div> : null}
        </div>
        {state === "error" ? (
          <button
            type="button"
            onClick={() => void recover()}
            className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-rose-100"
          >
            다시 시도
          </button>
        ) : null}
      </div>
    </div>
  );
}

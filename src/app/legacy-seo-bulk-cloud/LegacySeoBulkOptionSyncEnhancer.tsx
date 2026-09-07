"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function selectionSection() {
  return [...document.querySelectorAll<HTMLElement>("section")].find((section) =>
    section.querySelector("h2")?.textContent?.includes("1. 이전상품 선택"),
  ) ?? null;
}

function actionContainer(section: HTMLElement) {
  const button = [...section.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === "현재목록 선택",
  );
  return button?.parentElement ?? null;
}

function selectedModels(section: HTMLElement) {
  const result: string[] = [];
  for (const row of section.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox?.checked) continue;
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    const model = cells[1]?.textContent?.trim() ?? "";
    if (model && model !== "-") result.push(model);
  }
  return [...new Set(result)].slice(0, 100);
}

async function responseMessage(response: Response) {
  const raw = await response.text();
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (!response.ok || body?.ok !== true) {
      throw new Error(String(body?.message || `HTTP ${response.status}`));
    }
    return body as {
      changedCount?: number;
      warnings?: string[];
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`HTTP ${response.status}`);
  }
}

export default function LegacySeoBulkOptionSyncEnhancer() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [warningText, setWarningText] = useState("");

  useEffect(() => {
    const sync = () => {
      const section = selectionSection();
      if (!section) {
        setContainer(null);
        setSelectedCount(0);
        return;
      }
      const nextContainer = actionContainer(section);
      setContainer((current) => (current === nextContainer ? current : nextContainer));
      setSelectedCount(selectedModels(section).length);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", sync, true);
    const timer = window.setInterval(sync, 1_000);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", sync, true);
      window.clearInterval(timer);
    };
  }, []);

  if (!container) return null;

  return createPortal(
    <>
      <button
        type="button"
        disabled={busy || selectedCount === 0}
        onClick={async () => {
          const section = selectionSection();
          if (!section) return;
          const models = selectedModels(section);
          if (!models.length) return;
          setBusy(true);
          setStatus("");
          setWarningText("");
          try {
            const response = await fetch("/api/legacy-seo-option-sync", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              credentials: "same-origin",
              cache: "no-store",
              body: JSON.stringify({ modelNumbers: models }),
            });
            const body = await responseMessage(response);
            const warnings = Array.isArray(body.warnings) ? body.warnings : [];
            setStatus(`옵션/B코드 ${Number(body.changedCount) || 0}개 상품 동기화 완료`);
            setWarningText(warnings.join(" · "));
          } catch (error) {
            setStatus(error instanceof Error ? `동기화 실패: ${error.message}` : "동기화 실패");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
        title="선택상품을 Shopling 묶음형 상품 기준으로 옵션/B코드 동기화합니다. 쪼개진 단품 상품은 묶음형 후보가 있으면 사용하지 않습니다."
      >
        {busy ? "옵션 동기화 중…" : `선택 ${selectedCount}개 옵션/B코드 동기화`}
      </button>
      {status && (
        <span
          className={`self-center text-xs font-semibold ${status.startsWith("동기화 실패") ? "text-rose-700" : "text-sky-700"}`}
          title={warningText || undefined}
        >
          {status}{warningText ? ` · 검토 ${warningText.split(" · ").length}건` : ""}
        </span>
      )}
    </>,
    container,
  );
}

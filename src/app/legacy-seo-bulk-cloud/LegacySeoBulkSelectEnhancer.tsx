"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function legacySelectionSection() {
  return [...document.querySelectorAll<HTMLElement>("section")].find((section) =>
    section.querySelector("h2")?.textContent?.includes("1. 이전상품 선택"),
  ) ?? null;
}

function visibleRowCheckboxes(section: HTMLElement) {
  return [...section.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].slice(0, 100);
}

function actionButton(section: HTMLElement, label: string) {
  return [...section.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  ) ?? null;
}

export default function LegacySeoBulkSelectEnhancer() {
  const [headerCell, setHeaderCell] = useState<HTMLTableCellElement | null>(null);
  const [allSelected, setAllSelected] = useState(false);
  const [partiallySelected, setPartiallySelected] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => {
      const section = legacySelectionSection();
      if (!section) {
        setHeaderCell(null);
        setVisibleCount(0);
        setAllSelected(false);
        setPartiallySelected(false);
        return;
      }

      const cell = [...section.querySelectorAll<HTMLTableCellElement>("thead th")].find((th) =>
        th.textContent?.includes("선택"),
      ) ?? null;
      setHeaderCell((current) => (current === cell ? current : cell));

      const rows = visibleRowCheckboxes(section);
      const selectedCount = rows.filter((checkbox) => checkbox.checked).length;
      setVisibleCount(rows.length);
      setAllSelected(rows.length > 0 && selectedCount === rows.length);
      setPartiallySelected(selectedCount > 0 && selectedCount < rows.length);
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

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = partiallySelected;
  }, [partiallySelected, allSelected]);

  if (!headerCell) return null;

  return createPortal(
    <label
      className="ml-2 inline-flex cursor-pointer items-center gap-1.5 font-semibold text-violet-700"
      title={`현재 목록 최대 100개 일괄선택/해제${visibleCount ? ` · 현재 ${visibleCount}개 표시` : ""}`}
    >
      <input
        ref={checkboxRef}
        type="checkbox"
        aria-label="현재 목록 일괄선택"
        checked={allSelected}
        disabled={visibleCount === 0}
        onChange={() => {
          const section = legacySelectionSection();
          if (!section) return;
          const rows = visibleRowCheckboxes(section);
          const shouldSelect = rows.length > 0 && !rows.every((checkbox) => checkbox.checked);
          const button = actionButton(section, shouldSelect ? "현재목록 선택" : "선택해제");
          button?.click();
        }}
        className="h-4 w-4 accent-violet-700"
      />
      <span>일괄</span>
    </label>,
    headerCell,
  );
}

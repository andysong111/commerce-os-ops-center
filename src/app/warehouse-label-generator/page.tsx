"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  WAREHOUSE_LABEL_50X30_MM,
  createWarehouseLabelPdf,
  parseWarehouseCodesFromCsv,
  parseWarehouseCodesFromText,
} from "@/lib/warehouseLabelGenerator";

export default function WarehouseLabelGeneratorPage() {
  const [csvCodes, setCsvCodes] = useState<string[]>([]);
  const [manualText, setManualText] = useState("BAA1-1\nBAA1-2\nBAA1-3");
  const [status, setStatus] = useState("CSV를 업로드하거나 직접 입력 후 PDF를 생성하세요.");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState("warehouse-labels-50x30.pdf");
  const currentPdfUrlRef = useRef<string | null>(null);

  const manualCodes = useMemo(() => parseWarehouseCodesFromText(manualText), [manualText]);
  const codes = csvCodes.length > 0 ? csvCodes : manualCodes;

  function replacePdfUrl(nextUrl: string | null) {
    if (currentPdfUrlRef.current) {
      URL.revokeObjectURL(currentPdfUrlRef.current);
    }
    currentPdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsedCodes = parseWarehouseCodesFromCsv(text);
    setCsvCodes(parsedCodes);
    replacePdfUrl(null);
    setStatus(
      parsedCodes.length > 0
        ? `${file.name}에서 ${parsedCodes.length}개 코드를 불러왔습니다.`
        : "CSV에서 '전체코드' 또는 'code' 컬럼을 찾지 못했습니다.",
    );
  }

  function clearCsvCodes() {
    setCsvCodes([]);
    replacePdfUrl(null);
    setStatus("CSV 입력을 비우고 직접 입력 값을 사용합니다.");
  }

  function generatePdf() {
    if (codes.length === 0) {
      replacePdfUrl(null);
      setStatus("출력할 위치코드를 1개 이상 입력하세요.");
      return;
    }

    const pdfBytes = createWarehouseLabelPdf(codes);
    const pdfBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const nextUrl = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    setPdfFileName(`warehouse-labels-50x30-${date}.pdf`);
    replacePdfUrl(nextUrl);
    setStatus(`${codes.length}개 라벨 PDF를 생성했습니다.`);
  }

  function openPrintPreview() {
    if (!pdfUrl) return;
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <PageHeader
        title="창고 라벨 출력기"
        description="CSV 또는 직접 입력한 창고 위치코드를 Xprinter XP-DT108B 50×30mm 롤지에 맞는 1라벨 1페이지 PDF로 생성합니다."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">1. CSV 업로드</h2>
            <p className="mt-1 text-xs text-slate-500">컬럼명은 전체코드 또는 code를 사용합니다.</p>
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
              />
              {csvCodes.length > 0 ? (
                <button
                  type="button"
                  onClick={clearCsvCodes}
                  className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  CSV 입력 비우기
                </button>
              ) : null}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-950">2. 직접 입력</h2>
            <p className="mt-1 text-xs text-slate-500">줄바꿈 기준으로 여러 위치코드를 입력합니다. CSV가 있으면 CSV 값이 우선됩니다.</p>
            <textarea
              value={manualText}
              onChange={(event) => {
                setManualText(event.target.value);
                replacePdfUrl(null);
              }}
              rows={10}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="BAA1-1&#10;BAA1-2&#10;BAA1-3"
            />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-950">3. 라벨 크기 선택</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="rounded-lg border-2 border-blue-600 bg-blue-50 p-4 text-sm font-semibold text-blue-700">
                <input type="radio" checked readOnly className="mr-2" />
                {WAREHOUSE_LABEL_50X30_MM.label}
              </label>
              <button disabled className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-400">
                60×40mm 준비중
              </button>
              <button disabled className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-400">
                100×50mm 준비중
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-950">출력 요약</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">입력 방식</dt>
              <dd className="font-semibold text-slate-900">{csvCodes.length > 0 ? "CSV" : "직접 입력"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">출력 개수</dt>
              <dd className="font-semibold text-slate-900">{codes.length}개</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">PDF 페이지</dt>
              <dd className="font-semibold text-slate-900">라벨 1개 = 1페이지</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">페이지 크기</dt>
              <dd className="font-semibold text-slate-900">50×30mm</dd>
            </div>
          </dl>

          <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{status}</div>

          <div className="mt-5 space-y-2">
            <button type="button" onClick={generatePdf} className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              PDF 생성
            </button>
            <a
              href={pdfUrl ?? undefined}
              download={pdfFileName}
              aria-disabled={!pdfUrl}
              className={`block w-full rounded-md px-4 py-2.5 text-center text-sm font-semibold ${pdfUrl ? "bg-slate-900 text-white hover:bg-slate-800" : "pointer-events-none bg-slate-200 text-slate-400"}`}
            >
              PDF 다운로드
            </a>
            <button
              type="button"
              disabled={!pdfUrl}
              onClick={openPrintPreview}
              className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400"
            >
              인쇄하기
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

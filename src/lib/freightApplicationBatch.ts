import type {
  FreightApplication,
  FreightApplicationItem,
  FreightParseDiagnostics,
} from "../types/freightBarcodeRequest.ts";

const APPLICATION_NUMBER_PATTERN = /^\d{4,20}$/;

export function parseFreightApplicationNumberList(value: string): string[] {
  const rawValues = value
    .split(/[,，\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (rawValues.length === 0) {
    throw new Error("신청서 번호를 입력해주세요.");
  }

  const invalid = rawValues.find((entry) => !APPLICATION_NUMBER_PATTERN.test(entry));
  if (invalid) {
    throw new Error(`신청서 번호 ${invalid}은(는) 숫자 4~20자리로 입력해주세요.`);
  }

  return [...new Set(rawValues)];
}

export function getFreightApplicationNumbers(
  application: Pick<FreightApplication, "applicationNo" | "applicationNos" | "items">,
): string[] {
  const explicit = application.applicationNos?.filter(Boolean) ?? [];
  if (explicit.length > 0) return [...new Set(explicit)];

  const fromItems = application.items
    .map((item) => item.applicationNo?.trim() ?? "")
    .filter(Boolean);
  if (fromItems.length > 0) return [...new Set(fromItems)];

  try {
    return parseFreightApplicationNumberList(application.applicationNo);
  } catch {
    return application.applicationNo.trim() ? [application.applicationNo.trim()] : [];
  }
}

function combineDiagnostics(
  applications: FreightApplication[],
): FreightParseDiagnostics | undefined {
  const diagnostics = applications
    .map((application) => application.diagnostics)
    .filter((value): value is FreightParseDiagnostics => Boolean(value));
  if (diagnostics.length === 0) return undefined;

  return {
    parserMode: applications.length > 1 ? "batch" : diagnostics[0].parserMode,
    warnings: diagnostics.flatMap((entry) => entry.warnings),
    detectedCounts: diagnostics.reduce(
      (total, entry) => ({
        lines: total.lines + entry.detectedCounts.lines,
        itemLabels: total.itemLabels + entry.detectedCounts.itemLabels,
        urls: total.urls + entry.detectedCounts.urls,
        quantityLabels: total.quantityLabels + entry.detectedCounts.quantityLabels,
        orderNumbers: total.orderNumbers + entry.detectedCounts.orderNumbers,
      }),
      { lines: 0, itemLabels: 0, urls: 0, quantityLabels: 0, orderNumbers: 0 },
    ),
  };
}

function bindItemToApplication(
  item: FreightApplicationItem,
  applicationNo: string,
  applicationIndex: number,
  itemIndex: number,
): FreightApplicationItem {
  return {
    ...item,
    id: `freight-${applicationNo || `unknown-${applicationIndex + 1}`}-${item.rowNo}-${itemIndex + 1}`,
    applicationNo: applicationNo || item.applicationNo,
  };
}

export function combineFreightApplications(
  applications: FreightApplication[],
): FreightApplication {
  const applicationNos = [
    ...new Set(
      applications
        .flatMap((application) => getFreightApplicationNumbers(application))
        .filter(Boolean),
    ),
  ];
  const items = applications.flatMap((application, applicationIndex) => {
    const applicationNo =
      getFreightApplicationNumbers(application)[0] ?? application.applicationNo.trim();
    return application.items.map((item, itemIndex) =>
      bindItemToApplication(item, applicationNo, applicationIndex, itemIndex),
    );
  });

  return {
    applicationNo: applicationNos.join(", "),
    applicationNos,
    items,
    diagnostics: combineDiagnostics(applications),
  };
}

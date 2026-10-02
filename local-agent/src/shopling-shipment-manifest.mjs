import {
  listChromeTargets,
  shoplingTargets,
  withCdpTarget,
} from "./chrome-cdp.mjs";
import { extractTrackingCandidates } from "./shopling-unshipped-reconciliation.mjs";

const B12_PATH = "/order/dlvy_list.phtml";

function shipmentManifestProbe() {
  const clean = (value, limit = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const tables = Array.from(document.querySelectorAll("table"));
  const table = tables.find((candidate) => {
    const headers = Array.from(candidate.querySelectorAll("th")).map((cell) => clean(cell.textContent));
    return headers.some((header) => header.includes("택배사") && header.includes("송장번호"))
      && headers.some((header) => header.includes("샵플링주문번호"));
  });
  if (!table) return { error: "SHIPMENT_TABLE_NOT_FOUND", rows: [] };

  const rows = Array.from(table.rows).slice(1).map((row, rowIndex) => {
    const checkbox = row.querySelector('input[name="chk[]"]');
    const shoplingOrderNo = clean(checkbox?.value, 30);
    if (!shoplingOrderNo) return null;
    const status = clean(row.querySelector(`input[name="ord_status_${CSS.escape(shoplingOrderNo)}"]`)?.value, 20);
    const invoiceText = clean(row.cells[11]?.innerText, 160);
    const productLinks = Array.from(row.cells[12]?.querySelectorAll("a") || []);
    const shoplingProductCode = clean(productLinks[0]?.textContent, 40);
    const productText = clean(row.cells[13]?.innerText, 500);
    const quantityMatch = clean(row.cells[14]?.innerText, 80).match(/^([0-9,]+)/);
    return {
      sourceRowNumber: rowIndex + 1,
      selected: Boolean(checkbox.checked),
      shoplingOrderNo,
      orderStatus: status,
      invoiceText,
      shoplingProductCode,
      productText,
      quantity: quantityMatch ? Number(quantityMatch[1].replace(/,/g, "")) : null,
    };
  }).filter(Boolean);

  return {
    url: location.href,
    capturedAt: new Date().toISOString(),
    resultCount: Number(document.querySelector('input[name="srch_t_cnt"]')?.value || rows.length),
    filters: {
      startDate: clean(document.querySelector("#s_dt")?.value, 20),
      endDate: clean(document.querySelector("#e_dt")?.value, 20),
      courierStatus: clean(document.querySelector("#dlvy_status_tp")?.value, 20),
      rowCount: clean(document.querySelector("#row_cnt")?.value, 20),
      primarySort: clean(document.querySelector('select[name="sort_tp"]')?.value, 50),
      primaryDirection: clean(document.querySelector("#sort")?.value, 20),
      secondarySort: clean(document.querySelector('select[name="sort_tp_second"]')?.value, 20),
      secondaryDirection: clean(document.querySelector('select[name="sort_second"]')?.value, 20),
    },
    rows,
  };
}

export const SHOPLING_SHIPMENT_MANIFEST_EXPRESSION = `(${shipmentManifestProbe.toString()})()`;

export function selectShoplingB12Target(targets, origins) {
  const matches = shoplingTargets(targets || [], origins)
    .filter((target) => {
      try {
        return new URL(target.url).pathname === B12_PATH;
      } catch {
        return false;
      }
    });
  if (matches.length !== 1) {
    const error = new Error(`Expected one Shopling B12 page, found ${matches.length}.`);
    error.code = "SHOPLING_B12_TARGET_COUNT_INVALID";
    throw error;
  }
  return matches[0];
}

export function normalizeShipmentManifestCapture(captured, options = {}) {
  if (!captured || captured.error || !Array.isArray(captured.rows)) {
    const error = new Error(captured?.error || "Shopling B12 manifest capture failed.");
    error.code = captured?.error || "SHOPLING_B12_MANIFEST_CAPTURE_FAILED";
    throw error;
  }
  const status = String(options.status || "").trim();
  const selectedOnly = options.selectedOnly === true;
  const rejectedRows = [];
  const orders = captured.rows.flatMap((row) => {
    if (status && row.orderStatus !== status) return [];
    if (selectedOnly && !row.selected) return [];
    const invoiceCandidates = extractTrackingCandidates({ recognizedText: row.invoiceText });
    const invoiceNo = invoiceCandidates.length === 1 ? invoiceCandidates[0] : "";
    const quantity = Number(row.quantity);
    if (!invoiceNo || !row.shoplingOrderNo || !Number.isFinite(quantity) || quantity <= 0) {
      rejectedRows.push({
        sourceRowNumber: row.sourceRowNumber,
        shoplingOrderNo: String(row.shoplingOrderNo || ""),
        code: invoiceCandidates.length > 1
          ? "SHIPMENT_ROW_INVOICE_AMBIGUOUS"
          : "SHIPMENT_ROW_IDENTITY_INCOMPLETE",
      });
      return [];
    }
    return [{
      sourceRowNumber: row.sourceRowNumber,
      shoplingOrderNo: String(row.shoplingOrderNo),
      invoiceNo,
      bCode: "",
      quantity,
      shoplingProductCode: String(row.shoplingProductCode || ""),
      productName: String(row.productText || ""),
      optionName: "",
      orderStatus: String(row.orderStatus || ""),
    }];
  });
  return {
    schemaVersion: 1,
    capturedAt: captured.capturedAt,
    sourceUrl: captured.url,
    filters: captured.filters,
    sourceResultCount: captured.resultCount,
    selectedStatus: status || null,
    selectedOnly,
    orderCount: orders.length,
    rejectedRows,
    orders,
    privacy: {
      recipientNameStored: false,
      phoneStored: false,
      addressStored: false,
    },
  };
}

export async function captureShoplingShipmentManifest(config, options = {}, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const connect = dependencies.withCdpTarget || withCdpTarget;
  const listed = await listTargets(config);
  if (!listed.available) {
    const error = new Error(listed.error || "Chrome DevTools endpoint is unavailable.");
    error.code = "CHROME_DEBUG_UNAVAILABLE";
    throw error;
  }
  const target = selectShoplingB12Target(listed.targets, config.shoplingOrigins);
  const captured = await connect(target, async (session) => {
    const evaluated = await session.send("Runtime.evaluate", {
      expression: SHOPLING_SHIPMENT_MANIFEST_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    }, 15_000);
    if (evaluated.exceptionDetails) throw new Error("Shopling B12 manifest probe failed.");
    return evaluated.result?.value;
  });
  return normalizeShipmentManifestCapture(captured, options);
}

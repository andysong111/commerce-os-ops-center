import { requestOpsCenterJsonViaChrome } from "./ops-center-browser-transport.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function originFromConfig(config) {
  try {
    return new URL(config.opsOrigin).origin;
  } catch {
    fail("OPS_CENTER_ORIGIN_INVALID", "Ops Center 주소 설정이 올바르지 않습니다.");
  }
}

function requestHeaders(config, draftId, hasBody = false) {
  const origin = originFromConfig(config);
  const headers = {
    Accept: "application/json",
    Origin: origin,
    Referer: `${origin}/china-order-manager/drafts/${encodeURIComponent(draftId)}`,
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (config.vercelAutomationBypassSecret) {
    headers["x-vercel-protection-bypass"] = config.vercelAutomationBypassSecret;
  }
  return headers;
}

function parseBody(body, status, ok) {
  if (!ok || body?.ok !== true) {
    fail("OPS_CENTER_DRAFT_REQUEST_FAILED", body?.message || `Ops Center 발주초안 요청이 실패했습니다. (HTTP ${status})`, {
      status,
      code: body?.code || null,
    });
  }
  return body;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  return parseBody(body, response.status, response.ok);
}

function browserFallbackAllowed(error) {
  if (error?.code === "OPS_CENTER_DRAFT_REQUEST_FAILED") {
    return [401, 403].includes(Number(error?.details?.status));
  }
  return error instanceof TypeError
    || /fetch failed|network|econn|eacces|etimedout|socket|abort/i.test(String(error?.message || ""))
    || /^(EACCES|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)$/.test(String(error?.cause?.code || ""));
}

export function createOpsCenterDraftClient(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const browserRequest = dependencies.browserRequest || requestOpsCenterJsonViaChrome;
  const origin = originFromConfig(config);

  async function requestDraft(draftId, method, body = null) {
    const url = `${origin}/api/china-order-manager/drafts/${encodeURIComponent(draftId)}`;
    const headers = requestHeaders(config, draftId, body != null);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        ...(body == null ? {} : { body }),
        cache: "no-store",
      });
      return await parseResponse(response);
    } catch (error) {
      if (!browserFallbackAllowed(error)) throw error;
      const response = await browserRequest(config, {
        url,
        method,
        headers,
        body,
      }, dependencies.browserOptions || {});
      return parseBody(response.body, response.status, response.ok);
    }
  }

  async function loadDraft(draftId) {
    const body = await requestDraft(draftId, "GET");
    if (!body.draft || body.externalOrderExecuted !== false) {
      fail("OPS_CENTER_DRAFT_RESPONSE_INVALID", "Ops Center 발주초안 응답을 검증하지 못했습니다.");
    }
    return body.draft;
  }

  async function saveDraftLines(draftId, lines) {
    const body = await requestDraft(draftId, "PUT", JSON.stringify({ lines }));
    if (!body.draft || body.externalOrderExecuted !== false) {
      fail("OPS_CENTER_DRAFT_SAVE_RESPONSE_INVALID", "Ops Center 발주초안 저장 결과를 검증하지 못했습니다.");
    }
    return body.draft;
  }

  async function saveAndVerifyDraftLines(draftId, lines) {
    await saveDraftLines(draftId, lines);
    const verified = await loadDraft(draftId);
    const actualByBarcode = new Map(verified.lines.map((line) => [String(line.barcode), line]));
    for (const expected of lines) {
      const actual = actualByBarcode.get(String(expected.barcode));
      const same = actual
        && Number(actual.unitPriceCny) === Number(expected.unitPriceCny)
        && String(actual.freightGroupId || "") === String(expected.freightGroupId || "")
        && Number(actual.domesticChinaFreightCny) === Number(expected.domesticChinaFreightCny)
        && String(actual.note || "") === String(expected.note || "");
      if (!same) {
        fail("OPS_CENTER_DRAFT_READBACK_MISMATCH", "저장 후 발주초안의 실제 단가·운임을 다시 확인하지 못했습니다.", {
          barcode: expected.barcode,
        });
      }
    }
    return verified;
  }

  return { loadDraft, saveDraftLines, saveAndVerifyDraftLines };
}

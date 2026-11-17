const CLICK_START = "  async function clickModifySend() {";
const CLICK_END = "\n  function submitButton() {";

const TRUSTED_CLICK_IMPLEMENTATION = `  async function clickModifySend(assignment) {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title],[data-commerce-os-stock-legacy-action-label]';
    const resolved = [];
    for (const node of document.querySelectorAll(selector)) {
      if (!visible(node)) continue;
      const label = normalize([
        clickableText(node),
        node.getAttribute?.("alt") || "",
        node.getAttribute?.("title") || "",
        node.getAttribute?.("data-commerce-os-stock-legacy-action-label") || "",
      ].join(" "));
      if (!/상품\\s*수정전송/.test(label)) continue;
      const target = node instanceof HTMLImageElement
        ? node.closest("a,button,input,[onclick]") || node
        : node;
      if (!resolved.includes(target)) resolved.push(target);
    }
    if (resolved.length !== 1) {
      return {
        ok: false,
        code: resolved.length ? "A21_MODIFY_SEND_BUTTON_AMBIGUOUS" : "A21_MODIFY_SEND_BUTTON_NOT_FOUND",
        message: resolved.length
          ? \`상품 수정전송 단추가 \${resolved.length}개라 정확한 대상을 고르지 못했습니다.\`
          : "상품 수정전송 단추를 찾지 못했습니다.",
      };
    }

    const target = resolved[0];
    const onclick = normalize(target.getAttribute?.("onclick") || "");
    if (!/goods_mallMody_submit\\s*\\(/.test(onclick)) {
      return {
        ok: false,
        code: "A21_MODIFY_SEND_NATIVE_HANDLER_MISMATCH_HF86",
        message: "Shopling 원본 상품 수정전송 함수가 확인되지 않아 클릭하지 않았습니다.",
      };
    }

    const response = await chrome.runtime.sendMessage({
      type: "A21_TRUSTED_MODIFY_SEND_CLICK_HF86",
      jobId: String(assignment?.jobId || ""),
      runId: String(assignment?.runId || ""),
      stockProductKindHf48: String(assignment?.stockProductKindHf48 || ""),
      goodsKeyQuery: Array.isArray(assignment?.goodsKeys)
        ? assignment.goodsKeys.map(normalize).filter(Boolean).join(",")
        : "",
      expectedHandler: "goods_mallMody_submit",
    }).catch((error) => ({
      ok: false,
      code: "A21_TRUSTED_CLICK_CHANNEL_FAILED_HF86",
      message: normalize(error?.message || error || "신뢰 클릭 요청 실패"),
    }));

    if (
      response?.ok === true &&
      response?.trustedClick === true &&
      response?.popupObserved === true &&
      Number.isInteger(response?.popupTabId)
    ) {
      return {
        ok: true,
        code: "A21_MODIFY_SEND_TRUSTED_CLICK_POPUP_CONFIRMED_HF86",
        popupTabId: response.popupTabId,
      };
    }
    return {
      ok: false,
      code: response?.code || "A21_TRUSTED_CLICK_POPUP_NOT_CONFIRMED_HF86",
      message: response?.message || "Chrome 신뢰 클릭 뒤 실제 Shopling 수정전송 팝업을 확인하지 못했습니다.",
    };
  }
`;

export function patchHf86CanonicalListSource(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const start = normalized.indexOf(CLICK_START);
  const end = normalized.indexOf(CLICK_END, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("shopling_stock_hf86_click_function_missing");
  }

  const patched = `${normalized.slice(0, start)}${TRUSTED_CLICK_IMPLEMENTATION}${normalized.slice(end)}`
    .replace("const modifySend = await clickModifySend();", "const modifySend = await clickModifySend(assignment);");

  for (const guard of [
    'type: "A21_TRUSTED_MODIFY_SEND_CLICK_HF86"',
    'expectedHandler: "goods_mallMody_submit"',
    "response?.trustedClick === true",
    "response?.popupObserved === true",
    "A21_MODIFY_SEND_TRUSTED_CLICK_POPUP_CONFIRMED_HF86",
    "const modifySend = await clickModifySend(assignment);",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf86_canonical_guard_missing:${guard}`);
    }
  }
  return patched;
}

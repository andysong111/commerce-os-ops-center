function replaceOnce(source: string, before: string, after: string, code: string) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const normalizedBefore = before.replace(/\r\n?/g, "\n");
  const first = normalizedSource.indexOf(normalizedBefore);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (normalizedSource.indexOf(normalizedBefore, first + normalizedBefore.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${normalizedSource.slice(0, first)}${after}${normalizedSource.slice(first + normalizedBefore.length)}`;
}

export function patchHf74CanonicalListSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.1.6";',
    'const VERSION = "0.1.7";',
    "hf74_canonical_version",
  );

  next = replaceOnce(
    next,
    `  function clickModifySend() {
    const candidates = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]')]
      .filter((element) => /상품\\s*수정전송/.test(clickableText(element)));
    if (!candidates.length) return false;
    candidates[0].click();
    return true;
  }`,
    `  async function clickModifySend() {
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
    const token = \`stock-a21-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;
    const tokenAttribute = "data-commerce-os-stock-click-token";
    const requestEvent = "commerce-os-stock-main-click";
    const resultEvent = "commerce-os-stock-main-click-result";
    target.setAttribute(tokenAttribute, token);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener(resultEvent, onResult);
        target.removeAttribute(tokenAttribute);
        resolve(value);
      };
      const onResult = (event) => {
        if (normalize(event?.detail?.token) !== token) return;
        finish(event.detail?.ok
          ? { ok: true, code: "A21_MODIFY_SEND_MAIN_CLICKED" }
          : {
              ok: false,
              code: event.detail?.code || "A21_MODIFY_SEND_MAIN_CLICK_FAILED",
              message: event.detail?.message || "Shopling 본문 영역에서 상품 수정전송 단추를 누르지 못했습니다.",
            });
      };
      window.addEventListener(resultEvent, onResult);
      window.dispatchEvent(new CustomEvent(requestEvent, { detail: { token } }));
      window.setTimeout(() => finish({
        ok: false,
        code: "A21_MODIFY_SEND_MAIN_CLICK_TIMEOUT",
        message: "Shopling 본문 클릭 브리지 응답이 없어 상품 수정전송을 완료하지 못했습니다.",
      }), 4500);
    });
  }`,
    "hf74_canonical_main_world_modify_send",
  );

  next = replaceOnce(
    next,
    `    if (!clickModifySend()) return fail(assignment.jobId, "A21_MODIFY_SEND_BUTTON_NOT_FOUND", "상품 수정전송 버튼을 찾지 못했습니다.");`,
    `    const modifySend = await clickModifySend();
    if (!modifySend?.ok) {
      return fail(
        assignment.jobId,
        modifySend?.code || "A21_MODIFY_SEND_MAIN_CLICK_FAILED",
        modifySend?.message || "상품 수정전송 버튼을 Shopling 본문에서 누르지 못했습니다.",
      );
    }`,
    "hf74_canonical_await_main_world_modify_send",
  );

  next = replaceOnce(
    next,
    `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {`,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V017_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V017TestHooks = { clickModifySend };
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {`,
    "hf74_canonical_test_hook",
  );

  return replaceOnce(
    next,
    `          const key = \`${"${message.jobId}:${message.stage}"}\`;`,
    `          const key = \`${"${message.jobId}:${message.stage}:${Array.isArray(message.goodsKeys) ? message.goodsKeys.join(\",\") : \"\"}"}\`;`,
    "hf74_canonical_batch_dedupe",
  );
}

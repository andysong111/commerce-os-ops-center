(() => {
  const VERSION = "0.2.4";
  const CLAIM_MESSAGE = "A21_POPUP_CLAIM_V020";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const REQUEST_EVENT = "commerce-os-a21-v024-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-a21-v024-main-submit-response";
  const DELIVERY_NAME = "trsmt_env_mody_dlvyinfo";
  const GENERAL_NAMES = [
    "trsmt_env_mody_item_nm",
    "trsmt_env_mody_price",
    "trsmt_env_mody_ctg",
    "trsmt_env_mody_img",
    "trsmt_env_mody_fee",
    "trsmt_env_mody_desc",
    "trsmt_env_mody_keyword",
    "trsmt_env_mody_paysvc",
  ];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const isExactPopupUrl = () => String(location.pathname || "").toLowerCase() === TARGET_PATH.toLowerCase();
  let busy = false;

  function overlay() {
    let node = document.getElementById("commerce-os-a21-v024-status");
    if (node) return node;
    node = document.createElement("div");
    node.id = "commerce-os-a21-v024-status";
    node.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;max-width:420px;padding:10px 12px;border-radius:10px;background:#0f172a;color:#fff;font:12px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.25)";
    node.textContent = "Commerce OS v0.2.4 · 송신 작업 연결 대기";
    document.documentElement.appendChild(node);
    return node;
  }

  function status(text, tone = "dark") {
    const node = overlay();
    node.textContent = `Commerce OS v0.2.4 · ${text}`;
    node.style.background = tone === "ok" ? "#047857" : tone === "bad" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#0f172a";
  }

  function radios(name) {
    return [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  }

  function exactRadio(name, value) {
    return radios(name).find((item) => String(item.value ?? "") === String(value ?? "")) || null;
  }

  async function selectRadio(name, value) {
    const target = exactRadio(name, value);
    if (!(target instanceof HTMLInputElement) || target.type !== "radio" || target.disabled) return false;
    if (!target.checked) target.click();
    await sleep(35);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.checked && radios(name).every((peer) => peer === target || !peer.checked);
  }

  function verifyRadio(name, value) {
    const target = exactRadio(name, value);
    return Boolean(target?.checked) && radios(name).every((peer) => peer === target || !peer.checked);
  }

  function hiddenValues(name) {
    return [...document.querySelectorAll('input[type="hidden"]')]
      .filter((item) => item.name === name)
      .map((item) => String(item.value ?? ""));
  }

  function radioEvidence(radio) {
    if (!(radio instanceof HTMLInputElement)) return "";
    const chunks = [];
    if (radio.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === radio.id) chunks.push(label.textContent || "");
      }
    }
    const closestLabel = radio.closest("label");
    if (closestLabel) chunks.push(closestLabel.textContent || "");
    for (const sibling of [radio.previousSibling, radio.nextSibling, radio.previousElementSibling, radio.nextElementSibling]) {
      if (!sibling) continue;
      chunks.push(sibling.textContent || sibling.nodeValue || "");
    }
    const onclick = radio.getAttribute("onclick") || "";
    if (onclick) chunks.push(onclick);
    return norm(chunks.join(" | "));
  }

  function deliveryCandidates() {
    return radios(DELIVERY_NAME).map((radio) => {
      const evidence = radioEvidence(radio);
      const onclick = String(radio.getAttribute("onclick") || "");
      let score = 0;
      if (radio.dataset.commerceOsDeliveryUnchanged === "true") score += 120;
      if (/수정\s*안함|수정안함|변경\s*안함|변경안함/i.test(evidence)) score += 100;
      if (/dlvy_notice/i.test(onclick) || /dlvy_notice/i.test(evidence)) score += 80;
      if (String(radio.value ?? "") === "") score += 10;
      if (/수정\s*함|변경\s*함/i.test(evidence) && !/안함/i.test(evidence)) score -= 60;
      if (String(radio.value ?? "") === "Y") score -= 10;
      return { radio, evidence, score, value: String(radio.value ?? "") };
    });
  }

  function findDeliveryUnchanged() {
    const candidates = deliveryCandidates().sort((a, b) => b.score - a.score);
    const strong = candidates.find((row) => row.score >= 80);
    if (strong) return { ...strong, source: strong.evidence || `score:${strong.score}` };

    // 라벨/onclick이 노출되지 않는 Shopling 변형에서만 기존 form 계약(blank=수정안함)을 마지막 수단으로 사용한다.
    const blank = candidates.find((row) => row.value === "");
    const modify = candidates.find((row) => row.value === "Y");
    if (blank && modify && candidates.length === 2) {
      return { ...blank, source: "fallback:blank-paired-with-Y" };
    }
    return null;
  }

  function deliveryDiagnostics() {
    return deliveryCandidates().map((row) => ({
      value: row.value,
      checked: Boolean(row.radio.checked),
      evidence: row.evidence.slice(0, 160),
      score: row.score,
    }));
  }

  function forceDeliveryUnchanged() {
    const targetInfo = findDeliveryUnchanged();
    if (!targetInfo?.radio) {
      return { ok: false, evidence: "", diagnostics: deliveryDiagnostics() };
    }
    const peers = radios(DELIVERY_NAME);
    for (const peer of peers) peer.checked = peer === targetInfo.radio;
    targetInfo.radio.removeAttribute("onclick");
    try { targetInfo.radio.onclick = null; } catch { /* no-op */ }
    targetInfo.radio.dataset.commerceOsDeliveryUnchanged = "true";
    targetInfo.radio.dataset.commerceOsDeliveryEvidence = targetInfo.source || "";
    targetInfo.radio.dispatchEvent(new Event("input", { bubbles: true }));
    targetInfo.radio.dispatchEvent(new Event("change", { bubbles: true }));
    const checked = peers.filter((peer) => peer.checked);
    return {
      ok: checked.length === 1 && checked[0] === targetInfo.radio,
      evidence: targetInfo.source || "",
      value: String(targetInfo.radio.value ?? ""),
      diagnostics: deliveryDiagnostics(),
    };
  }

  function verifyDeliveryUnchanged() {
    const targetInfo = findDeliveryUnchanged();
    if (!targetInfo?.radio) return { ok: false, evidence: "", diagnostics: deliveryDiagnostics() };
    const checked = radios(DELIVERY_NAME).filter((peer) => peer.checked);
    return {
      ok: checked.length === 1 && checked[0] === targetInfo.radio,
      evidence: targetInfo.source || "",
      value: String(targetInfo.radio.value ?? ""),
      diagnostics: deliveryDiagnostics(),
    };
  }

  async function chooseMode(value) {
    const ok = await selectRadio("modify_tp", value);
    if (!ok) return false;
    await sleep(180);
    return verifyRadio("modify_tp", value);
  }

  async function configurePrice() {
    status("판매가 전송 form 설정 중");
    if (!await chooseMode("goods_normal")) return { ok: false, code: "V024_PRICE_MODE", message: "modify_tp=goods_normal 선택 실패" };
    const source = hiddenValues("tsmt_sale_price_tp");
    if (!source.length || source.some((value) => value !== "J")) {
      return { ok: false, code: "V024_PRICE_SOURCE", message: `tsmt_sale_price_tp가 J가 아닙니다: ${source.join(",") || "없음"}` };
    }
    for (const name of GENERAL_NAMES) {
      const expected = name === "trsmt_env_mody_price" ? "Y" : "";
      if (!await selectRadio(name, expected)) {
        return { ok: false, code: "V024_GENERAL_SELECT", message: `${name}=${expected || "(blank)"} 선택 실패` };
      }
    }
    const delivery = forceDeliveryUnchanged();
    if (!delivery.ok) {
      return {
        ok: false,
        code: "V024_DELIVERY_SELECT",
        message: `배송정보 '수정안함' 라디오를 실제 화면 기준으로 고정하지 못했습니다: ${JSON.stringify(delivery.diagnostics)}`,
      };
    }
    if (!verifyPrice()) return { ok: false, code: "V024_PRICE_VERIFY", message: "판매가만 수정 + 배송정보 수정안함 검증 실패" };
    return { ok: true, deliveryEvidence: delivery.evidence };
  }

  async function configureOption() {
    status("옵션 전송 form 설정 중");
    if (!await chooseMode("goods_stock")) return { ok: false, code: "V024_OPTION_MODE", message: "modify_tp=goods_stock 선택 실패" };
    await sleep(180);
    if (!await selectRadio("trsmt_env_mody_opt", "1")) return { ok: false, code: "V024_OPTION_SELECT", message: "trsmt_env_mody_opt=1 선택 실패" };
    if (!verifyOption()) return { ok: false, code: "V024_OPTION_VERIFY", message: "옵션송신 단독 검증 실패" };
    return { ok: true };
  }

  function verifyPrice() {
    if (!verifyRadio("modify_tp", "goods_normal")) return false;
    const source = hiddenValues("tsmt_sale_price_tp");
    if (!source.length || source.some((value) => value !== "J")) return false;
    if (!GENERAL_NAMES.every((name) => verifyRadio(name, name === "trsmt_env_mody_price" ? "Y" : ""))) return false;
    return verifyDeliveryUnchanged().ok;
  }

  function verifyOption() {
    return verifyRadio("modify_tp", "goods_stock") && verifyRadio("trsmt_env_mody_opt", "1");
  }

  function payloadExists() {
    const joined = [...document.querySelectorAll('input[type="hidden"]')].filter((item) => item.name === "prod_join_chk[]");
    return joined.length > 0 && joined.every((item) => /^\d+$/.test(String(item.value || "")));
  }

  async function sendFailure(jobId, code, message) {
    status(`중단 · ${message}`, "bad");
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function sendStage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
  }

  function mainSubmit(mode) {
    return new Promise((resolve) => {
      const nonce = `a21-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let settled = false;
      const cleanup = () => document.removeEventListener(RESPONSE_EVENT, onResponse);
      const onResponse = (event) => {
        let body = null;
        try { body = JSON.parse(String(event?.detail || "{}")); } catch { return; }
        if (body?.nonce !== nonce) return;
        settled = true;
        cleanup();
        resolve(body);
      };
      document.addEventListener(RESPONSE_EVENT, onResponse);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ nonce, mode }) }));
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ ok: false, error: "v024_main_bridge_timeout" });
      }, 5000);
    });
  }

  async function configureAndSubmit(assignment) {
    if (busy) return;
    busy = true;
    try {
      if (!isExactPopupUrl()) return sendFailure(assignment.jobId, "V024_POPUP_URL", `송신 URL 불일치: ${location.href}`);
      if (!payloadExists()) return sendFailure(assignment.jobId, "V024_PAYLOAD", "prod_join_chk[] 대상값이 없어 송신 차단");
      status(`${assignment.mode === "PRICE" ? "판매가" : "옵션"} assignment 수신`);
      const configured = assignment.mode === "PRICE" ? await configurePrice() : await configureOption();
      if (!configured.ok) return sendFailure(assignment.jobId, configured.code, configured.message);
      const valid = assignment.mode === "PRICE" ? verifyPrice() : verifyOption();
      if (!valid) return sendFailure(assignment.jobId, "V024_PRE_SUBMIT_VERIFY", "송신 직전 form 상태 검증 실패");

      const delivery = assignment.mode === "PRICE" ? verifyDeliveryUnchanged() : { ok: true, evidence: "" };
      status(
        `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 설정 완료 · 1.2초 후 MAIN world 원본송신${assignment.mode === "PRICE" ? " · 배송정보=수정안함" : ""}`,
        "ok",
      );
      await sendStage(
        assignment.jobId,
        "POPUP_CONFIG",
        `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 실제 form 값 검증 완료${assignment.mode === "PRICE" ? ` · 배송 수정안함(${delivery.evidence || "DOM"})` : ""}`,
      );
      await sleep(1200);

      if (assignment.mode === "PRICE") {
        const forced = forceDeliveryUnchanged();
        if (!forced.ok) return sendFailure(assignment.jobId, "V024_DELIVERY_CHANGED", "송신 직전 배송정보 수정안함 상태를 복구하지 못해 차단했습니다.");
      }
      const stillValid = assignment.mode === "PRICE" ? verifyPrice() : verifyOption();
      if (!stillValid) return sendFailure(assignment.jobId, "V024_CONFIG_CHANGED", "대기 중 form 상태가 바뀌어 송신 차단");

      status("MAIN world Shopling 원본 함수 호출", "warn");
      await sendStage(assignment.jobId, "SUBMIT_CLICKED", `${assignment.mode === "PRICE" ? "판매가" : "옵션"} · MAIN world 원본 송신 호출`);
      const response = await mainSubmit(assignment.mode);
      if (!response?.ok) return sendFailure(assignment.jobId, "V024_MAIN_SUBMIT_FAILED", `MAIN world 송신 실패: ${response?.error || "응답 없음"}`);
      if (assignment.mode === "PRICE" && response.deliveryInfoUnchanged !== true) {
        return sendFailure(assignment.jobId, "V024_DELIVERY_GUARD", "MAIN world에서 배송정보 수정안함 실화면 검증을 통과하지 못했습니다.");
      }
      status(`Shopling 원본 함수 실행 · 확인창 자동처리${response.sawDeliveryNotice ? " · 배송정보 유지" : ""}`, "ok");
      await sendStage(assignment.jobId, "RESULT_WAIT", "Shopling 수정전송 결과 추적 중 · 송신창 이동/닫힘 허용");
    } finally {
      busy = false;
    }
  }

  async function claim() {
    if (!isExactPopupUrl()) return;
    status("송신 작업 assignment 요청 중");
    const response = await chrome.runtime.sendMessage({ type: CLAIM_MESSAGE, role: "A21_POPUP", href: location.href, version: VERSION }).catch(() => null);
    if (!response?.ok || !response.assignment?.jobId) {
      status(`assignment 대기 · ${response?.error || "응답 없음"}`, "warn");
      return;
    }
    return configureAndSubmit(response.assignment);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        if (message?.type === "A21_IDENTIFY") return sendResponse({ ok: true, role: isExactPopupUrl() ? "A21_POPUP" : "OTHER", version: VERSION });
        if (message?.type === "A21_POPUP_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true, version: VERSION });
          await configureAndSubmit(message);
          return;
        }
        if (message?.type === "A21_POPUP_RESULT_ASSIGNMENT") return sendResponse({ ok: true, accepted: true, version: VERSION });
        sendResponse({ ok: false, error: "unsupported_message" });
      } catch (error) {
        if (message?.jobId) await sendFailure(message.jobId, "V024_CONTENT_EXCEPTION", error instanceof Error ? error.message : String(error));
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  overlay();
  setTimeout(() => void claim(), 120);
  window.addEventListener("load", () => setTimeout(() => void claim(), 220), { once: true });
})();
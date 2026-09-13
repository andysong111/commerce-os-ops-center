function replaceOne(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2) {
    throw new Error(`v0340 patch anchor missing/ambiguous: ${anchor.slice(0, 100)}`);
  }
  return source.replace(anchor, replacement);
}

function replaceSection(source: string, start: string, end: string, replacement: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0) {
    throw new Error(`v0340 section anchor missing/ambiguous: ${start.slice(0, 90)}`);
  }
  return source.slice(0, a) + replacement + source.slice(b);
}

function versioned(source: string) {
  return source
    .replaceAll("0.3.39", "0.3.40")
    .replaceAll("V0339", "V0340")
    .replaceAll("v0339", "v0340");
}

export function buildA18FrameStartV0340(input: Record<string, string>) {
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html", "recovery.mjs"]) {
    output[name] = versioned(output[name]);
  }

  // v0.3.40 changes only browser start routing. Keep the hardened v0.3.39
  // server watchdog semantics exactly as deployed: post-submit ambiguity never
  // returns to pending.
  let background = output["background-root.mjs"];
  background = replaceOne(
    background,
    'const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0340/status";',
    'const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0339/status";',
  );
  output["background-root.mjs"] = background;

  let content = output["content-group-canary.mjs"];
  content = replaceOne(
    content,
    `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || window.top !== window || !isProductListUi()) return false;
    if (message.type === SELECTED_START_MESSAGE) {
      startSelectedQueue(message.jobIds)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "selected_shopling_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));
      return true;
    }
    if (message.type === CONTROL_START_MESSAGE) {`,
    `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !isProductListUi()) return false;
    // Shopling A18 is rendered inside the admin shell on some sessions. The bulk
    // start message must be handled by the exact frame that owns the A18 DOM.
    if (message.type === SELECTED_START_MESSAGE) {
      startSelectedQueue(message.jobIds)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "selected_shopling_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));
      return true;
    }
    // The legacy one-product control action remains top-frame only.
    if (window.top !== window) return false;
    if (message.type === CONTROL_START_MESSAGE) {`,
  );
  output["content-group-canary.mjs"] = content;

  let popup = output["popup.js"];
  popup = replaceSection(
    popup,
    "function sendStart(tabId, jobIds) {",
    "function selectedJobIds() {",
    `function sendStartToFrame(tabId, frameId, jobIds) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, { type: START_MESSAGE, jobIds: jobIds }, { frameId: frameId }, function (response) {
      const lastError = chrome.runtime.lastError;
      resolve({
        ok: !lastError && response && response.ok === true,
        response: response || null,
        error: lastError ? String(lastError.message || lastError) : "",
      });
    });
  });
}

async function locateA18ProductFrame(tabId) {
  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: function () {
        function norm(value) { return String(value == null ? "" : value).normalize("NFKC").replace(/\\s+/g, " ").trim(); }
        const host = String(location.hostname || "");
        const path = String(location.pathname || "");
        const body = norm(document.body && (document.body.innerText || document.body.textContent || ""));
        const excluded = /\\/prodlinkage\\/goods_mallReg_(?:idChoice|preProdChoice)\\.phtml$/i.test(path)
          || /\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i.test(path);
        const isA18ProductList = host === "a.shopling.co.kr"
          && !excluded
          && /쇼핑몰\\s*상품등록(?:하기)?/i.test(body)
          && /쇼핑몰\\s*미등록\\s*검색/i.test(body);
        return { isA18ProductList: isA18ProductList, href: String(location.href || ""), top: window.top === window };
      },
    });
  } catch (error) {
    return { ok: false, error: "A18 프레임 탐색 실패: " + text(error && error.message ? error.message : error) };
  }
  const matches = (Array.isArray(frames) ? frames : []).filter(function (row) { return row && row.result && row.result.isA18ProductList === true; });
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length === 0
        ? "현재 탭에서 A18 쇼핑몰상품등록 화면을 찾지 못했습니다. A18 화면을 그대로 둔 채 다시 실행하세요. 원본 탭은 자동 새로고침하지 않습니다."
        : "A18 화면이 여러 프레임에서 감지되어 안전하게 시작하지 않았습니다.",
    };
  }
  return { ok: true, frameId: matches[0].frameId, href: matches[0].result.href, top: matches[0].result.top === true };
}

async function startWithA18Recovery(tab, jobIds) {
  const target = await locateA18ProductFrame(tab.id);
  if (!target.ok) return { ok: false, response: null, error: target.error };
  statusNode.textContent = target.top
    ? "A18 실행기에 직접 연결 중..."
    : "Shopling 내부 A18 프레임을 확인했습니다. 원본 화면 유지 상태로 연결 중...";
  const started = await sendStartToFrame(tab.id, target.frameId, jobIds);
  if (started.ok) return started;
  return {
    ok: false,
    response: started.response,
    error: text(started.error || (started.response && (started.response.message || started.response.error)) || "A18 프레임 실행기 시작 신호 실패"),
  };
}

`,
  );
  if (popup.includes("chrome.tabs.reload(")) {
    throw new Error("v0340_control_tab_reload_forbidden");
  }
  output["popup.js"] = popup;

  let html = output["popup.html"];
  html = html.replace(
    "최신 SEO 대량등록 중 fresh pending만 선택합니다. 최대 3상품/18채널씩 순차 병렬 처리하고 결과 프레임 성공을 서버 원장에 자동 마감합니다.",
    "최신 SEO 대량등록 중 fresh pending만 선택합니다. A18 내부 프레임에 직접 연결해 원본 화면을 새로고침하지 않고 최대 3상품/18채널씩 순차 병렬 처리합니다.",
  );
  output["popup.html"] = html;

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.40";
  manifest.description = "Shopling A18 내부 프레임을 직접 식별해 원본 관리자 탭을 reload하지 않고, 결과회수 보호를 유지한 채 fresh pending 상품을 최대 3상품/18채널씩 안전 대량전송합니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.40 · A18 프레임 직접연결";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.40\nA18 embedded-frame direct start; operator control tab is never auto-reloaded.\nReliable readback + bounded bulk from v0.3.39 retained.\n";
  output["README.txt"] = "v0.3.40 A18 FRAME DIRECT START\n- Shopling A18가 관리자 shell 내부 frame으로 렌더링되어도 실제 A18 DOM을 가진 frameId를 먼저 식별합니다.\n- 대량전송 시작 신호를 그 frame에 직접 보내며 원본 A18 탭을 chrome.tabs.reload로 새로고침하지 않습니다.\n- A18 프레임을 정확히 1개 찾지 못하면 아무 송신도 하지 않고 중단합니다.\n- v0.3.39의 결과 프레임 자동회수, post-submit confirm_needed 잠금, 최대 3상품/18채널 병렬 정책은 그대로 유지합니다.\n";

  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs"]) {
    new Function(output[name]);
  }
  return output;
}

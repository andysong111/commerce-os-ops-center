import { createServer } from "node:http";
import { runAlibaba1688CartStaging } from "./alibaba1688-cart-staging.mjs";
import { sanitizeError } from "./safe-json.mjs";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const MODES = new Set(["cost-capture", "cart-staging"]);
const running = new Map();

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function safeEmbeddedJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function page(response, input) {
  const title = input.mode === "cost-capture" ? "5-1 원가·운임 기록" : "5-2 장바구니 담기";
  const description = input.mode === "cost-capture"
    ? "실제 위안단가와 중국내 운임을 확인해 발주초안에 저장하고 예산을 다시 계산합니다."
    : "확정된 수량과 중국옵션이 1688 장바구니와 일치하도록 맞춥니다.";
  const payload = safeEmbeddedJson(input);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    "x-content-type-options": "nosniff",
  });
  response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px}.card{max-width:720px;margin:auto;background:white;border:1px solid #cbd5e1;border-radius:20px;padding:28px;box-shadow:0 18px 45px #0f172a1a}.bar{height:10px;background:#dbeafe;border-radius:99px;overflow:hidden}.bar>i{display:block;height:100%;width:20%;background:#1d4ed8;animation:p 1.2s infinite alternate}@keyframes p{to{width:92%}}.ok{color:#047857}.bad{color:#be123c}button{border:0;border-radius:10px;padding:12px 18px;background:#1d4ed8;color:white;font-weight:800;cursor:pointer}</style><main class="card"><small>COMMERCE OS · LOCAL 1688</small><h1>${title}</h1><p>${description}</p><div id="progress"><div class="bar"><i></i></div><p>1688 화면을 확인하고 있습니다. 이 창을 닫지 마세요.</p></div><div id="result"></div><script>const input=${payload};const progress=document.querySelector('#progress');const result=document.querySelector('#result');function add(tag,text,className){const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;result.append(element);return element;}function render(ok,message){result.replaceChildren();add('h2',ok?'완료':'확인 필요',ok?'ok':'bad');add('p',message||'처리 결과를 확인하지 못했습니다.');if(ok){const button=add('button','이 창 닫기');button.addEventListener('click',()=>window.close());}else{add('p','문제를 해결한 뒤 발주초안에서 같은 버튼을 다시 누르세요.');}}fetch('/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(async r=>({ok:r.ok,body:await r.json()})).then(({ok,body})=>{progress.hidden=true;render(ok,body.message);}).catch(()=>{progress.hidden=true;render(false,'Commerce OS 로컬 에이전트를 실행한 뒤 다시 시도하세요.');});</script></main></html>`);
}

function validOrigin(request, port) {
  const origin = String(request.headers.origin || "");
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

async function bodyJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 4_096) throw new Error("LOCAL_REQUEST_TOO_LARGE");
  }
  return JSON.parse(raw || "{}");
}

export function createPurchaseAutomationServer(config, dependencies = {}) {
  const run = dependencies.runAlibaba1688CartStaging || runAlibaba1688CartStaging;
  const configuredPort = config.purchaseAutomationPort === undefined
    ? 43_121
    : Number(config.purchaseAutomationPort);
  const server = createServer(async (request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : configuredPort;
    const host = String(request.headers.host || "");
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return json(response, 403, { ok: false, message: "로컬 요청만 허용합니다." });
    }
    const url = new URL(request.url || "/", `http://${host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "purchase-automation", externalOrderExecuted: false });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const input = { draftId: url.searchParams.get("draftId") || "", mode: url.searchParams.get("mode") || "" };
      if (!DRAFT_ID.test(input.draftId) || !MODES.has(input.mode)) {
        return json(response, 400, { ok: false, message: "발주초안 또는 업무 종류가 올바르지 않습니다." });
      }
      return page(response, input);
    }
    if (request.method === "POST" && url.pathname === "/run") {
      if (!validOrigin(request, port)) return json(response, 403, { ok: false, message: "로컬 작업 화면에서만 실행할 수 있습니다." });
      try {
        const input = await bodyJson(request);
        const draftId = String(input.draftId || "");
        const mode = String(input.mode || "");
        if (!DRAFT_ID.test(draftId) || !MODES.has(mode)) {
          return json(response, 400, { ok: false, message: "발주초안 또는 업무 종류가 올바르지 않습니다." });
        }
        const key = `${draftId}:${mode}`;
        const task = running.get(key) || run(config, { draftId, mode, execute: true }, {
          logger(event) { process.stdout.write(`${JSON.stringify({ event: "purchase_automation", draftId, mode, ...event })}\n`); },
        }).finally(() => running.delete(key));
        running.set(key, task);
        const result = await task;
        return json(response, 200, {
          ok: true,
          mode,
          message: mode === "cost-capture"
            ? "실제 위안단가와 중국내 운임을 저장했습니다. 발주초안으로 돌아가 최종 예산을 확인하세요."
            : "확정 수량과 중국옵션으로 장바구니를 맞췄습니다. 주문 제출과 결제는 실행하지 않았습니다.",
          externalOrderExecuted: false,
          checkoutSubmitted: false,
          paymentExecuted: false,
          stage: result.audit?.stage || null,
        });
      } catch (error) {
        const safe = sanitizeError(error, "PURCHASE_AUTOMATION_FAILED");
        return json(response, 409, { ok: false, code: safe.code, message: safe.message, externalOrderExecuted: false });
      }
    }
    return json(response, 404, { ok: false, message: "지원하지 않는 로컬 경로입니다." });
  });
  return server;
}

export function listenPurchaseAutomationServer(config, dependencies = {}) {
  const server = createPurchaseAutomationServer(config, dependencies);
  const port = config.purchaseAutomationPort === undefined
    ? 43_121
    : Number(config.purchaseAutomationPort);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

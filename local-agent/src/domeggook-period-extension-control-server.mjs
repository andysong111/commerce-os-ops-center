import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MIN_DEBUG_PORT = 9400;
const MAX_DEBUG_PORT = 9799;

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function html(response, value) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(value);
}

async function readJson(pathname) {
  try {
    return JSON.parse((await readFile(pathname, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeAccount(value) {
  const accountId = String(value?.accountId || "").trim();
  const scheduleTime = String(value?.scheduleTime || "").trim();
  const extensionDays = Number(value?.extensionDays);
  const debugPort = Number(value?.debugPort);
  if (!ACCOUNT_ID_PATTERN.test(accountId)) throw new Error("도매꾹 계정 설정의 아이디 형식이 올바르지 않습니다.");
  if (!TIME_PATTERN.test(scheduleTime)) throw new Error(`도매꾹 계정 ${accountId}의 실행시간이 올바르지 않습니다.`);
  if (!Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > 90) throw new Error(`도매꾹 계정 ${accountId}의 연장기간은 1~90일이어야 합니다.`);
  if (!Number.isInteger(debugPort) || debugPort < MIN_DEBUG_PORT || debugPort > MAX_DEBUG_PORT) throw new Error(`도매꾹 계정 ${accountId}의 로컬 포트가 올바르지 않습니다.`);
  return {
    accountId,
    scheduleTime,
    extensionDays,
    debugPort,
    enabled: value?.enabled !== false,
    liveExecution: value?.liveExecution === true,
  };
}

export function normalizeDomeggookControlSettings(value) {
  if (!Array.isArray(value?.accounts) || value.accounts.length < 1 || value.accounts.length > 12) {
    throw new Error("도매꾹 계정 설정은 1~12개여야 합니다.");
  }
  const accounts = value.accounts.map(normalizeAccount);
  const ids = new Set();
  const ports = new Set();
  for (const account of accounts) {
    const id = account.accountId.toLowerCase();
    if (ids.has(id)) throw new Error(`중복된 도매꾹 아이디입니다: ${account.accountId}`);
    if (ports.has(account.debugPort)) throw new Error(`중복된 도매꾹 로컬 포트입니다: ${account.debugPort}`);
    ids.add(id);
    ports.add(account.debugPort);
  }
  return { accounts, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null };
}

function defaultRunProcess(executable, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectRun(new Error("도매꾹 계정 실행 제한시간을 초과했습니다."));
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-20_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-20_000); });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(stderr.trim() || stdout.trim() || `도매꾹 실행이 종료코드 ${code}로 실패했습니다.`));
    });
  });
}

export function createDomeggookPeriodExtensionController(config, dependencies = {}) {
  const runProcess = dependencies.runProcess || defaultRunProcess;
  const root = resolve(dependencies.repoRoot || config.repoRoot);
  const dataRoot = resolve(dependencies.dataRoot || join(config.dataDir, "domeggook-period-extension"));
  const settingsPath = join(dataRoot, "settings.json");
  const runnerPath = join(root, "local-agent", "scripts", "run-domeggook-period-extension.ps1");
  let running = false;

  async function readState() {
    const settings = normalizeDomeggookControlSettings(await readJson(settingsPath));
    const receipts = await Promise.all(settings.accounts.map(async (account) => ({
      accountId: account.accountId,
      receipt: await readJson(join(dataRoot, account.accountId, "latest.json")),
    })));
    return { settings, receipts, running };
  }

  async function runAll() {
    if (running) {
      const error = new Error("도매꾹 전체 즉시실행이 이미 진행 중입니다.");
      error.code = "DOMEGGOOK_CONTROL_ALREADY_RUNNING";
      throw error;
    }
    running = true;
    const results = [];
    try {
      const { settings } = await readState();
      const accounts = settings.accounts.filter((account) => account.enabled && account.liveExecution);
      if (!accounts.length) throw new Error("실제 실행이 승인된 도매꾹 계정이 없습니다.");
      for (const account of accounts) {
        try {
          await runProcess("powershell.exe", [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", runnerPath,
            "-Days", String(account.extensionDays),
            "-AccountId", account.accountId,
            "-DebugPort", String(account.debugPort),
            "-Execute",
          ], { cwd: root, timeoutMs: 180_000 });
          results.push({ accountId: account.accountId, ok: true });
        } catch (error) {
          results.push({ accountId: account.accountId, ok: false, message: error instanceof Error ? error.message : "실행 실패" });
        }
      }
    } finally {
      running = false;
    }
    return {
      total: results.length,
      succeeded: results.filter((result) => result.ok).map((result) => result.accountId),
      failed: results.filter((result) => !result.ok).map((result) => result.accountId),
      results,
    };
  }

  return { readState, runAll };
}

function page(token) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>도매꾹 전체 즉시실행</title><style>
  :root{font-family:"Malgun Gothic","Segoe UI",sans-serif;color:#17211c;background:#eef2ef}body{margin:0}.wrap{width:min(880px,calc(100% - 32px));margin:40px auto}.card{background:#fff;border:1px solid #d9dfdb;border-radius:18px;padding:28px;box-shadow:0 16px 40px #17211c12}h1{margin:0 0 8px;font-size:28px}.muted{color:#66736c;line-height:1.6}.accounts{display:grid;gap:10px;margin:22px 0}.account{display:flex;justify-content:space-between;gap:12px;padding:14px;border:1px solid #d9dfdb;border-radius:12px}.run{border:0;border-radius:12px;background:#dc2626;color:#fff;font-weight:800;padding:13px 18px;font-size:15px}.run:disabled{opacity:.5}.link{margin-left:10px;color:#245c8d}.status{margin-top:18px;padding:14px;border-radius:12px;background:#f4f7f5;white-space:pre-line}.warn{color:#9a3412;font-weight:700}</style></head><body><main class="wrap"><section class="card"><p class="muted">Commerce OS · 이 Windows에서만 실행</p><h1>도매꾹 4개 계정 전체 즉시실행</h1><p class="muted">계정별로 순서대로 기간종료 상품을 연장하고, 실행 후 기간종료 목록을 다시 확인합니다. 한 계정이 실패해도 다음 계정은 계속합니다.</p><div id="accounts" class="accounts">불러오는 중...</div><p class="warn">실행하면 도매꾹 상품의 기간이 실제로 변경됩니다.</p><button id="run" class="run" type="button" disabled>전체 즉시실행</button><a class="link" href="https://commerce-os-ops-center.vercel.app/domeggook-period-extension">실행 이력 보기</a><div id="status" class="status" role="status">로컬 설정을 확인하는 중입니다.</div></section></main><script>
  const token=${JSON.stringify(token)}; const run=document.getElementById('run'); const status=document.getElementById('status'); const accounts=document.getElementById('accounts'); let state;
  async function load(){const response=await fetch('/api/state',{cache:'no-store'});const body=await response.json();if(!response.ok||body.ok!==true)throw new Error(body.message||'상태 확인 실패');state=body.state;accounts.innerHTML=state.settings.accounts.map(a=>'<div class="account"><strong>'+a.accountId+'</strong><span>매일 '+a.scheduleTime+' · '+a.extensionDays+'일 · '+(a.liveExecution?'실제 연장':'시험 실행')+'</span></div>').join('');run.disabled=state.running;status.textContent=state.running?'전체 즉시실행 진행 중입니다.':'실행 준비가 완료됐습니다.'}
  run.addEventListener('click',async()=>{const names=state.settings.accounts.filter(a=>a.enabled&&a.liveExecution).map(a=>a.accountId);if(!confirm(names.join(', ')+' 계정의 기간종료 상품을 지금 실제 연장할까요?'))return;run.disabled=true;status.textContent='계정별 전체 즉시실행 중입니다. Chrome 창을 닫지 마세요.';try{const response=await fetch('/api/run-all',{method:'POST',headers:{'x-commerce-os-token':token}});const body=await response.json();if(!response.ok||body.ok!==true)throw new Error(body.message||'전체 실행 실패');status.textContent='완료 · 성공 '+body.result.succeeded.length+'개 / 실패 '+body.result.failed.length+'개'+(body.result.failed.length?'\\n실패 계정: '+body.result.failed.join(', '):'');await load()}catch(error){status.textContent='실패 · '+error.message}finally{run.disabled=false}});load().catch(error=>{accounts.textContent='설정을 불러오지 못했습니다.';status.textContent='실패 · '+error.message});
  </script></body></html>`;
}

export async function createDomeggookPeriodExtensionControlServer(config, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port === 0 ? 0 : Number(options.port || 43122);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error("도매꾹 로컬 실행 화면은 localhost에만 열 수 있습니다.");
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error("도매꾹 로컬 실행 화면 포트가 올바르지 않습니다.");
  let origin = `http://${host === "::1" ? "[::1]" : host}:${port}`;
  const token = options.token || randomBytes(24).toString("hex");
  const controller = options.controller || createDomeggookPeriodExtensionController(config, options.dependencies);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", origin);
    try {
      if (request.method === "GET" && url.pathname === "/") return html(response, page(token));
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "commerce-os-domeggook-control" });
      if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, { ok: true, state: await controller.readState() });
      if (request.method === "POST" && url.pathname === "/api/run-all") {
        if (request.headers.origin !== origin || request.headers["x-commerce-os-token"] !== token) {
          return json(response, 403, { ok: false, code: "DOMEGGOOK_CONTROL_FORBIDDEN", message: "도매꾹 로컬 실행 화면에서만 실행할 수 있습니다." });
        }
        return json(response, 200, { ok: true, result: await controller.runAll() });
      }
      return json(response, 404, { ok: false, code: "DOMEGGOOK_CONTROL_NOT_FOUND" });
    } catch (error) {
      const conflict = error?.code === "DOMEGGOOK_CONTROL_ALREADY_RUNNING";
      return json(response, conflict ? 409 : 400, { ok: false, code: error?.code || "DOMEGGOOK_CONTROL_FAILED", message: error instanceof Error ? error.message : "도매꾹 로컬 실행 요청이 실패했습니다." });
    }
  });
  async function listen() {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, host, resolveListen);
    });
    const address = server.address();
    if (address && typeof address === "object") {
      origin = `http://${host === "::1" ? "[::1]" : host}:${address.port}`;
    }
    return { host, port, origin };
  }
  async function close() {
    if (!server.listening) return;
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
  return { server, listen, close, get origin() { return origin; }, token };
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { applyWorkQueue, emptyQueue, publicQueue } from "../shared/mobile-work-queue.mjs";
import { mobileAction, normalizeWorkRequest, UNPAID_ORDER_PHRASE } from "../shared/mobile-work-center.mjs";
import { createMobileWorkWorker, createWindowsWorkAdapter } from "../local-agent/mobile-work-center/worker.mjs";
import { createOndolPassAdapter, runInWorkCenter } from "../local-agent/mobile-work-center/ondolpass.mjs";

const start = Date.parse("2026-11-27T00:00:00Z");
const id = () => randomUUID();
const command = (actionId, values = {}) => ({ id: id(), actionId, issuedAt: start, execute: false, ...values });
const online = applyWorkQueue(emptyQueue(), {
  type: "poll", agent: { ready: true, busy: false, actions: ["connection-check", "full-operations", "1688-unpaid-order", "post-packing-invoices", "domeggook-withdrawal-execute"] }, canClaim: true,
}, start).state;
const poll = { type: "poll", agent: online.agent, canClaim: true };
const draftId = "fast-purchase-draft:0123456789abcdefabcd";
const json = (body, status = 200) => Response.json(body, { status });
const center = (extra = {}) => ({
  actions: [
    { id: "full-operations", mutates: true, requiresShoplingLogin: true },
    { id: "1688-cart-staging", mutates: true, requiresShoplingLogin: false },
  ],
  shoplingSession: { ready: true, matchedAccount: "fixture-account" },
  recentRuns: [],
  ...extra,
});

test("unknown actions, stale commands, live actions without confirmation and wrong order scope are rejected", () => {
  assert.equal(mobileAction("__proto__"), null);
  for (const candidate of [
    command("run-shell"),
    command("full-operations", { execute: true }),
    command("1688-payment-review", { execute: true, draftId }),
    command("domeggook-withdrawal-execute", { confirmed: true }),
    command("1688-unpaid-order", { execute: true, confirmed: true, draftId }),
    command("1688-unpaid-order", { execute: true, confirmed: true, draftId: "different", confirmation: UNPAID_ORDER_PHRASE }),
    command("post-packing-invoices", { invoiceNumbers: ["123456789012"], inventoryShortageInvoiceNumbers: ["123456789012"] }),
  ]) {
    assert.equal(normalizeWorkRequest(candidate), null);
  }
  const exact = command("1688-unpaid-order", { execute: true, confirmed: true, draftId, confirmation: UNPAID_ORDER_PHRASE, arbitrary: "drop me" });
  assert.deepEqual(normalizeWorkRequest(exact), Object.fromEntries(Object.entries(exact).filter(([key]) => key !== "arbitrary")));
  assert.equal(applyWorkQueue(online, { type: "enqueue", command: exact }, start + 121_000).code, "REQUEST_EXPIRED");
});

test("one queue claim de-identifies payload, preserves confirmation, and de-duplicates submission", () => {
  const action = command("post-packing-invoices", { execute: true, confirmed: true, invoiceNumbers: ["123456789012"], inventoryShortageInvoiceNumbers: [] });
  const queued = applyWorkQueue(online, { type: "enqueue", command: action }, start);
  assert.equal(queued.status, 202);
  assert.equal(applyWorkQueue(queued.state, { type: "enqueue", command: action }, start).status, 200);
  assert.equal(applyWorkQueue(queued.state, { type: "enqueue", command: { ...action, execute: false } }, start).code, "REQUEST_ID_REUSED");
  assert.equal(applyWorkQueue(queued.state, { type: "enqueue", command: command("full-operations") }, start).code, "JOB_ACTIVE");
  const claimed = applyWorkQueue(queued.state, poll, start);
  assert.deepEqual(claimed.command.invoiceNumbers, ["123456789012"]);
  assert.equal(claimed.command.confirmed, true);
  assert.equal(claimed.state.pending, null);
  assert.equal(JSON.stringify(publicQueue(claimed.state, start)).includes("123456789012"), false);
  assert.equal(applyWorkQueue(claimed.state, poll, start).command, undefined);
});

test("expired and ambiguous jobs are never executed again after connection loss", () => {
  const request = command("full-operations");
  assert.equal(applyWorkQueue(emptyQueue(), { type: "enqueue", command: request }, start).code, "PC_OFFLINE");
  const queued = applyWorkQueue(online, { type: "enqueue", command: request }, start).state;
  assert.equal(applyWorkQueue(queued, poll, start + 120_000).state.jobs[0].status, "expired");
  const running = applyWorkQueue(queued, poll, start).state;
  assert.equal(applyWorkQueue(running, { ...poll, canClaim: false }, start + 120_000).state.jobs[0].status, "running");
  const ambiguous = applyWorkQueue(running, poll, start + 120_000).state;
  assert.equal(ambiguous.jobs[0].status, "ambiguous");
  assert.equal(applyWorkQueue(ambiguous, { type: "enqueue", command: command("full-operations", { issuedAt: start + 120_000 }) }, start + 120_000).code, "JOB_ACTIVE");
  assert.equal(applyWorkQueue(ambiguous, { type: "acknowledge", id: id(), confirmed: true }, start + 120_000).status, 400);
  assert.equal(applyWorkQueue(ambiguous, { type: "acknowledge", id: request.id, confirmed: true }, start + 120_000).state.jobs[0].status, "acknowledged");
});

test("a finished picking list waits for an idle PC and claims task 4 exactly once with the original two lists", () => {
  const ticket = {id:id(), snapshotId:"pick-list", expiresAt:start+60_000, invoiceNumbers:["012345678901"],inventoryShortageInvoiceNumbers:["112345678901"]};
  const state = {...online,pickingInbox:[ticket]};
  const busy = {...poll,agent:{...online.agent,busy:true}};
  assert.equal(applyWorkQueue(state,busy,start).command,undefined);
  assert.equal(applyWorkQueue(state,{...poll,canClaim:false},start).command,undefined);
  const running = applyWorkQueue(state,poll,start);
  assert.deepEqual(running.command,normalizeWorkRequest({...ticket,issuedAt:start,actionId:"post-packing-invoices",execute:true,confirmed:true}));
  assert.equal(running.state.jobs[0].pickingSnapshotId,ticket.snapshotId);
  assert.equal(running.state.pickingInbox.length,0);
  assert.equal(applyWorkQueue(running.state,poll,start).command,undefined);
  assert.equal(JSON.stringify(publicQueue(running.state,start)).includes(ticket.invoiceNumbers[0]),false);
  const finished = applyWorkQueue(running.state,{type:"finish",id:ticket.id,status:"completed",code:"DONE"},start+1000);
  assert.equal(finished.state.jobs[0].pickingSnapshotId,ticket.snapshotId);
  const expired = applyWorkQueue(state,poll,ticket.expiresAt);
  assert.equal(expired.command,undefined);
  assert.equal(expired.state.jobs[0].status,"expired");
  const manual = applyWorkQueue(state,{type:"enqueue",command:command("full-operations")},start);
  assert.equal(applyWorkQueue(manual.state,poll,start).command.actionId,"full-operations");
  assert.deepEqual(manual.state.pickingInbox,[ticket]);
});

test("the Windows runId contract completes only on the original terminal receipt after one POST", async () => {
  let posts = 0;
  let ticks = 0;
  const adapter = createWindowsWorkAdapter({
    now: () => start + ticks,
    wait: async () => { ticks += 1000; },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/state")) {
        const receipt = { runId: ticks > 1000 ? "local-run" : "unrelated", actionId: "full-operations", status: "succeeded" };
        return json({ ok: true, state: center({ recentRuns: [receipt] }) });
      }
      if (url.endsWith("/")) return new Response(`let TOKEN = "${"a".repeat(48)}";`);
      assert.equal(url, "http://127.0.0.1:43121/api/actions/full-operations");
      assert.equal(options.headers["x-commerce-os-token"], "a".repeat(48));
      assert.equal(JSON.parse(options.body).execute, true);
      posts += 1;
      return json({ ok: true, run: { runId: "local-run", actionId: "full-operations" } }, 202);
    },
  });
  assert.deepEqual(await adapter.execute(command("full-operations", { execute: true, confirmed: true })), { status: "completed", code: "DONE" });
  assert.equal(posts, 1);
  assert.equal(ticks, 2000);
});

test("the original Windows needs_attention result blocks repeat live work", async () => {
  let ticks = 0;
  const adapter = createWindowsWorkAdapter({
    now: () => start + ticks,
    wait: async () => { ticks += 1000; },
    fetchImpl: async (url) => {
      if (url.endsWith("/api/state")) return json({ ok: true, state: center({
        recentRuns: [{ runId: "live-run", actionId: "full-operations", status: "needs_attention" }],
      }) });
      if (url.endsWith("/")) return new Response(`let TOKEN = "${"a".repeat(48)}";`);
      return json({ ok: true, run: { runId: "live-run", actionId: "full-operations" } }, 202);
    },
  });
  assert.deepEqual(await adapter.execute(command("full-operations", { execute: true, confirmed: true })), { status: "ambiguous", code: "CHECK_PC" });
  assert.equal(ticks, 1000);
});

test("a dropped live action response is held for review without replay", async () => {
  let posts = 0;
  const adapter = createWindowsWorkAdapter({ now: () => start, fetchImpl: async (url) => {
    if (url.endsWith("/api/state")) return json({ ok: true, state: center() });
    if (url.endsWith("/")) return new Response(`let TOKEN = "${"a".repeat(48)}";`);
    posts += 1;
    throw new Error("Lost response");
  } });
  assert.deepEqual(await adapter.execute(command("full-operations", { execute: true, confirmed: true })), { status: "ambiguous", code: "RESULT_UNCERTAIN" });
  assert.equal(posts, 1);
});

function mobileLoginFixture(phases, { disable = false, occupied = false, advanceBy = 10_000, dropAction = false } = {}) {
  const input = command("post-packing-invoices", {
    execute: true, confirmed: true, invoiceNumbers: ["123456789012"], inventoryShortageInvoiceNumbers: ["123456789013"],
  });
  const phasesSeen = [];
  const loginRequests = [];
  const businessRequests = [];
  let clock = start;
  let ready = false;
  const adapter = createWindowsWorkAdapter({
    now: () => clock,
    wait: async () => { clock += advanceBy; },
    fetchImpl: async (url, options) => {
      if (url.includes(":43122/")) return json({ ok: false }, 404);
      if (url.endsWith("/api/state")) return json({ ok: true, state: center({
        shoplingSession: { ready, matchedAccount: ready ? "fixture-account" : null }, settings: { shoplingAutoLoginEnabled: !disable }, shoplingAutoLogin: { credentialConfigured: true },
        actions: [{ id: input.actionId, mutates: true, requiresShoplingLogin: true }],
        pendingLoginAction: ready && occupied ? { actionId: input.actionId } : null,
        recentRuns: businessRequests.length ? [{ actionId: input.actionId, runId: "original", status: "succeeded" }] : [],
      }) });
      if (url.endsWith("/")) return new Response(`let TOKEN = "${"a".repeat(48)}";`);
      if (url.endsWith("/api/shopling/mobile-login")) {
        const body = JSON.parse(options.body);
        loginRequests.push(body);
        const phase = phases.shift();
        if (!phase) throw new Error("Lost authentication response");
        ready = phase === "ready";
        return json({ ok: true, requestId: phase === "wrong-id" ? id() : body.requestId, phase });
      }
      assert.equal(url, "http://127.0.0.1:43121/api/actions/post-packing-invoices");
      businessRequests.push(JSON.parse(options.body));
      if (dropAction) throw new Error("Lost business receipt");
      return json({ ok: true, run: { actionId: input.actionId, runId: "original" } });
    },
  });
  return { adapter, input, loginRequests, businessRequests, phasesSeen, run: () => adapter.execute(input, (phase) => phasesSeen.push(phase)) };
}

test("a restock SMS with an expired Shopling session requests only existing login recovery", async () => {
  const flow = mobileLoginFixture(["ready"]);
  await flow.adapter.requestShoplingSession(flow.input.id);
  await flow.adapter.requestShoplingSession(flow.input.id);
  assert.deepEqual(flow.loginRequests, [{ requestId: flow.input.id }]);
  assert.deepEqual(flow.businessRequests, []);
  const disabled = mobileLoginFixture([], { disable: true });
  await disabled.adapter.requestShoplingSession(disabled.input.id);
  assert.deepEqual(disabled.loginRequests, []);
});

test("a picking handoff reaches the existing task 4 PC endpoint once and records its original receipt", async () => {
  const flow = mobileLoginFixture(["captcha", "ready"]);
  const ticket = {
    id: id(), snapshotId: "current-picking", expiresAt: start + 60_000,
    invoiceNumbers: ["000000000011"], inventoryShortageInvoiceNumbers: ["000000000012"],
  };
  let state = { ...online, pickingInbox: [ticket] };
  const errors = [];
  const worker = createMobileWorkWorker({
    endpoint: "http://127.0.0.1:43289/api/mobile-work-center", agentToken: "a".repeat(43), adapter: flow.adapter,
    onError: message => errors.push(message),
    fetchImpl: async (_, init) => {
      const decision = applyWorkQueue(state, JSON.parse(init.body), start);
      state = decision.state ?? state;
      return json({ ok: decision.status < 400, command: decision.command }, decision.status);
    },
  });
  await worker.tick();
  assert.equal(state.jobs[0].status, "running");
  for (let pass = 0; pass < 5; pass += 1) {
    await new Promise(setImmediate);
    await worker.tick();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(flow.businessRequests, [{
    verifiedShoplingAccount: "fixture-account", execute: true, confirmed: true,
    invoiceNumbers: ticket.invoiceNumbers, inventoryShortageInvoiceNumbers: ticket.inventoryShortageInvoiceNumbers,
  }]);
  assert.deepEqual(flow.loginRequests, Array(2).fill({requestId: ticket.id}));
  assert.equal(state.jobs[0].status, "completed");
  assert.equal(state.jobs[0].code, "DONE");
  assert.equal(state.jobs[0].pickingSnapshotId, ticket.snapshotId);
  assert.equal(state.pickingInbox.length, 0);
});

test("a human Kakao answer resumes only the original mobile command, including both invoice groups", async () => {
  const flow = mobileLoginFixture(["captcha", "captcha", "ready"]);
  assert.deepEqual(await flow.run(), { status: "completed", code: "DONE" });
  assert.deepEqual(flow.phasesSeen, ["LOGIN_CHECKING", "KAKAO_CAPTCHA", "KAKAO_CAPTCHA", null]);
  assert.deepEqual(flow.loginRequests, Array(3).fill({ requestId: flow.input.id }));
  assert.deepEqual(flow.businessRequests, [{ verifiedShoplingAccount: "fixture-account", execute: true, confirmed: true,
    invoiceNumbers: flow.input.invoiceNumbers, inventoryShortageInvoiceNumbers: flow.input.inventoryShortageInvoiceNumbers }]);
});

test("manual or expired auth, a lost or mismatched reply, and PC contention never start a mobile task", async () => {
  for (const [phases, options, code] of [
    [["manual"], {}, "LOGIN_REQUIRED"], [["wrong-id"], {}, "LOGIN_REQUIRED"], [[], {}, "LOGIN_REQUIRED"],
    [["expired"], {}, "LOGIN_EXPIRED"], [["captcha"], { advanceBy: 4 * 60 * 60_000 }, "LOGIN_EXPIRED"],
    [["ready"], { occupied: true }, "AGENT_BUSY"], [["busy"], {}, "AGENT_BUSY"], [[], { disable: true }, "LOGIN_REQUIRED"],
  ]) {
    const flow = mobileLoginFixture(phases, options);
    assert.deepEqual(await flow.run(), { status: "needs_pc", code });
    assert.equal(flow.businessRequests.length, 0);
    if (options.disable) assert.equal(flow.loginRequests.length, 0);
  }
  const lost = mobileLoginFixture(["ready"], { dropAction: true });
  assert.deepEqual(await lost.run(), { status: "ambiguous", code: "RESULT_UNCERTAIN" });
  assert.equal(lost.businessRequests.length, 1);
});

test("only the current claimed mobile request can show or clear Kakao progress", () => {
  const request = command("full-operations");
  const queued = applyWorkQueue(online, { type: "enqueue", command: request }, start).state;
  const running = applyWorkQueue(queued, poll, start).state;
  const heartbeat = (state, requestId, code) => applyWorkQueue(state,
    { ...poll, canClaim: false, progress: { id: requestId, code } }, start + 1000).state ?? state;
  assert.equal(heartbeat(running, id(), "KAKAO_CAPTCHA").jobs[0].code, null);
  assert.equal(heartbeat(running, request.id, "private auth details").jobs[0].code, null);
  const waiting = heartbeat(running, request.id, "KAKAO_CAPTCHA");
  assert.equal(publicQueue(waiting, start + 1000).jobs[0].code, "KAKAO_CAPTCHA");
  assert.equal(waiting.jobs[0].status, "running");
  assert.equal(heartbeat(waiting, request.id, null).jobs[0].code, null);
});

test("a PC connection check traverses the same queue and worker without calling any write route", async () => {
  let state = online;
  const request = command("connection-check");
  state = applyWorkQueue(state, { type: "enqueue", command: request }, start).state;
  const seen = [];
  const adapter = createWindowsWorkAdapter({ now: () => start, fetchImpl: async (url, options) => {
    seen.push({ url, method: options.method });
    return url.endsWith(":43121/api/state") ? json({ ok: true, state: center() }) : json({ ok: false }, 404);
  } });
  const worker = createMobileWorkWorker({
    endpoint: "http://127.0.0.1:43289/api/mobile-work-center", agentToken: "a".repeat(43), adapter,
    fetchImpl: async (_, init) => {
      const decision = applyWorkQueue(state, JSON.parse(init.body), start);
      state = decision.state ?? state;
      return json({ ok: decision.status < 400, command: decision.command }, decision.status);
    },
  });
  await worker.tick();
  assert.equal(state.jobs[0].status, "running");
  for (let pass = 0; pass < 4 && state.jobs[0].status === "running"; pass += 1) {
    await new Promise(setImmediate);
    await worker.tick();
  }
  assert.equal(state.jobs[0].status, "completed");
  assert.equal(state.jobs[0].code, "PC_READY");
  assert.equal(seen.some(({ method }) => method === "POST"), false);
});

test("the extension can run only in one exact, loopback Chrome target", async () => {
  const target = { id: "good", type: "page", url: "http://127.0.0.1:43121/?draftId=x", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/good" };
  let calls = 0;
  const create = (targets) => createOndolPassAdapter({
    listTargets: async () => ({ targets }),
    withTarget: async (_, action) => action({ send: async () => { calls += 1; return { result: { value: { ready: true } } }; } }),
  });
  assert.equal((await create([target, target]).available()).ready, false);
  assert.equal((await create([{ ...target, webSocketDebuggerUrl: "ws://elsewhere:9222/devtools/page/good" }]).available()).ready, false);
  assert.equal((await create([target]).available()).ready, true);
  assert.equal(calls, 1);
});

test("the OnDolPass application accepts its own extension receipt and preserves the manual final submission", async () => {
  const methodCalls = [];
  const location = { origin: "http://127.0.0.1:43121", pathname: "/" };
  let listener;
  const window = {
    setTimeout, clearTimeout,
    addEventListener(_, handle) { listener = handle; },
    removeEventListener() { listener = null; },
    postMessage(input, target) {
      assert.equal(target, location.origin);
      assert.equal(input.type, "COMMERCE_OS_ONDOLPASS_RUN");
      assert.equal(input.plan.draftId, draftId);
      queueMicrotask(() => {
        const payload = { ok: true, applicationSubmitted: false };
        const message = { type: "COMMERCE_OS_ONDOLPASS_RESULT", requestId: input.requestId, source: "commerce-os-extension", payload };
        listener({ source: window, origin: location.origin, data: { ...message, requestId: "different-request" } });
        assert.equal(typeof listener, "function");
        listener({ source: window, origin: location.origin, data: message });
      });
    },
  };
  const globals = {
    location, window,
    browserWorkActive: () => false,
    requestOndolPassTrackingCapabilities: async () => ({ ok: true }),
    ondolPassRequestId: "",
    ondolPassTrackingRequestId: "",
    ondolPassTrackingCapabilityRequestId: "",
    request: async (route, options) => {
      methodCalls.push([route, JSON.parse(options.body)]);
      return { result: { draftId, lines: [{ q: 1 }] } };
    },
  };
  Object.assign(globalThis, globals);
  try {
    const outcome = await runInWorkCenter(command("ondolpass-application", { execute: true, confirmed: true, draftId }), 1000);
    assert.deepEqual(outcome, { status: "completed", code: "DONE" });
    assert.deepEqual(methodCalls, [["/api/ondolpass/prepare", { draftId }]]);
    assert.equal(globalThis.ondolPassRequestId, "");
  } finally {
    for (const name of Object.keys(globals)) delete globalThis[name];
  }
});

test("a partial withdrawal receipt locks the queue without another submit", async () => {
  const posts = [];
  const adapter = createWindowsWorkAdapter({
    now: () => start,
    fetchImpl: async (url, options) => {
      if (url.endsWith(":43121/api/state")) return json({ ok: true, state: center() });
      if (url.endsWith(":43122/api/work-center/state")) return json({ ok: true, state: { running: false, withdrawalRunning: false } });
      posts.push(url);
      assert.equal(options.headers.Origin, "http://127.0.0.1:43121");
      return json({ ok: true, result: { results: [{ ok: true }, { ok: true }, { ok: false }, { ok: true }], failed: ["third"] } });
    },
  });
  assert.deepEqual(await adapter.execute(command("domeggook-withdrawal-execute", { execute: true, confirmed: true })), { status: "ambiguous", code: "PARTIAL_RESULT" });
  assert.deepEqual(posts, ["http://127.0.0.1:43122/api/work-center/withdrawal/execute-all"]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildA19KeywordAuditV0346,
  SHOPLING_A19_KEYWORD_AUDITOR_V0346,
} from "../src/lib/shoplingMarketA19KeywordAuditV0346.ts";
import { SHOPLING_MARKET_AUTO_AGENT_V0330 } from "../src/lib/shoplingMarketAutoExtensionV0330.ts";
import { loadModule } from "./monthly-price-module.mjs";

const policy = loadModule("../src/lib/seoProhibitedKeywordPolicy.ts", {
  "@/lib/keywordExactProhibitedTerms": {
    OPS_PROHIBITED_KEYWORD_TERMS: ["한샘", "로또"],
  },
  "@/lib/supabase/admin": {
    createSupabaseAdminClient: async () => null,
  },
});

function fixture() {
  const value = {
    "manifest.json": JSON.stringify({
      version: "0.3.45",
      permissions: ["storage", "tabs"],
      content_scripts: [],
      action: { default_title: "v0.3.45" },
    }),
    "background-root.mjs": String.raw`
      const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
      async function marketAutoStorageGet() { return {}; }
      async function marketAutoStorageSet() { return true; }
      async function marketAutoAgentId() { return "agent"; }
      async function requestJson() { return {}; }
      function text(value) { return String(value || ""); }
      async function marketAutoRequest(action, token) {
        const agentId = await marketAutoAgentId();
        return requestJson("endpoint", {
          action,
          token,
          agentId,
        });
      }
      async function marketAutoTick() {
        const rows = [];
        for (const row of rows) {
          const response = {};
          if (response.ready === true && Array.isArray(response.jobIds) && response.jobIds.length) {
            return { ...response, token: row.token, ok: true };
          }
        }
        return { ok: true, ready: false };
      }
      async function marketAutoHeartbeat(token) { return token; }
      async function marketAutoReport(token) {
        const response = await marketAutoRequest("agent_report", token);
        return response;
      }
      function handler(message, sendResponse) {
        if (message.type === MARKET_AUTO_BG_REPORT) {
          const token = text(message.token);
          marketAutoReport(token).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
          return true;
        }
      }
    `.replace(/^ {6}/gm, ""),
    "shopling-market-auto-agent.mjs": String.raw`
      (() => {
        const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
        const ACTIVE_KEY = "active";
        function text(value) { return String(value || ""); }
        function terminalQueue() { return true; }
        async function send() { return { ok: true }; }
        async function get() { return {}; }
        async function set() { return true; }
        async function remove() { return true; }
        async function ensureIntent() { return true; }
        async function tick() {
          const stored = await get([ACTIVE_KEY]);
          const queue = stored.queue || null;
          const active = stored[ACTIVE_KEY] || null;
          if (active && active.token && active.orchestrationId) {
            const queueStartedAt = 0;
            const activeStartedAt = 0;
            if (queue && queueStartedAt >= activeStartedAt && terminalQueue(queue.status)) {
              const reported = await send({
                type: BG_REPORT,
                token: active.token,
                orchestrationId: active.orchestrationId,
                queueStatus: text(queue.status),
              });
              if (reported && reported.ok) {
                await remove(ACTIVE_KEY);
              }
              return;
            }
            await ensureIntent(active);
            return;
          }
          const claim = await send({});
          if (!claim || claim.ok !== true || claim.ready !== true) return;
          const jobIds = Array.isArray(claim.jobIds) ? claim.jobIds.map(text) : [];
          if (!jobIds.length) return;
          const next = {
            token: text(claim.token),
            orchestrationId: text(claim.orchestrationId),
            jobIds,
            startedAt: Date.now(),
            lastHeartbeatAt: Date.now(),
          };
          await set({ [ACTIVE_KEY]: next });
          await ensureIntent(next);
        }
        void tick;
      })();
    `.replace(/^ {6}/gm, ""),
  };
  value["shopling-market-auto-agent.mjs"] = SHOPLING_MARKET_AUTO_AGENT_V0330;
  return value;
}

test("extracts only Shopling A19 product-name or search-term prohibited words", () => {
  const result = policy.extractShoplingA19ProhibitedTerms(
    [
      { transmissionCode: "3385243", goodsKey: "123008", marketName: "스마트스토어", message: "[999] 등록이 불가능한 단어[넥밴드]가 상품명에 포함되어있습니다." },
      { transmissionCode: "3385244", goodsKey: "123008", marketName: "쿠팡", message: "등록이 불가능한 단어 [ 교정용 ] 이 검색어에 포함되어 있습니다." },
      { transmissionCode: "3385245", goodsKey: "123009", marketName: "토스쇼핑", message: "[999] 상품등록실패 : 토스쇼핑은 상품 옵션이 필수 입니다." },
      { transmissionCode: "3385246", goodsKey: "999999", marketName: "에이블리", message: "등록이 불가능한 단어[무관상품]가 상품명에 포함되어있습니다." },
    ],
    ["123008", "123009"],
  );
  assert.deepEqual(Array.from(result.terms), ["넥밴드", "교정용"]);
  assert.equal(result.evidence.length, 3);
  assert.equal(result.matchedEvidence.length, 2);
});

test("deduplicates normalized terms without treating unrelated A19 failures as keywords", () => {
  const result = policy.extractShoplingA19ProhibitedTerms([
    { transmissionCode: "1", goodsKey: "123008", marketName: "옥션", message: "등록이 불가능한 단어[ 넥밴드 ]가 상품명에 포함되어있습니다." },
    { transmissionCode: "2", goodsKey: "123008", marketName: "지마켓", message: "등록이 불가능한 단어[넥밴드]가 검색어에 포함되어있습니다." },
    { transmissionCode: "3", goodsKey: "123008", marketName: "에이블리", message: "커버 이미지가 없습니다." },
  ]);
  assert.deepEqual(Array.from(result.terms), ["넥밴드"]);
  assert.match(policy.shoplingA19EvidenceFingerprint(result.evidence), /^sha256:[0-9a-f]{64}$/);
});

test("v0.3.46 runs one A19 audit before terminal reporting and adds no retransmission", async () => {
  const builder = await readFile("src/lib/shoplingMarketA19KeywordAuditV0346.ts", "utf8");
  const output = buildA19KeywordAuditV0346(fixture());
  const manifest = JSON.parse(output["manifest.json"]);
  assert.equal(manifest.version, "0.3.46");
  assert.equal(
    manifest.content_scripts.filter((entry) =>
      entry.js?.includes("shopling-a19-keyword-auditor.mjs"),
    ).length,
    1,
  );
  for (const name of [
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
    "shopling-a19-keyword-auditor.mjs",
  ]) {
    new Function(output[name]);
  }
  assert.match(builder, /manifest\.version = "0\.3\.46"/);
  assert.match(builder, /shopling-a19-keyword-auditor\.mjs/);
  assert.match(SHOPLING_A19_KEYWORD_AUDITOR_V0346, /prod_join_chk\[\]/);
  assert.match(SHOPLING_A19_KEYWORD_AUDITOR_V0346, /goods_mallReg_failList\.phtml/);
  assert.match(builder, /marketAutoAuditA19/);
  assert.match(builder, /a19Evidence/);
  assert.match(builder, /a19AuditReceipt/);
  assert.match(builder, /a19_search_controls_missing/);
  assert.match(builder, /auditAndReport/);
  assert.match(builder, /reported\.terminal === true/);
  assert.doesNotMatch(SHOPLING_A19_KEYWORD_AUDITOR_V0346, /상품 재전송|일괄삭제|선택상태변경/);
});

test("server requires completed A19 evidence before orchestration terminal state", async () => {
  const server = await readFile("src/lib/shoplingMarketAutoOrchestrationServer.ts", "utf8");
  const route = await readFile("src/app/api/shopling-market-auto-orchestration/route.ts", "utf8");
  assert.match(server, /SHOPLING_A19_POST_MARKET_AUDIT_REQUIRED/);
  assert.match(server, /state: "market_ready"/);
  assert.doesNotMatch(server, /market_audit_ready|market_auditing/);
  assert.match(server, /extractShoplingA19ProhibitedTerms/);
  assert.match(server, /mergeSeoProhibitedKeywordPolicy/);
  assert.match(server, /SHOPLING_A19_AUDIT_RECEIPT_INVALID/);
  assert.match(route, /body\.a19Evidence/);
  assert.match(route, /body\.a19AuditReceipt/);
});

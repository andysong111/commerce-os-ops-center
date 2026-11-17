type ExtensionManifest = {
  version?: string;
  description?: string;
  action?: { default_title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

const AUTO_AGENT = "shopling-market-auto-agent.mjs";

function replaceExactly(
  source: string,
  anchor: string,
  replacement: string,
  expectedCount: number,
  code: string,
) {
  const count = source.split(anchor).length - 1;
  if (count !== expectedCount) throw new Error(`${code}:${count}`);
  return source.replace(anchor, replacement);
}

const RESUME_RUNNING_QUEUE_HELPER_V0348 = String.raw`  async function ensureRunningQueueResumeIntentV0348(queue) {
    const jobIds = Array.isArray(queue && queue.jobIds)
      ? [...new Set(queue.jobIds.map(text).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 100)
      : [];
    if (!jobIds.length) return false;

    const stored = await get([INTENT_KEY]);
    const intent = stored[INTENT_KEY] || null;
    const now = Date.now();
    const createdAt = Number(intent && intent.createdAt || 0);
    const age = now - createdAt;
    const recent = Number.isFinite(age) && age >= 0 && age < 90000;
    if (intent && intent.status === "pending" && recent) return false;

    const sameQueue = intent
      && intent.resumeRunningQueue === true
      && Number(intent.queueStartedAt || 0) === Number(queue.startedAt || 0);
    if (sameQueue && Number.isFinite(age) && age >= 0 && age < 30000) return false;

    await set({
      [INTENT_KEY]: {
        version: "0.3.48",
        status: "pending",
        jobIds,
        createdAt: now,
        resumeRunningQueue: true,
        queueStartedAt: Number(queue.startedAt || 0),
        reason: "resume_existing_running_queue",
      },
    });
    return true;
  }

`;

export function buildStaleQueueRecoveryV0348(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"] || "{}") as ExtensionManifest;
  if (manifest.version !== "0.3.47") throw new Error("v0348_wrong_base");
  if (!output[AUTO_AGENT]) throw new Error(`v0348_missing_asset:${AUTO_AGENT}`);

  let agent = replaceExactly(
    output[AUTO_AGENT],
    "  async function tick() {",
    `${RESUME_RUNNING_QUEUE_HELPER_V0348}  async function tick() {`,
    1,
    "v0348_tick_anchor",
  );
  agent = replaceExactly(
    agent,
    '      if (queue && queue.status === "running") return;\n      const claim = await send({ type: BG_TICK });',
    '      if (queue && queue.status === "running") {\n        await ensureRunningQueueResumeIntentV0348(queue);\n        return;\n      }\n      const claim = await send({ type: BG_TICK });',
    1,
    "v0348_running_queue_anchor",
  );

  if (/remove\s*\(\s*QUEUE_KEY/.test(agent)) {
    throw new Error("v0348_queue_clear_forbidden");
  }

  manifest.version = "0.3.48";
  manifest.description =
    "오래된 실행 중 마켓전송 큐를 삭제하거나 재전송하지 않고 기존 상품번호 그대로 A18 대사 화면에 복귀시켜, 종결 뒤 다음 원클릭 작업을 자동 인계합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.48 · 실행 중 큐 안전 복귀",
  };

  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output[AUTO_AGENT] = agent;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.48\nSafe running-queue A18 reconciliation recovery.\n";
  output["README.txt"] =
    "v0.3.48 RUNNING QUEUE SAFE RECOVERY\n" +
    "- 브라우저가 A18 밖에 있어 실행 중 큐가 멈추면 같은 jobIds로 A18 복귀 의도만 복원합니다.\n" +
    "- 기존 큐를 삭제·교체하지 않고 서버 원장 대사로 종결합니다.\n" +
    "- 기존 큐가 종결되기 전에는 새 원클릭 작업을 claim하거나 마켓전송하지 않습니다.\n" +
    "- v0.3.47의 A19 single-flight와 로그인 탭 폭증 차단을 그대로 유지합니다.\n";

  new Function(output[AUTO_AGENT]);
  return output;
}

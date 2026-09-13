/** Package boundary: optional title cleanup must never enqueue marketplace work. */
export const SEPARATED_TITLE_VERSION = "0.6.4";
export const SEPARATED_TITLE_FILENAME = "commerce-os-shopling-account-title-bridge-v0.6.4.zip";

export type ExtensionEntries = Record<string, Uint8Array>;
type Manifest = Record<string, unknown> & {
  content_scripts?: Array<Record<string, unknown> & { js?: string[] }>;
  background?: { service_worker?: string };
};

const REMOVED_FILES = [
  "content-shopling-pipeline.js",
  "content-shopling-pipeline-frame-bridge.js",
  "content-shopling-onebutton-stability-v054.js",
  "background-shopling-pipeline.js",
  "content-shopling-product-list-registry-bridge.js",
  "background-shopling-title-registry.js",
] as const;
const ROOT = "background-shopling-root.js";
const TITLE_BACKGROUND = "background-shopling-title-batch.js";
const TITLE_PAGE = "content-shopling-account-titles.js";
const TITLE_LIST = "content-shopling-product-list-batch.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function read(entries: ExtensionEntries, file: string): string {
  if (!entries[file]) throw new Error(`title_separation_missing_file:${file}`);
  return decoder.decode(entries[file]);
}

function once(source: string, before: string, after: string, label: string): string {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`title_separation_anchor_invalid:${label}`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

// This listener grants no marketplace permission and performs no network request.
// Old one-button tabs cannot authorize themselves against the new manual run.
const AUTHORIZE_MANUAL_PAGE = String.raw`
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "commerce-os-shopling-manual-title-v064-authorize") return false;
  chrome.storage.session.get("commerceOsShoplingTitleBatchRunV064").then((stored) => {
    const run = stored?.commerceOsShoplingTitleBatchRunV064;
    const allowed = Boolean(run && run.status === "running"
      && String(run.runId || "").startsWith("shopling-title-v064-")
      && run.runId === message.runId
      && run.currentGoodsKey === message.goodsKey
      && Number.isInteger(sender.tab?.id)
      && run.currentTabId === sender.tab.id
      && ["batch", "verify"].includes(run.phase));
    sendResponse({ ok: allowed });
  }).catch(() => sendResponse({ ok: false }));
  return true;
});
`;

const WORKER_AUTHORIZATION = String.raw`
    if (!runId.startsWith("shopling-title-v064-")) return;
    const authorization = await sendRuntimeMessage({
      type: "commerce-os-shopling-manual-title-v064-authorize", runId, goodsKey,
    });
    if (authorization?.ok !== true) return;
`;

const NOTICE = "선택 기능입니다. SEO 대량등록 클라우드·이전상품 SEO 클라우드의 29개 계정별 상품명은 다시 섞지 않아도 됩니다. 이 기능은 상품명만 저장하며 마켓으로 전송하지 않습니다.";
const CONFIRM = "현재 조회된 상품의 중복 상품명만 정리하고 Shopling에 저장합니다. SEO로 완성한 상품은 보통 실행할 필요가 없습니다. 마켓전송은 하지 않습니다. 계속할까요?";

/** Pure transformation of the generated v0.6.3 archive, before ZIP compression. */
export function separateShoplingTitleWorkflow(input: ExtensionEntries): ExtensionEntries {
  const entries: ExtensionEntries = { ...input };
  const manifest = JSON.parse(read(entries, "manifest.json")) as Manifest;
  if (manifest.version !== "0.6.3") throw new Error("title_separation_unreviewed_base_version");
  if (manifest.background?.service_worker !== ROOT) throw new Error("title_separation_background_changed");
  const removed = new Set<string>(REMOVED_FILES);
  manifest.version = SEPARATED_TITLE_VERSION;
  manifest.name = "Commerce OS Shopling Titles · 선택형 상품명 정리";
  manifest.short_name = "선택형 상품명 정리";
  manifest.description = "상품명 중복 정리는 직접 선택할 때만 실행합니다. SEO 29개 계정별 상품명은 보존하며 마켓전송과 분리됩니다. 기존 생애주기·가격 읽기 검증은 유지합니다.";
  manifest.content_scripts = (manifest.content_scripts ?? []).map((entry) => ({
    ...entry, js: (entry.js ?? []).filter((file) => !removed.has(file)),
  })).filter((entry) => entry.js.length > 0);

  let root = read(entries, ROOT);
  for (const file of ["background-shopling-pipeline.js", "background-shopling-title-registry.js"]) {
    root = once(root, `  "${file}",\n`, "", file);
  }
  entries[ROOT] = encoder.encode(root + "\n" + AUTHORIZE_MANUAL_PAGE);

  // Isolate manual jobs from the old combined pipeline, including an upgrade
  // while old batch tabs or local completion snapshots are still present.
  for (const file of [TITLE_BACKGROUND, TITLE_PAGE, TITLE_LIST]) {
    let source = read(entries, file);
    for (const value of [
      "commerce-os-shopling-title-batch-start",
      "commerce-os-shopling-title-batch-page",
      "commerce-os-shopling-title-batch-progress",
    ]) source = source.replaceAll(`"${value}"`, `"${value}-v064"`);
    for (const key of ["commerceOsShoplingTitleBatchRun", "commerceOsShoplingTitleBatchLastRun"]) {
      source = source.replaceAll(`"${key}"`, `"${key}V064"`);
    }
    if (file === TITLE_BACKGROUND) {
      source = once(source, "return `shopling-title-${Date.now()}", "return `shopling-title-v064-${Date.now()}", "manual_run_id");
    }
    if (file === TITLE_PAGE) {
      const anchor = '    const runId = params.get("commerce_os_run") || "";';
      source = once(source, anchor, anchor + "\n" + WORKER_AUTHORIZATION, "manual_worker_authorization");
      source = once(source, "  async function runManualSingle() {", `  async function runManualSingle() {\n    if (!window.confirm(${JSON.stringify(CONFIRM)})) return;`, "single_consent");
      source = source.replace('"Commerce OS · 계정별 상품명 분산"', '"선택 기능 · 계정별 상품명 정리 (전송 없음)"');
      source = source.replace('"같은 쇼핑몰 로그인 ID 중복은 Shopling 제목을 먼저 쓰고, 부족할 때 Commerce OS SEO 원장의 검증키워드만 보강합니다."', JSON.stringify(NOTICE));
    }
    if (file === TITLE_LIST) {
      source = once(source, "  async function runBatch() {", `  async function runBatch() {\n    if (!window.confirm(${JSON.stringify(CONFIRM)})) return;`, "batch_consent");
      source = source.replaceAll('"미분산 상품 일괄 처리"', '"선택 실행 · 상품명만 정리 (마켓전송 없음)"');
      source = source.replace('"Commerce OS · 조회상품 일괄 분산"', '"선택 기능 · 조회상품 상품명 정리"');
      source = once(source, "    box.append(title, status, button, detailHost);", `    const notice = document.createElement("p");\n    notice.textContent = ${JSON.stringify(NOTICE)};\n    notice.style.cssText = "font-size:11px;color:#64748b;margin:6px 0";\n    box.append(title, notice, status, button, detailHost);`, "manual_notice");
    }
    // Validate the exact downloadable code, not just historical source files.
    new Function(source);
    entries[file] = encoder.encode(source);
  }
  for (const file of REMOVED_FILES) delete entries[file];
  entries["manifest.json"] = encoder.encode(JSON.stringify(manifest, null, 2) + "\n");
  entries["VERSION.txt"] = encoder.encode(`Commerce OS Shopling optional title cleanup v${SEPARATED_TITLE_VERSION}\nMarketplace pipeline: excluded\n`);
  entries["README.txt"] = encoder.encode([
    "Commerce OS Shopling 선택형 상품명 정리 v0.6.4",
    "",
    "1. SEO 대량등록 / 이전상품 SEO 대량등록 상품은 상품명 정리를 다시 실행하지 않습니다.",
    "2. 마켓전송은 별도 Commerce OS Shopling Market Parallel 확장프로그램에서 시작합니다.",
    "3. 이 패키지에는 주황색 신규상품 원버튼·상품명 완료 후 마켓전송 실행기가 없습니다.",
    "4. 보라색 선택 기능은 현재 조회결과를 수집하고 확인창 승인 후 상품명만 정리·저장합니다.",
    "5. 기존 생애주기 판매상태 자동화·가격 읽기 검증은 유지됩니다.",
    "",
    "업데이트: 기존 0.6.3을 OFF하고 기존 자동 작업창을 정리한 뒤 이 폴더를 로드하세요.",
    "이전 버전과 새 버전을 동시에 켜지 마세요. 작업 중인 창에서 새로고침하지 마세요.",
    "서버의 claimed/submit_armed/sent/confirm_needed 원장은 이 업데이트가 변경하지 않습니다.",
    "재부팅 전 상품은 완료가 아닙니다. 송신 잠금·실행 상태를 대조해 별도로 재개해야 합니다.",
  ].join("\n") + "\n");

  new Function(read(entries, ROOT));
  for (const script of manifest.content_scripts ?? []) {
    for (const file of script.js ?? []) {
      if (!entries[file] || removed.has(file)) throw new Error(`title_separation_invalid_manifest_file:${file}`);
    }
  }
  return entries;
}

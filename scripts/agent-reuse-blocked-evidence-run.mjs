import { readFileSync, writeFileSync } from "node:fs";

const dockPath = "public/product-launch-tracker-app/detail-page-dock.js";
let dock = readFileSync(dockPath, "utf8");

const helperMarker = `async function enqueueSelected() {`;
const helper = `const REUSABLE_SOURCE_RUN_STAGES = new Set([\n  "source_collection",\n  "link_image_analysis",\n  "evidence_checkpoint",\n  "evidence_import",\n  "evidence_blocked",\n]);\n\nfunction reusableSourceRunId(item, mode = "auto") {\n  if (mode === "full") return "";\n  const automation = item?.detailPageAutomation;\n  if (!automation || automation.status !== "failed") return "";\n  const sourceRunId = cleanText(automation.sourceRunId, 200);\n  if (!sourceRunId) return "";\n  const stage = cleanText(automation.stage, 80);\n  return REUSABLE_SOURCE_RUN_STAGES.has(stage) ? sourceRunId : "";\n}\n\nasync function enqueueSelected() {`;
if (!dock.includes(helperMarker)) throw new Error("enqueue helper marker missing");
dock = dock.replace(helperMarker, helper);

const enqueueJobBefore = `      const job = {\n        itemId,\n        jobId: crypto.randomUUID(),\n        sourceUrl: readPrimaryChinaLink(item),\n        productName: String(item.productName || item.modelNumber || "상품"),\n        salesOptions: readSalesOptions(item),\n        attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,\n        sourceRunId: "",\n      };`;
const enqueueJobAfter = `      const persistedSourceRunId = reusableSourceRunId(item);\n      const job = {\n        itemId,\n        jobId: crypto.randomUUID(),\n        sourceUrl: readPrimaryChinaLink(item),\n        productName: String(item.productName || item.modelNumber || "상품"),\n        salesOptions: readSalesOptions(item),\n        attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,\n        sourceRunId: persistedSourceRunId,\n      };`;
if (!dock.includes(enqueueJobBefore)) throw new Error("enqueue job marker missing");
dock = dock.replace(enqueueJobBefore, enqueueJobAfter);

const enqueueStateBefore = `            stage: "source_collection",\n            message: "1688 상품정보·이미지 수집 대기 중",\n            progress: 1,\n            qaStatus: "pending",\n            sourceUrl: job.sourceUrl,\n            sourceRunId: "",`;
const enqueueStateAfter = `            stage: persistedSourceRunId ? "evidence_reuse" : "source_collection",\n            message: persistedSourceRunId\n              ? "저장된 1688 원본 재사용 · 분류 기준 재검사 대기 중"\n              : "1688 상품정보·이미지 수집 대기 중",\n            progress: persistedSourceRunId ? 5 : 1,\n            qaStatus: "pending",\n            sourceUrl: job.sourceUrl,\n            sourceRunId: job.sourceRunId,`;
if (!dock.includes(enqueueStateBefore)) throw new Error("enqueue state marker missing");
dock = dock.replace(enqueueStateBefore, enqueueStateAfter);

const retryJobBefore = `  const job = {\n    itemId: normalizedItemId,\n    jobId: crypto.randomUUID(),\n    sourceUrl,\n    productName: String(item.productName || item.modelNumber || "상품"),\n    salesOptions: readSalesOptions(item),\n    attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,\n    sourceRunId: "",\n  };`;
const retryJobAfter = `  const persistedSourceRunId = reusableSourceRunId(item, options.mode);\n  const job = {\n    itemId: normalizedItemId,\n    jobId: crypto.randomUUID(),\n    sourceUrl,\n    productName: String(item.productName || item.modelNumber || "상품"),\n    salesOptions: readSalesOptions(item),\n    attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,\n    sourceRunId: persistedSourceRunId,\n  };`;
if (!dock.includes(retryJobBefore)) throw new Error("retry job marker missing");
dock = dock.replace(retryJobBefore, retryJobAfter);

const retryStateBefore = `        stage: "source_collection",\n        message: "다시 생성 · 1688 수집 대기 중",\n        progress: 0,\n        qaStatus: "pending",\n        sourceUrl,\n        sourceRunId: "",`;
const retryStateAfter = `        stage: persistedSourceRunId ? "evidence_reuse" : "source_collection",\n        message: persistedSourceRunId\n          ? "저장된 1688 원본 재사용 · 분류 기준부터 다시 진행"\n          : "다시 생성 · 1688 수집 대기 중",\n        progress: persistedSourceRunId ? 5 : 0,\n        qaStatus: "pending",\n        sourceUrl,\n        sourceRunId: job.sourceRunId,`;
if (!dock.includes(retryStateBefore)) throw new Error("retry state marker missing");
dock = dock.replace(retryStateBefore, retryStateAfter);

const retryAnnouncementBefore = `    announceReviewRegeneration(options, "success", "전체 재생성 작업을 등록했습니다. 1688 원본 수집부터 다시 진행합니다.", created);`;
const retryAnnouncementAfter = `    announceReviewRegeneration(\n      options,\n      "success",\n      persistedSourceRunId\n        ? "저장된 1688 원본을 재사용합니다. 재수집 없이 분류 기준부터 다시 진행합니다."\n        : "전체 재생성 작업을 등록했습니다. 1688 원본 수집부터 다시 진행합니다.",\n      created,\n    );`;
if (!dock.includes(retryAnnouncementBefore)) throw new Error("retry announcement marker missing");
dock = dock.replace(retryAnnouncementBefore, retryAnnouncementAfter);

writeFileSync(dockPath, dock);

const testPath = "tests/productLaunchTrackerDetailPageDock.test.mjs";
let tests = readFileSync(testPath, "utf8");
const testMarker = `test("interrupted generation is recoverable instead of remaining permanently active", () => {`;
const newTest = `test("blocked local evidence runs are reused unless full recollection is explicitly requested", () => {\n  assert.match(dockSource, /function reusableSourceRunId/);\n  assert.match(dockSource, /REUSABLE_SOURCE_RUN_STAGES/);\n  assert.match(dockSource, /mode === "full"/);\n  assert.match(dockSource, /sourceRunId: persistedSourceRunId/);\n  assert.match(dockSource, /sourceRunId: job\\.sourceRunId/);\n  assert.match(dockSource, /저장된 1688 원본 재사용/);\n  assert.match(dockSource, /재수집 없이 분류 기준부터 다시 진행/);\n});\n\n${testMarker}`;
if (!tests.includes(testMarker)) throw new Error("test marker missing");
tests = tests.replace(testMarker, newTest);
writeFileSync(testPath, tests);

console.log("persisted evidence reuse installed");

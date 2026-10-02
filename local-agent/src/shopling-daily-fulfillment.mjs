import { join } from "node:path";
import { ensureDataDirs, readJsonFile, writeAgentState, writeJsonAtomic } from "./files.mjs";
import { createShoplingDailyBrowserAdapter } from "./shopling-daily-browser-adapter.mjs";
import { createShoplingLabelPdfFromSettings } from "./shopling-label-export.mjs";
import { runWindowsPdfPrint } from "./windows-pdf-printer.mjs";

export const SHOPLING_DAILY_STAGES = Object.freeze([
  "COLLECT_ORDER_CLAIM_QNA",
  "MAP_AND_CONFIRM",
  "MOVE_TO_READY",
  "PACKAGE_AND_TRANSMIT",
  "CREATE_AND_PRINT_LABELS",
]);

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateFulfillmentDate(value) {
  const date = String(value || "");
  if (!/^\d{8}$/.test(date)) throw codedError("Fulfillment date must use YYYYMMDD format.", "SHOPLING_DAILY_DATE_INVALID");
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw codedError("Fulfillment date is not a real calendar date.", "SHOPLING_DAILY_DATE_INVALID");
  }
  return date;
}

export function dailyFulfillmentCheckpointPath(config, date) {
  return join(config.dataDir, `shopling-daily-fulfillment-${validateFulfillmentDate(date)}.json`);
}

function stageRecord(status, result = null, error = null) {
  return {
    status,
    updatedAt: new Date().toISOString(),
    ...(result == null ? {} : { result }),
    ...(error == null ? {} : { error: { code: error.code || "SHOPLING_DAILY_STAGE_FAILED", message: String(error.message || error) } }),
  };
}

function initialCheckpoint(date, execute) {
  return {
    version: 1,
    date,
    mode: execute ? "execute" : "dry-run",
    status: "running",
    currentStage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: {},
  };
}

export async function runShoplingDailyFulfillment(config, options = {}, dependencies = {}) {
  const date = validateFulfillmentDate(options.date);
  const execute = options.execute === true;
  const print = options.print !== false;
  const resume = options.resume === true;
  await (dependencies.ensureDataDirs || ensureDataDirs)(config);
  const checkpointPath = dailyFulfillmentCheckpointPath(config, date);
  const readCheckpoint = dependencies.readJsonFile || readJsonFile;
  const writeCheckpoint = dependencies.writeJsonAtomic || writeJsonAtomic;
  const saved = resume ? await readCheckpoint(checkpointPath, null) : null;
  let checkpoint = saved?.date === date && saved?.mode === (execute ? "execute" : "dry-run")
    ? { ...saved, status: "running", updatedAt: new Date().toISOString() }
    : initialCheckpoint(date, execute);
  const adapter = dependencies.adapter || createShoplingDailyBrowserAdapter(config, { account: options.account || "andy801" }, dependencies.browserDependencies);
  const captureLabels = dependencies.createShoplingLabelPdfFromSettings || createShoplingLabelPdfFromSettings;
  const printLabels = dependencies.runWindowsPdfPrint || runWindowsPdfPrint;
  const updateAgentState = dependencies.writeAgentState || writeAgentState;

  const persist = async () => {
    checkpoint.updatedAt = new Date().toISOString();
    await writeCheckpoint(checkpointPath, checkpoint);
  };

  const runStage = async (stage, operation) => {
    if (resume && checkpoint.stages?.[stage]?.status === "succeeded") return checkpoint.stages[stage].result;
    checkpoint.currentStage = stage;
    checkpoint.stages[stage] = stageRecord("running");
    await persist();
    await updateAgentState(config, { currentAutomationStage: stage, lastErrorCode: null });
    try {
      const result = await operation();
      checkpoint.stages[stage] = stageRecord("succeeded", result);
      await persist();
      return result;
    } catch (error) {
      checkpoint.status = "failed";
      checkpoint.stages[stage] = stageRecord("failed", null, error);
      await persist();
      await updateAgentState(config, { currentAutomationStage: stage, lastErrorCode: error.code || "SHOPLING_DAILY_STAGE_FAILED" });
      throw error;
    }
  };

  const collection = await runStage(SHOPLING_DAILY_STAGES[0], () => adapter.collectAll({ execute }));
  const mapping = await runStage(SHOPLING_DAILY_STAGES[1], () => adapter.processMapping({ execute }));
  if (mapping.needsReview) {
    checkpoint.status = "needs_mapping_review";
    checkpoint.currentStage = SHOPLING_DAILY_STAGES[1];
    checkpoint.stages[SHOPLING_DAILY_STAGES[1]] = stageRecord("needs_review", mapping);
    await persist();
    await updateAgentState(config, { currentAutomationStage: "MAPPING_REVIEW_REQUIRED", lastErrorCode: null });
    return { status: checkpoint.status, checkpointPath, date, execute, collection, mapping };
  }

  const ready = await runStage(SHOPLING_DAILY_STAGES[2], () => adapter.moveNewOrdersToReady({ date, execute }));
  const transmission = await runStage(SHOPLING_DAILY_STAGES[3], () => adapter.transmitPending({ date, execute }));
  const batchOrderNumbers = transmission.completedOrderNumbers || [];
  const labels = await runStage(SHOPLING_DAILY_STAGES[4], async () => {
    const prepared = await adapter.prepareLabels({ date, execute, orderNumbers: batchOrderNumbers });
    if (!execute || !batchOrderNumbers.length || !print) {
      return { prepared, captured: null, printed: null, skipped: !batchOrderNumbers.length ? "no-orders" : !execute ? "dry-run" : "printing-disabled" };
    }
    const captured = await captureLabels(config, {
      expectedOrders: batchOrderNumbers.length,
      autoDetectPages: true,
      outputPath: options.outputPath,
    });
    const printed = await printLabels({
      pdfPath: captured.outputPath,
      expectedPages: captured.pageCount,
      execute: true,
      printerName: options.printerName,
      formName: options.formName,
    });
    return { prepared, captured, printed, skipped: null };
  });

  checkpoint.status = execute ? "completed" : "dry_run_completed";
  checkpoint.currentStage = "COMPLETE";
  await persist();
  await updateAgentState(config, { currentAutomationStage: "COMPLETE", lastErrorCode: null });
  return {
    status: checkpoint.status,
    checkpointPath,
    date,
    execute,
    collection,
    mapping,
    ready,
    transmission,
    labels,
  };
}

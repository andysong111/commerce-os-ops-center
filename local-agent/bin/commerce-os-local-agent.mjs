#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.mjs";
import { createDiagnosticPackage } from "../src/diagnostics.mjs";
import { ensureDataDirs, writeAgentState, writeLatestStatus } from "../src/files.mjs";
import { buildStatusSnapshot } from "../src/status.mjs";
import { createShoplingOrderPreflight } from "../src/shopling-order-preflight.mjs";
import { createShoplingLabelPdfFromSettings } from "../src/shopling-label-export.mjs";
import { uploadDiagnostic, uploadHeartbeat } from "../src/supabase-upload.mjs";
import { sanitizeError } from "../src/safe-json.mjs";
import { runWindowsPdfPrint } from "../src/windows-pdf-printer.mjs";

function parseArgs(argv) {
  const [command = "daemon", ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

async function recordHeartbeat(config) {
  let status = await buildStatusSnapshot(config);
  const upload = await uploadHeartbeat(config, status);
  status = { ...status, supabaseUpload: upload };
  if (upload.ok === false && !upload.skipped) {
    status.agent.lastErrorCode = upload.error?.code || "SUPABASE_UPLOAD_FAILED";
    await writeAgentState(config, { lastErrorCode: status.agent.lastErrorCode });
  }
  await writeLatestStatus(config, status);
  return status;
}

async function runStatus(config) {
  const status = await recordHeartbeat(config);
  console.log(JSON.stringify({
    event: "status",
    timestamp: status.timestamp,
    agentStatus: status.agent.status,
    stage: status.agent.currentAutomationStage,
    chromeRunning: status.chrome.running,
    shoplingTabs: status.shopling.tabCount,
  }));
}

async function runDiagnostic(config, flags) {
  const diagnostic = await createDiagnosticPackage(config, {
    goodsKey: flags.goodsKey || flags.goodskey || "",
    targetUrl: flags.url || "",
  });
  const upload = await uploadDiagnostic(config, diagnostic);
  if (upload.ok === false && !upload.skipped) {
    await writeAgentState(config, { lastErrorCode: upload.error?.code || "SUPABASE_UPLOAD_FAILED" });
  }
  console.log(JSON.stringify({
    event: "diagnostic",
    diagnosticId: diagnostic.diagnosticId,
    url: diagnostic.url,
    goodsKey: diagnostic.goodsKey,
    errors: diagnostic.errors,
    supabaseUpload: upload,
  }));
}

async function runOrderPreflight(config) {
  const preflight = await createShoplingOrderPreflight(config);
  console.log(JSON.stringify(preflight, null, 2));
}

async function runLabelPrint(config, flags) {
  const expectedPages = Number(flags.expectedPages);
  const expectedOrders = Number(flags.expectedOrders);
  if (!Number.isInteger(expectedPages) || expectedPages <= 0 || !Number.isInteger(expectedOrders) || expectedOrders <= 0) {
    const error = new Error("label-print requires positive --expected-orders and --expected-pages values.");
    error.code = "LABEL_PRINT_EXPECTED_COUNTS_REQUIRED";
    throw error;
  }
  const captured = await createShoplingLabelPdfFromSettings(config, {
    expectedOrders,
    expectedPages,
    outputPath: flags.output,
  });
  const printed = await runWindowsPdfPrint({
    pdfPath: captured.outputPath,
    expectedPages,
    execute: flags.execute === true,
    printerName: flags.printer,
    formName: flags.form,
  });
  console.log(JSON.stringify({
    event: "shopling_label_print",
    mode: flags.execute === true ? "execute" : "dry-run",
    captured,
    printed,
  }, null, 2));
}

async function runDaemon(config) {
  console.log(JSON.stringify({
    event: "agent_started",
    version: config.agentVersion,
    dataDir: config.dataDir,
    intervalMs: config.heartbeatIntervalMs,
  }));

  let stopped = false;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });

  while (!stopped) {
    try {
      const status = await recordHeartbeat(config);
      await writeAgentState(config, {
        currentAutomationStage: status.agent.currentAutomationStage,
        lastErrorCode: status.agent.lastErrorCode,
      });
      console.log(JSON.stringify({
        event: "heartbeat",
        timestamp: status.timestamp,
        agentStatus: status.agent.status,
        stage: status.agent.currentAutomationStage,
        chromeRunning: status.chrome.running,
        shoplingTabs: status.shopling.tabCount,
      }));
    } catch (error) {
      const safe = sanitizeError(error, "LOCAL_AGENT_HEARTBEAT_FAILED");
      await writeAgentState(config, { lastErrorCode: safe.code });
      console.error(JSON.stringify({ event: "heartbeat_failed", error: safe }));
    }
    await delay(config.heartbeatIntervalMs, undefined, { ref: true });
  }

  console.log(JSON.stringify({ event: "agent_stopped", timestamp: new Date().toISOString() }));
}

async function main() {
  const config = loadConfig();
  await ensureDataDirs(config);
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "status") return runStatus(config);
  if (command === "diagnose" || command === "diagnostic") return runDiagnostic(config, flags);
  if (command === "order-preflight" || command === "shopling-order-preflight") return runOrderPreflight(config);
  if (command === "label-print" || command === "shopling-label-print") return runLabelPrint(config, flags);
  if (command === "daemon" || command === "run") return runDaemon(config);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log("Usage: node local-agent/bin/commerce-os-local-agent.mjs [daemon|status|diagnose --goods-key GOODSKEY --url URL|order-preflight|label-print --expected-orders N --expected-pages N [--execute]]");
    return;
  }
  throw new Error(`Unknown local-agent command: ${command}`);
}

main().catch(async (error) => {
  const safe = sanitizeError(error, "LOCAL_AGENT_FATAL");
  try {
    const config = loadConfig();
    await ensureDataDirs(config);
    await writeAgentState(config, { lastErrorCode: safe.code });
  } catch {}
  console.error(JSON.stringify({ event: "fatal", error: safe }));
  process.exitCode = 1;
});

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function ensureDataDirs(config) {
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.diagnosticsDir, { recursive: true });
}

export async function readJsonFile(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function latestStatusPath(config) {
  return join(config.dataDir, "latest-status.json");
}

export function statePath(config) {
  return join(config.dataDir, "state.json");
}

export async function readAgentState(config) {
  return readJsonFile(statePath(config), {
    lastErrorCode: null,
    currentAutomationStage: "IDLE",
  });
}

export async function writeAgentState(config, patch) {
  const current = await readAgentState(config);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(statePath(config), next);
  return next;
}

export async function writeLatestStatus(config, status) {
  await ensureDataDirs(config);
  await writeJsonAtomic(latestStatusPath(config), status);
}

export async function writeDiagnosticFiles(config, diagnostic, screenshotBuffer = null) {
  await ensureDataDirs(config);
  const jsonPath = join(config.diagnosticsDir, `${diagnostic.diagnosticId}.json`);
  const screenshotPath = screenshotBuffer ? join(config.diagnosticsDir, `${diagnostic.diagnosticId}.png`) : null;
  const stored = screenshotPath ? { ...diagnostic, screenshotPath } : diagnostic;
  await writeJsonAtomic(jsonPath, stored);
  if (screenshotPath && screenshotBuffer) await writeFile(screenshotPath, screenshotBuffer);
  await writeJsonAtomic(join(config.diagnosticsDir, "latest-diagnostic.json"), stored);
  return { jsonPath, screenshotPath, diagnostic: stored };
}

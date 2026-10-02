import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const printerScript = resolve(moduleDir, "..", "scripts", "windows-pdf-print.py");
const bundledRoot = resolve(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");

export const DEFAULT_LABEL_PRINTER = "Xprinter XP-DT108B LABEL";
export const DEFAULT_LABEL_FORM = "대한통운 송장";
export const DEFAULT_LABEL_DPI = 203;

function printResultError(message, code = "LABEL_PRINT_RESULT_INVALID") {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateWindowsPdfPrintResult(output, options) {
  const expectedPages = Number(options.expectedPages);
  const printerName = options.printerName || DEFAULT_LABEL_PRINTER;
  const formName = options.formName || DEFAULT_LABEL_FORM;
  const executed = Boolean(options.execute);

  if (!output || Boolean(output.executed) !== executed) {
    throw printResultError("Printer helper returned an unexpected execution state.", "LABEL_PRINT_EXECUTION_STATE_INVALID");
  }
  if (Number(output.pageCount) !== expectedPages) {
    throw printResultError("Printer helper returned an unexpected page count.", "LABEL_PRINT_PAGE_COUNT_INVALID");
  }
  if (output.printer !== printerName) {
    throw printResultError("Printer helper used an unexpected printer.", "LABEL_PRINT_PRINTER_INVALID");
  }
  if (output.form?.name !== formName) {
    throw printResultError("Printer helper used an unexpected paper form.", "LABEL_PRINT_FORM_INVALID");
  }
  if (Math.abs(Number(output.form?.widthMm) - 109) > 0.5 || Math.abs(Number(output.form?.heightMm) - 127) > 0.5) {
    throw printResultError("Printer helper returned an unexpected paper size.", "LABEL_PRINT_FORM_SIZE_INVALID");
  }
  if (Math.abs(Number(output.printerCaps?.physicalWidthMm) - 109) > 2
    || Math.abs(Number(output.printerCaps?.physicalHeightMm) - 127) > 2) {
    throw printResultError("Printer driver did not accept the expected physical label size.", "LABEL_PRINT_DRIVER_SIZE_INVALID");
  }
  if (executed && (!Number.isInteger(Number(output.jobId)) || Number(output.jobId) <= 0)) {
    throw printResultError("Printer helper did not return a valid spool job id.", "LABEL_PRINT_JOB_ID_INVALID");
  }
  return output;
}

export function resolvePrintRuntime(env = process.env, exists = existsSync) {
  const pythonCandidates = [
    env.COMMERCE_OS_PYTHON,
    resolve(bundledRoot, "python", "python.exe"),
    "python",
  ].filter(Boolean);
  const pdftoppmCandidates = [
    env.COMMERCE_OS_PDFTOPPM,
    resolve(bundledRoot, "native", "poppler", "Library", "bin", "pdftoppm.exe"),
    "pdftoppm",
  ].filter(Boolean);
  const find = (candidates) => candidates.find((candidate) => candidate === "python" || candidate === "pdftoppm" || exists(candidate));
  return { python: find(pythonCandidates), pdftoppm: find(pdftoppmCandidates) };
}

export function buildWindowsPdfPrintArgs(options) {
  const expectedPages = Number(options.expectedPages);
  if (!Number.isInteger(expectedPages) || expectedPages <= 0) {
    const error = new Error("A positive expected page count is required for label printing.");
    error.code = "LABEL_PRINT_EXPECTED_PAGES_REQUIRED";
    throw error;
  }
  if (!options.pdfPath) {
    const error = new Error("A PDF path is required for label printing.");
    error.code = "LABEL_PRINT_PDF_REQUIRED";
    throw error;
  }
  if (!options.pdftoppm) {
    const error = new Error("A Poppler pdftoppm executable is required for label printing.");
    error.code = "LABEL_PRINT_PDFTOPPM_REQUIRED";
    throw error;
  }
  const args = [
    printerScript,
    "--pdf", resolve(options.pdfPath),
    "--printer", options.printerName || DEFAULT_LABEL_PRINTER,
    "--form", options.formName || DEFAULT_LABEL_FORM,
    "--expected-pages", String(expectedPages),
    "--render-dpi", String(options.renderDpi || DEFAULT_LABEL_DPI),
    "--pdftoppm", options.pdftoppm,
  ];
  if (options.execute) args.push("--execute");
  return args;
}

export async function runWindowsPdfPrint(options, dependencies = {}) {
  if (process.platform !== "win32" && !dependencies.allowNonWindows) {
    const error = new Error("Direct label printing is available only on Windows.");
    error.code = "LABEL_PRINT_WINDOWS_REQUIRED";
    throw error;
  }
  const runtime = dependencies.runtime || resolvePrintRuntime(options.env);
  if (!runtime.python || !runtime.pdftoppm) {
    const error = new Error("The bundled Python or Poppler runtime is unavailable.");
    error.code = "LABEL_PRINT_RUNTIME_MISSING";
    throw error;
  }
  const args = buildWindowsPdfPrintArgs({ ...options, pdftoppm: runtime.pdftoppm });
  const execute = dependencies.execFile || execFileAsync;
  const { stdout } = await execute(runtime.python, args, {
    windowsHide: true,
    timeout: options.timeoutMs || 300_000,
    maxBuffer: 1024 * 1024,
  });
  const output = JSON.parse(String(stdout || "{}"));
  return validateWindowsPdfPrintResult(output, options);
}

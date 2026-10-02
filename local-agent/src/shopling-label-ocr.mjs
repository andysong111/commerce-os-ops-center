import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { extractTrackingCandidates } from "./shopling-unshipped-reconciliation.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_TESSERACT = "C:/Program Files/Tesseract-OCR/tesseract.exe";
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);

export function resolveTesseractExecutable(env = process.env, exists = existsSync) {
  const candidates = [env.COMMERCE_OS_TESSERACT, DEFAULT_TESSERACT, "tesseract"].filter(Boolean);
  return candidates.find((candidate) => candidate === "tesseract" || exists(candidate)) || "";
}

export function assertSupportedLabelImage(imagePath, exists = existsSync) {
  const resolved = resolve(String(imagePath || ""));
  if (!imagePath || !exists(resolved)) {
    const error = new Error("Label image was not found.");
    error.code = "LABEL_IMAGE_NOT_FOUND";
    throw error;
  }
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extname(resolved).toLowerCase())) {
    const error = new Error("Label image format is not supported.");
    error.code = "LABEL_IMAGE_FORMAT_UNSUPPORTED";
    throw error;
  }
  return resolved;
}

export function buildTesseractArgs(imagePath, pageSegmentationMode = 11) {
  return [
    resolve(imagePath),
    "stdout",
    "-l", "eng",
    "--psm", String(pageSegmentationMode),
    "-c", "tessedit_char_whitelist=0123456789- ",
  ];
}

export async function recognizeLabelTrackingNumbers(imagePath, options = {}, dependencies = {}) {
  const exists = dependencies.exists || existsSync;
  const resolvedImage = assertSupportedLabelImage(imagePath, exists);
  const executable = options.tesseractPath || resolveTesseractExecutable(options.env, exists);
  if (!executable) {
    const error = new Error("Local Tesseract OCR is unavailable.");
    error.code = "LABEL_OCR_TESSERACT_MISSING";
    throw error;
  }

  const execute = dependencies.execFile || execFileAsync;
  const modes = options.pageSegmentationModes || [1, 11, 6];
  const texts = [];
  for (const mode of modes) {
    const result = await execute(executable, buildTesseractArgs(resolvedImage, mode), {
      windowsHide: true,
      timeout: options.timeoutMs || 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    texts.push(String(result.stdout || ""));
  }

  const recognizedText = texts.join("\n");
  return {
    engine: "LOCAL_TESSERACT",
    fileName: basename(resolvedImage),
    passCount: modes.length,
    trackingCandidates: extractTrackingCandidates({ recognizedText }),
    recognizedText,
  };
}

export async function createLabelObservationFromImage(imagePath, metadata = {}, dependencies = {}) {
  const ocr = await recognizeLabelTrackingNumbers(imagePath, metadata, dependencies);
  return {
    imageId: String(metadata.imageId || ocr.fileName),
    fileName: ocr.fileName,
    expectedLabelCount: metadata.expectedLabelCount ?? 1,
    reason: metadata.reason || "UNSPECIFIED",
    stockoutBCodes: metadata.stockoutBCodes || [],
    trackingCandidates: ocr.trackingCandidates,
    recognizedText: ocr.recognizedText,
    ocrEngine: ocr.engine,
    ocrPassCount: ocr.passCount,
  };
}

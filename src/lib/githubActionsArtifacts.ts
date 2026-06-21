import { inflateRawSync } from "node:zlib";
import type { EngineRunnerConfig, EngineRunnerKind } from "./engineRunnerTypes";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

const EXPECTED_FILES = {
  keyword_engine: [
    "keyword_mvp_approval_sheet.csv",
    "keyword_mvp_manual_candidates.csv",
    "keyword_mvp_summary.md",
  ],
  detail_page_engine: [
    "detailpage_final.html",
    "detailpage_render_report.json",
    "multi_source_summary.json",
  ],
} as const;

const OPTIONAL_FILES = {
  keyword_engine: [
    "keyword_mvp_result.csv",
    "keyword_mvp_result.json",
    "keyword_mvp_auto_promotion_audit.csv",
  ],
  detail_page_engine: [] as string[],
} as const;

export type ArtifactExtractionResult = {
  files: Record<string, string>;
  missingFiles: string[];
  skippedFiles: string[];
  generatedSourceFiles?: string[];
  foundSafeFiles: string[];
};

type ArtifactDownloadConfig = Pick<EngineRunnerConfig, "repoOwner" | "repoName"> & { token: string };

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function downloadWorkflowArtifact(
  config: ArtifactDownloadConfig,
  artifactId: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
    throw new Error("Invalid GitHub Actions artifact id.");
  }

  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/artifacts/${artifactId}/zip`;
  const response = await fetch(apiUrl, { headers: githubHeaders(config.token) });
  if (!response.ok) {
    throw new Error(`GitHub Actions artifact download failed with HTTP ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new Error("GitHub Actions artifact zip is larger than the safe preview limit.");
  }
  return bytes;
}

function normalizeSafeEntryName(name: string) {
  if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\\")) return null;
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === "")) return null;
  const normalized = parts.join("/");
  const basename = parts.at(-1) ?? "";
  if (!basename) return null;
  return normalized;
}

function allowedBasename(entryName: string, allowlist: Set<string>) {
  const basename = entryName.split("/").at(-1) ?? "";
  return allowlist.has(basename) ? basename : null;
}

function unsupportedLayoutMessage(expected: readonly string[]) {
  return `산출물 ZIP 구조를 읽을 수 없습니다. 예상 파일이 ZIP 안에 있는지 확인해 주세요. 예상 파일: ${expected.join(", ")}`;
}

function readUInt16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeEntry(method: number, compressed: Uint8Array): Uint8Array {
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new Error("Unsupported zip compression method.");
}

export function extractExpectedArtifactFiles(kind: EngineRunnerKind, zipBytes: Uint8Array): ArtifactExtractionResult {
  const expected = EXPECTED_FILES[kind];
  if (!expected) throw new Error("Unsupported engine runner kind.");

  const allowlist = new Set<string>([...expected, ...OPTIONAL_FILES[kind]]);
  const files: Record<string, string> = {};
  const skippedFiles: string[] = [];
  const generatedSourceFiles: string[] = [];
  const foundSafeFiles: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let offset = 0;

  while (offset + 30 <= zipBytes.byteLength && readUInt32(zipBytes, offset) === 0x04034b50) {
    const flags = readUInt16(zipBytes, offset + 6);
    const method = readUInt16(zipBytes, offset + 8);
    const compressedSize = readUInt32(zipBytes, offset + 18);
    const uncompressedSize = readUInt32(zipBytes, offset + 22);
    const nameLength = readUInt16(zipBytes, offset + 26);
    const extraLength = readUInt16(zipBytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags & 0x08 || dataEnd > zipBytes.byteLength) {
      throw new Error(unsupportedLayoutMessage(expected));
    }
    const entryName = decoder.decode(zipBytes.slice(nameStart, nameStart + nameLength));
    const safeEntryName = normalizeSafeEntryName(entryName);
    if (!safeEntryName) {
      skippedFiles.push(entryName || "unsafe-entry");
    } else if (kind === "detail_page_engine" && safeEntryName.startsWith("generated_source/") && !safeEntryName.endsWith("/")) {
      foundSafeFiles.push(safeEntryName);
      generatedSourceFiles.push(safeEntryName);
    } else {
      foundSafeFiles.push(safeEntryName);
      const basename = allowedBasename(safeEntryName, allowlist);
      if (basename) {
        if (Object.hasOwn(files, basename)) {
          throw new Error("동일한 산출물 파일이 여러 위치에서 발견되었습니다. 안전을 위해 가져오기를 중단했습니다.");
        }
        if (uncompressedSize > MAX_TEXT_FILE_BYTES) {
          throw new Error(`Artifact file ${basename} is larger than the safe preview limit.`);
        }
        const inflated = decodeEntry(method, zipBytes.slice(dataStart, dataEnd));
        if (inflated.byteLength > MAX_TEXT_FILE_BYTES) {
          throw new Error(`Artifact file ${basename} is larger than the safe preview limit.`);
        }
        files[basename] = decoder.decode(inflated);
      }
      else if (!safeEntryName.endsWith("/")) {
        skippedFiles.push(safeEntryName);
      }
    }
    offset = dataEnd;
  }

  return {
    files,
    missingFiles: expected.filter((file) => !Object.hasOwn(files, file)),
    skippedFiles,
    generatedSourceFiles: kind === "detail_page_engine" ? generatedSourceFiles : undefined,
    foundSafeFiles,
  };
}

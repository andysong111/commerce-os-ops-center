import { unzipSync } from "fflate";
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

const unreadableZipMessage = "GitHub Actions 산출물 ZIP을 읽지 못했습니다. artifact가 손상되었거나 지원하지 않는 ZIP 형식일 수 있습니다.";


type ZipEntries = Record<string, Uint8Array>;

function unzipArtifact(zipBytes: Uint8Array): ZipEntries {
  try {
    return unzipSync(zipBytes);
  } catch {
    throw new Error(unreadableZipMessage);
  }
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
  const entries = unzipArtifact(zipBytes);

  for (const [entryName, entryBytes] of Object.entries(entries)) {
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
        if (entryBytes.byteLength > MAX_TEXT_FILE_BYTES) {
          throw new Error(`Artifact file ${basename} is larger than the safe preview limit.`);
        }
        files[basename] = decoder.decode(entryBytes);
      }
      else if (!safeEntryName.endsWith("/")) {
        skippedFiles.push(safeEntryName);
      }
    }
  }

  return {
    files,
    missingFiles: expected.filter((file) => !Object.hasOwn(files, file)),
    skippedFiles,
    generatedSourceFiles: kind === "detail_page_engine" ? generatedSourceFiles : undefined,
    foundSafeFiles,
  };
}

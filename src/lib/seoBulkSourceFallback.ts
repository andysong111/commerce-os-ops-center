import { validate1688Url, type KeywordElonSourceDraft } from "./keywordEngineElonLabV2.ts";

export type SeoBulkCollectionMode = "1688_server" | "shopling_fallback" | "tracker_fallback";
export type SeoBulkSeedInput = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  optionText?: string;
  supportingText?: string;
  mallTitleCategory?: string;
  shoplingGoodsKeys?: string[];
};
export type SeoBulkShoplingSourceLoader = (
  input: SeoBulkSeedInput,
) => Promise<KeywordElonSourceDraft | null>;
export type SeoBulkCollectedSource = { source: KeywordElonSourceDraft; mode: SeoBulkCollectionMode };

export function seoBulkSourceLabel(mode: unknown) {
  if (mode === "1688_server") return "1688 원본";
  if (mode === "shopling_fallback") return "샵플링 등록 데이터";
  if (mode === "tracker_fallback") return "상품출시관리 데이터";
  return "";
}

export function normalizeSeoBulkCollectionMode(mode: unknown): SeoBulkCollectionMode {
  return mode === "1688_server" || mode === "shopling_fallback" ? mode : "tracker_fallback";
}

function usable(source: KeywordElonSourceDraft | null): source is KeywordElonSourceDraft {
  return Boolean(source && source.autoStatus !== "failed" &&
    (source.chineseTitle?.trim() || source.optionText?.trim()));
}

/** Only source collection is recoverable here; later identity/quality/safety errors still fail closed. */
export async function collectSeoBulkSourceChain(
  input: SeoBulkSeedInput,
  dependencies: {
    collect1688: (url: string) => Promise<KeywordElonSourceDraft>;
    collectShopling?: SeoBulkShoplingSourceLoader;
    trackerFallback: (input: SeoBulkSeedInput) => KeywordElonSourceDraft;
  },
): Promise<SeoBulkCollectedSource> {
  if (!input.launchItemId.trim()) throw new Error("출시 상품 ID가 없습니다.");
  const warnings: string[] = [];
  if (validate1688Url(input.sourceUrl)) {
    try {
      const source = await dependencies.collect1688(input.sourceUrl);
      if (usable(source) && !source.warnings.some((warning) =>
        /1688 HTTP [45]\d\d|1688 밖으로 리디렉션|품절·로그인·접근제한/.test(warning),
      )) return { source, mode: "1688_server" };
      warnings.push("BULK_1688_SOURCE_EMPTY");
    } catch {
      warnings.push("BULK_1688_SOURCE_FAILED");
    }
  } else {
    warnings.push("BULK_1688_SOURCE_MISSING_OR_INVALID");
  }

  if (dependencies.collectShopling) {
    try {
      const source = await dependencies.collectShopling(input);
      if (usable(source)) {
        return {
          source: { ...source, warnings: [...warnings, ...source.warnings, "BULK_SHOPLING_SOURCE_FALLBACK"] },
          mode: "shopling_fallback",
        };
      }
      warnings.push("BULK_SHOPLING_SOURCE_NOT_FOUND");
    } catch (error) {
      // Never persist credentials, response bodies or arbitrary exception messages in the public RUN result.
      const code = error instanceof Error ? error.message : "";
      warnings.push(/^BULK_SHOPLING_[A-Z_]+$/.test(code) ? code : "BULK_SHOPLING_SOURCE_UNAVAILABLE");
    }
  }

  const source = dependencies.trackerFallback(input);
  if (!usable(source)) {
    throw new Error("SEO 씨드가 부족합니다. 1688·샵플링 원본을 찾지 못했고 상품출시관리 상품명·옵션도 비어 있습니다.");
  }
  return {
    source: { ...source, warnings: [...warnings, ...source.warnings] },
    mode: "tracker_fallback",
  };
}

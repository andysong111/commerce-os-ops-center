const WAREHOUSE_LOCATION_REVIEW_MODELS = [
  "AAA028",
  "AAA035",
  "AAA052",
  "AAA076",
  "AAA081",
  "AAA099",
  "AAA104",
  "AAA108",
  "AAA112",
  "AAA118",
  "AAA132",
  "AAA136",
  "AAA148",
  "AAA156",
  "AAA158",
  "AAA173",
  "AAA176",
  "AAA185",
  "AAA196",
  "AAA197",
  "AAA198",
  "AAA199",
  "AAA202",
  "AAA226",
  "AAA230",
  "AAA245",
  "AAA247",
  "AAA255",
  "AAA268",
  "AAA276",
  "AAA279",
  "AAA290",
] as const;

export const SEO_WAREHOUSE_LOCATION_REVIEW_MODELS = new Set<string>(
  WAREHOUSE_LOCATION_REVIEW_MODELS,
);

export const SEO_USER_CONFIRMED_SOLD_OUT_MODELS = new Set<string>([
  "AAA162",
  "AAA252",
  "AAA271",
]);

export const SEO_USER_DEFERRED_MODELS = new Set<string>(["AAA189"]);

function modelKey(value: unknown) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

export function seoCatalogExclusion(modelNumber: unknown) {
  const model = modelKey(modelNumber);
  if (SEO_WAREHOUSE_LOCATION_REVIEW_MODELS.has(model)) {
    return {
      excluded: true,
      code: "WAREHOUSE_LOCATION_REVIEW_REQUIRED",
      reason: "창고 위치 확인 필요 32건 · 사용자 확인 전 SEO 등록 제외",
    } as const;
  }
  if (SEO_USER_CONFIRMED_SOLD_OUT_MODELS.has(model)) {
    return {
      excluded: true,
      code: "USER_CONFIRMED_SOLD_OUT",
      reason: "사용자 품절 확정 · SEO 등록 제외",
    } as const;
  }
  if (SEO_USER_DEFERRED_MODELS.has(model)) {
    return {
      excluded: true,
      code: "USER_DEFERRED",
      reason: "사용자 확인 전 보류 · SEO 등록 제외",
    } as const;
  }
  return { excluded: false, code: "", reason: "" } as const;
}

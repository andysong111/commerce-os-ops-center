type RetryRow = {
  run_id?: unknown;
  launch_item_id?: unknown;
  status?: unknown;
  stage?: unknown;
  error_message?: unknown;
  registration_status?: unknown;
  registration_job_id?: unknown;
  registration_request_id?: unknown;
  run_created_at?: unknown;
  archived_at?: unknown;
};

function text(value: unknown) { return String(value ?? "").trim(); }

export function legacySeoRunIssue(row: RetryRow) {
  const error = text(row.error_message);
  if (text(row.registration_status) === "failed") {
    return { code: "REGISTRATION_FAILED", label: "Shopling 등록 실패", retryable: false,
      detail: "SEO 생성 실패와 다릅니다. 기존 업로드 결과를 확인한 뒤 등록 재시도를 사용하세요." };
  }
  if (text(row.status) !== "failed") return null;
  if (/제한 복구 \d+회 이후|LEGACY_SEO_SELECTION_EXHAUSTED/.test(error)) {
    return { code: "EVIDENCE_REVIEW", label: "SEO 재료 확인 필요", retryable: false,
      detail: "누락 후보의 제한 복구를 마쳤지만 기준을 충족하지 못했습니다. 같은 재시도를 반복하지 말고 원본·키워드 근거를 보완해야 합니다." };
  }
  if (/금지키워드 제거 후 사용할|상품명용 우수 키워드가 부족|검증 키워드만으로|고유 쇼핑몰별 상품명|FINAL 검색어가 10개/.test(error)) {
    return { code: "MATERIAL_REVIEW", label: "SEO 재료 확인 필요", retryable: false,
      detail: "허용된 재료로 현재 출력 조건을 충족하지 못했습니다. 금지어를 복원하거나 무관한 표현을 추가하지 않습니다. 원본·허용 재료 보완이 먼저입니다." };
  }
  return { code: "GENERATION_FAILED", label: "SEO 생성 실패", retryable: true,
    detail: text(row.stage) === "filter_keywords"
      ? "샵플링 등록 전 단계입니다. 빠진 핵심 후보·미완료 점수화만 제한 복구하고 기존 정확성·금지어 검사를 다시 통과해야 합니다."
      : "샵플링 등록 전 단계입니다. 저장된 SEO 체크포인트에서 재시도합니다." };
}

export function canRetryLegacySeoGeneration(row: RetryRow) {
  return text(row.status) === "failed" && !text(row.archived_at) &&
    text(row.registration_status) === "idle" && !text(row.registration_job_id) &&
    !text(row.registration_request_id) && legacySeoRunIssue(row)?.retryable === true;
}

/** History must be owner-scoped and complete for the requested source IDs. */
export function selectLegacySeoRetryRunIds(history: RetryRow[], requestedIds: string[]) {
  const requested = new Set(requestedIds.map(text).filter(Boolean));
  const groups = new Map<string, RetryRow[]>();
  for (const row of history) {
    const source = text(row.launch_item_id);
    if (!source) continue;
    const rows = groups.get(source) ?? [];
    rows.push(row);
    groups.set(source, rows);
  }
  const result: string[] = [];
  for (const rows of groups.values()) {
    // Completed/active history (including archived successes) is never revived by retry.
    if (rows.some(row => ["ready", "queued", "running"].includes(text(row.status)) ||
      !["", "idle"].includes(text(row.registration_status)) ||
      text(row.registration_job_id) || text(row.registration_request_id))) continue;
    const failed = rows.filter(row => text(row.status) === "failed" && !text(row.archived_at));
    if (failed.some(row => !text(row.run_id) || !Number.isFinite(Date.parse(text(row.run_created_at))))) continue;
    failed.sort((a, b) => Date.parse(text(b.run_created_at)) - Date.parse(text(a.run_created_at)) ||
      text(b.run_id).localeCompare(text(a.run_id)));
    const latest = failed[0];
    if (latest && requested.has(text(latest.run_id)) && canRetryLegacySeoGeneration(latest)) result.push(text(latest.run_id));
  }
  return result.slice(0, 200);
}

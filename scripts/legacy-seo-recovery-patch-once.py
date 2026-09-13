from pathlib import Path


def replace_once(source, before, after):
    assert source.count(before) == 1, f'Unexpected integration anchor: {before[:90]!r}'
    return source.replace(before, after, 1)


p = Path('src/lib/legacySeoRunJobServer.ts')
s = p.read_text()
s = 'import { canRetryLegacySeoGeneration, selectLegacySeoRetryRunIds } from "./legacySeoRetryPolicy.ts";\n' + s
start = s.index('export async function retryLegacySeoRunJobs(')
end = s.index('export async function archiveLegacySeoRunJobs(', start)
s = s[:start] + '''export async function retryLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  runIds: string[],
) {
  const requested = [...new Set(runIds.map(text).filter(Boolean))].slice(0, 200);
  if (!requested.length) return [];
  const select = "run_id,launch_item_id,status,stage,error_message,registration_status,registration_job_id,registration_request_id,run_created_at,archived_at";
  const readRows = async (filters: Record<string, string>) => {
    const params = new URLSearchParams({ select, owner_id: `eq.${context.identity.userId}`, limit: "1000", ...filters });
    const rows = await storage<SeoRunJobRow[]>(context.config, `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`);
    if (!Array.isArray(rows) || rows.length >= 1000) throw new Error("LEGACY_SEO_RETRY_HISTORY_INCOMPLETE");
    return rows;
  };
  const requestedRows = await readRows({ run_id: `in.(${postgrestIn(requested)})` });
  const itemIds = [...new Set(requestedRows.filter(canRetryLegacySeoGeneration).map(row => text(row.launch_item_id)).filter(Boolean))];
  if (!itemIds.length) return [];
  const history = await readRows({ launch_item_id: `in.(${postgrestIn(itemIds)})` });
  const safeIds = selectLegacySeoRetryRunIds(history, requested);
  if (!safeIds.length) return [];
  const params = new URLSearchParams({
    select: WORKER_PATCH_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    run_id: `in.(${postgrestIn(safeIds)})`,
    status: "eq.failed",
    archived_at: "is.null",
    registration_status: "eq.idle",
    and: "(or(registration_job_id.is.null,registration_job_id.eq.),or(registration_request_id.is.null,registration_request_id.eq.))",
  });
  // Atomic failed-only transition: duplicate clicks cannot reset a queued/ready run.
  // Checkpoints and the durable recovery budget are deliberately NOT overwritten.
  const rows = await storage<SeoRunJobRow[]>(context.config, `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "queued", error_message: "", attempt_count: 0,
      not_before: new Date().toISOString(), lease_owner: null, lease_until: null,
      completed_at: null, updated_at: new Date().toISOString(),
      message: "저장된 체크포인트에서 이전상품 SEO 재실행 대기 · Shopling 등록 미시작",
    }),
  });
  return Array.isArray(rows) ? rows : [];
}

''' + s[end:]
p.write_text(s)

p = Path('src/app/api/legacy-seo-run-jobs/route.ts')
s = p.read_text()
s = replace_once(s, '''    const jobs = await retryLegacySeoRunJobs(context, runIds);
    scheduleWorker(context.identity.userId, Math.max(1, runIds.length));
    return Response.json({ ok: true, jobs });''', '''    const jobs = await retryLegacySeoRunJobs(context, runIds);
    if (jobs.length) scheduleWorker(context.identity.userId, jobs.length);
    return Response.json({ ok: true, jobs, retriedCount: jobs.length, skippedCount: runIds.length - jobs.length });''')
p.write_text(s)

p = Path('src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx')
s = p.read_text()
s = replace_once(s, '"use client";\n', '"use client";\n\nimport { legacySeoRunIssue, selectLegacySeoRetryRunIds } from "@/lib/legacySeoRetryPolicy";\n')
s = replace_once(s, '  const registerableJobs = useMemo(', '''  const retryableRunIds = useMemo(
    () => selectLegacySeoRetryRunIds(jobs, failedJobs.map(job => job.run_id)),
    [jobs, failedJobs],
  );
  const registrationFailedJobs = useMemo(() => jobs.filter(job => job.registration_status === "failed"), [jobs]);
  const registerableJobs = useMemo(''')
s = replace_once(s, '        } else if (action === "register") {', '''        } else if (action === "retry") {
          setMessage(`SEO 생성 재시도 ${Number(body.retriedCount) || 0}건 · 제외 ${Number(body.skippedCount) || 0}건. Shopling 신규등록은 실행하지 않았습니다.`);
        } else if (action === "register") {''')
s = replace_once(s, '            <span className="rounded-full bg-rose-100 px-2 py-1">오류 {failedJobs.length}</span>', '''            <span className="rounded-full bg-rose-100 px-2 py-1">SEO 생성실패 {failedJobs.length}</span>
            <span className="rounded-full bg-orange-100 px-2 py-1">Shopling 등록실패 {registrationFailedJobs.length}</span>''')
s = replace_once(s, 'disabled={busy || failedJobs.length === 0}', 'disabled={busy || retryableRunIds.length === 0}')
s = replace_once(s, 'void runAction("retry", { runIds: failedJobs.map((job) => job.run_id) })', 'void runAction("retry", { runIds: retryableRunIds })')
s = replace_once(s, '            생성실패 전체 재시도\n', '            생성실패 전체 재시도 ({retryableRunIds.length}건)\n')
s = replace_once(s, '              const mode = actualSourceMode(job);', '''              const mode = actualSourceMode(job);
              const issue = legacySeoRunIssue(job);
              const canRetry = retryableRunIds.includes(job.run_id);''')
s = replace_once(s, '? "오류"\n                                  : "취소"', '? "SEO 생성 실패"\n                                  : "취소"')
s = replace_once(s, '                          Shopling {job.registration_status}\n', '                          {job.registration_status === "idle" ? "Shopling 등록 미시작" : `Shopling ${job.registration_status}`}\n')
s = replace_once(s, '{job.status === "failed" && (', '{job.status === "failed" && canRetry && (')
s = replace_once(s, '                          다시시도\n', '                          SEO 생성 재시도\n')
s = replace_once(s, '                          Shopling 신규등록\n', '                          {job.registration_status === "failed" ? "Shopling 등록 재시도" : "Shopling 신규등록"}\n')
s = replace_once(s, '                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">', '''                  {issue && (
                    <div role="status" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
                      <strong>{issue.label}</strong> · {job.stage || "단계 확인 필요"}
                      <div>{issue.detail}</div>
                      {issue.retryable && !canRetry && <div>재시도 제외: 같은 상품의 최신 RUN 또는 완료·진행 이력을 확인하세요. 이전 실패 이력은 삭제하지 않습니다.</div>}
                    </div>
                  )}

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">''')
s = replace_once(s, '      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">\n        <div className="flex flex-wrap items-center justify-between gap-3">\n          <div>\n            <h2 className="text-lg font-bold">2. 이전상품 SEO 작업원장</h2>', '''      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs leading-5 text-slate-600">과거 상품명은 중복 최소화 참고자료입니다. 검증된 핵심 키워드는 재사용하고, 충분한 재료가 있을 때 조합·강조점·순서를 다양화합니다. 완전 비중복을 강제하거나 금지어·무관한 표현을 추가하지 않습니다.</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">2. 이전상품 SEO 작업원장</h2>''')
p.write_text(s)

p = Path('src/lib/keywordEngineElonKeywordPortfolioV8.ts')
s = p.read_text()
s = 'import { orderKeywordElonRunTerms, varyKeywordElonEqualRank } from "./keywordEngineElonRunVariation.ts";\n' + s
start = s.index('export function selectKeywordElonComplementSearchKeywordsV8(')
a, b = s[:start], s[start:]
b = replace_once(b, '  limit?: number;\n', '  limit?: number;\n  variationSeed?: string;\n')
b = replace_once(b, '  const directByKey = new Map(', '  const ranked = varyKeywordElonEqualRank(input.rankedDirectKeywords, input.variationSeed);\n  const directByKey = new Map(')
b = b.replace('input.rankedDirectKeywords.map(', 'ranked.map(').replace('input.rankedDirectKeywords.filter(', 'ranked.filter(')
b = replace_once(b, 'uniqueKeywords(input.supplementalSearchKeywords ?? [], 120)', 'orderKeywordElonRunTerms(uniqueKeywords(input.supplementalSearchKeywords ?? [], 120), input.variationSeed)')
b = replace_once(b, 'uniqueKeywords(input.fallbackSearchKeywords ?? [], 120)', 'orderKeywordElonRunTerms(uniqueKeywords(input.fallbackSearchKeywords ?? [], 120), input.variationSeed)')
b = replace_once(b, 'searchKeywords: selected.slice(0, limit),', 'searchKeywords: orderKeywordElonRunTerms(selected.slice(0, limit), input.variationSeed),')
b = replace_once(b, '    warnings: [\n', '    warnings: [\n      `SEO_KEYWORD_SEARCH_VARIATION:${input.variationSeed ? "validated-run-seed-v1" : "legacy-order"}`,\n')
p.write_text(a + b)

p = Path('src/lib/keywordEngineElonBulkFinal.ts')
s = p.read_text()
start = s.index('selectKeywordElonComplementSearchKeywordsV8({')
a, b = s[:start], s[start:]
b = replace_once(b, 'rankedDirectKeywords: titleReservoir.rankedDirectKeywords,', 'rankedDirectKeywords: titleReservoir.rankedDirectKeywords,\n    variationSeed: input.variationSeed,')
p.write_text(a + b)

from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"guard failed: {path}: expected 1 occurrence, got {count}: {old[:100]!r}")
    target.write_text(source.replace(old, new), encoding="utf-8")


# Server: archive all completed registrations with one owner-scoped PATCH.
path = "src/lib/legacySeoRunJobServer.ts"
replace(
    path,
    'const claimedJobSnapshots = new Map<string, SeoRunJobRow>();',
    '''const ARCHIVE_SELECT = [
  "run_id",
  "launch_item_id",
  "model_number",
  "product_name",
  "status",
  "registration_status",
  "registration_job_id",
  "run_created_at",
  "archived_at",
  "updated_at",
].join(",");

const claimedJobSnapshots = new Map<string, SeoRunJobRow>();''',
)
replace(
    path,
    '''export async function claimNextLegacySeoRunJob(
  config: ProductLaunchAdminConfig,''',
    '''export async function archiveCompletedLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
) {
  const archivedAt = new Date().toISOString();
  const params = new URLSearchParams({
    select: ARCHIVE_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    archived_at: "is.null",
    status: "eq.ready",
    registration_status: "eq.success",
  });
  const rows = await storage<SeoRunJobRow[]>(
    context.config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ archived_at: archivedAt, updated_at: archivedAt }),
    },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function claimNextLegacySeoRunJob(
  config: ProductLaunchAdminConfig,''',
)

# API: expose a dedicated completed-only archive action.
path = "src/app/api/legacy-seo-run-jobs/route.ts"
replace(
    path,
    '''  archiveLegacySeoRunJobs,
  insertLegacySeoRunJobs,''',
    '''  archiveCompletedLegacySeoRunJobs,
  archiveLegacySeoRunJobs,
  insertLegacySeoRunJobs,''',
)
replace(
    path,
    '''  if (action === "archive") {
    const jobs = await archiveLegacySeoRunJobs(''',
    '''  if (action === "archive_completed") {
    const jobs = await archiveCompletedLegacySeoRunJobs(context);
    return Response.json({ ok: true, archivedCount: jobs.length, jobs });
  }

  if (action === "archive") {
    const jobs = await archiveLegacySeoRunJobs(''',
)

# Lite listing: active remains default; archived scope is metadata-only.
path = "src/app/api/legacy-seo-run-jobs-lite/route.ts"
replace(
    path,
    '''const READ_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

let storageCircuitUntil = 0;''',
    '''const READ_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const ACTIVE_JOB_SELECT = [
  "run_id",
  "launch_item_id",
  "tracker_row_number",
  "model_number",
  "product_name",
  "source_url",
  "status",
  "stage",
  "progress_percent",
  "message",
  "result_payload",
  "error_message",
  "registration_status",
  "registration_job_id",
  "run_created_at",
  "archived_at",
  "updated_at",
].join(",");
const ARCHIVED_JOB_SELECT = [
  "run_id",
  "launch_item_id",
  "tracker_row_number",
  "model_number",
  "product_name",
  "status",
  "registration_status",
  "registration_job_id",
  "run_created_at",
  "archived_at",
  "updated_at",
].join(",");

let storageCircuitUntil = 0;''',
)
replace(
    path,
    '''async function listCompactJobs(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {''',
    '''async function listCompactJobs(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
  scope: "active" | "archived",
) {''',
)
replace(
    path,
    '''  const params = new URLSearchParams({
    select: [
      "run_id",
      "launch_item_id",
      "tracker_row_number",
      "model_number",
      "product_name",
      "source_url",
      "status",
      "stage",
      "progress_percent",
      "message",
      "result_payload",
      "error_message",
      "registration_status",
      "registration_job_id",
      "run_created_at",
      "updated_at",
    ].join(","),
    owner_id: `eq.${ownerId}`,
    archived_at: "is.null",
    order: "run_created_at.desc",
    limit: String(JOB_LIMIT),
  });''',
    '''  const archivedOnly = scope === "archived";
  const params = new URLSearchParams({
    select: archivedOnly ? ARCHIVED_JOB_SELECT : ACTIVE_JOB_SELECT,
    owner_id: `eq.${ownerId}`,
    archived_at: archivedOnly ? "not.is.null" : "is.null",
    order: archivedOnly ? "archived_at.desc" : "run_created_at.desc",
    limit: String(JOB_LIMIT),
  });''',
)
replace(
    path,
    '''      source_url: text(row.source_url),
      status: text(row.status),
      stage: text(row.stage),
      progress_percent: Math.max(0, Number(row.progress_percent) || 0),
      message: text(row.message),''',
    '''      source_url: archivedOnly ? "" : text(row.source_url),
      status: text(row.status),
      stage: archivedOnly ? "" : text(row.stage),
      progress_percent: archivedOnly ? 100 : Math.max(0, Number(row.progress_percent) || 0),
      message: archivedOnly ? "보관된 이전상품 SEO RUN" : text(row.message),''',
)
replace(
    path,
    '''      result_payload: record(row.result_payload),
      error_message: text(row.error_message),''',
    '''      result_payload: archivedOnly ? {} : record(row.result_payload),
      error_message: archivedOnly ? "" : text(row.error_message),''',
)
replace(
    path,
    '''      run_created_at: text(row.run_created_at),
      updated_at: text(row.updated_at),''',
    '''      run_created_at: text(row.run_created_at),
      archived_at: text(row.archived_at),
      updated_at: text(row.updated_at),''',
)
replace(
    path,
    '''    const includeJobs = request.nextUrl.searchParams.get("jobs") !== "false";
    const includeItems = request.nextUrl.searchParams.get("items") !== "false";''',
    '''    const includeJobs = request.nextUrl.searchParams.get("jobs") !== "false";
    const includeItems = request.nextUrl.searchParams.get("items") !== "false";
    const scope = request.nextUrl.searchParams.get("scope") === "archived" ? "archived" : "active";''',
)
replace(
    path,
    '''        ? listCompactJobs(context.config, context.identity.userId)
        : Promise.resolve([]),''',
    '''        ? listCompactJobs(context.config, context.identity.userId, scope)
        : Promise.resolve([]),''',
)
replace(path, '''        warnings,
        jobsAvailable:''', '''        warnings,
        scope,
        jobsAvailable:''')

# Client: completed-only bulk archive + on-demand archive drawer.
path = "src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx"
replace(path, '''  run_created_at: string;
  updated_at: string;
};''', '''  run_created_at: string;
  archived_at?: string;
  updated_at: string;
};''')
replace(
    path,
    '''  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected]''',
    '''  const [jobs, setJobs] = useState<Job[]>([]);
  const [archivedJobs, setArchivedJobs] = useState<Job[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [selected, setSelected]''',
)
replace(
    path,
    '''  const loadItems = useCallback(async () => {''',
    '''  const loadArchive = useCallback(async () => {
    if (archiveLoading) return;
    setArchiveLoading(true);
    try {
      const body = await requestJson<{ ok?: boolean; jobs?: Job[] }>(
        "/api/legacy-seo-run-jobs-lite?scope=archived&items=false",
      );
      setArchivedJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setArchiveLoaded(true);
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : "보관함을 불러오지 못했습니다.",
      );
    } finally {
      setArchiveLoading(false);
    }
  }, [archiveLoading]);

  const loadItems = useCallback(async () => {''',
)
replace(
    path,
    '''  const registerableJobs = useMemo(
    () => readyJobs.filter((job) => ["idle", "failed"].includes(job.registration_status)),
    [readyJobs],
  );''',
    '''  const registerableJobs = useMemo(
    () => readyJobs.filter((job) => ["idle", "failed"].includes(job.registration_status)),
    [readyJobs],
  );
  const completedJobs = useMemo(
    () => readyJobs.filter((job) => job.registration_status === "success"),
    [readyJobs],
  );''',
)
replace(
    path,
    '''        } else if (action === "register") {
          const results = array(body.results).map(record);
          const started = results.filter((row) => row.started === true).length;
          const failed = results.filter((row) => text(row.error)).length;
          setMessage(`Shopling 신규등록 ${started}건 시작${failed ? ` · 준비실패 ${failed}건` : ""}`);
        } else {
          setMessage("요청을 반영했습니다.");
        }
        await load();''',
    '''        } else if (action === "register") {
          const results = array(body.results).map(record);
          const started = results.filter((row) => row.started === true).length;
          const failed = results.filter((row) => text(row.error)).length;
          setMessage(`Shopling 신규등록 ${started}건 시작${failed ? ` · 준비실패 ${failed}건` : ""}`);
        } else if (action === "archive_completed") {
          setMessage(`Shopling 등록완료 ${Number(body.archivedCount) || 0}건을 보관함으로 이동했습니다.`);
          setShowArchive(true);
        } else if (action === "archive") {
          setMessage("선택한 SEO RUN을 보관함으로 이동했습니다.");
        } else {
          setMessage("요청을 반영했습니다.");
        }
        await load();
        if (action === "archive" || action === "archive_completed") {
          await loadArchive();
          window.dispatchEvent(new Event("commerce-os:legacy-seo-archive-changed"));
        }''',
)
replace(path, '''    [load],
  );''', '''    [load, loadArchive],
  );''')
replace(
    path,
    '''              상품출시 진행관리의 `등록완료건` 중 Shopling 등록완료 상품만 표시합니다. 실행 시 Product Master의 모델번호 연결을 통해 실제 goods_key가 있는지 다시 검증합니다.
            </p>''',
    '''              상품출시 진행관리의 `등록완료건` 중 Shopling 등록완료 상품만 표시합니다. 실행 시 Product Master의 모델번호 연결을 통해 실제 goods_key가 있는지 다시 검증합니다. 보관된 상품도 여기서 다시 선택하면 새 SEO RUN을 만들고 새 상품명·검색어로 Shopling에 추가등록할 수 있습니다.
            </p>''',
)
replace(
    path,
    '''          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void load();
              void loadItems();
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            새로고침
          </button>''',
    '''          <button
            type="button"
            disabled={busy || completedJobs.length === 0}
            onClick={() => void runAction("archive_completed", {})}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-40"
          >
            Shopling 완료 전체 보관 ({completedJobs.length}건)
          </button>
          <button
            type="button"
            disabled={busy || archiveLoading}
            onClick={() => {
              const next = !showArchive;
              setShowArchive(next);
              if (next && !archiveLoaded) void loadArchive();
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
          >
            {showArchive ? "보관함 닫기" : `보관함${archiveLoaded ? ` (${archivedJobs.length})` : ""}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void load();
              void loadItems();
              if (showArchive) void loadArchive();
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            새로고침
          </button>''',
)
replace(
    path,
    '''        <div className="mt-4 space-y-3">
          {[...jobs]''',
    '''        {showArchive && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-800">완료 보관함</h3>
                <p className="mt-1 text-xs text-slate-500">
                  작업원장만 보관됩니다. 원본 이전상품은 그대로 남아 언제든 다시 선택해 새 SEO RUN을 만들 수 있습니다.
                </p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {archiveLoading ? "불러오는 중" : `${archivedJobs.length}건`}
              </span>
            </div>
            <div className="mt-3 max-h-[360px] overflow-auto rounded-lg border border-slate-200 bg-white">
              {archivedJobs.map((job) => (
                <div key={`archive-${job.run_id}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div>
                    <div className="font-semibold text-slate-800">{job.model_number || job.product_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{job.product_name || "-"} · {job.archived_at ? new Date(job.archived_at).toLocaleString("ko-KR") : "보관일시 없음"}</div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className={`rounded-full px-2 py-1 font-semibold ${jobTone(job.status)}`}>
                      {job.status === "ready" ? "FINAL 완료" : job.status}
                    </span>
                    <span className={`rounded-full px-2 py-1 font-semibold ${registrationTone(job.registration_status)}`}>
                      Shopling {job.registration_status}
                    </span>
                  </div>
                </div>
              ))}
              {!archiveLoading && archiveLoaded && archivedJobs.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">보관된 SEO RUN이 없습니다.</div>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {[...jobs]''',
)

# Bulk auto-run must treat archived FINAL as processed, while explicit reselect remains allowed.
path = "src/app/legacy-seo-bulk-cloud/LegacySeoBulkRunAllEnhancer.tsx"
replace(
    path,
    '''const PREFLIGHT_API = "/api/legacy-seo-preflight";
const CHUNK_SIZE = 50;''',
    '''const PREFLIGHT_API = "/api/legacy-seo-preflight";
const ARCHIVED_HISTORY_API = "/api/legacy-seo-run-jobs-lite?scope=archived&items=false";
const ARCHIVED_HISTORY_CACHE_MS = 5 * 60_000;
const ARCHIVE_CHANGED_EVENT = "commerce-os:legacy-seo-archive-changed";
const CHUNK_SIZE = 50;
let archivedReadyItemIdsCache = new Set<string>();
let archivedReadyLoadedAt = 0;''',
)
replace(
    path,
    '''async function loadTargets() {
  const response = await fetch(API, {''',
    '''async function loadArchivedReadyItemIds(force = false) {
  const now = Date.now();
  if (!force && archivedReadyLoadedAt > 0 && now - archivedReadyLoadedAt < ARCHIVED_HISTORY_CACHE_MS) {
    return new Set(archivedReadyItemIdsCache);
  }
  const response = await fetch(ARCHIVED_HISTORY_API, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message) || `보관 이력 HTTP ${response.status}`);
  }
  archivedReadyItemIdsCache = new Set(
    (Array.isArray(body.jobs) ? body.jobs : [])
      .map(record)
      .filter((job) => text(job.status) === "ready")
      .map((job) => text(job.launch_item_id))
      .filter(Boolean),
  );
  archivedReadyLoadedAt = now;
  return new Set(archivedReadyItemIdsCache);
}

async function loadTargets(forceArchiveHistory = false) {
  const archivedReadyIds = await loadArchivedReadyItemIds(forceArchiveHistory);
  const response = await fetch(API, {''',
)
replace(
    path,
    '''  const blocked = new Set(
    jobs
      .filter((job) => ["queued", "running", "ready"].includes(text(job.status)))
      .map((job) => text(job.launch_item_id))
      .filter(Boolean),
  );''',
    '''  const blocked = new Set([
    ...jobs
      .filter((job) => ["queued", "running", "ready"].includes(text(job.status)))
      .map((job) => text(job.launch_item_id))
      .filter(Boolean),
    ...archivedReadyIds,
  ]);''',
)
replace(
    path,
    '''    const refreshTimer = window.setInterval(() => {
      if (!busy) void refresh();
    }, 5_000);

    return () => {''',
    '''    const refreshTimer = window.setInterval(() => {
      if (!busy) void refresh();
    }, 5_000);
    const archiveChanged = () => {
      archivedReadyLoadedAt = 0;
      if (!busy) {
        void loadTargets(true)
          .then((result) => {
            if (cancelled) return;
            setCandidateCount(result.candidateCount);
            setTargetIds(result.targetIds);
          })
          .catch(() => {});
      }
    };
    window.addEventListener(ARCHIVE_CHANGED_EVENT, archiveChanged);

    return () => {''',
)
replace(
    path,
    '''      window.clearInterval(domTimer);
      window.clearInterval(refreshTimer);
    };''',
    '''      window.clearInterval(domTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener(ARCHIVE_CHANGED_EVENT, archiveChanged);
    };''',
)

print("legacy SEO archive source patch applied")

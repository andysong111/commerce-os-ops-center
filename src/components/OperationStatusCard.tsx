export type OperationStatusState = "idle" | "queued" | "running" | "waiting_artifact" | "success" | "failed" | "blocked" | "unknown";

export function formatKeywordApplyRunPhase(phase?: string) {
  switch (phase) {
    case "queued": return "실행 대기 중입니다.";
    case "running": return "GitHub Actions가 실행 중입니다.";
    case "waiting_artifact": return "실행은 완료 대기/결과 파일 생성 대기 중입니다.";
    case "completed_no_artifact": return "실행은 끝났지만 결과 파일이 없습니다.";
    case "artifact_ready": return "결과 파일을 확인했습니다.";
    case "failed": return "GitHub Actions 실행이 실패했습니다.";
    default: return "상태를 확인 중입니다.";
  }
}

const labels: Record<OperationStatusState, string> = {
  idle: "대기 중",
  queued: "실행 요청됨",
  running: "GitHub Actions 실행 중",
  waiting_artifact: "결과 파일 생성 대기",
  success: "성공",
  failed: "실패",
  blocked: "차단됨",
  unknown: "확인 필요",
};

const steps = ["요청 접수", "GitHub Actions 실행", "샵플링 API 처리", "결과 artifact 생성", "OPS Center 결과 확인"];
const loadingCopy = [
  "샵플링 반영 작업을 준비하고 있습니다.",
  "GitHub Actions에서 안전하게 실행 중입니다.",
  "결과 파일이 생성되면 자동으로 가져옵니다.",
  "OPS Center는 샵플링을 직접 호출하지 않고 상태만 확인합니다.",
];

export function OperationStatusCard({ state, phase, requestId, runUrl, runStatus, runConclusion, artifactName, fetchedAt, lastCheckedAt, pollCount, maxPolls = 18, message }: {
  state: OperationStatusState;
  phase?: string;
  requestId?: string;
  runUrl?: string;
  runStatus?: string | null;
  runConclusion?: string | null;
  artifactName?: string;
  fetchedAt?: string;
  lastCheckedAt?: string;
  pollCount?: number;
  maxPolls?: number;
  message?: string;
}) {
  const active = state === "queued" || state === "running" || state === "waiting_artifact";
  const danger = state === "failed" || state === "blocked";
  const tone = danger ? "border-red-200 bg-red-50 text-red-950" : state === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-blue-200 bg-white text-slate-950";
  const copy = loadingCopy[(pollCount ?? 0) % loadingCopy.length];
  const hasSpecificRunUrl = Boolean(runIdFromUrl(runUrl));
  const linkLabel = hasSpecificRunUrl ? "실행 로그 열기" : "워크플로 목록 열기";
  return <div className={`mt-3 rounded-xl border p-4 shadow-sm ${tone}`}>
    <style>{`@keyframes opsPulse{0%,100%{transform:scale(.85);opacity:.45}50%{transform:scale(1.15);opacity:1}}@keyframes opsOrbit{to{transform:rotate(360deg)}}`}</style>
    <div className="flex items-start gap-3">
      <div className="relative mt-1 h-9 w-9 rounded-full border border-current/20" style={active ? { animation: "opsOrbit 1.4s linear infinite" } : undefined}>
        <span className="absolute left-3.5 top-[-3px] h-2.5 w-2.5 rounded-full bg-current" style={active ? { animation: "opsPulse 1s ease-in-out infinite" } : undefined} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">작업 실행 중</h4><span className="rounded-full bg-slate-900/10 px-2 py-0.5 text-xs font-bold">{labels[state]}</span>{danger ? <span className="text-xs font-bold text-red-700">로그 확인 필요</span> : null}</div>
        <p className="mt-1 text-sm">{message || formatKeywordApplyRunPhase(phase)}</p>
        {active ? <p className="mt-1 text-xs font-semibold text-blue-700">{copy}</p> : null}
        <ol className="mt-3 grid gap-2 text-xs sm:grid-cols-5">{steps.map((step, index) => <li key={step} className={`rounded-lg px-2 py-1 ${active && index <= Math.min((pollCount ?? 0) % 5, 4) ? "bg-blue-100 text-blue-900" : "bg-slate-100 text-slate-600"}`}>{index + 1}. {step}</li>)}</ol>
        <dl className="mt-3 grid gap-1 break-all text-xs sm:grid-cols-2">
          <div>request id: <span className="font-mono">{requestId || "-"}</span></div><div>run: {runStatus || "-"}{runConclusion ? ` / ${runConclusion}` : ""}</div>
          <div>artifact: {artifactName || "-"}</div><div>fetchedAt: {fetchedAt || "-"}</div>
          <div>마지막 확인: {lastCheckedAt || "-"}</div><div>poll: {pollCount ?? 0}/{maxPolls}</div>
        </dl>
        {phase === "queued" && !hasSpecificRunUrl ? <p className="mt-2 text-xs font-semibold text-blue-700">아직 실행 페이지가 연결되지 않았습니다. 잠시 후 자동으로 다시 확인합니다.</p> : null}
        {runUrl ? <a href={runUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold underline">{linkLabel}</a> : null}
      </div>
    </div>
  </div>;
}

function runIdFromUrl(url?: string) {
  return typeof url === "string" && /\/actions\/runs\/\d+/.test(url);
}

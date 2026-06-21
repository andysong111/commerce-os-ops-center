"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { keywordEngineSecrets } from "@/lib/engineEnvConfig";

type AdminTokenStatus = "connected" | "missing" | "permission_denied" | "checking" | "unknown";
type SecretStatus = { name: string; configured: boolean | "unknown"; updatedAt?: string };

function statusText(value: boolean | "unknown" | undefined) {
  if (value === true) return "설정됨";
  if (value === false) return "미설정";
  return "확인 불가";
}

function adminStatusText(status: AdminTokenStatus) {
  if (status === "connected") return "연결됨";
  if (status === "missing") return "연결 안 됨";
  if (status === "permission_denied") return "권한 부족";
  if (status === "checking") return "확인 중";
  return "확인 불가";
}

export default function EngineEnvSetupPage() {
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error" | "warning">("success");
  const [permissionHelp, setPermissionHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adminTokenStatus, setAdminTokenStatus] = useState<AdminTokenStatus>("checking");

  const allKeywordSecretsConfigured = useMemo(() => keywordEngineSecrets.every((secret) => statuses[secret.name]?.configured === true), [statuses]);
  const canSave = adminTokenStatus === "connected" && !saving;

  const refreshStatus = async () => {
    setAdminTokenStatus("checking");
    const response = await fetch("/api/engine-env/status");
    const data = await response.json();
    const keyword = data.engines?.find((engine: { engine: string }) => engine.engine === "keyword_engine");
    setStatuses(Object.fromEntries((keyword?.secrets ?? []).map((secret: SecretStatus) => [secret.name, secret])));
    const nextAdminStatus = (data.adminTokenStatus ?? (data.ok ? "connected" : "unknown")) as AdminTokenStatus;
    setAdminTokenStatus(nextAdminStatus);
    if (!data.ok && data.message) {
      setMessage(data.message);
      setMessageKind("error");
      setPermissionHelp(true);
    }
  };

  // Initial status synchronization with the GitHub Secrets API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshStatus(); }, []);

  const saveSecrets = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (adminTokenStatus !== "connected") {
      setMessage("관리 토큰이 연결된 뒤 저장할 수 있습니다.");
      setMessageKind("error");
      setPermissionHelp(true);
      return;
    }
    setSaving(true);
    setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const secrets = Object.fromEntries(keywordEngineSecrets.map((secret) => [secret.name, formData.get(secret.name)?.toString() ?? ""]));
    const response = await fetch("/api/engine-env/secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "keyword_engine", secrets }) });
    const data = await response.json();
    setSaving(false);
    if (!response.ok || !data.ok) {
      setMessage(data.partial ? "일부 항목만 저장되었습니다. 저장되지 않은 항목을 확인해 주세요." : "저장 실패: GitHub Secrets에 저장하지 못했습니다. 관리 토큰 권한과 Vercel Redeploy 여부를 확인해 주세요.");
      setMessageKind(data.partial ? "warning" : "error");
      setPermissionHelp(true);
      return;
    }
    form.reset();
    setMessage("저장 완료: GitHub Actions Secrets에 등록했습니다. OPS CENTER에는 값이 저장되지 않습니다.");
    setMessageKind("success");
    await refreshStatus();
  };

  const messageClass = messageKind === "success" ? "bg-emerald-50 text-emerald-900" : messageKind === "warning" ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-900";

  return (
    <div className="space-y-6">
      <PageHeader title="엔진 환경변수 설정" description="외부 키워드/상세페이지 엔진 실행에 필요한 GitHub Actions Secrets를 설정하고 점검합니다. 입력한 값은 OPS CENTER에 저장하지 않고 GitHub Actions Secrets로만 등록합니다." />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-950">GitHub 관리 토큰 상태</h2><p className="mt-2 text-sm text-slate-600">Vercel 환경변수를 추가한 뒤에는 반드시 Redeploy가 필요합니다.</p></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800">{adminStatusText(adminTokenStatus)}</span>
        </div>
        {adminTokenStatus === "connected" ? <p className="mt-3 text-sm font-semibold text-emerald-800">GitHub Actions Secrets를 설정할 수 있습니다.</p> : <p className="mt-3 text-sm font-semibold text-amber-900">GITHUB_ENGINE_ADMIN_TOKEN이 없거나 권한이 부족합니다. Vercel 환경변수에 등록한 뒤 Redeploy 해주세요.</p>}
      </section>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
        <h2 className="text-lg font-bold">보안 안내</h2>
        <p className="mt-2">입력한 Secret 값은 브라우저 저장소, operation history, 로그, 화면 JSON에 저장하지 않고 서버 API를 통해 GitHub Actions Secrets에 한 번만 전송합니다.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-950">키워드 엔진 환경변수</h2>
          <p className="mt-1 text-sm text-slate-600">대상 저장소: andysong111/andysong111-keyword-engine-soon</p>
          <p className="mt-2 text-sm text-slate-700">이 설정은 한 번만 저장하면 됩니다. 값은 GitHub Actions Secrets에 저장되고, 이후 키워드 엔진 실행 때 자동으로 사용됩니다.</p>
          <p className="mt-1 text-sm text-slate-700">값을 변경해야 할 때만 다시 입력해서 저장하세요.</p>
        </div>
        {allKeywordSecretsConfigured ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><p className="font-bold">키워드 엔진 환경변수 설정이 완료되었습니다. 이제 키워드 엔진 실행기에서 상품번호를 입력해 실행할 수 있습니다.</p><Link href="/keyword-engine-runner" className="mt-3 inline-block rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">키워드 엔진 실행기로 이동</Link></div> : null}
        <form className="space-y-4" onSubmit={saveSecrets}>
          {keywordEngineSecrets.map((secret) => (
            <label key={secret.name} className="block rounded-lg border border-slate-200 p-4 text-sm">
              <span className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-800"><span>{secret.name} — {secret.label}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{statusText(statuses[secret.name]?.configured)}</span></span>
              <input name={secret.name} type="password" autoComplete="off" placeholder={secret.placeholder} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span className="mt-2 block text-xs text-slate-500">{secret.helperText} 빈 값은 저장하지 않습니다. Secret 값은 성공적으로 저장된 뒤에만 입력창에서 지워집니다.</span>
            </label>
          ))}
          <button disabled={!canSave} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{saving ? "저장 중…" : "GitHub Actions Secrets에 저장"}</button>
          {adminTokenStatus !== "connected" ? <p className="text-sm font-semibold text-amber-900">관리 토큰이 연결된 뒤 저장할 수 있습니다.</p> : null}
        </form>
        {message ? <p className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${messageClass}`}>{message}</p> : null}
      </section>

      {permissionHelp ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-bold">OPS CENTER가 GitHub Secrets를 설정하려면 GITHUB_ENGINE_ADMIN_TOKEN이 필요합니다.</h2><ol className="mt-2 list-decimal pl-5"><li>GitHub fine-grained token 생성</li><li>대상 저장소 선택: andysong111/andysong111-keyword-engine-soon</li><li>권한: Actions: Read and write, Metadata: Read-only</li><li>Vercel → commerce-os-ops-center → Settings → Environment Variables</li><li>Key: GITHUB_ENGINE_ADMIN_TOKEN</li><li>Production and Preview 선택</li><li>Sensitive ON</li><li>Save</li><li>Deployments에서 최신 배포 Redeploy</li></ol><p className="mt-2 font-semibold">Redeploy 전에는 OPS CENTER가 새 환경변수를 인식하지 못합니다.</p><p className="mt-2 font-semibold">토큰 값은 Vercel 환경변수에만 저장하고, GitHub 코드나 Codex 프롬프트에 붙여넣지 마세요.</p></section> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">상세페이지 엔진 환경변수</h2>
        <p className="mt-2 text-sm text-slate-600">현재 상세페이지 엔진은 OPS CENTER에서 설정할 필수 환경변수가 없습니다. 필요해지면 이곳에서 관리합니다.</p>
      </section>
    </div>
  );
}

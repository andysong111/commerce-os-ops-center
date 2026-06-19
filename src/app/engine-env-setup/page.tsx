"use client";

import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { keywordEngineSecrets } from "@/lib/engineEnvConfig";

type SecretStatus = { name: string; configured: boolean | "unknown"; updatedAt?: string };

function statusText(value: boolean | "unknown" | undefined) {
  if (value === true) return "설정됨";
  if (value === false) return "미설정";
  return "확인 불가";
}

export default function EngineEnvSetupPage() {
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [message, setMessage] = useState("");
  const [permissionHelp, setPermissionHelp] = useState(false);
  const [saving, setSaving] = useState(false);

  const refreshStatus = async () => {
    const response = await fetch("/api/engine-env/status");
    const data = await response.json();
    const keyword = data.engines?.find((engine: { engine: string }) => engine.engine === "keyword_engine");
    setStatuses(Object.fromEntries((keyword?.secrets ?? []).map((secret: SecretStatus) => [secret.name, secret])));
    if (!data.ok && data.message) {
      setMessage(data.message);
      setPermissionHelp(true);
    }
  };

  // Initial status synchronization with the GitHub Secrets API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshStatus(); }, []);

  const saveSecrets = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const secrets = Object.fromEntries(keywordEngineSecrets.map((secret) => [secret.name, formData.get(secret.name)?.toString() ?? ""]));
    const response = await fetch("/api/engine-env/secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "keyword_engine", secrets }) });
    const data = await response.json();
    form.reset();
    setSaving(false);
    if (!response.ok || !data.ok) {
      setMessage(data.message ?? "GitHub Actions Secrets 저장에 실패했습니다.");
      setPermissionHelp(true);
      return;
    }
    setMessage("환경변수를 GitHub Actions Secrets에 저장했습니다. OPS CENTER에는 값이 저장되지 않습니다.");
    await refreshStatus();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="엔진 환경변수 설정" description="외부 키워드/상세페이지 엔진 실행에 필요한 GitHub Actions Secrets를 설정하고 점검합니다. 입력한 값은 OPS CENTER에 저장하지 않고 GitHub Actions Secrets로만 등록합니다." />

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
        <h2 className="text-lg font-bold">보안 안내</h2>
        <p className="mt-2">입력한 Secret 값은 브라우저 저장소, operation history, 로그, 화면 JSON에 저장하지 않고 서버 API를 통해 GitHub Actions Secrets에 한 번만 전송합니다.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-950">키워드 엔진 환경변수</h2>
          <p className="mt-1 text-sm text-slate-600">대상 저장소: andysong111/andysong111-keyword-engine-soon</p>
        </div>
        <form className="space-y-4" onSubmit={saveSecrets}>
          {keywordEngineSecrets.map((secret) => (
            <label key={secret.name} className="block rounded-lg border border-slate-200 p-4 text-sm">
              <span className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-800"><span>{secret.name} — {secret.label}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{statusText(statuses[secret.name]?.configured)}</span></span>
              <input name={secret.name} type="password" autoComplete="off" placeholder={secret.placeholder} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span className="mt-2 block text-xs text-slate-500">{secret.helperText} 빈 값은 저장하지 않습니다. Secret 값은 저장 후 즉시 입력창에서 지워집니다.</span>
            </label>
          ))}
          <button disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{saving ? "저장 중…" : "GitHub Actions Secrets에 저장"}</button>
        </form>
        {message ? <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">{message}</p> : null}
      </section>

      {permissionHelp ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-bold">OPS CENTER가 GitHub Secrets를 설정하려면 GITHUB_ENGINE_ADMIN_TOKEN이 필요합니다.</h2><p className="mt-2">GitHub fine-grained token requirements:</p><ul className="mt-2 list-disc pl-5"><li>Repository access: andysong111/andysong111-keyword-engine-soon</li><li>Repository access: andysong111/product-detail-page-auto if future detail env setup is added</li><li>Permissions: Actions: Read and write</li><li>Permissions: Secrets: Read and write, if available in GitHub token permission UI</li><li>Permissions: Metadata: Read-only</li></ul><p className="mt-2 font-semibold">토큰 값은 Vercel 환경변수에만 저장하고, GitHub 코드나 Codex 프롬프트에 붙여넣지 마세요.</p></section> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">상세페이지 엔진 환경변수</h2>
        <p className="mt-2 text-sm text-slate-600">현재 상세페이지 엔진은 OPS CENTER에서 설정할 필수 환경변수가 없습니다. 필요해지면 이곳에서 관리합니다.</p>
      </section>
    </div>
  );
}

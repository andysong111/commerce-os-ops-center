import { NextResponse } from "next/server";
import { getEngineEnvConfig } from "@/lib/engineEnvConfig";
import { saveRepositorySecrets } from "@/lib/githubActionsSecrets";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { engine?: unknown; secrets?: unknown } | null;
  const engine = typeof payload?.engine === "string" ? payload.engine : null;
  const config = getEngineEnvConfig(engine);
  if (!config) return NextResponse.json({ ok: false, message: "허용되지 않은 엔진입니다." }, { status: 400 });
  if (!payload || typeof payload.secrets !== "object" || payload.secrets === null || Array.isArray(payload.secrets)) {
    return NextResponse.json({ ok: false, message: "저장할 환경변수를 확인해 주세요." }, { status: 400 });
  }
  const allowed = new Set(config.secrets.map((secret) => secret.name));
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload.secrets as Record<string, unknown>)) {
    if (!allowed.has(name as never)) return NextResponse.json({ ok: false, message: "허용되지 않은 Secret 이름입니다." }, { status: 400 });
    if (typeof value === "string" && value.trim()) sanitized[name] = value.trim();
  }
  try {
    const savedSecrets = await saveRepositorySecrets(config, sanitized);
    return NextResponse.json({ ok: true, engine: config.engine, repo: config.repo, savedSecrets });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "GitHub Actions Secrets 저장에 실패했습니다." }, { status: 502 });
  }
}

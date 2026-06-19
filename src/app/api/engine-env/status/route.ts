import { NextResponse } from "next/server";
import { engineEnvConfigs } from "@/lib/engineEnvConfig";
import { listRepositorySecretStatuses } from "@/lib/githubActionsSecrets";

export async function GET() {
  try {
    const keyword = engineEnvConfigs.keyword_engine;
    const secrets = await listRepositorySecretStatuses(keyword);
    return NextResponse.json({ ok: true, engines: [{ engine: keyword.engine, repo: keyword.repo, secrets }] });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "GitHub Secrets 상태를 확인하지 못했습니다.", engines: [{ engine: "keyword_engine", repo: engineEnvConfigs.keyword_engine.repo, secrets: engineEnvConfigs.keyword_engine.secrets.map((secret) => ({ name: secret.name, configured: "unknown" })) }] }, { status: 200 });
  }
}

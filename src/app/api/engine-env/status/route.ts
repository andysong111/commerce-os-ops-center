import { NextResponse } from "next/server";
import { engineEnvConfigs, getEngineAdminToken } from "@/lib/engineEnvConfig";
import { listRepositorySecretStatuses, missingTokenMessage, permissionMessage } from "@/lib/githubActionsSecrets";

export async function GET() {
  try {
    const keyword = engineEnvConfigs.keyword_engine;
    const secrets = await listRepositorySecretStatuses(keyword);
    return NextResponse.json({ ok: true, adminTokenStatus: "connected", engines: [{ engine: keyword.engine, repo: keyword.repo, secrets }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Secrets 상태를 확인하지 못했습니다.";
    const adminTokenStatus = !getEngineAdminToken() || message === missingTokenMessage ? "missing" : message === permissionMessage ? "permission_denied" : "unknown";
    return NextResponse.json({ ok: false, adminTokenStatus, message, engines: [{ engine: "keyword_engine", repo: engineEnvConfigs.keyword_engine.repo, secrets: engineEnvConfigs.keyword_engine.secrets.map((secret) => ({ name: secret.name, configured: "unknown" })) }] }, { status: 200 });
  }
}

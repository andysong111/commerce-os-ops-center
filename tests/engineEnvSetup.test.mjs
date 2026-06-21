import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/engine-env-setup/page.tsx", "utf8");
const config = readFileSync("src/lib/engineEnvConfig.ts", "utf8");
const statusRoute = readFileSync("src/app/api/engine-env/status/route.ts", "utf8");
const saveRoute = readFileSync("src/app/api/engine-env/secrets/route.ts", "utf8");
const secretsLib = readFileSync("src/lib/githubActionsSecrets.ts", "utf8");
const runner = readFileSync("src/components/engine-runners/EngineRunnerConsole.tsx", "utf8");

test("environment setup page renders token status, one-time guidance, and success route", () => {
  assert.match(page, /GitHub 관리 토큰 상태/);
  assert.match(page, /연결됨/);
  assert.match(page, /연결 안 됨/);
  assert.match(page, /권한 부족/);
  assert.match(page, /확인 중/);
  assert.match(page, /확인 불가/);
  assert.match(page, /Vercel 환경변수를 추가한 뒤에는 반드시 Redeploy가 필요합니다/);
  assert.match(page, /관리 토큰이 연결된 뒤 저장할 수 있습니다/);
  assert.match(page, /이 설정은 한 번만 저장하면 됩니다/);
  assert.match(page, /값을 변경해야 할 때만 다시 입력해서 저장하세요/);
  assert.match(page, /키워드 엔진 환경변수 설정이 완료되었습니다/);
  assert.match(page, /키워드 엔진 실행기로 이동/);
  assert.match(page, /\/keyword-engine-runner/);
});

test("environment setup page keeps inputs on failure and clears only after successful save", () => {
  assert.match(page, /if \(!response\.ok \|\| !data\.ok\)/);
  assert.match(page, /form\.reset\(\)/);
  assert.ok(page.indexOf("form.reset()") > page.indexOf("if (!response.ok || !data.ok)"));
  assert.match(page, /저장 완료: GitHub Actions Secrets에 등록했습니다/);
  assert.match(page, /저장 실패: GitHub Secrets에 저장하지 못했습니다/);
  assert.match(page, /일부 항목만 저장되었습니다/);
  assert.match(page, /await refreshStatus\(\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|history\.pushState|replaceState/);
});

test("environment setup page renders required Korean content", () => {
  assert.match(page, /엔진 환경변수 설정/);
  assert.match(page, /키워드 엔진 환경변수/);
  assert.match(config, /샵플링 로그인 ID/);
  assert.match(config, /샵플링 회사 ID/);
  assert.match(config, /샵플링 API 인증키/);
  assert.match(config, /샵플링 API 기본 주소/);
  assert.match(page, /GitHub Actions Secrets에 저장/);
  assert.match(page, /OPS CENTER에는 값이 저장되지 않습니다/);
  assert.match(page, /현재 상세페이지 엔진은 OPS CENTER에서 설정할 필수 환경변수가 없습니다/);
});

test("status and save APIs expose statuses without secret values and validate allowlists", () => {
  assert.match(statusRoute, /adminTokenStatus/);
  assert.match(statusRoute, /missing/);
  assert.match(statusRoute, /permission_denied/);
  assert.match(statusRoute, /configured/);
  assert.match(statusRoute, /unknown/);
  assert.match(secretsLib, /GITHUB_ENGINE_ADMIN_TOKEN이 없거나 권한이 부족합니다/);
  assert.match(secretsLib, /GITHUB_ENGINE_ADMIN_TOKEN 권한을 확인해 주세요/);
  assert.match(saveRoute, /getEngineEnvConfig/);
  assert.match(saveRoute, /허용되지 않은 엔진입니다/);
  assert.match(saveRoute, /허용되지 않은 Secret 이름입니다/);
  assert.match(saveRoute, /value\.trim\(\)/);
  assert.match(secretsLib, /actions\/secrets\/public-key/);
  assert.match(secretsLib, /crypto_box_seal|__engineSecretEncryptForTest/);
  assert.match(saveRoute, /savedSecrets/);
  assert.doesNotMatch(statusRoute, /secret_value|encrypted_value/);
  assert.doesNotMatch(saveRoute, /secretValues|localStorage|sessionStorage|encrypted_value/);
});

test("runner failure diagnosis links to environment setup", () => {
  assert.match(runner, /환경변수 설정이 필요합니다/);
  assert.match(runner, /LOGIN_ID, COMPANY_ID, API_AUTH_KEY, SHOPLING_BASE_URL/);
  assert.match(runner, /필수 환경 변수/);
  assert.match(runner, /설정 후 다시 실행하면 됩니다/);
  assert.match(runner, /엔진 환경변수 설정하기/);
  assert.match(runner, /\/engine-env-setup/);
});

test("safety restrictions remain in place", () => {
  const combined = [page, statusRoute, saveRoute, secretsLib, runner].join("\n");
  assert.doesNotMatch(combined, /child_process|PowerShell\.exe|powershell/i);
  assert.doesNotMatch(combined, /auto-publish|auto-apply/i);
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
  assert.doesNotMatch(combined, /operation history.*secret|secret.*operation history/i);
});

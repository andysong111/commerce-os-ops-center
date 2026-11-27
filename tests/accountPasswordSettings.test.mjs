import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { ACCOUNT_PASSWORD_MIN_LENGTH, validateAccountPassword, passwordRecoveryDestination } =
  await importTranspiledTypeScript(
    new URL("../src/lib/accountPassword.ts", import.meta.url),
  );

test("only a completed recovery code exchange opens the new password form", async () => {
  const data = { session: { user: { id: "fixture-account" } }, redirectType: "recovery" };
  const retry = "/forgot-password?error=link";
  const params = new URLSearchParams({ code: "one-use", sb_flow_id: "fixture-flow", next: "https://outside.example" });
  assert.equal(await passwordRecoveryDestination(params, async (code, options) => {
    assert.equal(code, "one-use");
    assert.deepEqual(options, { flowId: "fixture-flow" });
    return { data, error: null };
  }), "/account/password?recovery=1");
  for (const response of [
    { data, error: { message: "expired" } },
    { data: { ...data, session: null }, error: null },
    { data: { ...data, redirectType: null }, error: null },
  ]) assert.equal(await passwordRecoveryDestination(params, async () => response), retry);
  assert.equal(await passwordRecoveryDestination(params, async () => { throw new Error("offline"); }), retry);
  for (const invalid of ["", "code=one-use&error_code=otp_expired", "code=one-use&error=access_denied"]) {
    let exchanged = false;
    assert.equal(await passwordRecoveryDestination(new URLSearchParams(invalid), async () => {
      exchanged = true; return { data, error: null };
    }), retry);
    assert.equal(exchanged, false);
  }
});

test("계정 비밀번호는 16자 이상이며 두 입력값이 일치해야 한다", () => {
  assert.equal(ACCOUNT_PASSWORD_MIN_LENGTH, 16);
  assert.deepEqual(validateAccountPassword("short", "short"), {
    ok: false,
    message: "비밀번호는 16자 이상이어야 합니다.",
  });
  assert.deepEqual(
    validateAccountPassword("abcdefghijklmnop", "abcdefghijklmnop!"),
    {
      ok: false,
      message: "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.",
    },
  );
  assert.deepEqual(
    validateAccountPassword("abcdefghijklmnop", "abcdefghijklmnop"),
    { ok: true },
  );
});

test("로그인된 현재 사용자만 updateUser로 비밀번호를 설정한다", async () => {
  const page = await readFile(
    new URL("../src/app/account/password/page.tsx", import.meta.url),
    "utf8",
  );
  const form = await readFile(
    new URL(
      "../src/components/account/PasswordSettingsForm.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(page, /getOpsCurrentUser\(\)/);
  assert.match(page, /next=%2Faccount%2Fpassword/);
  assert.match(form, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(page + form, /admin|deleteUser|createUser|service_role/i);
});

test("로그인 화면은 기존 비밀번호와 매직링크 동작을 분리한다", async () => {
  const login = await readFile(
    new URL("../src/app/login/page.tsx", import.meta.url),
    "utf8",
  );
  const sidebar = await readFile(
    new URL("../src/components/Sidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(login, /value="password"/);
  assert.match(login, /value="magic_link"/);
  assert.match(login, /기존 비밀번호/);
  assert.match(login, /새 비밀번호를 만드는 칸이 아닙니다/);
  assert.doesNotMatch(login, /optional for magic link|Sign in \/ Send magic link/);
  assert.match(sidebar, /\/account\/password/);
  assert.match(sidebar, /비밀번호 설정·변경/);
});

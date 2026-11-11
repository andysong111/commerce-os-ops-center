import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDomeggookInstallArguments,
  domeggookTaskName,
  normalizeDomeggookAccountsSettings,
  normalizeDomeggookLocalSettings,
} from "../src/lib/domeggookPeriodExtensionSettings.ts";

test("settings default to the approved account, 00:10, 90 days, and live execution", () => {
  assert.deepEqual(normalizeDomeggookLocalSettings(null), {
    accountId: "everysale999",
    scheduleTime: "00:10",
    extensionDays: 90,
    liveExecution: true,
    updatedAt: null,
  });
});

test("settings reject invalid account, time, and extension days", () => {
  assert.throws(() => normalizeDomeggookLocalSettings({ accountId: "아이디" }), /아이디/);
  assert.throws(() => normalizeDomeggookLocalSettings({ scheduleTime: "24:10" }), /HH:mm/);
  assert.throws(() => normalizeDomeggookLocalSettings({ extensionDays: 91 }), /1~90일/);
});

test("scheduled-task arguments include live execution only when explicitly enabled", () => {
  const live = normalizeDomeggookLocalSettings(null);
  assert.deepEqual(buildDomeggookInstallArguments(live), [
    "-At", "00:10", "-Days", "90", "-AccountId", "everysale999", "-Execute",
  ]);
  assert.equal(
    buildDomeggookInstallArguments({ ...live, liveExecution: false }).includes("-Execute"),
    false,
  );
});

test("multiple accounts receive isolated ports and scheduled-task names", () => {
  const settings = normalizeDomeggookAccountsSettings({
    accounts: [
      { ...normalizeDomeggookLocalSettings({ accountId: "everysale999", scheduleTime: "00:10" }), enabled: true, debugPort: 0 },
      { ...normalizeDomeggookLocalSettings({ accountId: "buzz1237", scheduleTime: "00:15" }), enabled: true, debugPort: 0 },
    ],
    updatedAt: null,
  });
  assert.equal(settings.accounts.length, 2);
  assert.notEqual(settings.accounts[0].debugPort, settings.accounts[1].debugPort);
  assert.equal(domeggookTaskName("buzz1237"), "Commerce OS Domeggook Period Extension - buzz1237");
});

test("multiple-account settings reject duplicate account IDs", () => {
  assert.throws(() => normalizeDomeggookAccountsSettings({
    accounts: [
      { ...normalizeDomeggookLocalSettings({ accountId: "buzz1237" }), enabled: true, debugPort: 9400 },
      { ...normalizeDomeggookLocalSettings({ accountId: "BUZZ1237" }), enabled: true, debugPort: 9401 },
    ],
    updatedAt: null,
  }), /중복된 도매꾹 아이디/);
});

test("dashboard search exposes the multi-account card with current-user DPAPI credentials", async () => {
  const [card, registry, workspace, api, saveCredential, runner] = await Promise.all([
    readFile("src/components/domeggook-period-extension/DomeggookPeriodExtensionCard.tsx", "utf8"),
    readFile("src/lib/opsModuleRegistry.ts", "utf8"),
    readFile("src/lib/opsWorkspace.ts", "utf8"),
    readFile("src/app/api/local/domeggook-period-extension/route.ts", "utf8"),
    readFile("local-agent/scripts/save-domeggook-credential.ps1", "utf8"),
    readFile("local-agent/scripts/run-domeggook-period-extension.ps1", "utf8"),
  ]);
  assert.match(card, /도매꾹 아이디/);
  assert.match(card, /\+ 계정 추가/);
  assert.match(card, /모든 계정 저장 및 예약 적용/);
  assert.match(card, /type="time"/);
  assert.match(card, /Windows 암호화 저장/);
  assert.match(card, /type="password"/);
  assert.doesNotMatch(card, /password\s*:/i);
  assert.match(registry, /id: "domeggook-period-extension"/);
  assert.match(registry, /Windows 사용자 전용 암호화 저장소/);
  assert.match(workspace, /patterns: \[\/도매꾹\//);
  assert.match(workspace, /moduleIds: \["domeggook-period-extension"\]/);
  assert.match(api, /localhost/);
  assert.match(api, /다른 사이트에서 보낸 실행 요청은 차단/);
  assert.match(saveCredential, /DataProtectionScope\]::CurrentUser/);
  assert.match(saveCredential, /ProtectedData\]::Protect/);
  assert.doesNotMatch(saveCredential, /ConvertTo-SecureString|Export-Clixml/);
  assert.match(runner, /ProtectedData\]::Unprotect/);
  assert.match(runner, /\.dpapi/);
});

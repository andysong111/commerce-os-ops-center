import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasCjLoisDpapiCredential,
  readCjLoisDpapiCredential,
} from "../local-agent/src/windows-dpapi-credential.mjs";

const config = {
  agentRoot: "C:/agent",
  cjLoisCredentialPath: "C:/agent/data/secrets/cj-lois-credential.json",
};

test("DPAPI credential availability reports presence without decrypting", async () => {
  let accessed = "";
  const available = await hasCjLoisDpapiCredential(config, {
    allowNonWindows: true,
    access: async (path) => { accessed = path; },
  });
  assert.equal(available, true);
  assert.equal(accessed, config.cjLoisCredentialPath);
});

test("DPAPI credential loader validates the helper result and never passes a secret on the command line", async () => {
  let helperArgs;
  const credential = await readCjLoisDpapiCredential(config, {
    allowNonWindows: true,
    runPowerShell: async (...args) => {
      helperArgs = args;
      return { stdout: JSON.stringify({ username: "operator-id", password: "secret-value" }) };
    },
  });
  assert.deepEqual(credential, { username: "operator-id", password: "secret-value" });
  assert.equal(helperArgs.includes("secret-value"), false);
});

test("DPAPI credential loader fails closed on malformed helper output", async () => {
  await assert.rejects(readCjLoisDpapiCredential(config, {
    allowNonWindows: true,
    runPowerShell: async () => ({ stdout: "not-json" }),
  }), { code: "CJ_DPAPI_OUTPUT_INVALID" });
});

test("credential scripts use secure input and Windows LocalMachine DPAPI", async () => {
  const [saveScript, readScript, migrateScript, gitignore] = await Promise.all([
    readFile("local-agent/scripts/save-cj-lois-credential.ps1", "utf8"),
    readFile("local-agent/scripts/read-cj-lois-credential.ps1", "utf8"),
    readFile("local-agent/scripts/migrate-cj-lois-credential.ps1", "utf8"),
    readFile(".gitignore", "utf8"),
  ]);
  assert.match(saveScript, /Read-Host .* -AsSecureString/);
  assert.match(saveScript, /System\.Security\.Cryptography\.DataProtectionScope\]::LocalMachine/);
  assert.match(readScript, /WINDOWS_LOCAL_MACHINE_DPAPI_V1/);
  assert.match(migrateScript, /WINDOWS_CURRENT_USER_DPAPI/);
  assert.match(migrateScript, /System\.Security\.Cryptography\.DataProtectionScope\]::LocalMachine/);
  assert.match(gitignore, /local-agent\/data\/secrets/);
  assert.doesNotMatch(saveScript, /password\s*=\s*["'][^"']+["']/i);
});

import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export async function hasCjLoisDpapiCredential(config, dependencies = {}) {
  if (process.platform !== "win32" && dependencies.allowNonWindows !== true) return false;
  const path = config?.cjLoisCredentialPath;
  if (!path) return false;
  try {
    await (dependencies.access || access)(path);
    return true;
  } catch {
    return false;
  }
}

export async function readCjLoisDpapiCredential(config, dependencies = {}) {
  if (process.platform !== "win32" && dependencies.allowNonWindows !== true) {
    fail("CJ_DPAPI_WINDOWS_REQUIRED", "CJ credential decryption requires Windows.");
  }
  const credentialPath = config?.cjLoisCredentialPath;
  if (!credentialPath) fail("CJ_DPAPI_CREDENTIAL_PATH_MISSING", "CJ credential path is not configured.");
  const scriptPath = resolve(config.agentRoot, "scripts", "read-cj-lois-credential.ps1");
  const runPowerShell = dependencies.runPowerShell || (async (file, path) => {
    try {
      return await execFile("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        file,
        "-Path",
        path,
      ], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024,
      });
    } catch {
      fail("CJ_DPAPI_DECRYPT_FAILED", "CJ credential could not be decrypted for the current Windows user.");
    }
  });
  const result = await runPowerShell(scriptPath, credentialPath);
  let parsed;
  try {
    parsed = JSON.parse(String(result?.stdout || "").trim());
  } catch {
    fail("CJ_DPAPI_OUTPUT_INVALID", "CJ credential helper returned an invalid result.");
  }
  const username = String(parsed?.username || "").trim();
  const password = String(parsed?.password || "");
  if (!username || !password) fail("CJ_DPAPI_CREDENTIAL_INVALID", "CJ credential is incomplete.");
  return { username, password };
}

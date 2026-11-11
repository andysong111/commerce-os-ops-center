import "server-only";

import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDomeggookInstallArguments,
  DOMEGGOOK_TASK_NAME,
  domeggookTaskName,
  normalizeDomeggookAccountsSettings,
  type DomeggookAccountSettings,
  type DomeggookAccountsSettings,
} from "@/lib/domeggookPeriodExtensionSettings";

export type { DomeggookAccountSettings, DomeggookAccountsSettings } from "@/lib/domeggookPeriodExtensionSettings";

export type DomeggookTaskState = {
  accountId: string;
  installed: boolean;
  state: string | null;
  nextRunTime: string | null;
};

function repoRoot() {
  return process.cwd();
}

function dataDir() {
  return path.join(repoRoot(), "local-agent", "data", "domeggook-period-extension");
}

function settingsPath() {
  return path.join(dataDir(), "settings.json");
}

function receiptPath(accountId: string) {
  return path.join(dataDir(), accountId, "latest.json");
}

function credentialPath(accountId: string) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "";
  return path.join(localAppData, "CommerceOS", "DomeggookCredentials", `${accountId}.dpapi`);
}

function scriptPath(name: string) {
  return path.join(repoRoot(), "local-agent", "scripts", name);
}

async function readJson(pathname: string) {
  try {
    const text = await readFile(pathname, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readDomeggookAccountsSettings() {
  const stored = await readJson(settingsPath());
  return normalizeDomeggookAccountsSettings(
    stored && typeof stored === "object" ? stored as Partial<DomeggookAccountsSettings> : null,
  );
}

export async function writeDomeggookAccountsSettings(value: Partial<DomeggookAccountsSettings>) {
  const settings = normalizeDomeggookAccountsSettings(value);
  const saved = { ...settings, updatedAt: new Date().toISOString() };
  await mkdir(dataDir(), { recursive: true });
  const temporary = `${settingsPath()}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  await rename(temporary, settingsPath());
  return saved;
}

function requireLocalWindows() {
  if (process.platform !== "win32") {
    throw new Error("이 기능은 Commerce OS를 실행 중인 로컬 Windows에서만 사용할 수 있습니다.");
  }
}

function runProcess(executable: string, args: string[], timeoutMs = 120_000, input?: string) {
  requireLocalWindows();
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repoRoot(),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("로컬 실행 제한시간을 초과했습니다."));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-20_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-20_000); });
    if (input !== undefined) child.stdin?.end(input);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `로컬 실행이 종료코드 ${code}로 실패했습니다.`));
    });
  });
}

export async function saveDomeggookCredentials(passwords: Record<string, string> | undefined) {
  if (!passwords) return;
  for (const [accountId, password] of Object.entries(passwords)) {
    if (!password) continue;
    try {
      await runProcess(
        "powershell.exe",
        powershellFileArgs(scriptPath("save-domeggook-credential.ps1"), ["-AccountId", accountId]),
        30_000,
        password,
      );
    } catch {
      throw new Error(`도매꾹 계정 ${accountId}의 비밀번호를 Windows 암호화 저장소에 저장하지 못했습니다.`);
    }
  }
}

function powershellFileArgs(file: string, args: string[]) {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args];
}

async function installAccount(account: DomeggookAccountSettings) {
  return runProcess(
    "powershell.exe",
    powershellFileArgs(scriptPath("install-domeggook-period-extension-task.ps1"), [
      ...buildDomeggookInstallArguments(account),
      "-DebugPort", String(account.debugPort),
    ]),
  );
}

async function uninstallTask(taskName: string) {
  return runProcess(
    "powershell.exe",
    powershellFileArgs(scriptPath("uninstall-domeggook-period-extension-task.ps1"), ["-TaskName", taskName]),
  );
}

async function listInstalledTaskNames() {
  const command = `$prefix='${DOMEGGOOK_TASK_NAME}'; @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {$_.TaskName -like "$prefix*"} | Select-Object -ExpandProperty TaskName) | ConvertTo-Json -Compress`;
  const result = await runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], 20_000);
  const parsed = JSON.parse(result.stdout.trim() || "[]") as string | string[] | null;
  return parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
}

export async function installDomeggookTasks(value: Partial<DomeggookAccountsSettings>) {
  const settings = await writeDomeggookAccountsSettings(value);
  const enabledAccounts = settings.accounts.filter((account) => account.enabled);
  const desiredNames = new Set(enabledAccounts.map((account) => domeggookTaskName(account.accountId)));
  for (const existing of await listInstalledTaskNames()) {
    if (!desiredNames.has(existing)) await uninstallTask(existing);
  }
  for (const account of enabledAccounts) await installAccount(account);
  return settings;
}

export async function runDomeggookAccountNow(
  account: DomeggookAccountSettings,
  execute: boolean,
  showChrome = false,
) {
  return runProcess(
    "powershell.exe",
    powershellFileArgs(scriptPath("run-domeggook-period-extension.ps1"), [
      "-Days", String(account.extensionDays),
      "-AccountId", account.accountId,
      "-DebugPort", String(account.debugPort),
      ...(execute ? ["-Execute"] : []),
      ...(showChrome ? ["-ShowChrome", "-LaunchOnly"] : []),
    ]),
    180_000,
  );
}

export async function readDomeggookTaskState(account: DomeggookAccountSettings): Promise<DomeggookTaskState> {
  if (process.platform !== "win32") {
    return { accountId: account.accountId, installed: false, state: null, nextRunTime: null };
  }
  const taskName = domeggookTaskName(account.accountId);
  const command = `$task=Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; if(-not $task){'null'}else{$info=Get-ScheduledTaskInfo -TaskName '${taskName}'; [pscustomobject]@{state=[string]$task.State;nextRunTime=$info.NextRunTime.ToString('o')}|ConvertTo-Json -Compress}`;
  try {
    const result = await runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], 20_000);
    const parsed = JSON.parse(result.stdout.trim()) as { state?: string; nextRunTime?: string } | null;
    return parsed
      ? { accountId: account.accountId, installed: true, state: parsed.state ?? null, nextRunTime: parsed.nextRunTime ?? null }
      : { accountId: account.accountId, installed: false, state: null, nextRunTime: null };
  } catch {
    return { accountId: account.accountId, installed: false, state: null, nextRunTime: null };
  }
}

export async function readDomeggookLocalState() {
  const settings = await readDomeggookAccountsSettings();
  const [tasks, receipts] = await Promise.all([
    Promise.all(settings.accounts.map(readDomeggookTaskState)),
    Promise.all(settings.accounts.map(async (account) => ({
      accountId: account.accountId,
      receipt: await readJson(receiptPath(account.accountId)),
    }))),
  ]);
  const credentials = await Promise.all(settings.accounts.map(async (account) => {
    const pathname = credentialPath(account.accountId);
    if (!pathname) return { accountId: account.accountId, saved: false };
    try {
      await access(pathname);
      return { accountId: account.accountId, saved: true };
    } catch {
      return { accountId: account.accountId, saved: false };
    }
  }));
  return { settings, tasks, receipts, credentials, localWindows: process.platform === "win32" };
}

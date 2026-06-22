import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const SHOPLING_PRODUCT_UPLOAD_CHANNELS = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
] as const;

export type ShoplingProductUploadChannel =
  | ""
  | (typeof SHOPLING_PRODUCT_UPLOAD_CHANNELS)[number];

export type ShoplingProductUploadInput = {
  rowExpression: string;
  channel: string;
  skip_if_goods_key?: boolean;
  dump?: boolean;
  sleep?: unknown;
};

export type ShoplingProductUploadResult = {
  status: "success" | "error" | "blocked" | "timeout";
  message?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  exitCode?: number | null;
  commandPreview?: string;
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

const ROW_EXPRESSION_PATTERN = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const MAX_TARGET_COUNT = 300;
const DEFAULT_SLEEP = 1.2;
const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function isValidRowExpression(rowExpression: string) {
  return ROW_EXPRESSION_PATTERN.test(rowExpression);
}

export function isValidShoplingProductUploadChannel(
  channel: string,
): channel is ShoplingProductUploadChannel {
  return channel === "" || SHOPLING_PRODUCT_UPLOAD_CHANNELS.includes(channel as never);
}

export function normalizeSleep(value: unknown) {
  if (value === undefined || value === null || value === "") return DEFAULT_SLEEP;
  const sleep = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(sleep) || sleep < 0 || sleep > 10) {
    throw new Error("실행 간격 초는 0 이상 10 이하의 숫자여야 합니다.");
  }
  return sleep;
}

export function countRowsInExpression(rowExpression: string) {
  if (!isValidRowExpression(rowExpression)) {
    throw new Error("실재고 시트 행 번호 형식이 올바르지 않습니다.");
  }

  return rowExpression.split(",").reduce((total, part) => {
    const [startText, endText] = part.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (end < start) {
      throw new Error("행 범위의 종료 번호는 시작 번호보다 작을 수 없습니다.");
    }
    return total + (end - start + 1);
  }, 0);
}

export function estimateTargetCount(rowExpression: string, channel: string) {
  const rowCount = countRowsInExpression(rowExpression);
  const channelCount = channel === "" ? SHOPLING_PRODUCT_UPLOAD_CHANNELS.length : 1;
  return rowCount * channelCount;
}

function quotePreview(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildShoplingProductUploadCommand(input: ShoplingProductUploadInput) {
  const rowExpression = input.rowExpression.trim();
  const channel = input.channel;

  if (!isValidRowExpression(rowExpression)) {
    throw new Error("실재고 시트 행 번호 형식이 올바르지 않습니다.");
  }
  if (!isValidShoplingProductUploadChannel(channel)) {
    throw new Error("지원하지 않는 채널입니다.");
  }

  const sleep = normalizeSleep(input.sleep);
  const targetCount = estimateTargetCount(rowExpression, channel);
  if (targetCount > MAX_TARGET_COUNT) {
    throw new Error(`예상 실행 대상이 ${targetCount}건입니다. 최대 ${MAX_TARGET_COUNT}건까지만 실행할 수 있습니다.`);
  }

  const args = ["run_batch.py", rowExpression];
  if (channel !== "") args.push("--channel", channel);
  if (input.skip_if_goods_key === true) args.push("--skip_if_goods_key");
  if (input.dump === true) args.push("--dump");
  args.push("--sleep", String(sleep));

  return {
    args,
    commandPreview: ["python", "run_batch.py", quotePreview(rowExpression), ...(channel !== "" ? ["--channel", quotePreview(channel)] : []), ...(input.skip_if_goods_key === true ? ["--skip_if_goods_key"] : []), ...(input.dump === true ? ["--dump"] : []), "--sleep", String(sleep)].join(" "),
    shell: false as const,
    targetCount,
  };
}

function appendCapped(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString();
  if (next.length <= MAX_OUTPUT_CHARS) return { value: next, truncated: false };
  return { value: next.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

export async function runShoplingProductUpload(input: ShoplingProductUploadInput): Promise<ShoplingProductUploadResult> {
  if (process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED !== "1") {
    return { status: "blocked", message: "SHOPLING_PRODUCT_UPLOAD_ENABLED=1 인 경우에만 실행할 수 있습니다." };
  }

  const engineDir = process.env.SHOPLING_PRODUCT_UPLOAD_ENGINE_DIR;
  const python = process.env.SHOPLING_PRODUCT_UPLOAD_PYTHON;
  if (!engineDir || !python) {
    return { status: "error", message: "외부 엔진 경로와 Python 실행 파일 환경변수가 필요합니다." };
  }
  if (!existsSync(path.join(engineDir, "run_batch.py"))) {
    return { status: "error", message: "SHOPLING_PRODUCT_UPLOAD_ENGINE_DIR에서 run_batch.py를 찾을 수 없습니다." };
  }

  let command;
  try {
    command = buildShoplingProductUploadCommand(input);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다." };
  }

  const start = Date.now();
  const startTime = new Date(start).toISOString();
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;

  return new Promise((resolve) => {
    const child = spawn(python, command.args, { cwd: engineDir, shell: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      const appended = appendCapped(stdout, chunk);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });
    child.stderr?.on("data", (chunk) => {
      const appended = appendCapped(stderr, chunk);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const end = Date.now();
      resolve({ status: "error", message: error.message, startTime, endTime: new Date(end).toISOString(), durationMs: end - start, commandPreview: command.commandPreview, stdout, stderr, stdoutTruncated, stderrTruncated });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const end = Date.now();
      resolve({ status: timedOut ? "timeout" : exitCode === 0 ? "success" : "error", startTime, endTime: new Date(end).toISOString(), durationMs: end - start, exitCode, commandPreview: command.commandPreview, stdout, stderr, stdoutTruncated, stderrTruncated });
    });
  });
}

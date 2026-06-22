import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoplingProductUploadCommand,
  buildShoplingProductUploadSpawnOptions,
  estimateTargetCount,
  isValidRowExpression,
  isValidShoplingProductUploadChannel,
} from "../src/lib/shoplingProductUploadRunner.ts";

const acceptedRows = ["967", "698,714", "714-730", "698,714-730,801"];
const rejectedRows = [
  "",
  "abc",
  "1; rm -rf",
  "1 && echo test",
  "../run_batch.py",
  "1|whoami",
  "1 2",
  "1/2",
  "1\\2",
  '"1"',
  "'1'",
];

test("row expression validation accepts supported formats", () => {
  for (const rowExpression of acceptedRows) {
    assert.equal(isValidRowExpression(rowExpression), true, rowExpression);
  }
});

test("row expression validation rejects unsafe or unsupported formats", () => {
  for (const rowExpression of rejectedRows) {
    assert.equal(isValidRowExpression(rowExpression), false, rowExpression);
  }
});

test("channel validation accepts only the allowlist and empty 전체 value", () => {
  for (const channel of ["", "도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]) {
    assert.equal(isValidShoplingProductUploadChannel(channel), true, channel);
  }
  for (const channel of ["전체", "도매5", "소매3", "admin", "1;whoami"]) {
    assert.equal(isValidShoplingProductUploadChannel(channel), false, channel);
  }
});

test("command builder creates a safe argument array for all-channel runs and ignores dump by default", () => {
  delete process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED;

  const command = buildShoplingProductUploadCommand({
    rowExpression: "967",
    channel: "",
    skip_if_goods_key: true,
    dump: true,
    sleep: 1.2,
  });

  assert.deepEqual(command.args, [
    "run_batch.py",
    "967",
    "--skip_if_goods_key",
    "--sleep",
    "1.2",
  ]);
  assert.equal(command.shell, false);
  assert.equal(command.args.includes("--channel"), false);
  assert.equal(command.commandPreview, 'python run_batch.py "967" --skip_if_goods_key --sleep 1.2');
  assert.equal(command.args.includes("--dump"), false);
  assert.equal(command.commandPreview.includes("--dump"), false);
  assert.equal(command.args.includes("--skip_if_goods_key"), true);
  assert.equal(command.rawDumpEnabled, false);
  assert.equal(command.rawDumpReason, "민감정보 보호를 위해 원문 XML 덤프는 비활성화되어 있습니다.");
});

test("command builder allows dump only when explicit raw dump env flag is enabled", () => {
  process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED = "1";
  try {
    const command = buildShoplingProductUploadCommand({
      rowExpression: "967",
      channel: "",
      skip_if_goods_key: true,
      dump: true,
      sleep: 1.2,
    });

    assert.equal(command.args.includes("--dump"), true);
    assert.equal(command.commandPreview.includes("--dump"), true);
    assert.equal(command.rawDumpEnabled, true);
    assert.equal(command.rawDumpReason, undefined);
  } finally {
    delete process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED;
  }
});

test("command builder includes channel only when selected", () => {
  const command = buildShoplingProductUploadCommand({
    rowExpression: "698,714-730,801",
    channel: "도매1",
    skip_if_goods_key: true,
    dump: false,
    sleep: "1.2",
  });

  assert.deepEqual(command.args, [
    "run_batch.py",
    "698,714-730,801",
    "--channel",
    "도매1",
    "--skip_if_goods_key",
    "--sleep",
    "1.2",
  ]);
  assert.equal(command.shell, false);
  assert.equal(command.commandPreview.includes("--channel \"도매1\""), true);
  assert.equal(command.args.includes("--dump"), false);
  assert.equal(command.args.includes("--skip_if_goods_key"), true);
});

test("spawn options force Python UTF-8 output without enabling shell", () => {
  const options = buildShoplingProductUploadSpawnOptions("/tmp/shopling-engine");

  assert.equal(options.cwd, "/tmp/shopling-engine");
  assert.equal(options.shell, false);
  assert.equal(options.env.PYTHONIOENCODING, "utf-8");
  assert.equal(options.env.PYTHONUTF8, "1");
  assert.equal(options.env.PATH, process.env.PATH);
});

test("target count protection allows small ranges and rejects over 300", () => {
  assert.equal(estimateTargetCount("967", ""), 6);
  assert.equal(estimateTargetCount("714-730", "도매1"), 17);
  assert.throws(
    () => buildShoplingProductUploadCommand({ rowExpression: "1-51", channel: "", sleep: 1.2 }),
    /최대 300건/,
  );
});

test("UI source includes required Korean labels", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("src/app/shopling-product-upload-runner/page.tsx", "utf8");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );
  const source = `${page}\n${component}`;

  for (const text of [
    "샵플링 상품등록 실행기",
    "실재고 시트 행 번호",
    "채널",
    "전체 6채널",
    "기본값은 도매1~도매4, 소매1~소매2 전체 등록입니다.",
    "이미 goods_key 있으면 스킵",
    "상품등록 실행",
    "실행 결과",
  ]) {
    assert.equal(source.includes(text), true, text);
  }
});

test("UI hides sleep and raw dump inputs and explains SaaS-safe logging", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes("실행 간격 초"), false);
  assert.equal(component.includes("실행 간격은 안정성을 위해 1.2초로 고정됩니다."), true);
  assert.equal(component.includes("요청/응답 XML 덤프 저장"), false);
  assert.equal(component.includes('name="dump"'), false);
  assert.equal(component.includes("민감정보 보호를 위해 원문 XML 요청/응답은 기본 저장하지 않습니다."), true);
  assert.equal(component.includes("실행 결과에는 행 번호, 채널, 성공/실패/SKIP, goods_key 중심의 요약 정보만 표시됩니다."), true);
});

test("client request sends fixed sleep and does not read dump form data", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes('sleep: "1.2"'), true);
  assert.equal(component.includes('dump: false'), true);
  assert.equal(component.includes('formData.get("sleep")'), false);
  assert.equal(component.includes('formData.get("dump")'), false);
});


test("runner implementation keeps process execution safety constraints", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/shoplingProductUploadRunner.ts", "utf8");

  assert.equal(source.includes("shell: true"), false);
  assert.equal(source.includes("exec("), false);
  assert.doesNotMatch(source, /PowerShell|powershell|pwsh/i);
  assert.match(source, /spawn\(python, command\.args/);
});

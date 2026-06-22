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

test("command builder creates a safe argument array for all-channel runs", () => {
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
    "--dump",
    "--sleep",
    "1.2",
  ]);
  assert.equal(command.shell, false);
  assert.equal(command.args.includes("--channel"), false);
  assert.equal(command.commandPreview.includes("--sleep 1.2"), true);
  assert.equal(command.args.includes("--dump"), true);
  assert.equal(command.args.includes("--skip_if_goods_key"), true);
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
    "요청/응답 XML 덤프 저장",
    "상품등록 실행",
    "실행 결과",
  ]) {
    assert.equal(source.includes(text), true, text);
  }
});

test("UI hides sleep input and explains fixed interval plus dump sensitivity", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes("실행 간격 초"), false);
  assert.equal(component.includes("실행 간격은 안정성을 위해 1.2초로 고정됩니다."), true);
  assert.equal(component.includes("덤프 파일에는 민감정보가 포함될 수 있으므로 외부 공유 금지."), true);
});

test("client request sends fixed sleep value", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes('sleep: "1.2"'), true);
  assert.equal(component.includes('formData.get("sleep")'), false);
});


test("runner implementation keeps process execution safety constraints", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/shoplingProductUploadRunner.ts", "utf8");

  assert.equal(source.includes("shell: true"), false);
  assert.equal(source.includes("exec("), false);
  assert.doesNotMatch(source, /PowerShell|powershell|pwsh/i);
  assert.match(source, /spawn\(python, command\.args/);
});

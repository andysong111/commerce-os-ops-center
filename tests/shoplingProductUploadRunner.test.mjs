import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoplingProductUploadCommand,
  buildShoplingProductUploadDispatchRequest,
  dispatchShoplingProductUploadActions,
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

function withGithubActionsEnv(overrides, callback) {
  const keys = [
    "SHOPLING_UPLOAD_REPO",
    "SHOPLING_UPLOAD_WORKFLOW",
    "SHOPLING_UPLOAD_REF",
    "GITHUB_ACTIONS_TOKEN",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SHOPLING_UPLOAD_REPO = "andysong111/shopling-product-upload-auto";
  process.env.SHOPLING_UPLOAD_WORKFLOW = "shopling-product-upload.yml";
  process.env.SHOPLING_UPLOAD_REF = "main";
  process.env.GITHUB_ACTIONS_TOKEN = "ghp_test_secret";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("GitHub Actions dispatch payload maps empty channel to all-channel workflow input", () => {
  withGithubActionsEnv({}, () => {
    const request = buildShoplingProductUploadDispatchRequest({
      rowExpression: "950",
      channel: "",
      skip_if_goods_key: true,
    });

    assert.equal(request.url, "https://api.github.com/repos/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml/dispatches");
    assert.equal(request.githubActionsUrl, "https://github.com/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml");
    assert.deepEqual(request.body, {
      ref: "main",
      inputs: {
        row_expression: "950",
        channel: "전체 6채널",
        skip_if_goods_key: true,
      },
    });
    assert.equal(request.commandPreview, "GitHub Actions: shopling-product-upload.yml row=950 channel=전체 6채널 skip_if_goods_key=true");
    assert.equal(request.token, "ghp_test_secret");
  });
});

test("GitHub Actions dispatch payload preserves selected channel and ref", () => {
  withGithubActionsEnv({ SHOPLING_UPLOAD_REF: "main" }, () => {
    const request = buildShoplingProductUploadDispatchRequest({
      rowExpression: "698,714-730,801",
      channel: "도매1",
      skip_if_goods_key: false,
    });

    assert.equal(request.body.ref, "main");
    assert.equal(request.body.inputs.row_expression, "698,714-730,801");
    assert.equal(request.body.inputs.channel, "도매1");
    assert.equal(request.body.inputs.skip_if_goods_key, false);
  });
});

test("GitHub Actions env validation rejects missing or invalid repository settings safely", () => {
  withGithubActionsEnv({ GITHUB_ACTIONS_TOKEN: undefined }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /GITHUB_ACTIONS_TOKEN/,
    );
  });
  withGithubActionsEnv({ SHOPLING_UPLOAD_REPO: undefined }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /SHOPLING_UPLOAD_REPO/,
    );
  });
  withGithubActionsEnv({ SHOPLING_UPLOAD_REPO: "invalid" }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /owner\/repo/,
    );
  });
});

test("GitHub Actions dispatch success returns queued result without exposing token", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCall;
  globalThis.fetch = async (url, init) => {
    fetchCall = { url, init };
    return { status: 204, text: async () => "" };
  };
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await dispatchShoplingProductUploadActions({
        rowExpression: "950",
        channel: "",
        skip_if_goods_key: true,
      });

      assert.equal(result.status, "queued");
      assert.equal(result.githubActionsUrl, "https://github.com/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml");
      assert.equal(JSON.stringify(result).includes("ghp_test_secret"), false);
      assert.equal(fetchCall.init.headers.Authorization, "Bearer ghp_test_secret");
      assert.equal(JSON.parse(fetchCall.init.body).inputs.channel, "전체 6채널");
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
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
  assert.match(source, /SHOPLING_PRODUCT_UPLOAD_RUN_MODE === "github_actions"/);
});

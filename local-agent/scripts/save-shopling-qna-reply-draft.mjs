#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { withShoplingQnaBrowserAdapter } from "../src/shopling-qna-browser-adapter.mjs";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { runShoplingQnaReplyDraft } from "../src/shopling-qna-reply-draft.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      flags.execute = true;
      continue;
    }
    if (token.startsWith("--") && argv[index + 1]) {
      flags[token.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function selectReplyStep(review, requestedKey) {
  const steps = review?.qnaReplyPlan?.replySteps || review?.replySteps || [];
  const matches = steps.filter((step) => !requestedKey || String(step.qnaKey) === String(requestedKey));
  if (matches.length !== 1) {
    fail("QNA_REVIEWED_ACTION_COUNT_INVALID", `Expected one reviewed QnA reply step, found ${matches.length}.`);
  }
  return matches[0];
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.review) fail("QNA_REVIEW_FILE_REQUIRED", "--review is required.");

const review = JSON.parse(await readFile(resolve(flags.review), "utf8"));
const step = selectReplyStep(review, flags.qna);
const startDate = String(review?.range?.startDate || review?.range?.start || "");
const endDate = String(review?.range?.endDate || review?.range?.end || "");
if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate)) {
  fail("QNA_REVIEW_RANGE_INVALID", "The review must contain its exact Shopling read range.");
}

const readCurrentQnas = async () => {
  const snapshot = await readShoplingCustomerServiceSnapshot({
    config: shoplingCustomerServiceConfigFromEnv(),
    startDate,
    endDate,
    resources: ["qna"],
  });
  return snapshot.qnas;
};

const result = await withShoplingQnaBrowserAdapter(loadConfig(), {
  account: flags.account || "andy801",
}, (adapter) => runShoplingQnaReplyDraft(step, {
  execute: flags.execute === true,
  approvalKey: flags["approval-key"] || "",
}, { adapter, readCurrentQnas }));

const audit = {
  ...result,
  completedAt: new Date().toISOString(),
  privacy: {
    rawQuestionStored: false,
    rawQuestionTitleStored: false,
    rawReplyStored: false,
    questionerIdentityStored: false,
  },
};
const serialized = `${JSON.stringify(audit, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);

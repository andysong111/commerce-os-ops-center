#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { withShoplingQnaBrowserAdapter } from "../src/shopling-qna-browser-adapter.mjs";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { runShoplingQnaDraftStaging } from "../src/shopling-qna-draft-staging.mjs";

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

const flags = parseArgs(process.argv.slice(2));
if (!flags.review) fail("QNA_REVIEW_FILE_REQUIRED", "--review is required.");

const review = JSON.parse(await readFile(resolve(flags.review), "utf8"));
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
}, (adapter) => runShoplingQnaDraftStaging(review, {
  execute: flags.execute === true,
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

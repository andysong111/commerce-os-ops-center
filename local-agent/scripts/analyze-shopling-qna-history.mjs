import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { analyzeShoplingQnaHistory } from "../src/shopling-qna-case-classifier.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key.startsWith("--") && argv[index + 1]) {
      flags[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

function required(value, code) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error(code);
  return cleaned;
}

const flags = parseArgs(process.argv.slice(2));
const startDate = required(flags.start, "QNA_HISTORY_START_REQUIRED");
const endDate = required(flags.end, "QNA_HISTORY_END_REQUIRED");
const keys = new Set(required(flags.keys, "QNA_HISTORY_KEYS_REQUIRED")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));

loadConfig();
const snapshot = await readShoplingCustomerServiceSnapshot({
  config: shoplingCustomerServiceConfigFromEnv(),
  startDate,
  endDate,
  resources: ["qna"],
});
const qnas = snapshot.qnas.filter((qna) => keys.has(String(qna.qnaKey)));
const found = new Set(qnas.map((qna) => String(qna.qnaKey)));
const missingKeys = [...keys].filter((key) => !found.has(key));
if (missingKeys.length) throw new Error(`QNA_HISTORY_KEYS_NOT_FOUND:${missingKeys.join(",")}`);

const report = {
  ...analyzeShoplingQnaHistory(qnas),
  capturedAt: snapshot.capturedAt,
  range: snapshot.range,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);

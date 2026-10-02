import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { buildShoplingQnaReplyPlan } from "../src/shopling-qna-reply-plan.mjs";
import { buildShoplingQnaAutomationPlan } from "../src/shopling-qna-automation-policy.mjs";
import { buildShoplingReturnPickupPlan } from "../src/shopling-return-pickup-plan.mjs";

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

function seoulCalendarDate(offsetDays = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) + offsetDays));
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

async function readOptionalArray(path, property) {
  if (!path) return [];
  const value = JSON.parse(await readFile(resolve(path), "utf8"));
  const items = Array.isArray(value) ? value : value?.[property];
  if (!Array.isArray(items)) throw new Error(`CUSTOMER_SERVICE_${property.toUpperCase()}_FILE_INVALID`);
  return items;
}

const flags = parseArgs(process.argv.slice(2));
const endDate = flags.end || seoulCalendarDate(0);
const startDate = flags.start || seoulCalendarDate(-30);
const resources = flags.scope === "qna" ? ["qna"] : ["claims", "orders", "qna"];
const [valueDecisions, proposedReplies, approvedRules, evidence] = await Promise.all([
  readOptionalArray(flags["decision-file"], "valueDecisions"),
  readOptionalArray(flags["reply-file"], "proposedReplies"),
  readOptionalArray(flags["rule-file"], "approvedRules"),
  readOptionalArray(flags["evidence-file"], "evidence"),
]);
const snapshot = await readShoplingCustomerServiceSnapshot({
  config: shoplingCustomerServiceConfigFromEnv(),
  startDate,
  endDate,
  resources,
});
const qnaReplyPlan = buildShoplingQnaReplyPlan(snapshot.qnas, proposedReplies);
const result = {
  schemaVersion: 1,
  mode: "PLAN_ONLY",
  capturedAt: snapshot.capturedAt,
  range: snapshot.range,
  sourceCounts: {
    claims: snapshot.claims.length,
    orders: snapshot.orders.length,
    qnas: snapshot.qnas.length,
  },
  returnPickupPlan: buildShoplingReturnPickupPlan({
    claims: snapshot.claims,
    orders: snapshot.orders,
    valueDecisions,
  }),
  qnaReplyPlan,
  qnaAutomationPlan: buildShoplingQnaAutomationPlan(snapshot.qnas, qnaReplyPlan, {
    approvedRules,
    evidence,
  }),
  externalWritesPerformed: false,
  privacy: {
    recipientNameStored: false,
    phoneStored: false,
    addressStored: false,
    rawQuestionStored: false,
    rawQuestionTitleStored: false,
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);

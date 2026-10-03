import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recoverCjLoisSession } from "../src/cj-lois-auth-recovery.mjs";
import { withCjLoisReturnPickupBrowserAdapter } from "../src/cj-lois-return-pickup-browser-adapter.mjs";
import { loadConfig } from "../src/config.mjs";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { createReturnPickupAuditStore } from "../src/shopling-return-pickup-audit.mjs";
import { runCjReturnPickupStage } from "../src/shopling-return-pickup-execution.mjs";
import { buildShoplingReturnPickupPlan } from "../src/shopling-return-pickup-plan.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[name] = argv[index + 1];
      index += 1;
    } else {
      flags[name] = true;
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

function selectReviewedStep(review, actionKey) {
  const steps = review?.returnPickupPlan?.pickupSteps || review?.pickupSteps || [];
  const matches = steps.filter((step) => step.actionKey === actionKey);
  if (matches.length !== 1) {
    const error = new Error("The review file must contain one exact return-pickup action.");
    error.code = "RETURN_PICKUP_REVIEW_STEP_COUNT_INVALID";
    throw error;
  }
  const candidates = review?.returnPickupPlan?.reviewCandidates || [];
  const candidateMatches = candidates.filter((candidate) => candidate.claimKey === matches[0].claimKey
    && candidate.orderNo === matches[0].orderNo
    && candidate.outboundInvoiceNo === matches[0].outboundInvoiceNo);
  const productNames = candidateMatches[0]?.productNames || [];
  const productName = productNames.join(" / ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (candidateMatches.length !== 1 || !productName) {
    const error = new Error("The review file must contain one product summary for the exact pickup action.");
    error.code = "RETURN_PICKUP_REVIEW_PRODUCT_INVALID";
    throw error;
  }
  return { ...matches[0], productName };
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.review || !flags["action-key"]) {
  throw Object.assign(
    new Error("CJ return-pickup stage requires --review and --action-key."),
    { code: "RETURN_PICKUP_ARGUMENTS_REQUIRED" },
  );
}

const review = JSON.parse(await readFile(resolve(flags.review), "utf8"));
const step = selectReviewedStep(review, flags["action-key"]);
const config = loadConfig();
const auditStore = createReturnPickupAuditStore(config.dataDir);
const endDate = flags.end || seoulCalendarDate(0);
const startDate = flags.start || seoulCalendarDate(-30);

const loadCurrentPickupSteps = async (reviewedStep) => {
  const snapshot = await readShoplingCustomerServiceSnapshot({
    config: shoplingCustomerServiceConfigFromEnv(),
    startDate,
    endDate,
    resources: ["claims", "orders"],
  });
  return buildShoplingReturnPickupPlan({
    claims: snapshot.claims,
    orders: snapshot.orders,
    valueDecisions: [{
      claimKey: reviewedStep.claimKey,
      orderNo: reviewedStep.orderNo,
      decision: "PICKUP_WORTHWHILE",
    }],
    operatorOverrides: step.operatorOverride ? [{
      claimKey: reviewedStep.claimKey,
      orderNo: reviewedStep.orderNo,
      override: step.operatorOverride,
    }] : [],
  }).pickupSteps;
};

const cjAuthentication = await recoverCjLoisSession(config);
const result = await withCjLoisReturnPickupBrowserAdapter(config, async (cjAdapter) => (
  runCjReturnPickupStage({
    step,
    execute: flags.execute === true,
    approvalKey: flags["approval-key"],
  }, {
    cjAdapter,
    loadCurrentPickupSteps,
    readAudit: auditStore.readAudit,
    writeAudit: auditStore.writeAudit,
  })
));

process.stdout.write(`${JSON.stringify({
  ...result,
  cjAuthentication,
  mode: flags.execute === true ? "execute" : "dry-run",
}, null, 2)}\n`);

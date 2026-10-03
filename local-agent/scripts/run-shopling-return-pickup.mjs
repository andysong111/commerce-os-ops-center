import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recoverCjLoisSession } from "../src/cj-lois-auth-recovery.mjs";
import { withCjLoisReturnPickupBrowserAdapter } from "../src/cj-lois-return-pickup-browser-adapter.mjs";
import { loadConfig } from "../src/config.mjs";
import {
  readShoplingCustomerServiceSnapshot,
  shoplingCustomerServiceConfigFromEnv,
} from "../src/shopling-customer-service-source.mjs";
import { withShoplingReturnB7BrowserAdapter } from "../src/shopling-return-b7-browser-adapter.mjs";
import { createReturnPickupAuditStore } from "../src/shopling-return-pickup-audit.mjs";
import { runShoplingReturnPickupExecution } from "../src/shopling-return-pickup-execution.mjs";
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
  return matches[0];
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.review || !flags["action-key"]) {
  throw Object.assign(
    new Error("return-pickup requires --review and --action-key."),
    { code: "RETURN_PICKUP_ARGUMENTS_REQUIRED" },
  );
}
const review = JSON.parse(await readFile(resolve(flags.review), "utf8"));
const step = selectReviewedStep(review, flags["action-key"]);
const config = loadConfig();
const auditStore = createReturnPickupAuditStore(config.dataDir);
const endDate = flags.end || seoulCalendarDate(0);
const startDate = flags.start || seoulCalendarDate(-30);
const existingAudit = await auditStore.readAudit(step.actionKey);

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

const executeWithAdapters = (b7Adapter, cjAdapter) => runShoplingReturnPickupExecution({
  step,
  execute: flags.execute === true,
  approvalKey: flags["approval-key"],
  claimContent: flags["claim-content"],
}, {
  b7Adapter,
  cjAdapter,
  loadCurrentPickupSteps,
  readAudit: auditStore.readAudit,
  writeAudit: auditStore.writeAudit,
});

let cjAuthentication = {
  authenticated: false,
  recovered: false,
  otpUsed: false,
  skipped: true,
};
let result;
if (["SHOPLING_RETURN_REGISTERED", "SHOPLING_RETURN_INVOICE_RECORDED"].includes(existingAudit?.stage)) {
  result = await executeWithAdapters(null, null);
} else if (existingAudit?.stage === "CJ_RESERVATION_VERIFIED") {
  result = await withShoplingReturnB7BrowserAdapter(
    config,
    (b7Adapter) => executeWithAdapters(b7Adapter, null),
    { expectedAccount: flags.account || "andy801" },
  );
} else {
  cjAuthentication = await recoverCjLoisSession(config);
  result = await withShoplingReturnB7BrowserAdapter(config, async (b7Adapter) => (
    withCjLoisReturnPickupBrowserAdapter(
      config,
      (cjAdapter) => executeWithAdapters(b7Adapter, cjAdapter),
    )
  ), { expectedAccount: flags.account || "andy801" });
}

process.stdout.write(`${JSON.stringify({
  ...result,
  cjAuthentication,
  mode: flags.execute === true ? "execute" : "dry-run",
}, null, 2)}\n`);

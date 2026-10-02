import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { withShoplingB12BrowserAdapter } from "../src/shopling-b12-browser-adapter.mjs";
import {
  normalizeB12InvoiceDeletionCandidate,
  runShoplingB12InvoiceDeletion,
} from "../src/shopling-b12-invoice-deletion.mjs";
import { normalizeTrackingNumber } from "../src/shopling-unshipped-reconciliation.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--execute") {
      flags.execute = true;
      continue;
    }
    if (key.startsWith("--") && argv[index + 1]) {
      flags[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

function selectCandidate(review, requestedInvoice) {
  const steps = review?.actionPlan?.invoiceDeletionSteps
    || review?.invoiceDeletionSteps
    || [];
  const invoiceNo = normalizeTrackingNumber(requestedInvoice);
  const matches = steps.filter((step) => !invoiceNo || normalizeTrackingNumber(step.invoiceNo) === invoiceNo);
  if (matches.length !== 1) {
    const error = new Error(`Expected one reviewed invoice deletion step, found ${matches.length}.`);
    error.code = "B12_REVIEWED_ACTION_COUNT_INVALID";
    throw error;
  }
  return normalizeB12InvoiceDeletionCandidate(matches[0]);
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.review) {
  const error = new Error("--review is required.");
  error.code = "B12_REVIEW_FILE_REQUIRED";
  throw error;
}

const review = JSON.parse(await readFile(resolve(flags.review), "utf8"));
const candidate = selectCandidate(review, flags.invoice);
const plan = review?.actionPlan || review;
if (flags.execute === true && plan?.gates?.readyForApproval !== true) {
  const error = new Error("The reviewed post-packing plan is not ready for an external write.");
  error.code = "B12_REVIEW_NOT_READY_FOR_APPROVAL";
  throw error;
}
const result = await withShoplingB12BrowserAdapter(loadConfig(), (adapter) =>
  runShoplingB12InvoiceDeletion(candidate, {
    execute: flags.execute === true,
    approvalKey: flags["approval-key"] || "",
  }, { adapter }));

const audit = {
  ...result,
  completedAt: new Date().toISOString(),
  privacy: {
    recipientNameStored: false,
    phoneStored: false,
    addressStored: false,
  },
};
const serialized = `${JSON.stringify(audit, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { recoverCjLoisSession } from "../src/cj-lois-auth-recovery.mjs";
import { withCjLoisReturnPickupBrowserAdapter } from "../src/cj-lois-return-pickup-browser-adapter.mjs";
import { loadConfig } from "../src/config.mjs";
import { writeJsonAtomic } from "../src/files.mjs";
import { createReturnPickupAuditStore } from "../src/shopling-return-pickup-audit.mjs";
import {
  buildReturnPickupQnaEvidence,
  inspectReturnInvoiceReadbackEligibility,
  runReturnInvoiceReadback,
} from "../src/shopling-return-invoice-readback.mjs";
import { withShoplingReturnMemoBrowserAdapter } from "../src/shopling-return-memo-browser-adapter.mjs";

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

const flags = parseArgs(process.argv.slice(2));
const config = loadConfig();
const auditStore = createReturnPickupAuditStore(config.dataDir);
const audits = (await auditStore.listAudits())
  .filter((audit) => !flags["action-key"] || audit.actionKey === flags["action-key"]);
if (flags["action-key"] && audits.length !== 1) {
  throw Object.assign(new Error("Exactly one audit must match --action-key."), {
    code: "RETURN_INVOICE_ACTION_KEY_NOT_FOUND",
  });
}

const now = flags.now ? new Date(flags.now) : new Date();
const preliminary = audits.map((audit) => inspectReturnInvoiceReadbackEligibility(audit, now));

const candidates = audits.filter((_audit, index) => preliminary[index].status === "DUE");
const results = audits.map((_audit, index) => preliminary[index]);
let cjAuthentication = { attempted: false };

if (candidates.length) {
  cjAuthentication = await recoverCjLoisSession(config);
  await withCjLoisReturnPickupBrowserAdapter(config, async (cjAdapter) => {
    for (const audit of candidates) {
      const result = await runReturnInvoiceReadback({
        audit,
        now,
        execute: flags.execute === true,
      }, {
        cjAdapter,
        memoAdapter: {
          recordReturnInvoiceMemo: (memo) => withShoplingReturnMemoBrowserAdapter(
            config,
            audit.orderNo,
            (adapter) => adapter.recordReturnInvoiceMemo(memo),
          ),
        },
        writeAudit: auditStore.writeAudit,
      });
      const index = audits.findIndex((item) => item.actionKey === audit.actionKey);
      results[index] = result;
    }
  });
}

const latestAudits = await auditStore.listAudits();
const evidence = latestAudits.map(buildReturnPickupQnaEvidence).filter(Boolean);
await mkdir(config.dataDir, { recursive: true });
await writeJsonAtomic(resolve(config.dataDir, "return-invoice-evidence.json"), {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidence,
});

process.stdout.write(`${JSON.stringify({
  mode: flags.execute === true ? "execute" : "dry-run",
  checkedCount: results.length,
  resultCounts: Object.fromEntries([...new Set(results.map((item) => item.status))]
    .map((status) => [status, results.filter((item) => item.status === status).length])),
  results: results.map((result) => Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "audit"),
  )),
  qnaEvidenceCount: evidence.length,
  cjAuthentication: {
    attempted: candidates.length > 0,
    authenticated: cjAuthentication?.authenticated === true,
    recovered: cjAuthentication?.recovered === true,
    otpUsed: cjAuthentication?.otpUsed === true,
  },
}, null, 2)}\n`);

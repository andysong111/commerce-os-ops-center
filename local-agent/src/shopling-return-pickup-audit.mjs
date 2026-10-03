import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./files.mjs";

function clean(value) {
  return String(value || "").trim();
}

export function returnPickupAuditPath(dataDir, actionKey) {
  const root = resolve(dataDir, "return-pickup-audits");
  const digest = createHash("sha256").update(clean(actionKey), "utf8").digest("hex");
  return resolve(root, `${digest}.json`);
}

export function createReturnPickupAuditStore(dataDir) {
  const root = resolve(dataDir, "return-pickup-audits");
  return {
    async readAudit(actionKey) {
      if (!clean(actionKey)) return null;
      return readJsonFile(returnPickupAuditPath(dataDir, actionKey), null);
    },
    async writeAudit(actionKey, value) {
      if (!clean(actionKey) || value?.actionKey !== actionKey) {
        const error = new Error("Return pickup audit identity is invalid.");
        error.code = "RETURN_PICKUP_AUDIT_INVALID";
        throw error;
      }
      await mkdir(root, { recursive: true });
      await writeJsonAtomic(returnPickupAuditPath(dataDir, actionKey), value);
      return value;
    },
  };
}

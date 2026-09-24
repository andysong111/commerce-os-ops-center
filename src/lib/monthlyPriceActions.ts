import { randomUUID } from "node:crypto";
import { buildMonthlyPricePlan, monthlyValidateObservation, monthlyLiveProduct, monthlyMallPrices, assertMonthlyWritePreimage, assertMonthlyPendingOptionPreimage, verifyMonthlyPricePlan, resolveMonthlyPriceGroup, monthlyRecord, MONTHLY_PRICE_POLICY } from "@/lib/monthlyPriceCore";
import { assertMonthlyEvidenceUnchanged } from "@/lib/monthlyPriceSource";
import { loadShoplingProductGroupsByGoodsKey } from "@/lib/shopling/shoplingProductGroupRegistry";
import { ensureMonthlyShoplingSaleStatus, readMonthlyLiveProduct, writeMonthlyShoplingPrice } from "@/lib/monthlyPriceShopling";
import { withMonthlyPriceItem, saveMonthlyPriceItem, auditMonthlyPrice, type MonthlyPriceItem } from "@/lib/monthlyPriceStore";

function code(error: unknown) {
  const raw = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : "MONTHLY_PRICE_OPERATION_FAILED";
}
function validId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error("MONTHLY_PRICE_ID_INVALID");
  return value;
}
function response(item: MonthlyPriceItem) {
  return { id: item.id, state: item.state, errorCode: item.error_code, writeIndex: item.write_index, transmission: item.transmission, plan: item.plan };
}
async function resolveCurrentGroup(item: MonthlyPriceItem, observation: unknown) {
  const registered = (await loadShoplingProductGroupsByGoodsKey([item.goods_key])).get(item.goods_key) ?? null;
  const observed = monthlyValidateObservation(observation, item.goods_key);
  const live = await readMonthlyLiveProduct(item.goods_key);
  const candidateGroup = item.candidate.productGroup;
  if (registered && candidateGroup && registered !== candidateGroup) {
    throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
  }
  return {
    observed,
    live,
    registered,
    resolution: resolveMonthlyPriceGroup(item.candidate, live, observed, registered),
  };
}
export async function monthlyPriceItemAction(payload: Record<string, unknown>) {
  const itemId = validId(payload.itemId), runId = validId(payload.runId), action = String(payload.action);
  return withMonthlyPriceItem(itemId, runId, async (item, run) => {
    if (action === "prepare") {
      if (item.state !== "QUEUED") return response(item);
      try {
        await assertMonthlyEvidenceUnchanged(run.source_snapshot.evidenceVersion);
        const { observed, live, resolution } = await resolveCurrentGroup(item, payload.observation);
        if (!resolution.group || resolution.source === "UNRESOLVED") {
          item.plan = null;
          item.state = "HELD";
          item.error_code = null;
          await auditMonthlyPrice(item, "LEGACY_GROUP_UNRESOLVED_HELD", {
            policy: MONTHLY_PRICE_POLICY,
            sourceHash: run.source_hash,
            action: "KEEP_CURRENT_PRICE",
          });
          return response(item);
        }
        const effectiveCandidate = {
          ...item.candidate,
          productGroup: resolution.group,
          reason: item.candidate.reason === "MONTHLY_PRICE_GROUP_REQUIRED" ? null : item.candidate.reason,
        };
        item.plan = buildMonthlyPricePlan(
          effectiveCandidate,
          live,
          observed,
          resolution.source === "EXACT"
            ? { groupResolution: "EXACT" }
            : {
                groupResolution: resolution.source,
                restrictMallKeys: observed.rows.map((row) => row.mallKey),
              },
        );
        item.state = item.plan.writes.length ? "PREPARED" : "HELD";
        item.error_code = null;
        await auditMonthlyPrice(item, "PREFLIGHT", {
          policy: MONTHLY_PRICE_POLICY,
          sourceHash: run.source_hash,
          groupResolution: resolution.source,
          plan: item.plan,
        });
      } catch (error) {
        item.state = "BLOCKED"; item.error_code = code(error);
      }
    } else if (action === "write") {
      if (item.state === "WRITING" || item.state === "UNCERTAIN") return response(item);
      if (item.state !== "PREPARED" || !item.plan || item.plan.policy !== MONTHLY_PRICE_POLICY) return response(item);
      const write = item.plan.writes[item.write_index];
      if (!write) { item.state = "VERIFY_PENDING"; return response(item); }
      let dispatched = false;
      try {
        await assertMonthlyEvidenceUnchanged(run.source_snapshot.evidenceVersion);
        const { observed, live: resolvedLive, resolution } = await resolveCurrentGroup(item, payload.observation);
        let live = resolvedLive;
        if (!resolution.group || resolution.group !== item.plan.productGroup) throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
        if (item.plan.groupResolution === "EXACT" && resolution.source !== "EXACT") {
          throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
        }
        if (item.plan.saleStatusTransition && item.write_index === 0) {
          const status = await ensureMonthlyShoplingSaleStatus(item.goods_key, item.plan.saleStatusTransition.target);
          live = status.rows;
          await auditMonthlyPrice(item, "SALE_STATUS_PREPRICE_READY", {
            before: status.before,
            after: status.after,
            changed: status.changed,
            restoreAfterTransmission: item.plan.saleStatusTransition.restoreAfterTransmission,
          });
        }
        const liveProduct = monthlyLiveProduct(item.candidate, live);
        if (write.kind !== "OPTION_PRICE") assertMonthlyPendingOptionPreimage(item.plan, liveProduct.options);
        const current = write.mallKey ? monthlyMallPrices(observed, write.mallKey) : liveProduct.prices;
        if (assertMonthlyWritePreimage(write, current, write.mallKey ? [] : liveProduct.options) === "ALREADY_APPLIED") {
          await auditMonthlyPrice(item, "WRITE_ALREADY_MATCHES", { writeIndex: item.write_index, current });
        } else {
          item.state = "WRITING";
          // Both markers must be durable BEFORE the first external side effect.
          await saveMonthlyPriceItem(item);
          await auditMonthlyPrice(item, "WRITE_INTENT", { writeIndex: item.write_index, fingerprint: item.plan.fingerprint, write });
          dispatched = true;
          await writeMonthlyShoplingPrice(item.goods_key, write);
          await auditMonthlyPrice(item, "WRITE_ACK", { writeIndex: item.write_index });
        }
        item.write_index += 1;
        item.state = item.write_index >= item.plan.writes.length ? "VERIFY_PENDING" : "PREPARED";
        item.error_code = null;
      } catch (error) {
        // A positive API acknowledgement isn't readback; any ambiguous write is
        // frozen. A later click verifies first and never reapplies a percentage.
        item.state = dispatched || item.write_index > 0 || item.state === "WRITING" ? "UNCERTAIN" : "BLOCKED";
        item.error_code = code(error);
      }
    } else if (action === "verify") {
      if (!["VERIFY_PENDING", "UNCERTAIN", "WRITING"].includes(item.state) || !item.plan) return response(item);
      try {
        const observed = monthlyValidateObservation(payload.observation, item.goods_key);
        const live = await readMonthlyLiveProduct(item.goods_key);
        monthlyValidateObservation(payload.observation, item.goods_key);
        // Recover only an exact positive readback; unresolved partial writes stay
        // protected from both re-dispatch and cross-month competing jobs.
        verifyMonthlyPricePlan(item.plan, item.candidate, live, observed);
        item.state = "VERIFIED"; item.write_index = item.plan.writes.length; item.error_code = null;
        await auditMonthlyPrice(item, "SHOPLING_READBACK_VERIFIED", { fingerprint: item.plan.fingerprint });
      } catch (error) { item.state = "UNCERTAIN"; item.error_code = code(error); }
    } else if (action === "resendClaim") {
      if (item.state === "RESENDING") return { ...response(item), duplicate: true };
      if (item.state !== "VERIFIED" || !item.plan) throw new Error("MONTHLY_PRICE_VERIFIED_REQUIRED");
      // A refresh may happen long after verification: re-read immediately before
      // issuing a narrowly scoped market transmission capability.
      const observed = monthlyValidateObservation(payload.observation, item.goods_key);
      const live = await readMonthlyLiveProduct(item.goods_key);
      monthlyValidateObservation(payload.observation, item.goods_key);
      verifyMonthlyPricePlan(item.plan, item.candidate, live, observed);
      const batchId = payload.batchId === undefined || payload.batchId === null || payload.batchId === "" ? undefined : validId(payload.batchId);
      item.transmission = { token: randomUUID(), fingerprint: item.plan.fingerprint, claimedAt: new Date().toISOString(), ...(batchId ? { batchId } : {}) };
      item.state = "RESENDING";
      await auditMonthlyPrice(item, "MARKET_TRANSMISSION_INTENT", item.transmission);
      return { ...response(item), duplicate: false };
    } else if (action === "resendReport") {
      const report = monthlyRecord(payload.report);
      if (item.state === "TRANSMITTED") return response(item);
      if (item.state !== "RESENDING" || !item.plan || !item.transmission || report.token !== item.transmission.token || report.fingerprint !== item.transmission.fingerprint || report.goodsKey !== item.goods_key) throw new Error("MONTHLY_PRICE_TRANSMISSION_SCOPE_INVALID");
      if (report.relistRequired === true || report.state === "RELIST_REQUIRED") {
        if (item.plan.saleStatusTransition && report.saleStatusRolledBack === true) {
          const restored = await ensureMonthlyShoplingSaleStatus(item.goods_key, item.plan.saleStatusTransition.before);
          await auditMonthlyPrice(item, "SALE_STATUS_FAILURE_ROLLBACK", {
            before: restored.before,
            after: restored.after,
            changed: restored.changed,
          });
        }
        item.error_code = "MONTHLY_PRICE_RELIST_REQUIRED";
        await auditMonthlyPrice(item, "MARKET_RELIST_REQUIRED", {
          token: item.transmission.token,
          priceOutcome: String(report.priceOutcome ?? ""),
          optionOutcome: String(report.optionOutcome ?? ""),
          saleStatusRolledBack: report.saleStatusRolledBack === true,
          reason: "A21_THREE_STAGE_RETRY_EXHAUSTED",
        });
      } else if (
        report.state === "SUCCEEDED" &&
        report.priceAndOption === true &&
        (!item.plan.saleStatusTransition || report.saleStatusActivated === true) &&
        (!item.plan.saleStatusTransition?.restoreAfterTransmission || report.saleStatusRestored === true)
      ) {
        if (item.plan.saleStatusTransition?.restoreAfterTransmission) {
          const restored = await ensureMonthlyShoplingSaleStatus(item.goods_key, item.plan.saleStatusTransition.before);
          await auditMonthlyPrice(item, "SALE_STATUS_RESTORED", {
            before: restored.before,
            after: restored.after,
            changed: restored.changed,
          });
        }
        item.state = "TRANSMITTED";
        item.transmission = { ...item.transmission, finishedAt: new Date().toISOString(), result: "RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING" };
        item.error_code = null;
        await auditMonthlyPrice(item, "TRANSMISSION_WINDOW_FINISHED", { ...item.transmission, marketVerified: false });
      } else if (
        ["PARTIAL_FAILURE", "STOPPED", "MISSING"].includes(String(report.state)) ||
        (
          report.state === "SUCCEEDED" &&
          (
            report.priceAndOption !== true ||
            (item.plan.saleStatusTransition && report.saleStatusActivated !== true) ||
            (item.plan.saleStatusTransition?.restoreAfterTransmission && report.saleStatusRestored !== true)
          )
        )
      ) {
        if (item.plan.saleStatusTransition && report.saleStatusRolledBack === true) {
          const restored = await ensureMonthlyShoplingSaleStatus(item.goods_key, item.plan.saleStatusTransition.before);
          await auditMonthlyPrice(item, "SALE_STATUS_FAILURE_ROLLBACK", {
            before: restored.before,
            after: restored.after,
            changed: restored.changed,
          });
        }
        item.error_code = "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED";
        // Keep the token and state. Do not resend a batch whose delivery is unknown
        // or whose required status -> PRICE -> OPTION evidence is incomplete.
        await auditMonthlyPrice(item, "TRANSMISSION_UNCERTAIN", {
          token: item.transmission.token,
          state: report.state,
          priceAndOption: report.priceAndOption === true,
          saleStatusActivated: report.saleStatusActivated === true,
          saleStatusRestored: report.saleStatusRestored === true,
        });
      }
    } else throw new Error("MONTHLY_PRICE_ACTION_INVALID");
    return response(item);
  });
}

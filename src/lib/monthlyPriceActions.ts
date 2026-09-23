import { randomUUID } from "node:crypto";
import { buildMonthlyPricePlan, monthlyValidateObservation, monthlyLiveProduct, monthlyMallPrices, assertMonthlyWritePreimage, verifyMonthlyPricePlan, resolveMonthlyPriceGroup, monthlyRecord, MONTHLY_PRICE_POLICY } from "@/lib/monthlyPriceCore";
import { assertMonthlyEvidenceUnchanged } from "@/lib/monthlyPriceSource";
import { loadShoplingProductGroupsByGoodsKey } from "@/lib/shopling/shoplingProductGroupRegistry";
import { readMonthlyLiveProduct, writeMonthlyShoplingPrice, writeMonthlyShoplingSaleStatus } from "@/lib/monthlyPriceShopling";
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
        item.transmission = null;
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
    } else if (action === "saleStatusClaim") {
      if (item.state !== "PREPARED" || !item.plan || item.plan.policy !== MONTHLY_PRICE_POLICY) throw new Error("MONTHLY_PRICE_PREPARED_REQUIRED");
      const transition = item.plan.saleStatusTransition;
      if (!transition?.requiredBeforePrice) return { ...response(item), duplicate: true };
      if (item.transmission?.saleStatusMarketFinishedAt) return { ...response(item), duplicate: true };
      let duplicate = Boolean(item.transmission?.saleStatusToken);
      try {
        await assertMonthlyEvidenceUnchanged(run.source_snapshot.evidenceVersion);
        const currentRows = await readMonthlyLiveProduct(item.goods_key);
        const current = monthlyLiveProduct(item.candidate, currentRows);
        item.transmission = {
          ...(item.transmission ?? {}),
          fingerprint: item.plan.fingerprint,
          originalSaleStatus: transition.original,
          saleStatusTarget: "B",
        };
        if (!item.transmission.saleStatusShoplingVerifiedAt) {
          if (current.saleStatus === "C") {
            item.transmission.saleStatusShoplingIntentAt ||= new Date().toISOString();
            await saveMonthlyPriceItem(item);
            await auditMonthlyPrice(item, "SALE_STATUS_SHOPLING_WRITE_INTENT", {
              fingerprint: item.plan.fingerprint,
              from: transition.original,
              to: "B",
            });
            await writeMonthlyShoplingSaleStatus(item.goods_key, "B");
          } else if (current.saleStatus !== "B") {
            throw new Error("MONTHLY_PRICE_SALE_STATUS_CHANGED");
          }
          item.transmission.saleStatusShoplingVerifiedAt = new Date().toISOString();
          await auditMonthlyPrice(item, "SALE_STATUS_SHOPLING_VERIFIED", {
            fingerprint: item.plan.fingerprint,
            saleStatus: "B",
          });
        }
        if (!item.transmission.saleStatusToken) {
          duplicate = false;
          item.transmission.saleStatusToken = randomUUID();
          item.transmission.saleStatusMarketClaimedAt = new Date().toISOString();
          await auditMonthlyPrice(item, "SALE_STATUS_MARKET_TRANSMISSION_INTENT", {
            token: item.transmission.saleStatusToken,
            fingerprint: item.plan.fingerprint,
            goodsKey: item.goods_key,
            targetSaleStatus: "B",
          });
        }
        item.error_code = null;
        return { ...response(item), duplicate };
      } catch (error) {
        item.error_code = code(error);
        throw error;
      }
    } else if (action === "saleStatusReport") {
      const report = monthlyRecord(payload.report);
      const transition = item.plan?.saleStatusTransition;
      const transmission = item.transmission;
      if (!transition?.requiredBeforePrice || item.state !== "PREPARED" || !transmission?.saleStatusToken) throw new Error("MONTHLY_PRICE_SALE_STATUS_SCOPE_INVALID");
      if (
        report.token !== transmission.saleStatusToken ||
        report.fingerprint !== item.plan?.fingerprint ||
        report.goodsKey !== item.goods_key ||
        report.targetSaleStatus !== "B"
      ) throw new Error("MONTHLY_PRICE_SALE_STATUS_SCOPE_INVALID");
      if (report.state === "SUCCEEDED" && report.statusOnly === true) {
        transmission.saleStatusMarketFinishedAt = new Date().toISOString();
        transmission.saleStatusResult = "RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING";
        item.error_code = null;
        await auditMonthlyPrice(item, "SALE_STATUS_MARKET_WINDOW_FINISHED", {
          token: transmission.saleStatusToken,
          targetSaleStatus: "B",
          marketVerified: false,
        });
      } else if (["PARTIAL_FAILURE", "STOPPED", "MISSING"].includes(String(report.state))) {
        item.error_code = "MONTHLY_PRICE_SALE_STATUS_MARKET_REVIEW_REQUIRED";
        await auditMonthlyPrice(item, "SALE_STATUS_MARKET_TRANSMISSION_UNCERTAIN", {
          token: transmission.saleStatusToken,
          state: report.state,
        });
      }
      return response(item);
    } else if (action === "restoreSaleStatusClaim") {
      if (item.state !== "TRANSMITTED" || !item.plan?.saleStatusTransition?.restoreAvailable || item.plan.saleStatusTransition.original !== "C") {
        throw new Error("MONTHLY_PRICE_RESTORE_NOT_AVAILABLE");
      }
      if (item.transmission?.restoreMarketFinishedAt) return { ...response(item), duplicate: true };
      let duplicate = Boolean(item.transmission?.restoreToken);
      item.transmission = { ...(item.transmission ?? {}), fingerprint: item.plan.fingerprint, restoreTarget: "C" };
      if (!item.transmission.restoreShoplingVerifiedAt) {
        await writeMonthlyShoplingSaleStatus(item.goods_key, "C");
        item.transmission.restoreShoplingVerifiedAt = new Date().toISOString();
        await auditMonthlyPrice(item, "SALE_STATUS_RESTORE_SHOPLING_VERIFIED", { fingerprint: item.plan.fingerprint, saleStatus: "C" });
      }
      if (!item.transmission.restoreToken) {
        duplicate = false;
        item.transmission.restoreToken = randomUUID();
        item.transmission.restoreMarketClaimedAt = new Date().toISOString();
        await auditMonthlyPrice(item, "SALE_STATUS_RESTORE_MARKET_INTENT", {
          token: item.transmission.restoreToken,
          targetSaleStatus: "C",
        });
      }
      return { ...response(item), duplicate };
    } else if (action === "restoreSaleStatusReport") {
      const report = monthlyRecord(payload.report);
      const transmission = item.transmission;
      if (item.state !== "TRANSMITTED" || !transmission?.restoreToken || !item.plan?.saleStatusTransition?.restoreAvailable) {
        throw new Error("MONTHLY_PRICE_RESTORE_NOT_AVAILABLE");
      }
      if (
        report.token !== transmission.restoreToken ||
        report.fingerprint !== item.plan.fingerprint ||
        report.goodsKey !== item.goods_key ||
        report.targetSaleStatus !== "C"
      ) throw new Error("MONTHLY_PRICE_RESTORE_SCOPE_INVALID");
      if (report.state === "SUCCEEDED" && report.statusOnly === true) {
        transmission.restoreMarketFinishedAt = new Date().toISOString();
        transmission.restoreResult = "RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING";
        item.error_code = null;
        await auditMonthlyPrice(item, "SALE_STATUS_RESTORE_MARKET_WINDOW_FINISHED", { token: transmission.restoreToken, marketVerified: false });
      } else if (["PARTIAL_FAILURE", "STOPPED", "MISSING"].includes(String(report.state))) {
        item.error_code = "MONTHLY_PRICE_RESTORE_MARKET_REVIEW_REQUIRED";
        await auditMonthlyPrice(item, "SALE_STATUS_RESTORE_MARKET_UNCERTAIN", { token: transmission.restoreToken, state: report.state });
      }
      return response(item);
    } else if (action === "write") {
      if (item.state === "WRITING" || item.state === "UNCERTAIN") return response(item);
      if (item.state !== "PREPARED" || !item.plan || item.plan.policy !== MONTHLY_PRICE_POLICY) return response(item);
      if (item.plan.saleStatusTransition?.requiredBeforePrice && !item.transmission?.saleStatusMarketFinishedAt) {
        throw new Error("MONTHLY_PRICE_SALE_STATUS_TRANSMISSION_REQUIRED");
      }
      const write = item.plan.writes[item.write_index];
      if (!write) { item.state = "VERIFY_PENDING"; return response(item); }
      let dispatched = false;
      try {
        await assertMonthlyEvidenceUnchanged(run.source_snapshot.evidenceVersion);
        const { observed, live, resolution } = await resolveCurrentGroup(item, payload.observation);
        if (!resolution.group || resolution.group !== item.plan.productGroup) throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
        if (item.plan.groupResolution === "EXACT" && resolution.source !== "EXACT") {
          throw new Error("MONTHLY_PRICE_GROUP_CHANGED");
        }
        const liveProduct = monthlyLiveProduct(item.candidate, live);
        if (item.plan.saleStatusTransition?.requiredBeforePrice && liveProduct.saleStatus !== "B") throw new Error("MONTHLY_PRICE_SALE_STATUS_CHANGED");
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
      item.transmission = {
        ...(item.transmission ?? {}),
        token: randomUUID(),
        fingerprint: item.plan.fingerprint,
        claimedAt: new Date().toISOString(),
      };
      item.state = "RESENDING";
      await auditMonthlyPrice(item, "MARKET_TRANSMISSION_INTENT", item.transmission);
      return { ...response(item), duplicate: false };
    } else if (action === "resendReport") {
      const report = monthlyRecord(payload.report);
      if (item.state === "TRANSMITTED") return response(item);
      if (item.state !== "RESENDING" || !item.transmission?.token || report.token !== item.transmission.token || report.fingerprint !== item.transmission.fingerprint || report.goodsKey !== item.goods_key) throw new Error("MONTHLY_PRICE_TRANSMISSION_SCOPE_INVALID");
      if (report.state === "SUCCEEDED" && report.priceAndOption === true) {
        item.state = "TRANSMITTED";
        item.transmission = { ...item.transmission, finishedAt: new Date().toISOString(), result: "RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING" };
        item.error_code = null;
        await auditMonthlyPrice(item, "TRANSMISSION_WINDOW_FINISHED", { ...item.transmission, marketVerified: false });
      } else if (["PARTIAL_FAILURE", "STOPPED", "MISSING"].includes(String(report.state))) {
        item.error_code = "MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED";
        // Keep the token and state. Do not resend a batch whose delivery is unknown.
        await auditMonthlyPrice(item, "TRANSMISSION_UNCERTAIN", { token: item.transmission.token, state: report.state });
      }
    } else throw new Error("MONTHLY_PRICE_ACTION_INVALID");
    return response(item);
  });
}

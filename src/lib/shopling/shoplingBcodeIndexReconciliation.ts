import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  shoplingAccountFingerprint,
} from "@/lib/shopling/shoplingBcodeIndex";
import { shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";

type UnknownRecord = Record<string, unknown>;

export type ShoplingBcodeIndexMove = {
  goodsKey: string;
  optionId: string;
  previousBCode: string;
  currentBCode: string;
};

const B_CODE = /^B[A-Z]{2}\d+-\d+$/;
const DIGITS = /^\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizeShoplingBcodeIndexMoves(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error("SHOPLING_INDEX_RECONCILIATION_ENTRY_COUNT_INVALID");
  }
  const seen = new Set<string>();
  return value.map((candidate): ShoplingBcodeIndexMove => {
    const row = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as UnknownRecord
      : {};
    const goodsKey = text(row.goodsKey);
    const optionId = text(row.optionId);
    const previousBCode = text(row.previousBCode).toUpperCase().replace(/\s+/g, "");
    const currentBCode = text(row.currentBCode).toUpperCase().replace(/\s+/g, "");
    const identity = `${goodsKey}:${optionId}`;
    if (
      !DIGITS.test(goodsKey)
      || !DIGITS.test(optionId)
      || !B_CODE.test(previousBCode)
      || (currentBCode && !B_CODE.test(currentBCode))
      || previousBCode === currentBCode
      || seen.has(identity)
    ) {
      throw new Error("SHOPLING_INDEX_RECONCILIATION_ENTRY_INVALID");
    }
    seen.add(identity);
    return { goodsKey, optionId, previousBCode, currentBCode };
  });
}

export async function reconcileShoplingBcodeIndex(input: {
  mode: "plan" | "apply";
  source: string;
  entries: ShoplingBcodeIndexMove[];
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SHOPLING_INDEX_RECONCILIATION_DATABASE_NOT_CONFIGURED");
  const config = shoplingReadConfigFromEnv(process.env);
  const accountFingerprint = shoplingAccountFingerprint(config);
  const source = text(input.source).slice(0, 120) || "OWNER_CONFIRMED_SHOPLING_READBACK";
  const results: UnknownRecord[] = [];

  for (const entry of input.entries) {
    const sourceRead = await admin
      .from("shopling_bcode_option_index")
      .select("*")
      .eq("account_fingerprint", accountFingerprint)
      .eq("goods_key", entry.goodsKey)
      .eq("option_id", entry.optionId)
      .eq("barcode", entry.previousBCode);
    if (sourceRead.error) throw new Error(`SHOPLING_INDEX_RECONCILIATION_READ_FAILED:${sourceRead.error.message}`);
    const targetRead = entry.currentBCode
      ? await admin
          .from("shopling_bcode_option_index")
          .select("*")
          .eq("account_fingerprint", accountFingerprint)
          .eq("goods_key", entry.goodsKey)
          .eq("option_id", entry.optionId)
          .eq("barcode", entry.currentBCode)
      : { data: [], error: null };
    if (targetRead.error) throw new Error(`SHOPLING_INDEX_RECONCILIATION_READ_FAILED:${targetRead.error.message}`);
    const sources = Array.isArray(sourceRead.data) ? sourceRead.data : [];
    const targets = Array.isArray(targetRead.data) ? targetRead.data : [];
    if (sources.length > 1 || targets.length > 1 || (sources.length && targets.length)) {
      throw new Error("SHOPLING_INDEX_RECONCILIATION_CONFLICT");
    }
    if (!entry.currentBCode && sources.length === 0) {
      results.push({ ...entry, status: "already_applied" });
      continue;
    }
    if (entry.currentBCode && sources.length === 0 && targets.length === 1) {
      results.push({ ...entry, status: "already_applied" });
      continue;
    }
    if (sources.length !== 1 || targets.length !== 0) {
      throw new Error("SHOPLING_INDEX_RECONCILIATION_SOURCE_MISSING");
    }
    if (input.mode === "plan") {
      results.push({ ...entry, status: "ready" });
      continue;
    }

    if (!entry.currentBCode) {
      const removed = await admin
        .from("shopling_bcode_option_index")
        .delete()
        .eq("account_fingerprint", accountFingerprint)
        .eq("goods_key", entry.goodsKey)
        .eq("option_id", entry.optionId)
        .eq("barcode", entry.previousBCode)
        .select("goods_key,option_id,barcode");
      if (removed.error || !Array.isArray(removed.data) || removed.data.length !== 1) {
        throw new Error(`SHOPLING_INDEX_RECONCILIATION_DELETE_FAILED:${removed.error?.message ?? "COUNT"}`);
      }
    } else {
      const moved = await admin
        .from("shopling_bcode_option_index")
        .update({
          barcode: entry.currentBCode,
          source,
          refresh_id: randomUUID(),
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("account_fingerprint", accountFingerprint)
        .eq("goods_key", entry.goodsKey)
        .eq("option_id", entry.optionId)
        .eq("barcode", entry.previousBCode)
        .select("goods_key,option_id,barcode");
      if (moved.error || !Array.isArray(moved.data) || moved.data.length !== 1) {
        throw new Error(`SHOPLING_INDEX_RECONCILIATION_UPDATE_FAILED:${moved.error?.message ?? "COUNT"}`);
      }
    }

    const oldVerify = await admin
      .from("shopling_bcode_option_index")
      .select("goods_key")
      .eq("account_fingerprint", accountFingerprint)
      .eq("goods_key", entry.goodsKey)
      .eq("option_id", entry.optionId)
      .eq("barcode", entry.previousBCode);
    const newVerify = entry.currentBCode
      ? await admin
          .from("shopling_bcode_option_index")
          .select("goods_key,option_id,barcode")
          .eq("account_fingerprint", accountFingerprint)
          .eq("goods_key", entry.goodsKey)
          .eq("option_id", entry.optionId)
          .eq("barcode", entry.currentBCode)
      : { data: [], error: null };
    if (
      oldVerify.error
      || newVerify.error
      || (Array.isArray(oldVerify.data) && oldVerify.data.length !== 0)
      || (entry.currentBCode && (!Array.isArray(newVerify.data) || newVerify.data.length !== 1))
    ) {
      throw new Error("SHOPLING_INDEX_RECONCILIATION_READBACK_FAILED");
    }
    results.push({ ...entry, status: "verified" });
  }

  return {
    mode: input.mode,
    externalWrite: false,
    verifiedCount: results.filter((row) => row.status === "verified" || row.status === "already_applied").length,
    results,
  };
}

import { createHash } from "node:crypto";
import { OPS_PROHIBITED_KEYWORD_TERMS } from "@/lib/keywordExactProhibitedTerms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const SEO_PROHIBITED_KEYWORD_POLICY_OPERATION_TYPE =
  "SEO_PROHIBITED_KEYWORD_POLICY_V1";

const POLICY_SOURCE = "commerce-os-seo-prohibited-keywords";
const POLICY_LIMIT = 200;
const A19_EVIDENCE_LIMIT = 500;

type UnknownRecord = Record<string, unknown>;
type AdminClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseAdminClient>>
>;

export type ShoplingA19FailureEvidence = {
  transmissionCode: string;
  goodsKey: string;
  marketName: string;
  message: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function termIdentity(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR");
}

export function normalizeSeoProhibitedKeywordTerm(value: unknown) {
  const normalized = text(value).slice(0, 60);
  return normalized && normalized.length <= 60 ? normalized : "";
}

export function mergeSeoProhibitedKeywordLists(
  ...values: unknown[]
) {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const normalized = normalizeSeoProhibitedKeywordTerm(entry);
      const identity = termIdentity(normalized);
      if (!normalized || seen.has(identity)) continue;
      seen.add(identity);
      merged.push(normalized);
      if (merged.length >= POLICY_LIMIT) return merged;
    }
  }
  return merged;
}

export function normalizeShoplingA19FailureEvidence(value: unknown) {
  if (!Array.isArray(value)) return [] as ShoplingA19FailureEvidence[];
  const output: ShoplingA19FailureEvidence[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, A19_EVIDENCE_LIMIT)) {
    const row = record(entry);
    const goodsKey = text(row.goodsKey);
    const message = text(row.message).slice(0, 1_000);
    if (!/^\d{5,9}$/.test(goodsKey) || !message) continue;
    const normalized = {
      transmissionCode: text(row.transmissionCode).slice(0, 40),
      goodsKey,
      marketName: text(row.marketName).slice(0, 80),
      message,
    };
    const identity = [
      normalized.transmissionCode,
      normalized.goodsKey,
      normalized.marketName,
      normalized.message,
    ].join("\u0000");
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(normalized);
  }
  return output;
}

const SHOPLING_A19_PROHIBITED_TERM_PATTERN =
  /등록이\s*불가능한\s*단어\s*[\[［]\s*([^\]］\r\n]{1,60}?)\s*[\]］]\s*(?:가|이)?\s*(?:상품명|검색어|사이트\s*검색어|쇼핑몰\s*검색어)[^.\r\n]{0,100}?포함/giu;

export function extractShoplingA19ProhibitedTerms(
  rawEvidence: unknown,
  allowedGoodsKeys?: Iterable<string>,
) {
  const allowed = allowedGoodsKeys
    ? new Set([...allowedGoodsKeys].map(text).filter(Boolean))
    : null;
  const evidence = normalizeShoplingA19FailureEvidence(rawEvidence).filter(
    (row) => !allowed || allowed.has(row.goodsKey),
  );
  const matchedEvidence: ShoplingA19FailureEvidence[] = [];
  const extracted: string[] = [];
  for (const row of evidence) {
    SHOPLING_A19_PROHIBITED_TERM_PATTERN.lastIndex = 0;
    let matched = false;
    for (const match of row.message.matchAll(
      SHOPLING_A19_PROHIBITED_TERM_PATTERN,
    )) {
      const term = normalizeSeoProhibitedKeywordTerm(match[1]);
      if (!term) continue;
      extracted.push(term);
      matched = true;
    }
    if (matched) matchedEvidence.push(row);
  }
  return {
    evidence,
    matchedEvidence,
    terms: mergeSeoProhibitedKeywordLists(extracted),
  };
}

function policyFingerprint(terms: string[]) {
  const canonical = terms
    .map((term) => ({ identity: termIdentity(term), term }))
    .sort((left, right) => left.identity.localeCompare(right.identity, "ko"))
    .map((row) => row.term)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

async function requireAdmin(admin?: AdminClient) {
  if (admin) return admin;
  const created = await createSupabaseAdminClient();
  if (!created) throw new Error("supabase_admin_unavailable");
  return created;
}

export async function readSeoProhibitedKeywordPolicyTerms(
  ownerId: string,
  admin?: AdminClient,
) {
  const client = await requireAdmin(admin);
  const result = await client
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", SEO_PROHIBITED_KEYWORD_POLICY_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .eq("actor_id", ownerId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new Error(`SEO_PROHIBITED_KEYWORD_POLICY_READ_FAILED:${result.error.message}`);
  }
  const stored = record(record(result.data).result_snapshot);
  return mergeSeoProhibitedKeywordLists(stored.terms);
}

export async function readCombinedSeoProhibitedKeywordTerms(
  ownerId: string,
  admin?: AdminClient,
) {
  return mergeSeoProhibitedKeywordLists(
    OPS_PROHIBITED_KEYWORD_TERMS,
    await readSeoProhibitedKeywordPolicyTerms(ownerId, admin),
  );
}

export async function mergeSeoProhibitedKeywordPolicy(input: {
  ownerId: string;
  terms: unknown;
  source: string;
  sourceReference: string;
  admin?: AdminClient;
}) {
  const client = await requireAdmin(input.admin);
  const previousTerms = await readSeoProhibitedKeywordPolicyTerms(
    input.ownerId,
    client,
  );
  const terms = mergeSeoProhibitedKeywordLists(previousTerms, input.terms);
  const previousIdentities = new Set(previousTerms.map(termIdentity));
  const addedTerms = terms.filter(
    (term) => !previousIdentities.has(termIdentity(term)),
  );
  if (!addedTerms.length) {
    return { terms, addedTerms, changed: false };
  }

  const now = new Date().toISOString();
  const fingerprint = policyFingerprint(terms);
  const result = await client.from("commerce_operation_runs").upsert(
    {
      operation_type: SEO_PROHIBITED_KEYWORD_POLICY_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: POLICY_SOURCE,
      source_event_id: `seo-prohibited-keywords:${input.ownerId}:${fingerprint}`,
      correlation_id: `seo-prohibited-keywords:${input.ownerId}`,
      actor_type: "SYSTEM",
      actor_id: input.ownerId,
      input_snapshot: {
        source: text(input.source),
        sourceReference: text(input.sourceReference),
        addedTerms,
      },
      result_snapshot: {
        terms,
        termCount: terms.length,
        fingerprint: `sha256:${fingerprint}`,
      },
      error_message: null,
      started_at: now,
      finished_at: now,
      updated_at: now,
    },
    { onConflict: "source_event_id", ignoreDuplicates: true },
  );
  if (result.error) {
    throw new Error(`SEO_PROHIBITED_KEYWORD_POLICY_WRITE_FAILED:${result.error.message}`);
  }
  const readback = await readSeoProhibitedKeywordPolicyTerms(
    input.ownerId,
    client,
  );
  const readbackIdentities = new Set(readback.map(termIdentity));
  if (terms.some((term) => !readbackIdentities.has(termIdentity(term)))) {
    throw new Error("SEO_PROHIBITED_KEYWORD_POLICY_READBACK_MISMATCH");
  }
  return { terms: readback, addedTerms, changed: true };
}

export function shoplingA19EvidenceFingerprint(
  evidence: ShoplingA19FailureEvidence[],
) {
  const canonical = evidence
    .map((row) =>
      [row.transmissionCode, row.goodsKey, row.marketName, row.message].join(
        "\u001F",
      ),
    )
    .sort()
    .join("\n");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

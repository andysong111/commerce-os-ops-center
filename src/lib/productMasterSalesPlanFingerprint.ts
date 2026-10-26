import { createHash } from "node:crypto";

export type ProductMasterSalesPlanFingerprintInput = {
  planningContentFingerprint: string;
  identityResolverVersion: string;
  analysisAsOf: string;
};

export function productMasterSalesPlanFingerprint(
  request: ProductMasterSalesPlanFingerprintInput,
  eventFingerprint: string,
) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        planningContentFingerprint: request.planningContentFingerprint,
        identityResolverVersion: request.identityResolverVersion,
        analysisAsOf: request.analysisAsOf,
        eventFingerprint,
      }),
    )
    .digest("hex")}`;
}

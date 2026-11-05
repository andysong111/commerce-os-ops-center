export const PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED =
  "PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED";

const PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED_MESSAGE =
  "상품마스터 연동 비밀키가 필요합니다.";

export function isExpectedPurchaseStrategyLabReadinessError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    return (
      message === PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED ||
      message === PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED_MESSAGE
    );
  }

  if (error && typeof error === "object" && "code" in error) {
    return (
      String(error.code).trim() ===
      PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED
    );
  }

  return false;
}

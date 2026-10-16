import { loadConfig } from "../src/config.mjs";
import { runAlibaba1688CartStaging } from "../src/alibaba1688-cart-staging.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const draftId = argument("--draft-id");
const execute = process.argv.includes("--execute");
const maxItemsArgument = argument("--max-items");
const maxItems = maxItemsArgument ? Number(maxItemsArgument) : null;
if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId)) {
  process.stderr.write("발주초안 ID가 없거나 올바르지 않습니다.\n");
  process.exitCode = 2;
} else {
  try {
    const result = await runAlibaba1688CartStaging(loadConfig(), {
      draftId,
      execute,
      maxItems,
    }, {
      logger(event) {
        process.stdout.write(`${JSON.stringify({ type: "1688-cart-stage", ...event })}\n`);
      },
    });
    process.stdout.write(`${JSON.stringify({
      type: "1688-cart-result",
      ok: true,
      execute,
      maxItems,
      draftId,
      stage: result.audit.stage,
      actionSummary: result.audit.actionSummary,
      checkoutSummary: result.audit.checkoutSummary,
      externalOrderExecuted: result.audit.externalOrderExecuted === true,
      checkoutSubmitted: result.audit.checkoutSubmitted === true,
      paymentExecuted: false,
      orderSubmission: result.audit.orderSubmission || null,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      type: "1688-cart-error",
      ok: false,
      code: error?.code || "ALIBABA1688_CART_STAGING_FAILED",
      message: error instanceof Error ? error.message : "1688 장바구니 준비가 실패했습니다.",
      details: error?.details || null,
      submissionAttempted: error?.audit?.submissionAttempted === true || error?.details?.submissionAttempted === true,
      externalOrderExecuted: error?.audit?.externalOrderExecuted === true,
      checkoutSubmitted: error?.audit?.checkoutSubmitted === true,
      paymentExecuted: false,
    })}\n`);
    process.exitCode = 2;
  }
}

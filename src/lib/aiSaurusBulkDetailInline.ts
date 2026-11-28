import { AI_SAURUS_ORIGIN } from "./aiSaurusBulkDetailTypes";

export const OPS_OPTION_REVIEW_CHANNEL = "ai-saurus-option-review-v1";

export function readStudioReviewSignal(event: MessageEvent, attempt: string, parent: Window, current: Window | null) {
  const data = event.data;
  if (event.origin !== AI_SAURUS_ORIGIN || data?.channel !== OPS_OPTION_REVIEW_CHANNEL ||
      data.attempt !== attempt || (data.type !== "ready" && data.type !== "attached")) return;
  const sender = event.source as Window | null;
  if (!sender || sender.opener !== parent || (current && !current.closed && current !== sender)) return;
  return { sender, attached: data.type === "attached" };
}

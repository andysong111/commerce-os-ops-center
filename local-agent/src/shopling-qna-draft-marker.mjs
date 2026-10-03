export const SHOPLING_QNA_DRAFT_PREFIX = "[초안]";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isShoplingQnaReviewDraft(value) {
  return clean(value).startsWith(SHOPLING_QNA_DRAFT_PREFIX);
}

export function stripShoplingQnaDraftPrefix(value) {
  let reply = clean(value);
  while (reply.startsWith(SHOPLING_QNA_DRAFT_PREFIX)) {
    reply = clean(reply.slice(SHOPLING_QNA_DRAFT_PREFIX.length));
  }
  return reply;
}

export function markShoplingQnaReviewDraft(value) {
  const reply = stripShoplingQnaDraftPrefix(value);
  if (!reply) {
    const error = new Error("A Shopling review draft requires non-empty reply text.");
    error.code = "QNA_REVIEW_DRAFT_EMPTY";
    throw error;
  }
  return `${SHOPLING_QNA_DRAFT_PREFIX} ${reply}`;
}

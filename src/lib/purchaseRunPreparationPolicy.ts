// One preparation run is a single frozen calculation. The demand and sales
// collectors each take several minutes in production, so their completed
// snapshots must remain reusable for the rest of the same one-click flow.
// A later start still refreshes them after this bounded resume window.
export const PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS = 60 * 60 * 1000;

import type { RecommendationCard, SourcingFeedback } from "@/lib/sourcingEngine";
import { SOURCING_CARD_STORAGE_KEY } from "@/lib/sourcingCardStorage";

export type ServerSaveResult = { ok: true; message: string } | { ok: false; code: string; message: string };

export function saveCardToLocalStorage(card: RecommendationCard, storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage): RecommendationCard[] {
  const stored = storage.getItem(SOURCING_CARD_STORAGE_KEY);
  const current = stored ? (JSON.parse(stored) as RecommendationCard[]) : [];
  const next = [card, ...current.filter((item) => item.id !== card.id)].slice(0, 200);
  storage.setItem(SOURCING_CARD_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function getServerFallbackMessage(result: ServerSaveResult): string {
  if (result.ok) return result.message;
  if (result.code === "AUTH_REQUIRED") return "Local saved. Sign in to sync cards to server storage.";
  if (result.code === "SUPABASE_NOT_CONFIGURED") return "Local saved. Supabase server storage is not configured yet.";
  return `Local saved. Server sync skipped: ${result.message}`;
}

export async function saveCardWithServerFallback(card: RecommendationCard): Promise<{ localCards: RecommendationCard[]; server: ServerSaveResult }> {
  const localCards = saveCardToLocalStorage(card);
  try {
    const response = await fetch("/api/sourcing/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card),
    });
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    if (response.ok) return { localCards, server: { ok: true, message: "Server saved. Local fallback also updated." } };
    return { localCards, server: { ok: false, code: body.code ?? "SERVER_SAVE_FAILED", message: body.message ?? `HTTP ${response.status}` } };
  } catch (error) {
    return { localCards, server: { ok: false, code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "Network error" } };
  }
}

export const SOURCING_FEEDBACK_STORAGE_KEY = "commerce-os:sourcing-engine-feedback";

export function saveFeedbackToLocalStorage(feedback: SourcingFeedback, storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage): SourcingFeedback[] {
  const stored = storage.getItem(SOURCING_FEEDBACK_STORAGE_KEY);
  const current = stored ? (JSON.parse(stored) as SourcingFeedback[]) : [];
  const next = [feedback, ...current].slice(0, 500);
  storage.setItem(SOURCING_FEEDBACK_STORAGE_KEY, JSON.stringify(next));
  return next;
}

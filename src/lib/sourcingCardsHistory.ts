import type { RecommendationCard } from "@/lib/sourcingEngine";
import { SOURCING_CARD_STORAGE_KEY } from "@/lib/sourcingCardStorage";

export type SourcingHistoryCard = RecommendationCard & {
  serverId?: string;
  serverCreatedAt?: string;
};

export function removeCardById<T extends { id: string }>(cards: T[], cardId: string): T[] {
  return cards.filter((card) => card.id !== cardId);
}

export function deleteCardFromLocalStorage(
  cardId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): SourcingHistoryCard[] {
  const stored = storage.getItem(SOURCING_CARD_STORAGE_KEY);
  const current = stored ? (JSON.parse(stored) as SourcingHistoryCard[]) : [];
  const next = removeCardById(current, cardId);
  storage.setItem(SOURCING_CARD_STORAGE_KEY, JSON.stringify(next));
  return next;
}

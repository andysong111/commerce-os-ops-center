import type { RecommendationCard } from "@/lib/sourcingEngine";

const KEY = "commerce-os:sourcing-engine-cards";

export function loadCards() {
  if (typeof window === "undefined") return [] as RecommendationCard[];
  const value = window.localStorage.getItem(KEY);
  if (!value) return [] as RecommendationCard[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as RecommendationCard[]) : [];
  } catch {
    return [] as RecommendationCard[];
  }
}

export function saveCard(card: RecommendationCard) {
  const next = [card, ...loadCards().filter((item) => item.id !== card.id)].slice(0, 200);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next.length;
}

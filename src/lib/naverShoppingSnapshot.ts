export type NaverShoppingApiItem = {
  title?: string;
  link?: string;
  image?: string;
  lprice?: string;
  hprice?: string;
  mallName?: string;
  productId?: string;
  productType?: string;
  brand?: string;
  maker?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  category4?: string;
};

export type NaverShoppingSnapshotItem = {
  title: string;
  link: string;
  image: string;
  lowPriceKrw: number;
  highPriceKrw: number;
  mallName: string;
  brand: string;
  maker: string;
  categoryPath: string;
};

export type NaverShoppingSnapshot = {
  keyword: string;
  total: number;
  displayCount: number;
  priceMinKrw: number;
  priceMedianKrw: number;
  priceMaxKrw: number;
  mallCount: number;
  brandCount: number;
  topMalls: Array<{ name: string; count: number }>;
  topBrands: Array<{ name: string; count: number }>;
  topCategories: Array<{ name: string; count: number }>;
  items: NaverShoppingSnapshotItem[];
  notes: string[];
};

export function buildNaverShoppingSnapshot({
  keyword,
  total,
  items,
}: {
  keyword: string;
  total: number;
  items: NaverShoppingApiItem[];
}): NaverShoppingSnapshot {
  const normalizedItems = items.map(normalizeNaverItem);
  const prices = normalizedItems
    .map((item) => item.lowPriceKrw)
    .filter((price) => price > 0)
    .sort((a, b) => a - b);

  const topMalls = topCounts(normalizedItems.map((item) => item.mallName).filter(Boolean));
  const topBrands = topCounts(normalizedItems.map((item) => item.brand).filter(Boolean));
  const topCategories = topCounts(
    normalizedItems.map((item) => item.categoryPath).filter(Boolean),
  );

  const snapshot: NaverShoppingSnapshot = {
    keyword,
    total,
    displayCount: normalizedItems.length,
    priceMinKrw: prices[0] ?? 0,
    priceMedianKrw: median(prices),
    priceMaxKrw: prices.at(-1) ?? 0,
    mallCount: new Set(normalizedItems.map((item) => item.mallName).filter(Boolean)).size,
    brandCount: new Set(normalizedItems.map((item) => item.brand).filter(Boolean)).size,
    topMalls,
    topBrands,
    topCategories,
    items: normalizedItems,
    notes: [],
  };

  snapshot.notes = buildSnapshotNotes(snapshot);
  return snapshot;
}

export function normalizeNaverItem(item: NaverShoppingApiItem): NaverShoppingSnapshotItem {
  return {
    title: stripHtml(item.title ?? ""),
    link: item.link ?? "",
    image: item.image ?? "",
    lowPriceKrw: toNumber(item.lprice),
    highPriceKrw: toNumber(item.hprice),
    mallName: item.mallName ?? "",
    brand: item.brand ?? "",
    maker: item.maker ?? "",
    categoryPath: [item.category1, item.category2, item.category3, item.category4]
      .filter(Boolean)
      .join(" > "),
  };
}

function buildSnapshotNotes(snapshot: NaverShoppingSnapshot) {
  const notes: string[] = [];

  if (snapshot.total === 0) {
    notes.push("검색 결과가 없어 신규 수요 검증에는 부적합합니다.");
  }
  if (snapshot.total > 50000) {
    notes.push("검색 결과 수가 매우 많아 가격경쟁/노출경쟁이 강할 수 있습니다.");
  }
  if (snapshot.priceMedianKrw > 0 && snapshot.priceMedianKrw < 7000) {
    notes.push("중위 가격이 낮아 수입/배송비 반영 후 마진 압박이 클 수 있습니다.");
  }
  if (snapshot.brandCount > 0 && snapshot.topBrands[0]?.count >= snapshot.displayCount * 0.35) {
    notes.push("상위 결과에서 특정 브랜드 비중이 높아 비브랜드 진입 난이도를 확인해야 합니다.");
  }
  if (snapshot.mallCount > 0 && snapshot.topMalls[0]?.count >= snapshot.displayCount * 0.35) {
    notes.push("특정 몰 비중이 높아 가격 기준이 왜곡될 수 있습니다.");
  }
  if (snapshot.displayCount > 0 && snapshot.notes.length === 0) {
    notes.push("MVP 기준상 경쟁 스냅샷 참고 가능. 실제 판매량 데이터는 아닙니다.");
  }

  return notes;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

function toNumber(value?: string) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return Math.round((values[middle - 1] + values[middle]) / 2);
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
}

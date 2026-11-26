export type ChinaLinkUsage = {
  commonUrl: string;
  purchaseUrl: string;
  detailPageUrl: string;
  purchaseAlternates: string[];
};

export const MAX_CHINA_PRODUCT_LINKS: number;
export function normalizeChinaProductUrl(value: unknown): string;
export function normalizeChinaProductLinks(value: unknown): string[];
export function promoteChinaProductLink(values: unknown, selectedIndex: unknown): string[];
export function readChinaProductLinks(item: unknown): string[];
export function sameChinaProductLinks(item: unknown, values: unknown): boolean;
export function applyChinaProductLinks(
  item: Record<string, unknown>,
  values: unknown,
  options?: { now?: Date; updatedBy?: string },
): Record<string, unknown>;

export function normalizeChinaLinkUsage(value: unknown): ChinaLinkUsage;
export function readLegacyChinaLinkUsage(item: unknown): ChinaLinkUsage;
export function readChinaLinkUsage(item: unknown): ChinaLinkUsage;
export function readChinaPurchaseLink(item: unknown): string;
export function readChinaDetailPageLink(item: unknown): string;
export function setChinaLinkUsageInput(
  usage: ChinaLinkUsage, role: "purchaseUrl" | "detailPageUrl", value: string,
): ChinaLinkUsage;
export function addChinaPurchaseAlternate(usage: ChinaLinkUsage): ChinaLinkUsage;
export function chinaLinkUsagePatch(item: unknown, value: unknown): {
  chinaLinkUsage: ChinaLinkUsage;
  chinaProductLinks: string[];
  primaryChinaProductLink: string;
  detailPageSource: Record<string, unknown>;
};
export function applyChinaLinkUsage<T extends Record<string, unknown>>(
  item: T, value: unknown, options?: { now?: Date; updatedBy?: string },
): T & ReturnType<typeof chinaLinkUsagePatch> & { updatedAt: string; updatedBy: string };

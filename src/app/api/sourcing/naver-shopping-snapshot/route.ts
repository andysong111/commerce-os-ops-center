import { NextResponse, type NextRequest } from "next/server";
import {
  buildNaverShoppingSnapshot,
  type NaverShoppingApiItem,
} from "@/lib/naverShoppingSnapshot";

const NAVER_SHOPPING_SEARCH_URL = "https://openapi.naver.com/v1/search/shop.json";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword")?.trim() ?? "";
  const excludeOverseas = request.nextUrl.searchParams.get("excludeOverseas") === "true";
  const display = clampNumber(Number(request.nextUrl.searchParams.get("display") ?? 50), 10, 100);

  if (!keyword) {
    return NextResponse.json(
      {
        ok: false,
        code: "MISSING_KEYWORD",
        message: "keyword query parameter is required.",
      },
      { status: 400 },
    );
  }

  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        ok: false,
        code: "MISSING_NAVER_KEYS",
        message:
          "NAVER_SEARCH_CLIENT_ID and NAVER_SEARCH_CLIENT_SECRET are required to use the Naver shopping snapshot adapter.",
      },
      { status: 503 },
    );
  }

  const url = new URL(NAVER_SHOPPING_SEARCH_URL);
  url.searchParams.set("query", keyword);
  url.searchParams.set("display", String(display));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "sim");
  if (excludeOverseas) {
    url.searchParams.set("exclude", "cbshop");
  }

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "NAVER_API_ERROR",
        status: response.status,
        message: "Naver shopping search request failed.",
      },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    total?: number;
    items?: NaverShoppingApiItem[];
  };

  const snapshot = buildNaverShoppingSnapshot({
    keyword,
    total: payload.total ?? 0,
    items: payload.items ?? [],
  });

  return NextResponse.json({
    ok: true,
    snapshot,
    notice:
      "This is a competition snapshot, not sales-volume proof. Use it only as a sourcing decision aid.",
  });
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

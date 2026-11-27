import type { createSupabaseAdminClient } from "./supabase/admin";
type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;
type Query = ReturnType<Db["from"]>;

export async function readSeoPagesResult(makeQuery: () => Query, sort: string) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await makeQuery()
      .order(sort)
      .range(offset, offset + 399);
    if (error || !Array.isArray(data))
      return {
        data: null,
        error: error ?? { message: "SEO 원장 응답 확인 필요" },
      };
    rows.push(...data);
    if (data.length < 400) return { data: rows, error: null };
  }
}
export async function readSeoPages(makeQuery: () => Query, sort: string) {
  const result = await readSeoPagesResult(makeQuery, sort);
  if (result.error)
    throw new Error("SEO 원장을 읽지 못했습니다. " + result.error.message);
  return result.data;
}
export async function readSeoIdPages(
  ids: string[],
  makeQuery: (ids: string[]) => Query,
  sort: string,
) {
  const result: Row[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    result.push(...(await readSeoPages(() => makeQuery(batch), sort)));
  }
  return result;
}

import { createSupabaseAdminClient } from "./supabase/admin.ts";

type AdminClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseAdminClient>>
>;
type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function rows(value: unknown) {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function missingIsolationSchema(error: { message: string; code?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /seo_listing_lifecycle_isolations.*(?:does not exist|schema cache)/i.test(
      error.message,
    )
  );
}

export async function readActiveSeoListingLifecycleIsolations(
  admin: AdminClient,
  ownerId: string,
) {
  const result = await admin
    .from("seo_listing_lifecycle_isolations")
    .select(
      "launch_item_id,reason_code,evidence_basis,isolation_fingerprint,correction_plan_fingerprint,isolated_at",
    )
    .eq("owner_id", ownerId)
    .eq("active", true)
    .limit(1000);
  if (result.error) {
    if (missingIsolationSchema(result.error)) {
      return {
        schemaAvailable: false,
        rows: [] as UnknownRecord[],
        launchItemIds: new Set<string>(),
      };
    }
    throw new Error(
      `SEO_LIFECYCLE_ISOLATION_READ_FAILED:${result.error.message}`,
    );
  }
  const activeRows = rows(result.data);
  return {
    schemaAvailable: true,
    rows: activeRows,
    launchItemIds: new Set(
      activeRows.map((row) => text(row.launch_item_id)).filter(Boolean),
    ),
  };
}

export function excludeActiveSeoListingLifecycleIsolations(
  lifecycleRows: UnknownRecord[],
  launchItemIds: ReadonlySet<string>,
) {
  if (launchItemIds.size === 0) return lifecycleRows;
  return lifecycleRows.filter(
    (row) => !launchItemIds.has(text(row.launch_item_id)),
  );
}

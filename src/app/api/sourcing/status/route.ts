import { resolveSourcingRequestContext } from "@/lib/sourcingOrganization";
import { validateSourcingStorageConfig } from "@/lib/sourcingServerStorage";

export async function GET() {
  const config = validateSourcingStorageConfig();
  const base = {
    ok: true,
    supabaseConfigured: config.ok,
    missing: config.ok ? [] : config.missing,
    organizationId: process.env.SOURCING_ORGANIZATION_ID || null,
  };

  if (!config.ok) {
    return Response.json({ ...base, signedIn: false, cardsUsable: false, code: "SUPABASE_NOT_CONFIGURED" });
  }

  const resolved = await resolveSourcingRequestContext();
  if (!resolved.ok) {
    return Response.json({ ...base, signedIn: false, cardsUsable: false, code: resolved.body.code, message: resolved.body.message }, { status: resolved.status });
  }

  return Response.json({
    ...base,
    signedIn: true,
    userId: resolved.context.userId,
    organizationId: resolved.context.organizationId,
    cardsUsable: true,
  });
}

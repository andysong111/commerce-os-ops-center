import { resolveSourcingRequestContext } from "@/lib/sourcingOrganization";
import { validateSourcingStorageConfig } from "@/lib/sourcingServerStorage";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function GET() {
  const publicConfig = getSupabasePublicConfig();
  const serverConfig = validateSourcingStorageConfig();
  const base = {
    ok: true,
    supabaseConfigured: serverConfig.ok,
    publicConfigOk: publicConfig.ok,
    publicKeyName: publicConfig.publicKeyName,
    missingPublic: publicConfig.missing,
    missingServer: serverConfig.ok ? [] : serverConfig.missing,
    organizationId: process.env.SOURCING_ORGANIZATION_ID || null,
  };

  if (!serverConfig.ok) {
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

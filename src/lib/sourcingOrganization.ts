import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SourcingRequestContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  userId: string;
  organizationId: string;
};

export async function resolveSourcingRequestContext(): Promise<
  | { ok: true; context: SourcingRequestContext }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, status: 503, body: { ok: false, code: "SUPABASE_NOT_CONFIGURED", message: "Supabase client is not configured." } };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, status: 401, body: { ok: false, code: "AUTH_REQUIRED", message: "Sign in before using Supabase-backed sourcing storage." } };
  }

  const requestedOrganizationId = process.env.SOURCING_ORGANIZATION_ID;
  if (requestedOrganizationId) {
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", requestedOrganizationId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, status: 403, body: { ok: false, code: "ORG_ACCESS_DENIED", message: "The signed-in user is not a member of the configured sourcing organization." } };
    }
    return { ok: true, context: { supabase, userId: userData.user.id, organizationId: requestedOrganizationId } };
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.organization_id) {
    return { ok: false, status: 403, body: { ok: false, code: "ORG_REQUIRED", message: "No organization membership was found for this user. Create or select an organization before saving to Supabase." } };
  }

  return { ok: true, context: { supabase, userId: userData.user.id, organizationId: String(data.organization_id) } };
}

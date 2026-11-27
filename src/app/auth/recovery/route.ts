import { passwordRecoveryResponse } from "@/lib/accountPassword";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const supabase = await createSupabaseServerClient();
  return passwordRecoveryResponse(params, supabase?.auth.exchangeCodeForSession.bind(supabase.auth));
}

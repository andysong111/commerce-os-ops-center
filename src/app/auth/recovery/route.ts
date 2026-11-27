import { NextResponse } from "next/server";
import { passwordRecoveryDestination } from "@/lib/accountPassword";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const supabase = await createSupabaseServerClient();
  const destination = await passwordRecoveryDestination(params, supabase?.auth.exchangeCodeForSession.bind(supabase.auth));
  return NextResponse.redirect(new URL(destination, request.url), {
    status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

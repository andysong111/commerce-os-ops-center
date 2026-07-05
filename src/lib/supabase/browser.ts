import { getSupabasePublicConfig } from "@/lib/supabase/config";
export async function createSupabaseBrowserClient() {
  const { url: supabaseUrl, publicKey: supabasePublicKey } = getSupabasePublicConfig();

  if (!supabaseUrl || !supabasePublicKey) return null;

  const { createBrowserClient } = await dynamicImportSupabaseSsr();
  return createBrowserClient(supabaseUrl, supabasePublicKey);
}

async function dynamicImportSupabaseSsr(): Promise<{ createBrowserClient: (url: string, key: string) => unknown }> {
  return Function("specifier", "return import(specifier)")("@supabase/ssr");
}

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config.ok) return null;

  const { createBrowserClient } = await dynamicImportSupabaseSsr();
  return createBrowserClient(config.url, config.publicKey);
}

async function dynamicImportSupabaseSsr(): Promise<{ createBrowserClient: (url: string, key: string) => unknown }> {
  return Function("specifier", "return import(specifier)")("@supabase/ssr");
}

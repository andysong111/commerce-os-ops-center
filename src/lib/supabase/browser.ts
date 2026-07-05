import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config.ok) return null;

  return createBrowserClient(config.url, config.publicKey);
}

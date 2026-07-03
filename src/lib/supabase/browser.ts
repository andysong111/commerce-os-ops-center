export async function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) return null;

  const { createBrowserClient } = await dynamicImportSupabaseSsr();
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}

async function dynamicImportSupabaseSsr(): Promise<{ createBrowserClient: (url: string, key: string) => unknown }> {
  return Function("specifier", "return import(specifier)")("@supabase/ssr");
}

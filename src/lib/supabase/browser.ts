type SupabaseBrowserClient = {
  auth: {
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ error: { message: string } | null }>;
    signOut: () => Promise<{ error: { message: string } | null }>;
    getUser: () => Promise<{ data: { user: { email?: string | null } | null }; error: { message: string } | null }>;
  };
};

export async function createSupabaseBrowserClient(): Promise<SupabaseBrowserClient | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) return null;

  const { createBrowserClient } = await dynamicImportSupabaseSsr();
  return createBrowserClient(supabaseUrl, supabasePublishableKey) as SupabaseBrowserClient;
}

async function dynamicImportSupabaseSsr(): Promise<{ createBrowserClient: (url: string, key: string) => unknown }> {
  return Function("specifier", "return import(specifier)")("@supabase/ssr");
}

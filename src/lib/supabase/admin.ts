export async function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) return null;

  const { createClient } = await dynamicImportSupabaseJs();
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function dynamicImportSupabaseJs(): Promise<{ createClient: (url: string, key: string, options: unknown) => unknown }> {
  return Function("specifier", "return import(specifier)")("@supabase/supabase-js");
}

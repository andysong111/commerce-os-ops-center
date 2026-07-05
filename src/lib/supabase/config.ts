export function getSupabasePublicConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publicKey = publishableKey || anonKey;
  const publicKeyName = publishableKey
    ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    : anonKey
      ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
      : null;

  const missing = [
    !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !publicKey ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter(Boolean) as string[];

  return {
    ok: missing.length === 0,
    url: url ?? "",
    publicKey: publicKey ?? "",
    publicKeyName,
    missing,
  };
}

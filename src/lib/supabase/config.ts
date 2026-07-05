export const SUPABASE_URL_ENV_NAME = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_PUBLISHABLE_KEY_ENV_NAME = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
export const SUPABASE_ANON_KEY_ENV_NAME = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export type SupabasePublicConfigStatus = {
  hasUrl: boolean;
  hasPublicKey: boolean;
  publicKeyName: typeof SUPABASE_PUBLISHABLE_KEY_ENV_NAME | typeof SUPABASE_ANON_KEY_ENV_NAME | null;
  missing: string[];
};

export type SupabasePublicConfig = SupabasePublicConfigStatus & {
  url?: string;
  publicKey?: string;
};

export function getSupabasePublicConfig(env: NodeJS.ProcessEnv = process.env): SupabasePublicConfig {
  const url = env[SUPABASE_URL_ENV_NAME];
  const publishableKey = env[SUPABASE_PUBLISHABLE_KEY_ENV_NAME];
  const anonKey = env[SUPABASE_ANON_KEY_ENV_NAME];
  const publicKey = publishableKey || anonKey;
  const publicKeyName = publishableKey ? SUPABASE_PUBLISHABLE_KEY_ENV_NAME : anonKey ? SUPABASE_ANON_KEY_ENV_NAME : null;
  const missing = [];

  if (!url) missing.push(SUPABASE_URL_ENV_NAME);
  if (!publicKey) missing.push(`${SUPABASE_PUBLISHABLE_KEY_ENV_NAME} or ${SUPABASE_ANON_KEY_ENV_NAME}`);

  return {
    url,
    publicKey,
    hasUrl: Boolean(url),
    hasPublicKey: Boolean(publicKey),
    publicKeyName,
    missing,
  };
}

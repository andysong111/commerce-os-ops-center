import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

type SupabaseServerClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; email?: string } | null }; error: { message: string } | null }>;
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ error: { message: string } | null }>;
    signInWithOtp: (credentials: { email: string; options?: { emailRedirectTo?: string } }) => Promise<{ error: { message: string } | null }>;
    exchangeCodeForSession: (code: string) => Promise<{ error: { message: string } | null }>;
    signOut: () => Promise<{ error: { message: string } | null }>;
  };
  from: (table: string) => SupabaseQueryBuilder;
};

type SupabaseQueryBuilder = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (columns?: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => SupabaseQueryBuilder;
  limit: (count: number) => SupabaseQueryBuilder;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  single: () => Promise<{ data: Record<string, unknown>; error: { message: string } | null }>;
  upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => SupabaseQueryBuilder;
  insert: (row: Record<string, unknown>) => SupabaseQueryBuilder;
};

export async function createSupabaseServerClient(): Promise<SupabaseServerClient | null> {
  const config = getSupabasePublicConfig();
  if (!config.ok) return null;

  try {
    const { createServerClient } = await dynamicImportSupabaseSsr();
    const cookieStore = await cookies();
    return createServerClient(config.url, config.publicKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }) as SupabaseServerClient;
  } catch {
    return null;
  }
}

async function dynamicImportSupabaseSsr(): Promise<{
  createServerClient: (url: string, key: string, options: unknown) => unknown;
}> {
  return Function("specifier", "return import(specifier)")("@supabase/ssr");
}

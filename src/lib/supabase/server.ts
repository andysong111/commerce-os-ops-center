import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { RecoveryExchange } from "@/lib/accountPassword";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { getOpsAuthCookieOptions } from "@/lib/supabase/session";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

type SupabaseServerClient = {
  auth: {
    getUser: (jwt?: string) => Promise<{ data: { user: { id: string; email?: string } | null }; error: { message: string; code?: string; name?: string; status?: number } | null }>;
    getSession: () => Promise<{
      data: {
        session: {
          access_token: string;
          user?: { id?: string; email?: string };
        } | null;
      };
      error: { message: string; code?: string; name?: string; status?: number } | null;
    }>;
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ error: { message: string } | null }>;
    signInWithOtp: (credentials: { email: string; options?: { emailRedirectTo?: string } }) => Promise<{ error: { message: string } | null }>;
    resetPasswordForEmail: (email: string, options: { redirectTo: string }) => Promise<{ error: { code?: string; status?: number } | null }>;
    exchangeCodeForSession: RecoveryExchange;
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
  delete: () => SupabaseQueryBuilder;
};

export async function createSupabaseServerClient(): Promise<SupabaseServerClient | null> {
  const config = getSupabasePublicConfig();
  if (!config.ok) return null;

  try {
    const cookieStore = await cookies();
    return createServerClient(config.url, config.publicKey, {
      cookieOptions: getOpsAuthCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: CookieToSet[],
          headersToSet?: Record<string, string>,
        ) {
          void headersToSet;
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }) as unknown as SupabaseServerClient;
  } catch {
    return null;
  }
}

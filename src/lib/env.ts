import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

export const supabaseConfigured =
  /^https:\/\/[^\s]+$/i.test(url) &&
  anonKey.length >= 32 &&
  !url.includes('your-project') &&
  !anonKey.includes('your-public-anon-key');

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
      global: {
        headers: { 'x-client-info': 'khidki-web/1.0.0' },
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}

export const appUrl = () => window.location.origin;

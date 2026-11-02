import { getRequest } from '@tanstack/react-start/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export function getRequestAuthToken(): string | undefined {
  try {
    const req = getRequest();
    const authHeader = req?.headers.get('authorization') || req?.headers.get('x-supabase-auth');
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
  } catch {
    /* Raw Worker webhook has no TanStack request. */
  }
  return undefined;
}

export function getRuntimeEnv(name: string): string | undefined {
  const globalEnv = (globalThis as any)?.__ENV__;
  const runtimeValue =
    (globalEnv && typeof globalEnv === 'object' ? globalEnv[name] : undefined) ??
    (typeof process !== 'undefined' ? process.env[name] : undefined);

  const buildValue =
    name === 'VITE_SUPABASE_URL' ||
    name === 'VITE_SUPABASE_ANON_KEY' ||
    name === 'VITE_SUPABASE_PUBLISHABLE_KEY' ||
    name === 'RESEND_FROM_EMAIL'
      ? (import.meta as any).env?.[name]
      : undefined;
  const value = runtimeValue ?? buildValue;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function createRequestSupabaseClient(explicitAuthToken?: string) {
  let request: Request | undefined;
  try {
    request = getRequest();
  } catch {
    /* Raw Worker webhook has no TanStack request. */
  }

  const supabaseUrl =
    getRuntimeEnv('SUPABASE_URL') ??
    getRuntimeEnv('VITE_SUPABASE_URL') ??
    'https://iockpxtkflyjfagkvgnr.supabase.co';
  const supabaseKey =
    getRuntimeEnv('SUPABASE_ANON_KEY') ??
    getRuntimeEnv('SUPABASE_PUBLISHABLE_KEY') ??
    getRuntimeEnv('VITE_SUPABASE_ANON_KEY') ??
    getRuntimeEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    'sb_publishable_jLUHqN-Y_2az8c0Y2yG3mA_gl618304';

  let token = explicitAuthToken?.trim();
  if (!token) {
    const rawHeader = request?.headers.get('authorization') || request?.headers.get('x-supabase-auth');
    if (rawHeader) {
      token = rawHeader.replace(/^Bearer\s+/i, '').trim();
    }
  }

  const authorization = token ? `Bearer ${token}` : undefined;
  return createClient<Database>(supabaseUrl, supabaseKey, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(
          typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers)
          new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        headers.set('apikey', supabaseKey);
        if (authorization) headers.set('Authorization', authorization);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

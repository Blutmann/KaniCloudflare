import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type StaffProfile = Tables<'staff_profiles'>;
export type StaffRole = StaffProfile['role'];
export type StaffBarber = Tables<'barbers'>;

export type AuthenticatedStaff = {
  user: User;
  profile: StaffProfile;
  barbers: StaffBarber[];
};

let cachedStaff: { data: AuthenticatedStaff | null; timestamp: number } | null = null;
let inFlightStaff: Promise<AuthenticatedStaff | null> | null = null;
const STAFF_CACHE_TTL_MS = 15 * 1000; // 15s fast-cache for staff sessions

export function clearStaffCache() {
  cachedStaff = null;
  inFlightStaff = null;
}

export async function signInWithPassword(email: string, password: string) {
  clearStaffCache();
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function signOut() {
  clearStaffCache();
  return supabase.auth.signOut();
}

async function fetchAuthenticatedStaff(): Promise<AuthenticatedStaff | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('staff_profiles')
    .select('user_id, role, barber_id, display_name, active, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.active) return null;

  let barbersQuery = supabase
    .from('barbers')
    .select('id, name, active, created_at')
    .eq('active', true);

  if (profile.role === 'BARBER') {
    if (!profile.barber_id) return null;
    barbersQuery = barbersQuery.eq('id', profile.barber_id);
  }

  const { data: barbers, error: barbersError } = await barbersQuery;
  if (barbersError || !barbers?.length) return null;
  const onlyBarber = barbers[0];
  if (profile.role === 'BARBER' && (barbers.length !== 1 || !onlyBarber || onlyBarber.id !== profile.barber_id)) return null;

  return { user, profile, barbers };
}

export async function getAuthenticatedStaff(options?: { bypassCache?: boolean }): Promise<AuthenticatedStaff | null> {
  const now = Date.now();
  if (!options?.bypassCache && cachedStaff && now - cachedStaff.timestamp < STAFF_CACHE_TTL_MS) {
    return cachedStaff.data;
  }

  if (!options?.bypassCache && inFlightStaff) {
    return inFlightStaff;
  }

  const promise = (async () => {
    try {
      const result = await fetchAuthenticatedStaff();
      cachedStaff = { data: result, timestamp: Date.now() };
      return result;
    } finally {
      inFlightStaff = null;
    }
  })();

  inFlightStaff = promise;
  return promise;
}

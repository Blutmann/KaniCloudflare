import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { validStaffScope } from './kani-permissions';

export type StaffProfile = Omit<Tables<'staff_profiles'>, 'role'> & { role: 'ADMIN' | 'MANAGER' | 'BARBER' };
export type StaffRole = StaffProfile['role'];
export type StaffBarber = Tables<'barbers'>;

export type AuthenticatedStaff = {
  user: User;
  profile: StaffProfile;
  barbers: StaffBarber[];
};

const STAFF_AUTH_EVENT = 'kani:staff-auth-changed';

let cachedStaff: { data: AuthenticatedStaff; timestamp: number } | null = null;
let inFlightStaff: Promise<AuthenticatedStaff | null> | null = null;
let sessionRevision = 0;
const STAFF_CACHE_TTL_MS = 15 * 1000; // 15s fast-cache for staff sessions

function emitStaffAuth(staff: AuthenticatedStaff | null) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(STAFF_AUTH_EVENT, { detail: { staff } }));
  } catch {
    // Non-DOM or constrained environment
  }
}

export function clearStaffCache() {
  sessionRevision += 1;
  cachedStaff = null;
  inFlightStaff = null;
  emitStaffAuth(null);
}

export async function signInWithPassword(email: string, password: string) {
  clearStaffCache();
  const res = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (res.data?.session?.access_token && typeof document !== 'undefined') {
    try {
      const maxAge = res.data.session.expires_in || 3600;
      document.cookie = `sb-access-token=${encodeURIComponent(res.data.session.access_token)}; path=/; max-age=${maxAge}; SameSite=Lax; Secure`;
    } catch {}
  }
  return res;
}

export async function signOut() {
  clearStaffCache();
  if (typeof document !== 'undefined') {
    try {
      document.cookie = `sb-access-token=; path=/; max-age=0; SameSite=Lax; Secure`;
    } catch {}
  }
  return supabase.auth.signOut();
}

async function fetchAuthenticatedStaff(): Promise<AuthenticatedStaff | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  if (session.access_token && typeof document !== 'undefined') {
    try {
      const maxAge = session.expires_in || 3600;
      document.cookie = `sb-access-token=${encodeURIComponent(session.access_token)}; path=/; max-age=${maxAge}; SameSite=Lax; Secure`;
    } catch {}
  }

  const sessionUserId = session.user?.id;

  const [
    {
      data: { user },
      error: userError,
    },
    profileRes,
    barbersRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    sessionUserId
      ? supabase
          .from('staff_profiles')
          .select('user_id, role, barber_id, display_name, active, created_at, updated_at')
          .eq('user_id', sessionUserId)
          .maybeSingle()
      : Promise.resolve(null),
    supabase.from('barbers').select('id, name, active, created_at').eq('active', true),
  ]);

  if (userError || !user) return null;
  if (sessionUserId && user.id !== sessionUserId) return null;

  const { data: profile, error: profileError } = profileRes ?? (await supabase
    .from('staff_profiles')
    .select('user_id, role, barber_id, display_name, active, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle());

  if (profileError || !profile || !profile.active || !validStaffScope(profile)) return null;

  if (profile.role === 'BARBER' && !profile.barber_id) return null;

  const { data: allActiveBarbers, error: barbersError } = barbersRes;
  if (barbersError || !allActiveBarbers?.length) return null;

  const rawBarbers =
    profile.role === 'BARBER'
      ? allActiveBarbers.filter(barber => barber.id === profile.barber_id)
      : allActiveBarbers;

  if (!rawBarbers.length) return null;
  const officialOrder = ['Lautaro', 'Gonzalo', 'Valentín', 'Franco'];
  const barbers = [...rawBarbers].sort((a, b) => {
    const idxA = officialOrder.indexOf(a.name);
    const idxB = officialOrder.indexOf(b.name);
    return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
  });
  const onlyBarber = barbers[0];
  if (profile.role === 'BARBER' && (barbers.length !== 1 || !onlyBarber || onlyBarber.id !== profile.barber_id)) return null;

  return { user, profile, barbers };
}

export async function getAuthenticatedStaff(options?: { bypassCache?: boolean }): Promise<AuthenticatedStaff | null> {
  const revision = sessionRevision;
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
      if (revision !== sessionRevision) return null;
      cachedStaff = result ? { data: result, timestamp: Date.now() } : null;
      emitStaffAuth(result);
      return result;
    } catch {
      return null;
    } finally {
      if (revision === sessionRevision) inFlightStaff = null;
    }
  })();

  inFlightStaff = promise;
  return promise;
}

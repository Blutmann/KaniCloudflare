import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { initialAppointments, initialAvailability, initialSlotOverrides, availableSlots, slotKey, type Appointment, type Availability, type Barber, type SlotOverride, type SlotOverrides, type Status } from '@/lib/kani-model';
export type KaniTheme = 'dark' | 'light';
type Store = { appointments: Appointment[]; availability: Availability; slotOverrides: SlotOverrides; mobileMenuOpen: boolean; setMobileMenuOpen: (open: boolean) => void; theme: KaniTheme; toggleTheme: () => void; addAppointment: (a: Omit<Appointment, 'id' | 'status'>) => Appointment | null; setStatus: (id: string, status: Status) => void; setAvailability: (availability: Availability) => void; setSlotOverride: (barber: Barber, date: string, time: string, override: SlotOverride | null) => void };
const KaniContext = createContext<Store | null>(null);
export function KaniProvider({ children }: { children: ReactNode }) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [availability, setAvailabilityState] = useState<Availability>(initialAvailability);
  const [slotOverrides, setSlotOverrides] = useState<SlotOverrides>(initialSlotOverrides);
  const [mobileMenuOpen, setMobileMenuOpenState] = useState(false);
  const [theme, setTheme] = useState<KaniTheme>('light');
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    let saved: KaniTheme = 'light';
    try {
      saved = window.localStorage.getItem('kani-theme') === 'dark' ? 'dark' : 'light';
    } catch { /* storage may be unavailable */ }
    document.documentElement.dataset['theme'] = saved;
    setTheme(saved);
    setThemeReady(true);
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset['theme'] = theme;
    try { window.localStorage.setItem('kani-theme', theme); } catch { /* storage may be unavailable */ }
  }, [theme, themeReady]);

  const setMobileMenuOpen = useCallback((open: boolean) => {
    setMobileMenuOpenState(open);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(current => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const addAppointment = useCallback((a: Omit<Appointment, 'id' | 'status'>) => {
    let created: Appointment | null = null;
    setAppointments(prev => {
      if (!availableSlots(a.service, a.barber, a.date, prev, availability, slotOverrides).includes(a.time)) {
        return prev;
      }
      const next: Appointment = { ...a, id: `K-${Date.now().toString().slice(-6)}`, status: 'Pendiente' };
      created = next;
      return [...prev, next];
    });
    return created;
  }, [availability, slotOverrides]);

  const setStatus = useCallback((id: string, status: Status) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, status } : a)));
  }, []);

  const setAvailability = useCallback((next: Availability) => {
    setAvailabilityState(next);
  }, []);

  const setSlotOverride = useCallback((barber: Barber, date: string, time: string, override: SlotOverride | null) => {
    setSlotOverrides(prev => {
      const key = slotKey(barber, date, time);
      if (!override) { const next = { ...prev }; delete next[key]; return next; }
      return { ...prev, [key]: override };
    });
  }, []);

  const value = useMemo<Store>(() => ({
    appointments,
    availability,
    slotOverrides,
    mobileMenuOpen,
    setMobileMenuOpen,
    theme,
    toggleTheme,
    addAppointment,
    setStatus,
    setAvailability,
    setSlotOverride,
  }), [
    appointments,
    availability,
    slotOverrides,
    mobileMenuOpen,
    setMobileMenuOpen,
    theme,
    toggleTheme,
    addAppointment,
    setStatus,
    setAvailability,
    setSlotOverride,
  ]);

  return <KaniContext.Provider value={value}>{children}</KaniContext.Provider>;
}
export function useKani() { const store = useContext(KaniContext); if (!store) throw new Error('KANI provider is missing'); return store; }

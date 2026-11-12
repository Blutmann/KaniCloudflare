import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { barbers } from './kani-model';
import { readPublicBookingBarbers, readPublicAvailabilityStarts, readAvailabilityStartsForRange, eligibleBarbersForAvailabilityStart } from './kani-availability';

const roster = barbers.map(name => ({ id: name, name, public_booking_enabled: name !== 'Franco' }));
const starts = barbers.map(barber_id => ({ barber_id, slot_date: '2026-11-14', start_time: '16:00', compatible_services: ['Corte'], is_exception: true }));
beforeEach(() => rpc.mockReset());
describe('public commercial roster independent of internal staff access', () => {
  it('filters hidden rows even if the signed-in session can read them; keeps internal model intact', async () => {
    rpc.mockResolvedValue({ data: roster, error: null });
    expect((await readPublicBookingBarbers()).map(b => b.name)).toEqual(['Lautaro', 'Gonzalo', 'Valentín']);
    expect(barbers).toContain('Franco');
  });
  it('fails closed on listing errors and unknown flag values', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    await expect(readPublicBookingBarbers()).rejects.toThrow('unavailable');
    rpc.mockResolvedValueOnce({ data: [{ id: 'Franco', name: 'Franco' }], error: null });
    expect(await readPublicBookingBarbers()).toEqual([]);
  });
  it('filters hidden availability out of deferred assignment, even with a stale internal RPC response', async () => {
    rpc.mockResolvedValueOnce({ data: roster, error: null }).mockResolvedValueOnce({ data: starts, error: null });
    const publicStarts = await readPublicAvailabilityStarts(null, '2026-11-14', '2026-11-14');
    expect(eligibleBarbersForAvailabilityStart(publicStarts, '2026-11-14', '16:00', 'Corte', new Date('2026-11-01T12:00:00Z'))).toEqual(['Lautaro', 'Gonzalo', 'Valentín']);
  });
  it('offers no time or automatic candidate when only the hidden professional is available', async () => {
    rpc.mockResolvedValueOnce({ data: roster, error: null }).mockResolvedValueOnce({ data: starts.filter(s => s.barber_id === 'Franco'), error: null });
    expect(await readPublicAvailabilityStarts(null, '2026-11-14', '2026-11-14')).toEqual([]);
  });
  it('does not query hidden IDs chosen by a manipulated public selection', async () => {
    rpc.mockResolvedValueOnce({ data: roster, error: null });
    expect(await readPublicAvailabilityStarts('Franco', '2026-11-14', '2026-11-14')).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps the scoped internal availability query for Franco separate', async () => {
    rpc.mockResolvedValueOnce({ data: starts.filter(s => s.barber_id === 'Franco'), error: null });
    expect(await readAvailabilityStartsForRange('Franco')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('read_valid_availability_starts', { p_barber_id: 'Franco', p_from_date: null, p_to_date: null });
  });
  it('takes commercial changes into account without a cached active-only roster', async () => {
    rpc.mockResolvedValueOnce({ data: roster, error: null }).mockResolvedValueOnce({ data: roster.map(b => ({ ...b, public_booking_enabled: true })), error: null });
    expect(await readPublicBookingBarbers()).toHaveLength(3);
    expect(await readPublicBookingBarbers()).toHaveLength(4);
  });
});

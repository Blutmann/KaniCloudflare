import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/lib/kani-notifications.functions', () => ({ sendAppointmentNotification: mocks.send }));
import { updateRealAppointmentStatus } from './kani-appointments';

describe('cancellation persistence before notification', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not dispatch when the real DB update fails', async () => {
    mocks.rpc.mockResolvedValue({ error: new Error('DB_FAILED') });
    await expect(updateRealAppointmentStatus('id', 'CANCELLED')).rejects.toThrow('DB_FAILED');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('dispatches the persisted cancellation claim', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ appointment_status:'CANCELLED', notification_claim_token:'claim' }], error:null });
    mocks.send.mockResolvedValue({status:'SENT'});
    await expect(updateRealAppointmentStatus('id','CANCELLED')).resolves.toBe('CANCELLED');
    expect(mocks.send).toHaveBeenCalledWith({data:{appointmentId:'id',claimToken:'claim',clientPhone:undefined}});
  });
  it('keeps a successful cancellation when email fails and records diagnostics', async () => {
    mocks.rpc.mockResolvedValueOnce({data:[{appointment_status:'CANCELLED',notification_claim_token:'claim'}],error:null})
      .mockResolvedValue({error:null});
    mocks.send.mockRejectedValue(new Error('EMAIL_FAILED'));
    await expect(updateRealAppointmentStatus('id','CANCELLED')).resolves.toBe('CANCELLED');
    expect(mocks.rpc).toHaveBeenCalledWith('record_appointment_notification_dispatch_error', expect.objectContaining({p_appointment_id:'id'}));
    expect(mocks.rpc.mock.calls.filter(([name])=>name==='update_appointment_status')).toHaveLength(1);
  });
  it('does not resend an idempotent cancellation', async () => {
    mocks.rpc.mockResolvedValue({data:[{appointment_status:'CANCELLED',notification_claim_token:null}],error:null});
    await updateRealAppointmentStatus('id','CANCELLED');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

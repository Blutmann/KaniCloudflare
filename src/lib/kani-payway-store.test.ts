import { describe, expect, it, vi } from 'vitest';
import { createPaywayStore } from './kani-payway-store.server';

const appointmentId='123e4567-e89b-42d3-a456-426614174000';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const compact=id.replaceAll('-','');
const owner={appointmentId,accessToken:'x'.repeat(64),expiresAt:Date.now()+60000};
const draft={barber:'Lautaro',serviceName:'Corte',date:'2026-10-27',time:'10:00',name:'Synthetic Client',email:'fixture@example.test',phone:'+5491100000000',notes:''};
const row={id,appointment_id:appointmentId,site_transaction_id:'KANI'+compact,provider_site_id:'12345678',amount_ars:3000,amount_minor_units:300000,state:'PROCESSING',provider_transaction_id:null,confirmation_status:'NOT_CONFIRMED',expires_at:new Date(owner.expiresAt).toISOString()};
function setup(){
  const rpc=vi.fn().mockResolvedValue({data:{acquired:true,attempt:row,appointment:{id:appointmentId,status:'PENDING',deposit_ars:3000,service_price_ars:25000,deposit_paid:false}},error:null});
  const session={read:vi.fn().mockResolvedValue(owner),write:vi.fn().mockResolvedValue(undefined),clear:vi.fn().mockResolvedValue(undefined)};
  const store=createPaywayStore({rpc} as unknown as Parameters<typeof createPaywayStore>[0],'12345678',session);
  return {rpc,session,store};
}
describe('durable Payway adapter',()=>{
  it('uses the atomic preparation RPC and its authoritative deposit, without persisting authentication',async()=>{
    const s=setup();s.rpc.mockResolvedValue({data:{...row,state:'CREATED'},error:null});
    expect(await s.store.prepare(draft)).toEqual({appointmentId,attemptId:compact,accessToken:owner.accessToken,depositArs:3000});
    const args=s.rpc.mock.calls[0]![1];
    expect(args.p_existing_appointment_id).toBe(appointmentId);
    expect(args).not.toHaveProperty('amount');expect(args).not.toHaveProperty('accessToken');
    expect(s.session.write).toHaveBeenCalledWith(owner);
  });
  it('creates a new appointment with a fresh token instead of returning UNKNOWN when a previous cookie belongs to a different or already confirmed reservation',async()=>{
    const s=setup();
    const newAppointmentId='987e6543-e21b-42d3-a456-426614174999';
    const newAttemptId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const secondDraft={barber:'Gonzalo',serviceName:'Corte y barba',date:'2026-10-29',time:'11:30',name:'Synthetic Client',email:'fixture@example.test',phone:'+5491100000000',notes:''};
    s.rpc
      .mockResolvedValueOnce({data:null,error:{message:'BARBER_OR_SERVICE_NOT_FOUND'}})
      .mockResolvedValueOnce({data:null,error:{message:'CHECKOUT_RESERVATION_CHANGED'}})
      .mockResolvedValueOnce({data:null,error:{message:'BARBER_OR_SERVICE_NOT_FOUND'}})
      .mockResolvedValueOnce({data:{...row,id:newAttemptId,appointment_id:newAppointmentId,amount_ars:5000,amount_minor_units:500000,state:'CREATED'},error:null});

    const prepared=await s.store.prepare(secondDraft);
    expect(prepared.appointmentId).toBe(newAppointmentId);
    expect(prepared.attemptId).toBe(newAttemptId.replaceAll('-',''));
    expect(prepared.depositArs).toBe(5000);
    expect(prepared.accessToken).not.toBe(owner.accessToken);
    expect(s.rpc).toHaveBeenLastCalledWith('prepare_payway_attempt',expect.objectContaining({
      p_barber_name:'Gonzalo',
      p_service_name:'Corte + barba',
      p_booking_date:'2026-10-29',
      p_start_time:'11:30',
      p_existing_appointment_id:null,
    }));
  });
  it('clears the checkout session cookie when an appointment is confirmed',async()=>{
    const s=setup();
    s.rpc.mockResolvedValue({data:[{result_code:'CONFIRMED',notification_claim_token:null}],error:null});
    expect(await s.store.confirm(appointmentId,compact,'42',500000)).toBe(true);
    expect(s.session.clear).toHaveBeenCalledTimes(1);
  });
  it('rejects ownership manipulation before touching the database',async()=>{
    const s=setup();
    await expect(s.store.claim({appointmentId,attemptId:compact,accessToken:'wrong'})).rejects.toThrow('NOT_OWNED');
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('does not claim no reservation exists after an uncertain DB/cookie acknowledgement',async()=>{
    const s=setup();s.rpc.mockRejectedValue(new Error('connection lost'));
    await expect(s.store.prepare(draft)).rejects.toThrow('PAYMENT_REVIEW_REQUIRED');
    s.rpc.mockResolvedValue({data:null,error:{message:'PAYMENT_REVIEW_REQUIRED'}});
    await expect(s.store.prepare(draft)).rejects.toThrow('PAYMENT_REVIEW_REQUIRED');
    s.rpc.mockResolvedValue({data:row,error:null});s.session.write.mockRejectedValue(new Error('cookie unavailable'));
    await expect(s.store.prepare(draft)).rejects.toThrow('PAYMENT_REVIEW_REQUIRED');
  });
  it('claims atomically and maps durable UNKNOWN/rejected results without retrying',async()=>{
    const s=setup();const input={appointmentId,attemptId:compact,accessToken:owner.accessToken};
    expect((await s.store.claim(input)).acquired).toBe(true);
    expect(s.rpc).toHaveBeenCalledWith('claim_payway_attempt',{p_attempt_id:id,p_appointment_id:appointmentId});
    s.rpc.mockResolvedValue({data:{acquired:false,attempt:{...row,state:'UNKNOWN'},appointment:{}},error:null});
    expect((await s.store.claim(input)).attempt.state).toBe('unknown');
    s.rpc.mockResolvedValue({data:{acquired:false,attempt:{...row,state:'REJECTED'},appointment:{}},error:null});
    expect((await s.store.claim(input)).attempt.result?.state).toBe('rejected');
  });
  it('persists only explicit provider evidence and propagates settlement failures',async()=>{
    const s=setup();await s.store.settle(compact,'approved','42','approved');
    expect(s.rpc).toHaveBeenCalledWith('settle_payway_attempt',{p_attempt_id:id,p_state:'APPROVED',p_provider_id:'42',p_provider_status:'approved',p_provider_code:null});
    s.rpc.mockResolvedValue({error:{message:'synthetic failure'},data:null});
    await expect(s.store.settle(compact,'unknown')).rejects.toThrow('SETTLEMENT_FAILED');
  });
  it('never represents a failed confirmation as paid',async()=>{
    const s=setup();s.rpc.mockResolvedValue({data:[{result_code:'SLOT_COLLISION_LATE_PAYMENT'}],error:null});
    expect(await s.store.confirm(appointmentId,compact,'42',300000)).toBe(false);
    expect(s.rpc).toHaveBeenCalledWith('confirm_payway_attempt',{p_appointment_id:appointmentId,p_attempt_id:id,p_provider_id:'42',p_amount_minor:300000});
  });
});

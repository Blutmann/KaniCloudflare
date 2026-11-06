import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({payments:vi.fn(),calendar:vi.fn(),emails:vi.fn()}));
vi.mock('nitro',()=>({definePlugin:(setup:unknown)=>setup}));
vi.mock('../lib/kani-payment-maintenance.server',()=>({reconcilePendingPayments:mocks.payments}));
vi.mock('../lib/kani-google-calendar-sync',()=>({processCalendarSyncQueue:mocks.calendar}));
vi.mock('../lib/kani-barber-email.server',()=>({dispatchBarberConfirmationEmails:mocks.emails}));
import plugin from '../../server/plugins/payment-maintenance';
beforeEach(()=>{
 mocks.payments.mockReset().mockResolvedValue(undefined);
 mocks.calendar.mockReset().mockResolvedValue({processed:0});
 mocks.emails.mockReset().mockResolvedValue({processed:1,accepted:1,failed:0});
});
async function scheduled(){
 const hooks=new Map<string,()=>Promise<void>>();
 (plugin as any)({hooks:{hook:(name:string,callback:()=>Promise<void>)=>hooks.set(name,callback)}});
 expect(hooks.has('cloudflare:scheduled')).toBe(true);
 await hooks.get('cloudflare:scheduled')!();
}
it('the deployed Nitro scheduled entry dispatches barber emails and preserves payment/Calendar work',async()=>{
 await scheduled();
 expect(mocks.payments).toHaveBeenCalledOnce();expect(mocks.calendar).toHaveBeenCalledOnce();
 expect(mocks.emails).toHaveBeenCalledWith({limit:10});
});
it('payment or Calendar failure does not stop the independent email recovery',async()=>{
 mocks.payments.mockRejectedValue(new Error('controlled payment maintenance failure'));
 mocks.calendar.mockRejectedValue(new Error('controlled Calendar maintenance failure'));
 await scheduled();expect(mocks.emails).toHaveBeenCalledOnce();
});
it('email failure cannot reject the scheduled invocation after the other integrations run',async()=>{
 mocks.emails.mockRejectedValue(new Error('controlled email failure'));
 await expect(scheduled()).resolves.toBeUndefined();
 expect(mocks.payments).toHaveBeenCalledOnce();expect(mocks.calendar).toHaveBeenCalledOnce();
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBarberConfirmedEmail, type BarberConfirmationPayload } from '../lib/kani-barber-confirmed-email';
import { handleTurnoIcsRequest } from '../lib/kani-calendar-ics';
import { dispatchBarberConfirmationEmails } from '../lib/kani-barber-email.server';
const mocks = vi.hoisted(()=>({ rpc:vi.fn() }));
vi.mock('../lib/kani-payment-db.server',()=>({ createPaymentSupabaseClient:async()=>({ rpc:mocks.rpc }) }));

export const barberEmailFixture: BarberConfirmationPayload = {
  appointmentId:'00000000-0000-4000-8000-000000000099', clientName:'Cliente de prueba',
  clientPhone:'1128436014', clientEmail:'cliente@example.invalid', barberName:'Profesional de prueba',
  serviceName:'Corte', bookingDate:'2026-11-12', startTime:'16:15:00', endTime:'17:00:00',
  serviceDurationMinutes:45, finalPriceArs:25000, depositPaidArs:5000, collectedArs:0,
  benefitCode:null, benefitType:null,
};
describe('Barber confirmation email',()=>{
  it('reuses official branding and sends only summary, contacts and safe actions',()=>{
    const email=buildBarberConfirmedEmail(barberEmailFixture,{calendarSyncEnabled:true});
    expect(email.subject).toBe('[KANI] Cliente de prueba agendó un turno con vos');
    for(const value of ['kani-email-logo.png','#000000','#B99A5B','#762936','DM Serif Display','Inter','Resumen del turno','Datos del cliente']) expect(email.html).toContain(value);
    expect(email.text.indexOf('RESUMEN DEL TURNO')).toBeLessThan(email.text.indexOf('DATOS DEL CLIENTE'));
    expect(email.text).toContain('Seña abonada: $5.000');
    expect(email.text).toContain('Saldo pendiente a pagar en el local: $20.000');
    expect(email.html+email.text).not.toMatch(/cancelar|cancelacion|cancellation|claimToken/i);
    expect(email.text).toContain('puede crear duplicados');
  });
  it.each([
    ['1128436014','5491128436014'], ['+54 9 11 2843-6014','5491128436014'],
    ['5491128436014','5491128436014'], ['+56 9 8765 4321','56987654321'],
    ['+34 612 34 56 78','34612345678'], ['+1 201 555 0123','12015550123'],
  ])('normalizes WhatsApp %s once', (phone,digits)=>{
    const email=buildBarberConfirmedEmail({...barberEmailFixture,clientPhone:phone});
    expect(email.html).toContain(`href="https://wa.me/${digits}"`);
    expect(email.text).toContain(`https://wa.me/${digits}`);
    expect(email.diagnostic).toBeNull();
  });
  it.each([null,'','abc1128436014','0000000000','+999123456789'])('omits invalid WhatsApp %s with diagnostic',phone=>{
    const email=buildBarberConfirmedEmail({...barberEmailFixture,clientPhone:phone});
    expect(email.html+email.text).not.toContain('wa.me/');
    expect(email.diagnostic).toBe('CLIENT_PHONE_INVALID_OR_MISSING');
  });
  it.each([
    ['NO_DEPOSIT',25000,0,0,25000],['FREE_SERVICE',0,0,0,0],
    ['PERCENT_10',22500,5000,0,17500],['PERCENT_50',12500,5000,2500,5000],
  ])('uses actual verified amounts for %s',(benefitType,finalPriceArs,depositPaidArs,collectedArs,balance)=>{
    const email=buildBarberConfirmedEmail({...barberEmailFixture,benefitType,benefitCode:'CONTROL',finalPriceArs,depositPaidArs,collectedArs});
    const amount=(n:number)=>'$'+n.toLocaleString('es-AR');
    expect(email.text).toContain('Precio final: '+amount(finalPriceArs));
    expect(email.text).toContain('Seña abonada: '+amount(depositPaidArs));
    expect(email.text).toContain('Saldo pendiente a pagar en el local: '+amount(balance));
    expect(email.text).toContain('Beneficio aplicado:');
  });
  it('omits absent email, escapes user content and clearly labels a controlled test',()=>{
    const email=buildBarberConfirmedEmail({...barberEmailFixture,clientName:'<script>alert(1)</script>',clientEmail:null},{isTest:true});
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).not.toContain('Email:');
    expect(email.subject).toMatch(/^\[PRUEBA\] \[KANI\]/);
    expect(email.text).toContain('No corresponde a una reserva real');
  });
  it('produces signed ICS with full date, real duration, Buenos Aires and stable appointment UID',async()=>{
    const email=buildBarberConfirmedEmail({...barberEmailFixture,serviceDurationMinutes:60,endTime:'17:15:00'});
    const url=email.text.match(/https:\/\/www.kanibarber.com\/api\/calendar\/turno.ics\?\S+/)![0];
    const response=handleTurnoIcsRequest(new Request(url));
    expect(response.status).toBe(200);
    const ics=await response.text();
    expect(ics).toContain('UID:kani-turno-'+barberEmailFixture.appointmentId+'@kanibarber.com');
    expect(ics).toContain('DTSTART;TZID=America/Argentina/Buenos_Aires:20261112T161500');
    expect(ics).toContain('DTEND;TZID=America/Argentina/Buenos_Aires:20261112T171500');
    expect(ics).toContain('LOCATION:');
    const tampered=new URL(url);tampered.searchParams.set('m','15');
    expect(handleTurnoIcsRequest(new Request(tampered)).status).toBe(403);
  });
});

describe('Independent durable sender',()=>{
  const job={job_id:'job-control',lease_id:'lease-control',recipient_email:'linked-barber@example.invalid',payload:barberEmailFixture,provider_request:null,is_test:false};
  beforeEach(()=>{
    vi.unstubAllGlobals();mocks.rpc.mockReset();
    process.env['RESEND_API_KEY']='unit-test-only';process.env['RESEND_FROM_EMAIL']='Kani <sender@example.invalid>';
    mocks.rpc.mockImplementation(async(name:string,args:any)=>{
      if(name==='claim_barber_confirmation_emails')return {data:[job],error:null};
      if(name==='prepare_barber_confirmation_email')return {data:args.p_request,error:null};
      return {data:true,error:null};
    });
  });
  it('targets the linked recipient; uses a separate key and provider acceptance state',async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({id:'provider-id'}));vi.stubGlobal('fetch',fetcher);
    expect(await dispatchBarberConfirmationEmails({appointmentId:barberEmailFixture.appointmentId,limit:1})).toEqual({processed:1,accepted:1,failed:0});
    const init=fetcher.mock.calls[0]![1];
    expect(JSON.parse(init.body).to).toEqual(['linked-barber@example.invalid']);
    expect(init.headers['Idempotency-Key']).toBe('barber-confirmed/job-control');
    expect(mocks.rpc).toHaveBeenCalledWith('finish_barber_confirmation_email',expect.objectContaining({p_status:'PROVIDER_ACCEPTED',p_message_id:'provider-id'}));
    expect(mocks.rpc.mock.calls.map(c=>c[0])).not.toContain('complete_appointment_notification');
  });
  it('uses the frozen provider body on retry even after content or settings change',async()=>{
    const frozen={from:'original@example.invalid',to:['linked-barber@example.invalid'],subject:'Frozen',html:'saved',text:'saved'};
    mocks.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='claim_barber_confirmation_emails' ? [{...job,provider_request:frozen}] : name==='prepare_barber_confirmation_email' ? args.p_request : true,error:null}));
    const fetcher=vi.fn().mockResolvedValue(Response.json({id:'same-id'}));vi.stubGlobal('fetch',fetcher);
    await dispatchBarberConfirmationEmails();
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(frozen);
  });
  it('reads the real Nitro cold-start bindings without relying on a previous HTTP request',async()=>{
    delete process.env['RESEND_API_KEY'];delete process.env['RESEND_FROM_EMAIL'];
    vi.stubGlobal('__env__',{RESEND_API_KEY:'nitro-binding-test',RESEND_FROM_EMAIL:'Kani <nitro@example.invalid>'});
    const fetcher=vi.fn().mockResolvedValue(Response.json({id:'cold-start-provider'}));vi.stubGlobal('fetch',fetcher);
    expect((await dispatchBarberConfirmationEmails()).accepted).toBe(1);
    expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer nitro-binding-test');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).from).toBe('Kani <nitro@example.invalid>');
  });
  it.each([429,500,403])('records provider HTTP %s independently without failing the booking',async(status)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:'never logged'},{status})));
    expect((await dispatchBarberConfirmationEmails()).failed).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith('finish_barber_confirmation_email',expect.objectContaining({p_status:'FAILED',p_error:`RESEND_HTTP_${status}`}));
  });
  it('retains durable recovery on network or persistence failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('network timeout')));
    await expect(dispatchBarberConfirmationEmails()).resolves.toEqual({processed:1,accepted:0,failed:1});
    mocks.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});
    await expect(dispatchBarberConfirmationEmails()).resolves.toEqual({processed:0,accepted:0,failed:1});
  });
  it('does not send if another worker owns the claim or request persistence failed',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    mocks.rpc.mockResolvedValue({data:[],error:null});await dispatchBarberConfirmationEmails();
    expect(fetcher).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation(async(name:string)=>({data:name==='claim_barber_confirmation_emails'?[job]:null,error:name==='prepare_barber_confirmation_email'?{message:'write failed'}:null}));
    await dispatchBarberConfirmationEmails();expect(fetcher).not.toHaveBeenCalled();
  });
});

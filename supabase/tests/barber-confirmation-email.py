"""Real roles, confirmation triggers, leases and provider receipts in isolated PostgreSQL."""
from pathlib import Path
import json,uuid,subprocess,concurrent.futures
exec(compile((Path(__file__).parent/'notification-inbox.py').read_text(encoding='utf-8'),'notification-inbox.py','exec'))
sql("alter table auth.users add column email text,add column deleted_at timestamptz,add column banned_until timestamptz; grant usage on schema auth,kani_private to service_role;")
sql("update auth.users set email='barber-'||right(id::text,1)||'@example.invalid'")
assert sql("select has_table_privilege('service_role','auth.users','select')")=='f', 'Match production: no broad auth.users grant'
migrations=list((repo/'supabase/migrations').glob('*_kani_barber_confirmation_email.sql'))
assert len(migrations)==1
sql('begin;'+migrations[0].read_text(encoding='utf-8')+'commit;')
table='kani_private.barber_confirmation_email_jobs'
assert sql(f'select count(*) from {table}')=='0','No historical backfill or mass email'
def service(q):return sql('set role service_role;'+q+';reset role;')
def claim(apt=None):
    raw=service('select public.claim_barber_confirmation_emails(25,'+("'%s'"%apt if apt else 'null')+')')
    return [json.loads(line) for line in raw.splitlines() if line.startswith('{')]
def job(apt):return json.loads(sql(f"select row_to_json(q) from {table} q where appointment_id='{apt}'"))
def ready(apt):sql(f"update {table} set available_at=now()-interval '1 second',lease_until=null where appointment_id='{apt}'")
def finish(j,status='PROVIDER_ACCEPTED',message='provider-control'):
    return service(f"select finish_barber_confirmation_email('{j['job_id']}','{j['lease_id']}','{status}','{message}')")
def prepare(j,body='{"subject":"Original","to":["barber-1@example.invalid"]}'):
    return service(f"select prepare_barber_confirmation_email('{j['job_id']}','{j['lease_id']}','{body}'::jsonb)")
pending=insert('PENDING')
assert sql(f"select count(*) from {table} where appointment_id='{pending}'")=='0'
sql(f"update appointments set notes='Intento fallido' where id='{pending}'")
assert not claim(pending)
sql(f"update appointments set status='CONFIRMED' where id='{pending}';update appointments set status='CONFIRMED' where id='{pending}'")
assert job(pending)['attempts']==0
web=claim(pending)[0]
assert web['recipient_email']=='barber-1@example.invalid'
assert web['payload']['depositPaidArs']==0 and web['payload']['finalPriceArs']==25000
assert not claim(pending),'Unexpired lease prevents concurrent duplicate sends'
prepare(web);finish(web)
assert job(pending)['status']=='PROVIDER_ACCEPTED' and not claim(pending)
print('No historical backfill; web pending/failure excluded; confirmation once; independent accepted state: PASS')

for user in [1,3,4]:
    day={1:'10',3:'11',4:'12'}[user]
    apt=last(asuser(user,f"select appointment_id from create_manual_appointment(p_barber_id=>'{two}',p_service_id=>'20000000-0000-0000-0000-000000000001',p_booking_date=>'2098-03-{day}',p_start_time=>'13:00',p_client_name=>'Control Manual',p_client_phone=>'1128436014',p_deposit_required=>false)")) if user!=1 else None
    # BARBER may only create its own appointment; operators can assign another professional.
    if user==1:
        apt=last(asuser(user,f"select appointment_id from create_manual_appointment(p_barber_id=>'{one}',p_service_id=>'20000000-0000-0000-0000-000000000001',p_booking_date=>'2098-03-{day}',p_start_time=>'13:00',p_client_name=>'Control Manual',p_client_phone=>'1128436014',p_deposit_required=>false)"))
    item=claim(apt)[0];assert item['recipient_email']==('barber-1@example.invalid' if user==1 else 'barber-2@example.invalid')
    assert item['payload']['depositPaidArs']==0
    finish(item,message='manual-'+str(user))
print('Manual creation by BARBER/MANAGER/ADMIN resolves assigned professional, never creator: PASS')

for benefit,price in [('NO_DEPOSIT',25000),('FREE_SERVICE',0),('PERCENT_10',22500),('PERCENT_50',12500)]:
    apt=insert('CONFIRMED',benefit_code='CONTROL',benefit_type=benefit,benefit_final_price_ars=price,deposit_required=False)
    item=claim(apt)[0];assert item['payload']['finalPriceArs']==price and item['payload']['depositPaidArs']==0
    finish(item,message=benefit)
paid=insert('PENDING',deposit_paid=True,deposit_amount_ars=7500,service_price_ars=30000)
sql(f"insert into payment_attempts(appointment_id,provider,site_transaction_id,provider_transaction_id,amount_ars,amount_minor_units,state,confirmation_status) values('{paid}','PAYWAY','EmailControl','EmailApproved',7500,750000,'APPROVED','CONFIRMED');update appointments set status='CONFIRMED' where id='{paid}'")
item=claim(paid)[0];assert item['payload']['depositPaidArs']==7500 and item['payload']['finalPriceArs']==30000
finish(item,message='paid-control')
legacy_paid=insert('CONFIRMED',deposit_paid=True,deposit_amount_ars=5000)
sql(f"insert into appointment_payment_orders(appointment_id,paid_amount_ars,reconciliation_status) values('{legacy_paid}',5000,'CONFIRMED')")
item=claim(legacy_paid)[0];assert item['payload']['depositPaidArs']==5000
finish(item,message='legacy-paid')
print('Normal, approved web payment, verified legacy deposit, no-deposit, free and discounted amounts: PASS')

retry=insert('CONFIRMED');first=claim(retry)[0];prepare(first)
finish(first,'FAILED','');ready(retry)
second=claim(retry)[0];assert second['job_id']==first['job_id'] and second['lease_id']!=first['lease_id']
assert second['provider_request']['subject']=='Original'
prepare(second,'{"subject":"Changed"}')
assert job(retry)['provider_request']['subject']=='Original'
assert 'f' in finish(first).splitlines(), 'Stale lease must not finish another attempt'
finish(second,message='retry-provider');assert not claim(retry)
service("select record_barber_email_delivery('retry-provider','DELIVERED')")
assert job(retry)['status']=='DELIVERED'
service("select record_barber_email_delivery('retry-provider','BOUNCED')")
assert job(retry)['status']=='DELIVERED'
service("select record_barber_email_delivery('retry-provider','COMPLAINED');select record_barber_email_delivery('retry-provider','DELIVERED')")
assert job(retry)['status']=='NEEDS_REVIEW'
race=insert('CONFIRMED');item=claim(race)[0];prepare(item)
service("select record_barber_email_delivery('early-provider','DELIVERED')");finish(item,message='early-provider')
assert job(race)['status']=='DELIVERED'
print('Frozen retries, lease exclusion, stale receipt denial, callback race and status ordering: PASS')

lost=insert('CONFIRMED');item=claim(lost)[0];prepare(item)
sql(f"update {table} set lease_until=now()-interval '1 second' where appointment_id='{lost}'")
reclaimed=claim(lost)[0];assert reclaimed['job_id']==item['job_id']
sql(f"update {table} set first_attempt_at=now()-interval '25 hours',lease_until=null where appointment_id='{lost}'")
assert not claim(lost) and job(lost)['status']=='NEEDS_REVIEW'
missing=insert('CONFIRMED',barber=two)
sql("update staff_profiles set active=false where user_id='00000000-0000-0000-0000-000000000002'")
assert not claim(missing) and job(missing)['error_code']=='BARBER_ACCOUNT_EMAIL_MISSING'
assert sql(f"select status from appointments where id='{missing}'")=='CONFIRMED'
sql("update staff_profiles set active=true where user_id='00000000-0000-0000-0000-000000000002'");ready(missing)
item=claim(missing)[0];prepare(item)
sql("update auth.users set email='changed@example.invalid' where id='00000000-0000-0000-0000-000000000002'");ready(missing)
assert not claim(missing) and job(missing)['error_code']=='RECIPIENT_CHANGED'
cancelled=insert('CONFIRMED');sql(f"update appointments set status='CANCELLED' where id='{cancelled}'")
assert not claim(cancelled) and job(cancelled)['status']=='SKIPPED'
edited=insert('CONFIRMED');sql(f"update appointments set barber_id='{two}' where id='{edited}'")
assert not claim(edited) and job(edited)['status']=='SKIPPED'
exhausted=insert('CONFIRMED');sql(f"update {table} set attempts=6,status='PROCESSING',lease_until=now()-interval '1 minute' where appointment_id='{exhausted}'")
assert not claim(exhausted) and job(exhausted)['status']=='NEEDS_REVIEW'
print('Crash recovery, bounded retries, expired idempotency, invalid/changed link, cancellation and reassignment: PASS')

concurrent_apt=insert('CONFIRMED')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    claims=list(pool.map(lambda _:claim(concurrent_apt),[1,2]))
assert sorted(map(len,claims))==[0,1], 'Only one real database connection can own the event'
print('Concurrent independent workers claim one event exactly once: PASS')

for user in [1,2,3,4]:
    check_denied(user,'select claim_barber_confirmation_emails()')
    check_denied(user,f'select * from {table}')
    check_denied(user,"select record_barber_email_delivery('forged','DELIVERED')")
    check_denied(user,f"select * from kani_private.barber_confirmation_recipient('{one}')")
for q in ['select claim_barber_confirmation_emails()',f'select * from {table}']:
    try:sql('set role anon;'+q);raise AssertionError('Anonymous access')
    except RuntimeError:pass
assert sql("select has_function_privilege('public','public.claim_barber_confirmation_emails(integer,uuid)','execute')")=='f'
print('BARBER/MANAGER/ADMIN/anon cannot read recipients, forge delivery or dispatch; only trusted service: PASS')

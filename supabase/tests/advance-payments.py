"""Real receipts with two barbers, manager and ADMIN in a disposable offline database."""
from pathlib import Path
import uuid, json
from concurrent.futures import ThreadPoolExecutor

exec(compile((Path(__file__).parent/'staff-permissions.py').read_text(encoding='utf-8'), 'staff-permissions.py', 'exec'))
sql((Path(__file__).parent/'notification-legacy-fixture.sql').read_text(encoding='utf-8'))
sql('begin;'+next((repo/'supabase/migrations').glob('*_kani_account_notification_inbox.sql')).read_text(encoding='utf-8')+'commit;')
before = sql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from appointments a")
sql('begin;'+next((repo/'supabase/migrations').glob('*_kani_advance_collection_preserves_appointment.sql')).read_text(encoding='utf-8')+'commit;')
assert sql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from appointments a") == before

one='10000000-0000-0000-0000-000000000001'
two='10000000-0000-0000-0000-000000000002'
client=last(asuser(1,"select (save_client(null,'Cliente anticipado','1128436014','test@example.invalid')).id"))

def appointment(barber=one, day=10, status='CONFIRMED', deposit=5000, final=25000):
    ident=str(uuid.uuid4())
    sql(f"""insert into appointments(id,client_id,barber_id,service_id,booking_date,start_time,end_time,status,
     service_price_ars,deposit_paid,deposit_amount_ars,benefit_final_price_ars,benefit_discount_amount_ars)
     values('{ident}','{client}','{barber}','20000000-0000-0000-0000-000000000001',
     (now() at time zone 'America/Argentina/Buenos_Aires')::date+{day},'10:00','10:45','{status}',25000,{str(deposit>0).lower()},{deposit},{final},{25000-final})""")
    return ident

def args(ident,barber=one,discount=0):
    return f"p_appointment_id=>'{ident}',p_barber_id=>'{barber}',p_service_name=>'Corte',p_service_price_ars=>25000,p_discount_value=>{discount}"

today=sql("select (now() at time zone 'America/Argentina/Buenos_Aires')::date")
for user,barber in [(1,one),(2,two),(3,one),(4,two)]:
    ident=appointment(barber)
    saved=json.loads(last(asuser(user,"select staff_save_service_payment("+args(ident,barber)+",p_payment_date=>'2099-01-01',p_payment_time=>'23:59')")))
    assert saved['payment_date']==today and saved['collected_amount_ars']==20000
    assert saved['created_by_user_id'].endswith('%012d'%user)
    assert sql(f"select status::text||'|'||balance_paid::text from appointments where id='{ident}'")=='CONFIRMED|true'
    note=sql(f"select id from admin_activity_notifications where appointment_id='{ident}' and event_key is not null")
    detail=json.loads(last(asuser(user,f"select staff_notification_detail('{note}')")))
    assert detail['collected']==20000 and detail['balance']==0 and detail['status']=='CONFIRMED'
    assert sql(f"select count(*) from admin_activity_notifications where appointment_id='{ident}' and event_key is not null")=='1'
    check_denied(user,"select staff_save_service_payment("+args(ident,barber)+")")
    assert int(sql(f"select count(*) from staff_operation_audit where table_name='service_payments' and record_id='{saved['id']}'"))>=1

for day in [-3,0,7]:
    ident=appointment(day=day)
    payment(1,p_appointment_id=ident,p_barber_id=one,p_service_name='Corte',p_service_price_ars=25000)
    assert sql(f"select status from appointments where id='{ident}'")=='CONFIRMED'

foreign=appointment(two)
check_denied(1,"select staff_save_service_payment("+args(foreign,two)+")",'BARBER_NOT_ALLOWED')
for status in ['PENDING','CANCELLED']:
    bad=appointment(status=status)
    check_denied(4,"select staff_save_service_payment("+args(bad)+")",'APPOINTMENT_NOT_COLLECTIBLE')
for deposit,final,discount in [(0,0,25000),(25000,25000,0)]:
    zero=appointment(deposit=deposit,final=final)
    check_denied(1,"select staff_save_service_payment("+args(zero,discount=discount)+")",'NO_PENDING_BALANCE')
    assert sql(f"select count(*) from service_payments where appointment_id='{zero}'")=='0'
over=appointment(final=22500)
check_denied(1,"select staff_save_service_payment("+args(over)+")",'PAYMENT_EXCEEDS_BALANCE')
payment(1,p_appointment_id=over,p_barber_id=one,p_service_name='Corte',p_service_price_ars=25000,p_discount_value=2500)
assert sql(f"select collected_amount_ars from service_payments where appointment_id='{over}'")=='17500'

concurrent=appointment()
def race(_):
    try: asuser(1,"select staff_save_service_payment("+args(concurrent)+")"); return True
    except RuntimeError: return False
with ThreadPoolExecutor(max_workers=2) as pool: assert sorted(pool.map(race,[1,2]))==[False,True]
assert sql(f"select count(*) from service_payments where appointment_id='{concurrent}'")=='1'
sig='(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text)'
for name in ['public.staff_save_service_payment','kani_private.save_service_payment']:
    assert sql(f"select has_function_privilege('anon','{name+sig}','execute')")=='f'
    assert sql(f"select has_function_privilege('authenticated','{name+sig}','execute')")=='t'
assert sql("select prosecdef::text from pg_proc where oid='public.staff_save_service_payment"+sig+"'::regprocedure")=='false'
check_denied(7,"select staff_save_service_payment("+args(appointment())+")",'STAFF_REQUIRED')
print('Advance/day/past collection; true receipt date; attendance preserved; zero/overpayment/foreign denial; concurrent duplicate and audit: PASS')

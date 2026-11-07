"""Production-derived routines and synthetic rows only, in a disposable offline DB."""
from pathlib import Path
import hashlib

exec(compile((Path(__file__).parent/'staff-permissions.py').read_text(encoding='utf-8'), 'staff-permissions.py', 'exec'))
sql("""update barbers set name=case name when 'Uno' then 'Lautaro' when 'Dos' then 'Gonzalo' when 'Tres' then 'Valentín' when 'Cuatro' then 'Franco' end;
update staff_profiles set display_name=b.name from barbers b where b.id=barber_id;""")
sql((Path(__file__).parent/'public-booking-visibility-fixture.sql').read_text(encoding='utf-8'))
# Production has table-wide anonymous SELECT on barbers (still restricted by RLS).
sql('grant select on public.barbers to anon;')
# Replace the general fixture's intentionally disabled policy with the verified
# original production policy before testing the new ADMIN invoker function.
sql('alter policy admin_can_manage_barbers on public.barbers using(public.is_admin()) with check(public.is_admin());')
franco='10000000-0000-0000-0000-000000000004'
future="current_date+((13-extract(dow from current_date)::int)%7)+7" # A future Saturday within the booking horizon.
request_args="'Franco','Corte de cabello',%s,'16:00','Cliente sintético','5555000000','fixture@example.invalid',null"%future
old_appointment=last(sql('set role anon;select appointment_id from request_appointment('+request_args+')'))
old_attempt=last(sql("set role service_role; select (prepare_payway_attempt(gen_random_uuid(),'123','Franco','Corte de cabello',%s,'16:00','Cliente sintético','5555000000','fixture@example.invalid',null,'%s')->>'id')"%(future,old_appointment)))
sql("insert into barber_availability_slots(barber_id,slot_date,start_time,end_time,status) select id,current_date+20,'10:00','12:00','AVAILABLE' from barbers where id='%s' on conflict do nothing"%franco)
before_rpc=sql("set role anon;select row_to_json(r)::text from read_valid_availability_starts(null,current_date,current_date+21) r where barber_id<>'%s' order by barber_id,slot_date,start_time"%franco)
before_view=sql("set role anon;select row_to_json(v)::text from available_barber_slots v where barber_id<>'%s' order by barber_id,slot_date,start_time"%franco)
assert last(sql("set role anon;select count(*)>0 from read_valid_availability_starts('%s',current_date,current_date+21)"%franco))=='t'

tables=['staff_profiles','barbers','appointments','barber_availability_slots','clients','client_barbers','service_payments','payment_attempts','appointment_payment_orders','benefit_codes']
def snapshot():
 return {t:sql("select coalesce(jsonb_agg(j order by j::text),'[]')::text from (select to_jsonb(r) %s j from public.%s r) x"% ("- 'public_booking_enabled'" if t=='barbers' else '',t)) for t in tables}
before=snapshot()
sql('begin;'+next((repo/'supabase/migrations').glob('*_kani_public_booking_visibility.sql')).read_text(encoding='utf-8')+'commit;')
assert snapshot()==before,'Migration altered existing business data, roles or associations'
print('Migration preserves all appointments, payment ledgers, clients, schedules and six staff profiles: PASS')

assert last(sql("set role anon;select string_agg(name,',' order by name) from barbers"))=='Gonzalo,Lautaro,Valentín'
for role in ['anon','authenticated','service_role']:
 assert last(sql("set role %s;select count(*) from read_public_booking_barbers()"%role))=='3'
 assert last(sql("set role %s;select count(*) from read_public_booking_barbers() where id='%s'"%(role,franco)))=='0'
assert last(asuser(6,'select count(*) from read_public_booking_barbers()'))=='3'
assert last(sql("set role anon;select count(*) from barber_availability_slots where barber_id='%s'"%franco))=='0'
assert last(sql("set role anon;select count(*) from available_barber_slots where barber_id='%s'"%franco))=='0'
assert last(sql("set role anon;select count(*) from read_valid_availability_starts('%s',current_date,current_date+21)"%franco))=='0'
assert last(sql("set role anon;select count(*) from read_valid_availability_starts(null,current_date+20,current_date+20) where barber_id='%s'"%franco))=='0'
assert last(sql("set role anon;select count(*) from read_valid_availability_starts(null,current_date+20,current_date+20)"))=='0'
assert sql("set role anon;select row_to_json(r)::text from read_valid_availability_starts(null,current_date,current_date+21) r where barber_id<>'%s' order by barber_id,slot_date,start_time"%franco)==before_rpc
assert sql("set role anon;select row_to_json(v)::text from available_barber_slots v where barber_id<>'%s' order by barber_id,slot_date,start_time"%franco)==before_view
assert sql("select has_column_privilege('anon','barber_availability_slots','internal_note','select')::text")=='false'
print('All public listing, direct table, view and RPC paths hide Franco; other availability results unchanged: PASS')

def denied_sql(query,expected):
 try:sql(query)
 except RuntimeError as e:assert expected in str(e),str(e)
 else:raise AssertionError('Unexpectedly permitted: '+query)

bad_args=request_args.replace("'16:00'","'17:00'")
for role in ['anon','service_role']:
 denied_sql('set role '+role+';select * from request_appointment('+bad_args+')','BARBER_NOT_PUBLICLY_BOOKABLE')
check_denied(3,'select * from request_appointment('+bad_args+')','BARBER_NOT_PUBLICLY_BOOKABLE')
denied_sql("set role service_role; select prepare_payway_attempt(gen_random_uuid(),'123',"+bad_args+',null)','BARBER_NOT_PUBLICLY_BOOKABLE')
sql("insert into benefit_codes(code,type) values('SYNTHETIC-NO-DEPOSIT','NO_DEPOSIT')")
denied_sql("set role service_role;select confirm_zero_deposit_appointment("+bad_args.rsplit(',null',1)[0]+",'SYNTHETIC-NO-DEPOSIT',null)",'BARBER_NOT_PUBLICLY_BOOKABLE')
assert sql("select status from benefit_codes where code='SYNTHETIC-NO-DEPOSIT'")=='ACTIVE'
assert sql("select count(*) from payment_attempts")=='1'
# Direct UUID inserts cannot bypass the public guard, nor can anon forge a manual origin.
client_id=sql("select client_id from appointments where id='%s'"%old_appointment)
denied_sql("insert into appointments(client_id,barber_id,booking_date,start_time,end_time) values('%s','%s',current_date+19,'10:00','10:45')"%(client_id,franco),'BARBER_NOT_PUBLICLY_BOOKABLE')
denied_sql("set role anon;insert into appointments(client_id,barber_id,booking_date,start_time,end_time,origin,is_manual) values('%s','%s',current_date+19,'10:00','10:45','MANUAL',true)"%(client_id,franco),'permission denied')
print('Tampered name/UUID, public PayWay preparation and zero-deposit creation denied atomically: PASS')

for user in [6,3,4]:
 assert last(asuser(user,"select count(*) from barbers where id='%s' and active"%franco))=='1'
 assert last(asuser(user,"select count(*)>0 from barber_availability_slots where barber_id='%s'"%franco))=='t'
 assert last(asuser(user,"select count(*)>0 from read_valid_availability_starts('%s',current_date,current_date+21)"%franco))=='t'
 assert last(asuser(user,"select count(*)>0 from service_payments where barber_id='%s'"%franco))=='t'
 manual=last(asuser(user,"select appointment_id from create_manual_appointment(p_barber_id=>'%s',p_service_id=>'20000000-0000-0000-0000-000000000001',p_booking_date=>current_date+18,p_start_time=>'%s:00',p_client_name=>'Cliente interno',p_client_phone=>'77770000')"%(franco,{6:10,3:11,4:12}[user])))
 assert sql("select (is_manual and origin='MANUAL')::text from appointments where id='%s'"%manual)=='true'
 assert payment(user,p_barber_id=franco,p_service_name='Barba')['barber_id']==franco
check_denied(1,"select * from create_manual_appointment(p_barber_id=>'%s',p_booking_date=>current_date+18,p_start_time=>'13:00',p_client_name=>'Ajeno',p_client_phone=>'66660000')"%franco,'MANUAL_APPOINTMENT_NOT_ALLOWED')
assert last(asuser(1,"select count(*) from barber_availability_slots where barber_id='%s'"%franco))=='0'
print('Franco BARBER, MANAGER and ADMIN retain internal scheduling, manual appointments and payments; cross-barber scope denied: PASS')

# Existing checkout/payment confirmation is deliberately NOT gated by the new commercial flag.
sql("update payment_attempts set state='APPROVED',provider_transaction_id='synthetic_approved' where id='%s'"%old_attempt)
assert last(sql("set role service_role;select result_code from confirm_payway_attempt('%s','%s','synthetic_approved',500000)"%(old_appointment,old_attempt)))=='CONFIRMED'
assert sql("select status from appointments where id='%s'"%old_appointment)=='CONFIRMED'
print('Existing synthetic PayWay payment can still confirm its original Franco booking; no provider request made: PASS')

for user in [1,3,6,7]:
 check_denied(user,"select admin_set_barber_public_booking('%s',true)"%franco,'ADMIN_REQUIRED')
denied_sql("set role anon;select admin_set_barber_public_booking('%s',true)"%franco,'permission denied')
assert last(asuser(3,"update barbers set public_booking_enabled=true where id='%s'"%franco))=='UPDATE 0'
assert last(asuser(4,"select admin_set_barber_public_booking('%s',true)"%franco))=='t'
assert last(sql('set role anon;select count(*) from read_public_booking_barbers()'))=='4'
assert last(sql("set role anon;select count(*)>0 from read_valid_availability_starts('%s',current_date,current_date+21)"%franco))=='t'
assert last(asuser(4,"select admin_set_barber_public_booking('%s',false)"%franco))=='f'
print('Only ADMIN can reverse the commercial exclusion; public availability returns when enabled: PASS')

for name in ['Lautaro','Gonzalo','Valentín']:
 positive=bad_args.replace("'Franco'","'%s'"%name)
 # Future Saturday 17:00 is covered by the existing commercial availability.
 assert last(sql('set role anon;select appointment_status from request_appointment('+positive+')'))=='PENDING'
assert sql("select count(*) from staff_profiles")=='7' # Six active + inactive test manager, unchanged.
print('All three offered professionals still accept new public reservations: PASS')

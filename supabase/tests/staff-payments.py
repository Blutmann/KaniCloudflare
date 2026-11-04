# Runs after staff-permissions.py, using only its isolated synthetic database.
import json

def last(result):
    return result.splitlines()[-1]

def check_denied(user, query, message=None):
    try:
        asuser(user, query)
    except RuntimeError as error:
        if message:
            assert message in str(error), str(error)
    else:
        raise AssertionError('Unauthorized operation succeeded: ' + query)

def payment(user, **params):
    def literal(value):
        if value is None: return 'null'
        if isinstance(value, (int, float)): return str(value)
        return "'" + str(value).replace("'", "''") + "'"
    args = ','.join(key + '=>' + literal(value) for key, value in params.items())
    return json.loads(last(asuser(user, 'select public.staff_save_service_payment(' + args + ')')))

sql("""create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
insert into public.services(id,name,duration_minutes,price_ars) values
 ('20000000-0000-0000-0000-000000000001','Corte de cabello',45,25000),
 ('20000000-0000-0000-0000-000000000002','Corte + barba',60,30000),
 ('20000000-0000-0000-0000-000000000003','Barba',30,10000);
insert into auth.users values ('00000000-0000-0000-0000-000000000005'),('00000000-0000-0000-0000-000000000006'),('00000000-0000-0000-0000-000000000007');
insert into barbers(id,name) values ('10000000-0000-0000-0000-000000000003','Tres'),('10000000-0000-0000-0000-000000000004','Cuatro');
insert into staff_profiles(user_id,role,barber_id,display_name,active) values
 ('00000000-0000-0000-0000-000000000005','BARBER','10000000-0000-0000-0000-000000000003','Tres',true),
 ('00000000-0000-0000-0000-000000000006','BARBER','10000000-0000-0000-0000-000000000004','Cuatro',true),
 ('00000000-0000-0000-0000-000000000007','MANAGER',null,'Inactivo',false);
""")
owners = [(1,1),(2,2),(5,3),(6,4)]
ids=[]
for user, barber in owners:
    own = '10000000-0000-0000-0000-%012d' % barber
    saved=payment(user,p_barber_id=own,p_service_name='Corte',p_discount_value=5000)
    assert saved['final_amount_ars']==20000 and saved['collected_amount_ars']==20000
    assert saved['created_by_user_id'].endswith('%012d' % user)
    ids.append(saved['id'])
    assert last(asuser(user,'select count(*) from service_payments'))=='1'
    other='10000000-0000-0000-0000-%012d' % (2 if barber==1 else 1)
    check_denied(user, "select staff_save_service_payment(p_barber_id=>'%s',p_service_name=>'Corte')"%other,'BARBER_NOT_ALLOWED')

for user,barber in owners:
    other_id=ids[1] if user==1 else ids[0]
    check_denied(user,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Barba')"%other_id,'PAYMENT_NOT_ALLOWED')
    check_denied(user,"select soft_delete_service_payment('%s')"%ids[0],'OPERATOR_REQUIRED')
    check_denied(user,"update service_payments set deleted_at=now() where id='%s'"%ids[0],'permission denied')
    check_denied(user,"update service_payments set online_deposit_amount_ars=0 where id='%s'"%ids[0],'permission denied')
    check_denied(user,'delete from service_payments','permission denied')

fixed=payment(1,p_payment_id=ids[0],p_service_name='Corte y barba',p_discount_value=5000)
assert fixed['service_price_ars']==30000 and fixed['final_amount_ars']==25000
percent=payment(1,p_payment_id=ids[0],p_service_name='Corte',p_discount_kind='PERCENT',p_discount_value=10)
assert percent['final_amount_ars']==22500
percent=payment(1,p_payment_id=ids[0],p_service_name='Corte y barba',p_discount_kind='PERCENT',p_discount_value=10)
assert percent['final_amount_ars']==27000 and percent['discount_value']==10
manual=payment(1,p_payment_id=ids[0],p_service_name='Corte y barba',p_discount_kind='PERCENT',p_discount_value=10,p_final_amount_ars=24500)
assert manual['final_amount_ars']==24500 and manual['discount_ars']==3000
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Corte',p_final_amount_ars=>-1)"%ids[0],'TOTAL_BELOW_DEPOSIT')
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Corte',p_discount_kind=>'PERCENT',p_discount_value=>101)"%ids[0],'INVALID_PAYMENT_AMOUNTS')

custom=payment(2,p_payment_id=ids[1],p_service_name='Otro',p_service_other_detail='Servicio personalizado',p_service_price_ars=17000)
assert custom['service_name']=='Otros' and custom['service_other_detail']=='Servicio personalizado'
check_denied(2,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Otro',p_service_price_ars=>17000)"%ids[1],'OTHER_SERVICE_DETAIL_REQUIRED')
voided=payment(2,p_payment_id=ids[1],p_service_name='Anulado')
assert voided['final_amount_ars']==0 and voided['collected_amount_ars']==0 and voided['voided_by_user_id'].endswith('000000000002')
assert last(asuser(2,'select count(*) from service_payments'))=='1'
assert last(asuser(3,'select count(*) from service_payments'))=='4'
payment(3,p_payment_id=ids[2],p_service_name='Barba')
asuser(3,"select soft_delete_service_payment('%s')"%ids[2])
assert sql("select (deleted_at is not null)::text from service_payments where id='%s'"%ids[2])=='true'
check_denied(7,"select staff_save_service_payment(p_barber_id=>'10000000-0000-0000-0000-000000000001',p_service_name=>'Corte')",'STAFF_REQUIRED')
assert last(asuser(3,"update staff_profiles set role='ADMIN' where user_id=auth.uid()"))=='UPDATE 0'
assert last(asuser(3,'select is_admin()'))=='f'
check_denied(1,'select staff_list_benefit_codes()','OPERATOR_REQUIRED')
assert last(asuser(3,'select staff_list_benefit_codes()'))=='[]'
assert last(asuser(4,'select staff_list_benefit_codes()'))=='[]'
assert sql('select count(*) from staff_operation_audit where table_name=\'service_payments\'')!='0'
check_denied(3,'delete from staff_operation_audit','permission denied')

# Real RPC: outside opening hours, full interval collision, ID tampering and cancellation.
def manual_args(barber, start='22:00'):
    return "p_barber_id=>'10000000-0000-0000-0000-%012d',p_service_id=>'20000000-0000-0000-0000-000000000001',p_booking_date=>current_date+10,p_start_time=>'%s',p_client_name=>'Cliente nocturno',p_client_phone=>'33333333'"%(barber,start)
apt=last(asuser(1,'select appointment_id from create_manual_appointment('+manual_args(1)+')'))
check_denied(2,'select * from create_manual_appointment('+manual_args(1)+')','MANUAL_APPOINTMENT_NOT_ALLOWED')
check_denied(1,'select * from create_manual_appointment('+manual_args(1,'22:15')+')','APPOINTMENT_COLLISION')
check_denied(2,"select * from update_appointment_status('%s','CANCELLED')"%apt,'APPOINTMENT_NOT_ALLOWED')
sql("update appointments set booking_date=current_date-1 where id='%s'"%apt)
asuser(1,"select * from update_appointment_status('%s','CANCELLED')"%apt)
assert sql("select cancelled_by::text from appointments where id='%s'"%apt).endswith('000000000001')
assert sql("select (cancelled_at is not null)::text from appointments where id='%s'"%apt)=='true'

# Deposit state is authoritative and cannot be edited, forged, unlinked or voided.
apt=last(asuser(1,'select appointment_id from create_manual_appointment('+manual_args(1,'21:00')+')'))
sql("update appointments set deposit_paid=true,deposit_amount_ars=5000 where id='%s'"%apt)
deposit=payment(1,p_barber_id='10000000-0000-0000-0000-000000000001',p_service_name='Corte',p_appointment_id=apt,p_discount_value=5000)
assert deposit['final_amount_ars']==20000 and deposit['collected_amount_ars']==15000
assert deposit['online_deposit_amount_ars']==5000
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Anulado')"%deposit['id'],'DEPOSIT_PAYMENT_CANNOT_BE_VOIDED')
check_denied(3,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Anulado')"%deposit['id'],'DEPOSIT_PAYMENT_CANNOT_BE_VOIDED')
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Corte',p_final_amount_ars=>4999)"%deposit['id'],'TOTAL_BELOW_DEPOSIT')
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_appointment_id=>'%s',p_service_name=>'Corte')"%(ids[0],apt),'PAYMENT_APPOINTMENT_IMMUTABLE')
assert sql("select deposit_amount_ars from appointments where id='%s'"%apt)=='5000'

# Creating a walk-in client links its stable ID for history without exposing other payments.
walkin=payment(6,p_barber_id='10000000-0000-0000-0000-000000000004',p_service_name='Barba',p_client_name='Cliente del cobro',p_client_contact='44444444')
assert walkin['client_id']
assert last(asuser(6,"select count(*) from clients where id='%s'"%walkin['client_id']))=='1'
assert last(asuser(1,"select count(*) from clients where id='%s'"%walkin['client_id']))=='0'
check_denied(1,"select staff_save_service_payment(p_payment_id=>'%s',p_service_name=>'Corte',p_client_id=>'%s')"%(ids[0],walkin['client_id']),'CLIENT_NOT_ALLOWED')
print('Four barber scopes, manager/admin separation, payment edits, discounts, voids, deposits, manual bookings, cancellations and immutable audit: PASS')

for user, barber in owners:
    own='10000000-0000-0000-0000-%012d'%barber
    slot=last(asuser(user,"select id from create_availability_slots('%s',array[current_date+11],'07:30','08:15')"%own))
    other_user=2 if user==1 else 1
    check_denied(other_user,"select * from update_availability_slot('%s','UNAVAILABLE',null)"%slot,'AVAILABILITY_NOT_ALLOWED')
    asuser(user,"select * from update_availability_slot('%s','UNAVAILABLE','Bloqueo propio')"%slot)
    asuser(user,"select * from update_availability_slot('%s','AVAILABLE',null)"%slot)
    asuser(3,"select * from update_availability_slot('%s','UNAVAILABLE',null)"%slot)
    asuser(4,"select * from update_availability_slot('%s','AVAILABLE',null)"%slot)
    assert last(asuser(other_user,"select count(*) from barber_availability_slots where id='%s'"%slot))=='0'

sql("insert into benefit_codes(code,type) values('KANI-FICTICIO','PERCENT_10')")
assert last(asuser(3,"select count(*) from benefit_codes where code='KANI-FICTICIO'"))=='1'
assert last(asuser(1,"select count(*) from benefit_codes"))=='0'
assert last(asuser(3,"update benefit_codes set status='DISABLED' where code='KANI-FICTICIO'"))=='UPDATE 0'
assert last(asuser(3,"delete from benefit_codes where code='KANI-FICTICIO'"))=='DELETE 0'
check_denied(3,"insert into benefit_codes(code,type) values('INDEBIDO','PERCENT_10')",'row-level security')
assert last(asuser(4,"update benefit_codes set status='DISABLED' where code='KANI-FICTICIO'"))=='UPDATE 1'
assert len(json.loads(last(asuser(3,'select staff_list_benefit_codes()'))))==1

# Public booking reuses an existing manual client, assigns the selected barber and adds the relation.
date="current_date+((8-extract(dow from current_date)::int)%7)+7"
public_args="'Dos','Corte de cabello',%s,'10:00','Cliente del cobro','44444444','shared@example.invalid',null"%date
check_denied(1,"select * from request_appointment("+public_args+")",'APPOINTMENT_NOT_ALLOWED')
public_apt=last(sql("set role anon; select appointment_id from request_appointment("+public_args+")"))
assert sql("select client_id::text from appointments where id='%s'"%public_apt)==walkin['client_id']
assert sql("select barber_id::text from appointments where id='%s'"%public_apt).endswith('000000000002')
assert last(asuser(2,"select count(*) from clients where id='%s'"%walkin['client_id']))=='1'
assert last(asuser(2,"select count(*) from service_payments where id='%s'"%walkin['id']))=='0'
assert last(asuser(6,"select count(*) from appointments where id='%s'"%public_apt))=='0'
assert sql("select count(*) from clients where phone='44444444'")=='1'

dispatch="select record_channel_dispatch_status('%s',null,'EMAIL','RESEND','synthetic@example.invalid',null,'FAILED',null,null,true,null)"%apt
check_denied(2,dispatch,'ACCESS_DENIED')
asuser(1,dispatch)
asuser(3,dispatch)
check_denied(1,'update staff_operation_audit set operation=\'FORGED\'','permission denied')
print('Four availability scopes, manager read-only discounts, preserved ADMIN rights, public shared-client assignment and notification scope: PASS')

# Definer callbacks cannot bypass the staff scopes through a forgotten legacy API.
for user in [1,2,3,4,5,6]:
    check_denied(user,'select * from get_pending_calendar_sync_items(10)','permission denied')
    check_denied(user,"select record_calendar_sync_failure('00000000-0000-0000-0000-000000000001','fake')",'permission denied')
    check_denied(user,"select set_barber_google_calendar('Uno','fake-calendar')",'permission denied')
assert last(sql("set role service_role;select set_barber_google_calendar('Uno','synthetic-calendar')"))=='t'
assert sql("select calendar_id from barber_google_calendars where barber_id='10000000-0000-0000-0000-000000000001'")=='synthetic-calendar'

# The public view honors invoker RLS, masks blocked intervals and never needs appointment SELECT.
asuser(3,"select * from create_availability_slots('10000000-0000-0000-0000-000000000001',array[current_date+13],'10:00','11:00')")
asuser(3,"select * from create_availability_slots('10000000-0000-0000-0000-000000000002',array[current_date+13],'10:00','11:00')")
sql("insert into barber_availability_slots(barber_id,slot_date,start_time,end_time,status,internal_note) values('10000000-0000-0000-0000-000000000001',current_date+13,'10:15','10:30','UNAVAILABLE','PRIVATE')")
assert last(sql("set role anon;select count(*) from available_barber_slots where barber_id='10000000-0000-0000-0000-000000000001' and slot_date=current_date+13"))=='9'
assert last(asuser(1,"select count(*) from available_barber_slots where barber_id='10000000-0000-0000-0000-000000000002'"))=='0'
try: sql('set role anon;select internal_note from barber_availability_slots')
except RuntimeError as error: assert 'permission denied' in str(error)
else: raise AssertionError('Private availability notes exposed')
assert sql("select ('security_invoker=true'=any(reloptions))::text from pg_class where oid='public.available_barber_slots'::regclass")=='true'
print('Legacy definer bypasses closed; service callbacks preserved; public invoker view hides blocked intervals and private notes: PASS')
assert sql("select has_table_privilege('authenticated','public.service_payments','TRUNCATE')::text")=='false'
assert sql("select has_table_privilege('authenticated','public.service_payments','TRIGGER')::text")=='false'
assert sql("select has_column_privilege('anon','public.barber_availability_slots','internal_note','SELECT')::text")=='false'
assert sql("select has_table_privilege('anon','public.barber_availability_slots','SELECT')::text")=='false'
assert last(sql("set role anon;select count(*) from (select id,barber_id,slot_date,start_time,end_time,status from barber_availability_slots where slot_date=current_date+13) public_columns"))=='2'
assert last(asuser(1,"select internal_note from barber_availability_slots where internal_note='PRIVATE'"))=='PRIVATE'
try: sql("set role anon;select * from barber_availability_slots where slot_date=current_date+13")
except RuntimeError as error: assert 'permission denied' in str(error)
else: raise AssertionError('Anonymous wildcard read exposed private availability fields')
print('Broad anon/PUBLIC grants and direct note grants removed; public columns preserved; staff notes remain scoped: PASS')

check_denied(1,"select create_appointment_notification_event('%s','CONFIRMED')"%public_apt,'permission denied')
check_denied(1,"select staff_create_appointment_notification_event('%s','NEW_REQUEST')"%public_apt,'APPOINTMENT_NOT_ALLOWED')
asuser(2,"select staff_create_appointment_notification_event('%s','NEW_REQUEST')"%public_apt)
asuser(3,"select staff_create_appointment_notification_event('%s','NEW_REQUEST')"%public_apt)
check_denied(2,"select staff_create_appointment_notification_event('%s','CANCELLED')"%public_apt,'NOTIFICATION_STATUS_NOT_ALLOWED')
print('Outbox capabilities require a verified owner/operator and the actual appointment status: PASS')

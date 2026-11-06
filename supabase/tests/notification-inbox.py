"""Four controlled identities in a disposable, network-isolated PostgreSQL instance."""
from pathlib import Path
import json, uuid

exec(compile((Path(__file__).parent/'staff-permissions.py').read_text(encoding='utf-8'), 'staff-permissions.py','exec'))
sql((Path(__file__).parent/'notification-legacy-fixture.sql').read_text(encoding='utf-8'))
one='10000000-0000-0000-0000-000000000001'
two='10000000-0000-0000-0000-000000000002'
client=last(asuser(1,"select (save_client(null,'Cliente Controlado','1123456789','control@example.invalid')).id"))
def insert(status='CONFIRMED',barber=one,**fields):
    ident=str(uuid.uuid4())
    values={'id':ident,'client_id':client,'barber_id':barber,'service_id':'20000000-0000-0000-0000-000000000001',
            'booking_date':'2097-01-10','start_time':'10:00','end_time':'10:45','status':status,**fields}
    def lit(x):
        if x is None:return 'null'
        if isinstance(x,bool):return str(x).lower()
        if isinstance(x,(int,float)):return str(x)
        return "'"+str(x).replace("'","''")+"'"
    sql('insert into appointments('+','.join(values)+') values('+','.join(lit(v) for v in values.values())+')')
    return ident
legacy=insert('PENDING')
sql(f"update appointments set status='CONFIRMED' where id='{legacy}'; update appointments set status='CANCELLED' where id='{legacy}'")
sql(f"insert into admin_activity_notifications(event_type,actor_display_name,barber_id,appointment_id,barber_name,client_name,event_date) values('APPOINTMENT_CONFIRMED','Duplicado','{one}','{legacy}','Uno','Cliente','2097-01-10')")
sql("update admin_activity_notifications set read_at=now()")
before=int(sql('select count(*) from admin_activity_notifications'))
migrations=list((repo/'supabase/migrations').glob('*_kani_account_notification_inbox.sql'))
assert len(migrations)==1
migration=migrations[0]
sql('begin;'+migration.read_text(encoding='utf-8')+'commit;')
assert int(sql('select count(*) from admin_activity_notifications'))==before
assert sql('select count(*) from admin_activity_notifications where read_at is not null')==str(before)
def inbox(user,before=None):
    return json.loads(last(asuser(user,'select staff_notification_inbox('+('null' if before is None else str(before))+')')))
def detail(user,ident):return json.loads(last(asuser(user,f"select staff_notification_detail('{ident}')")))
def event(apt,kind='APPOINTMENT_CONFIRMED'):
    return sql(f"select id from admin_activity_notifications where appointment_id='{apt}' and event_type='{kind}' and event_key is not null")
def reads(user,ids=None,through=None,read=True):
    args=f"p_read=>{str(read).lower()}"
    if ids is not None:args+=",p_ids=>array["+','.join("'%s'::uuid"%i for i in ids)+']::uuid[]'
    if through is not None:args+=',p_through=>'+str(through)
    return asuser(user,'select staff_set_notification_reads('+args+')')
assert inbox(1)['unread_count']==2
assert inbox(2)['unread_count']==0
assert inbox(3)['unread_count']==2 and inbox(4)['unread_count']==2
assert all(n['read_at'] is None for n in inbox(4)['items']), 'Never inherit legacy shared read_at'
print('Legacy events retained; duplicate feed entries suppressed; shared legacy reads not attributed: PASS')

web=insert('PENDING')
assert not event(web)
sql(f"update appointments set notes='Intento fallido' where id='{web}'")
assert not event(web)
sql(f"update appointments set status='CONFIRMED' where id='{web}';update appointments set status='CONFIRMED' where id='{web}'")
assert event(web)
assert sql(f"select count(*) from admin_activity_notifications where appointment_id='{web}' and event_key is not null")=='1'
pending=insert('PENDING')
sql(f"update appointments set status='CANCELLED' where id='{pending}'")
assert not event(pending,'APPOINTMENT_CANCELLED')
manual=insert('CONFIRMED',is_manual=True,origin='MANUAL',deposit_required=False,service_price_ars=17000)
other=insert('CONFIRMED',barber=two)
free=insert('CONFIRMED',benefit_code='CONTROL-GRATIS',benefit_type='FREE_SERVICE',benefit_original_price_ars=25000,
            benefit_discount_amount_ars=25000,benefit_final_price_ars=0,deposit_required=False)
no_deposit=insert('CONFIRMED',benefit_code='CONTROL-SIN-SENA',benefit_type='NO_DEPOSIT',deposit_required=False)
assert all(event(a) for a in [manual,other,free,no_deposit])
# Exercise the real staff manual-creation RPC as well as raw-trigger paths.
created=last(asuser(1,f"select appointment_id from create_manual_appointment(p_barber_id=>'{one}',p_service_id=>'20000000-0000-0000-0000-000000000001',p_booking_date=>'2097-02-04',p_start_time=>'13:00',p_client_name=>'Manual Controlado',p_client_phone=>'1123456789',p_deposit_required=>false)"))
assert event(created)
assert detail(1,event(free))['final_price']==0
assert detail(1,event(no_deposit))['deposit_paid']==0
assert all(n['appointment_id']!=other for n in inbox(1)['items'])
assert all(n['appointment_id']==other for n in inbox(2)['items'])
for user in [1,2,3,4]:
    assert inbox(user)['unread_count']==len([n for n in inbox(user)['items'] if n['read_at'] is None])
check_denied(1,f"select staff_notification_detail('{event(other)}')",'NOTIFICATION_NOT_ALLOWED')
check_denied(2,f"select staff_set_notification_reads(true,array['{event(web)}'::uuid])",'NOTIFICATION_NOT_ALLOWED')
assert last(asuser(2,f"select count(*) from admin_activity_notifications where id='{event(web)}'"))=='0'
print('Confirmed web/manual/free/no-deposit events only; two-barber visibility and direct detail/read denials: PASS')

n=event(web)
before_counts={u:inbox(u)['unread_count'] for u in [1,2,3,4]}
reads(1,[n]);assert inbox(1)['unread_count']==before_counts[1]-1
assert all(inbox(u)['unread_count']==before_counts[u] for u in [2,3,4])
assert last(asuser(3,'select count(*) from admin_activity_user_state'))=='0'
check_denied(3,f"insert into admin_activity_user_state(notification_id,user_id,read_at) values('{n}','00000000-0000-0000-0000-000000000001',now())")
reads(1,[n],read=False);assert inbox(1)['unread_count']==before_counts[1]
fence=inbox(1)['through'];new_arrival=insert('CONFIRMED')
reads(1,through=fence)
assert inbox(1)['unread_count']==1 and inbox(1)['items'][0]['appointment_id']==new_arrival
assert inbox(3)['unread_count']==before_counts[3]+1
reads(3,[n]);assert inbox(4)['unread_count']==before_counts[4]+1
assert next(x for x in inbox(3)['items'] if x['id']==n)['read_at'] is not None
assert next(x for x in inbox(4)['items'] if x['id']==n)['read_at'] is None
print('Account-only read/unread, session-independent persistence, global accurate count and bulk high-water fence: PASS')

sql(f"update appointments set status='CANCELLED' where id='{web}';update appointments set status='CANCELLED' where id='{web}'")
assert event(web,'APPOINTMENT_CANCELLED')
assert detail(1,n)['status']=='CANCELLED', 'Detail must query current state, not historic event'
assert sql(f"select count(*) from admin_activity_notifications where appointment_id='{web}' and event_key is not null")=='2'
check_denied(1,f"select staff_save_service_payment(p_barber_id=>'{one}',p_appointment_id=>'{web}',p_service_name=>'Corte')",'APPOINTMENT_NOT_COLLECTIBLE')
paid=payment(1,p_barber_id=one,p_appointment_id=manual,p_service_name='Corte',p_service_price_ars=17000)
assert paid['collected_amount_ars']==17000
assert detail(1,event(manual))['status']=='COMPLETED'
assert detail(1,event(manual))['balance']==0 and detail(1,event(manual))['has_payment']
check_denied(1,f"select staff_save_service_payment(p_barber_id=>'{one}',p_appointment_id=>'{manual}',p_service_name=>'Corte')",'APPOINTMENT_ALREADY_LINKED')
free_payment=payment(1,p_barber_id=one,p_appointment_id=free,p_service_name='Corte',p_service_price_ars=25000,p_discount_value=25000)
assert free_payment['collected_amount_ars']==0
assert detail(1,event(free))['balance']==0
deposit=insert('CONFIRMED',deposit_paid=True,deposit_amount_ars=5000,service_price_ars=25000,
               benefit_original_price_ars=25000,benefit_discount_amount_ars=2500,benefit_final_price_ars=22500)
assert detail(1,event(deposit))['deposit_paid']==5000 and detail(1,event(deposit))['balance']==17500
sql(f"insert into appointment_payment_orders(appointment_id,paid_amount_ars,reconciliation_status) values('{deposit}',5000,'CONFIRMED')")
assert detail(1,event(deposit))['deposit_verifiable']
sql(f"insert into payment_attempts(appointment_id,provider,site_transaction_id,provider_transaction_id,amount_ars,amount_minor_units,state,confirmation_status) values('{deposit}','PAYWAY','controlledapproved','controlled-provider',5000,500000,'APPROVED','CONFIRMED')")
assert detail(1,event(deposit))['deposit_paid']==5000
sql(f"update payment_attempts set amount_ars=6000,amount_minor_units=600000 where appointment_id='{deposit}'")
assert detail(1,event(deposit))['deposit_verifiable'] is False
late=insert('PENDING')
sql(f"insert into payment_attempts(appointment_id,provider,site_transaction_id,provider_transaction_id,amount_ars,amount_minor_units,state,confirmation_status) values('{late}','PAYWAY','controlledlate','controlled-late-provider',5000,500000,'APPROVED','PAID_LATE_REVIEW')")
assert not event(late)

print('Live cancelled/completed details, real balance/benefits, zero-price completion and duplicate collection prevention: PASS')

count=int(sql('select count(*) from admin_activity_notifications'))
sql(f"update barber_availability_slots set status=case when status='AVAILABLE' then 'UNAVAILABLE'::availability_status else 'AVAILABLE'::availability_status end where barber_id='{one}'")
assert int(sql('select count(*) from admin_activity_notifications'))==count
assert all(n['event_type'] in ['APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED'] for n in inbox(4)['items'])
for user in [1,2,3]:check_denied(user,f"select staff_delete_notifications(array['{n}'::uuid])",'ADMIN_REQUIRED')
asuser(4,f"select staff_delete_notifications(array['{n}'::uuid])")
for user in [1,2,3,4]:assert all(x['id']!=n for x in inbox(user)['items'])
check_denied(4,f"select staff_notification_detail('{n}')",'NOTIFICATION_NOT_ALLOWED')
assert sql(f"select count(*) from admin_activity_notifications where id='{n}' and deleted_at is not null")=='1'
assert sql(f"select count(*) from appointments where id='{web}'")=='1'
assert int(sql(f"select count(*) from staff_operation_audit where table_name='admin_activity_notifications' and record_id='{n}' and new_values->>'deleted_at' is not null"))==1
asuser(4,f"select staff_delete_notifications(array['{n}'::uuid])")
assert int(sql(f"select count(*) from staff_operation_audit where table_name='admin_activity_notifications' and record_id='{n}' and new_values->>'deleted_at' is not null"))==1
check_denied(4,f"delete from admin_activity_notifications where id='{event(other)}'")
check_denied(4,f"update admin_activity_notifications set read_at=now() where id='{event(other)}'")
assert sql("select has_function_privilege('anon','public.staff_notification_inbox(bigint)','execute')")=='f'
assert sql("select has_table_privilege('anon','public.admin_activity_user_state','select')")=='f'
assert sql("select has_function_privilege('authenticated','public.log_admin_activity_appointment()','execute')")=='f'
for u in [1,2,3,4]:check_denied(u,f"select * from get_appointment_payment_details('{other}')",'permission denied')
assert sql("select has_function_privilege('service_role','public.get_appointment_payment_details(uuid)','execute')")=='t'
assert last(sql(f"set role service_role;set request.jwt.claim.role='service_role';select count(*) from get_appointment_payment_details('{other}')"))=='1'

assert inbox(7)['items']==[], 'Inactive manager cannot see notifications'
# Reassignment follows current ownership, not the historical barber snapshot.
reassigned=insert('CONFIRMED')
reassigned_event=event(reassigned)
reads(1,[reassigned_event])
sql(f"update appointments set barber_id='{two}' where id='{reassigned}'")
check_denied(1,f"select staff_notification_detail('{reassigned_event}')",'NOTIFICATION_NOT_ALLOWED')
assert any(x['id']==reassigned_event and x['read_at'] is None for x in inbox(2)['items'])
assert detail(2,reassigned_event)['barber_id']==two
print('No availability feed emissions; admin-only audited logical deletion; repeat deletion idempotent; anonymous/inactive access denied: PASS')

# Pagination and a count independent of the visible page length.
for _ in range(52):insert('CONFIRMED')
first=inbox(4);second=inbox(4,first['next_before'])
assert len(first['items'])==50 and first['unread_count']>50
assert not ({x['id'] for x in first['items']} & {x['id'] for x in second['items']})
reads(4,through=first['through']);assert inbox(4)['unread_count']==0
assert inbox(3)['unread_count']>0
print('Pagination, all-visible unread count and bulk operation across unloaded pages: PASS')

"""Standalone ACL compatibility, without any five-account migration or production records."""
import json, os, subprocess, time
from pathlib import Path

repo=Path(__file__).resolve().parents[2]
container=os.environ['KANI_TEST_CONTAINER']
prefix=['docker','exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(query):
    result=subprocess.run(prefix,input=query,text=True,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr)
    return result.stdout.strip()
assert subprocess.check_output(['docker','inspect','--format','{{.HostConfig.NetworkMode}}',container],text=True).strip()=='none'
for attempt in range(30):
    try:sql('select 1');break
    except RuntimeError:
        if attempt==29:raise
        time.sleep(.2)
sql((repo/'supabase/tests/staff-permissions-fixture.sql').read_text(encoding='utf-8'))
sql((repo/'supabase/tests/fixtures/public-availability-read-paths.sql').read_text(encoding='utf-8'))
# Match the actual original grants, not just the more restrictive future schema.
sql('''revoke select on barber_availability_slots from public;
revoke select(internal_note) on barber_availability_slots from public,anon;
revoke all on barber_availability_slots from authenticated;
grant select on barber_availability_slots to authenticated;
create role public_privileges_probe;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into barbers(id,name) values
 ('10000000-0000-0000-0000-000000000001','Uno'),('10000000-0000-0000-0000-000000000002','Dos');
insert into staff_profiles(user_id,role,barber_id,display_name) values
 ('00000000-0000-0000-0000-000000000001','BARBER','10000000-0000-0000-0000-000000000001','Uno'),
 ('00000000-0000-0000-0000-000000000002','BARBER','10000000-0000-0000-0000-000000000002','Dos'),
 ('00000000-0000-0000-0000-000000000003','ADMIN',null,'Admin');
insert into services(id,name,duration_minutes,price_ars) values
 ('20000000-0000-0000-0000-000000000001','Corte de cabello',45,25000),
 ('20000000-0000-0000-0000-000000000002','Barba',30,15000);
insert into clients(id,name,phone) values('30000000-0000-0000-0000-000000000001','Sintetico','11111111');
insert into barber_availability_slots(barber_id,slot_date,start_time,end_time,status,internal_note) values
 ('10000000-0000-0000-0000-000000000001','2030-01-07','10:00','13:00','AVAILABLE','PRIVATE'),
 ('10000000-0000-0000-0000-000000000001','2030-01-07','10:15','10:30','UNAVAILABLE','BLOCKED PRIVATE'),
 ('10000000-0000-0000-0000-000000000002','2030-01-07','10:00','11:00','AVAILABLE','OTHER PRIVATE');
insert into appointments(client_id,barber_id,service_id,booking_date,start_time,end_time,status) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2030-01-07','11:00','11:45','CONFIRMED');''')

def asanon(query):return sql('set role anon;'+query)
def asstaff(user,query):return sql("set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-%012d';"%user+query).splitlines()[-1]
def denied(query):
    try:asanon(query)
    except RuntimeError as error:assert 'permission denied' in str(error)
    else:raise AssertionError('Private anonymous read was permitted')
def snapshot():
    return sql("select jsonb_build_object('data',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from barber_availability_slots s),'policies',(select md5(jsonb_agg(to_jsonb(p) order by policyname)::text) from pg_policies p where tablename='barber_availability_slots'),'rpc',pg_get_functiondef('public.read_valid_availability_starts(uuid,date,date)'::regprocedure),'view',pg_get_viewdef('public.available_barber_slots'::regclass),'authenticated_acl',(select jsonb_agg(jsonb_build_array(x.privilege_type,x.is_grantable) order by x.privilege_type) from pg_class c cross join lateral aclexplode(c.relacl) x where c.oid='barber_availability_slots'::regclass and x.grantee='authenticated'::regrole))")
view="select coalesce(jsonb_agg(to_jsonb(v) order by barber_id,slot_date,start_time),'[]'::jsonb) from available_barber_slots v"
rpc="select coalesce(jsonb_agg(to_jsonb(v) order by barber_id,slot_date,start_time),'[]'::jsonb) from read_valid_availability_starts(null,'2030-01-07','2030-01-07') v"
baseline_view=asanon(view).splitlines()[-1]
baseline_rpc=asanon(rpc).splitlines()[-1]
assert len(json.loads(baseline_view))==36
assert len(json.loads(baseline_rpc))>0
assert sql("select has_column_privilege('anon','barber_availability_slots','internal_note','SELECT')::text")=='true'
before=snapshot()
assert asstaff(1,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='2'
assert asstaff(2,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='1'
assert asstaff(3,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='3'
migration=(repo/'supabase/migrations/20261104223457_kani_anonymous_availability_columns.sql').read_text(encoding='utf-8')

for scenario in ['original production grants','PUBLIC and direct column grants','idempotent replay']:
    if scenario=='PUBLIC and direct column grants':
        sql('grant select on barber_availability_slots to public,anon;grant select(internal_note) on barber_availability_slots to public,anon;')
        assert sql("select has_column_privilege('public_privileges_probe','barber_availability_slots','internal_note','SELECT')::text")=='true'
    sql('BEGIN;\n'+migration+'\nCOMMIT;')
    assert snapshot()==before
    assert asanon(view).splitlines()[-1]==baseline_view
    assert asanon(rpc).splitlines()[-1]==baseline_rpc
    assert sql("select has_column_privilege('anon','barber_availability_slots','internal_note','SELECT')::text")=='false'
    assert sql("select has_table_privilege('anon','barber_availability_slots','SELECT')::text")=='false'
    assert sql("select has_column_privilege('public_privileges_probe','barber_availability_slots','internal_note','SELECT')::text")=='false'
    denied('select internal_note from barber_availability_slots')
    denied('select * from barber_availability_slots')
    assert asanon('select count(*) from (select id,barber_id,slot_date,start_time,end_time,status from barber_availability_slots) safe').splitlines()[-1]=='2'
    assert asstaff(1,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='2'
    assert asstaff(2,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='1'
    assert asstaff(3,"select count(*) from barber_availability_slots where internal_note like '%PRIVATE%'")=='3'
    assert sql("select (to_regclass('public.client_barbers') is null and not exists(select 1 from pg_enum where enumtypid='staff_role'::regtype and enumlabel='MANAGER'))::text")=='true'
    print('PASS: '+scenario+'; anonymous notes blocked, public RPC/view identical, authenticated/ADMIN scopes and data preserved')

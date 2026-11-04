# Run with pnpm run test:staff:sql: a fresh disposable PostgreSQL 17 container (network none).
# This tests schema and permissions, not recovery of the real production backup.
import json,subprocess,time,os
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
prefix=['docker','exec','-i',os.environ.get('KANI_TEST_CONTAINER','kani-permissions-test'),'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(q):
 p=subprocess.run(prefix,input=q,text=True,capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
inspect=subprocess.run(['docker','inspect','--format','{{.HostConfig.NetworkMode}}',os.environ.get('KANI_TEST_CONTAINER','kani-permissions-test')],text=True,capture_output=True,check=True)
assert inspect.stdout.strip()=='none', 'Disposable test container must have network none'
for attempt in range(30):
 try:sql('select 1');break
 except RuntimeError:
  if attempt==29:raise
  time.sleep(.2)
sql((Path(__file__).parent/'staff-permissions-fixture.sql').read_text(encoding='utf-8'))
assert sql("select has_table_privilege('anon','public.barber_availability_slots','SELECT')::text")=='true'
assert sql("select has_column_privilege('anon','public.barber_availability_slots','internal_note','SELECT')::text")=='true'
print('Legacy broad anonymous availability access reproduced before migrations: PASS')
for name in ['20261104121944_kani_manager_role.sql','20261104121945_kani_operational_permissions.sql','20261104125638_kani_complete_staff_payments_and_permissions.sql','20261104223457_kani_anonymous_availability_columns.sql']:
 sql('BEGIN;\n'+(repo/'supabase/migrations'/name).read_text(encoding='utf-8')+'\nCOMMIT;')
print('Migrations apply to production-derived schema fixture: PASS')
sql('''insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into barbers(id,name) values ('10000000-0000-0000-0000-000000000001','Uno'),('10000000-0000-0000-0000-000000000002','Dos');
insert into staff_profiles(user_id,role,barber_id,display_name) values
('00000000-0000-0000-0000-000000000001','BARBER','10000000-0000-0000-0000-000000000001','Uno'),
('00000000-0000-0000-0000-000000000002','BARBER','10000000-0000-0000-0000-000000000002','Dos'),
('00000000-0000-0000-0000-000000000003','MANAGER',null,'Jefe'),
('00000000-0000-0000-0000-000000000004','ADMIN',null,'Admin');''')
def asuser(n,q):return sql("set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-%012d';"%n+q)
def denied(n,q):
 try:asuser(n,q)
 except RuntimeError as e:
  assert any(x in str(e) for x in ['permission denied','CLIENT_NOT_ALLOWED','CLIENT_DELETE_NOT_ALLOWED','row-level security']),str(e)
 else:raise AssertionError('Operation unexpectedly permitted: '+q)
assert asuser(3,'select public.is_operator(),public.is_admin()').endswith('t|f')
assert asuser(4,'select public.is_operator(),public.is_admin()').endswith('t|t')
a=asuser(1,"select (public.save_client(null,'Cliente Uno','11111111',null)).id").splitlines()[-1]
b=asuser(2,"select (public.save_client(null,'Cliente Dos','22222222',null)).id").splitlines()[-1]
assert asuser(1,'select count(*) from clients').endswith('1')
assert asuser(2,'select count(*) from clients').endswith('1')
assert asuser(3,'select count(*) from clients').endswith('2')
denied(1,f"select public.save_client('{b}','Ajeno','22222222',null)")
denied(1,f"update clients set deleted_at=now() where id='{a}'")
denied(1,f"delete from clients where id='{a}'")
# Shared contact creates a second durable relation to the same card.
assert asuser(2,"select (public.save_client(null,'Cliente Uno','11111111',null)).id").endswith(a)
assert asuser(2,'select count(*) from clients').endswith('2')
assert sql('select count(*) from clients')=='2'
asuser(2,f"select public.save_client('{a}','Cliente Compartido','11111111',null)")
assert asuser(1,f"select name from clients where id='{a}'").endswith('Cliente Compartido')
asuser(3,f"select public.delete_client('{b}')")
assert sql("select count(*) from staff_operation_audit where table_name='clients' and old_values->>'deleted_at' is null and new_values->>'deleted_at' is not null")=='1'
denied(1,'delete from staff_operation_audit')
# Manager cannot call administrative-only code check or mutate discounts.
assert asuser(3,'select public.check_is_admin_user()').endswith('f')
assert asuser(3,"update benefit_codes set status=status returning id").endswith('UPDATE 0')
denied(1,"insert into client_barbers(client_id,barber_id) values ('%s','10000000-0000-0000-0000-000000000002')"%a)
print('Related-client visibility, shared reuse/edit, delete restrictions, manager/admin separation and immutable audit: PASS')

exec(compile((Path(__file__).parent/"staff-payments.py").read_text(encoding='utf-8'), "staff-payments.py", "exec"))

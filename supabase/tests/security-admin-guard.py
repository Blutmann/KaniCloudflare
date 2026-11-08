"""Reproduce live SQL NULL authorization bypass using synthetic users offline only."""
from pathlib import Path
exec(compile((Path(__file__).parent/'staff-permissions.py').read_text(encoding='utf-8'),'staff-permissions.py','exec'))
sql((Path(__file__).parent/'security-admin-guard-fixture.sql').read_text(encoding='utf-8'))
sql("insert into auth.users values ('00000000-0000-0000-0000-000000000099'),('00000000-0000-0000-0000-000000000098');insert into staff_profiles(user_id,role,active,display_name) values ('00000000-0000-0000-0000-000000000098','ADMIN',false,'Disabled synthetic administrator');")
for n in [99,98]:
 assert asuser(n,'select public.check_is_admin_user() is null').endswith('t')
 assert asuser(n,"select (public.admin_create_benefit_code('FREE_SERVICE','synthetic private note','AUDIT-BEFORE-%d')->>'type')"%n).endswith('FREE_SERVICE')
 assert asuser(n,"select jsonb_array_length(public.admin_list_benefit_codes())>0").endswith('t')
 assert asuser(n,"select public.admin_disable_benefit_code((select (x->>'id')::uuid from jsonb_array_elements(public.admin_list_benefit_codes()) x where x->>'code'='AUDIT-BEFORE-%d'))"%n).endswith('t')
print('CONFIRMED before fix: non-staff and disabled ADMIN can list, create free-service codes and disable codes through live production routines')
before=sql("select count(*) from benefit_codes")
sql((repo/'supabase/migrations/20261107190103_kani_admin_guard_null_denial.sql').read_text(encoding='utf-8'))
for n in [1,2,3,98,99]:
 assert asuser(n,'select public.check_is_admin_user()').endswith('f')
 for q in ["select public.admin_list_benefit_codes()","select public.admin_create_benefit_code('FREE_SERVICE',null,'AUDIT-AFTER')","select public.admin_disable_benefit_code(gen_random_uuid())"]:
  try:asuser(n,q)
  except RuntimeError as e:assert 'UNAUTHORIZED_ADMIN_ONLY' in str(e)
  else:raise AssertionError('Non-admin bypass remained')
assert sql('select count(*) from benefit_codes')==before
assert asuser(4,'select public.check_is_admin_user()').endswith('t')
assert asuser(4,"select public.admin_create_benefit_code('NO_DEPOSIT',null,'AUDIT-ADMIN-OK')->>'code'").endswith('AUDIT-ADMIN-OK')
assert asuser(4,"select public.admin_disable_benefit_code((select (x->>'id')::uuid from jsonb_array_elements(public.admin_list_benefit_codes()) x where x->>'code'='AUDIT-ADMIN-OK'))").endswith('t')
assert sql("set role service_role;set request.jwt.claim.role='service_role';select public.check_is_admin_user()").endswith('t')
assert sql("select has_function_privilege('anon','public.admin_list_benefit_codes()','EXECUTE')::text")=='false'
print('PASS after prepared fix: BARBER, MANAGER, non-staff and disabled ADMIN denied; active ADMIN/service role preserved; records preserved; anonymous execution denied')

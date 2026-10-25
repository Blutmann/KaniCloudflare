# Run only against the disposable kani-mp-audit-db container, initialized with an empty database.
import subprocess,concurrent.futures,json
from pathlib import Path
prefix=['env','-u','DOCKER_HOST','-u','DOCKER_CONTEXT','-u','DOCKER_TLS','-u','DOCKER_TLS_VERIFY','-u','DOCKER_CERT_PATH','docker','--host=unix:///var/run/docker.sock','exec','-i','kani-mp-audit-db','psql','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(q):
 p=subprocess.run(prefix,input=q,text=True,capture_output=True)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout.strip()
sql((Path(__file__).parent / 'payment-confirmation-audit-fixture.sql').read_text())
sql((Path(__file__).parents[1] / 'migrations/20261025000100_kani_secure_payment_confirmation.sql').read_text())
barber='00000000-0000-4000-8000-000000000001'
def apt(n,clock='10:00',status='PENDING',day='current_date+2'):
 id=f'10000000-0000-4000-8000-{n:012d}'
 sql(f"insert into appointments values ('{id}','{barber}',{day},'{clock}','{int(clock[:2])+1:02}:00','{status}',now()); insert into appointment_payment_orders(appointment_id,order_id) values ('{id}','ORD{n}');")
 return id
def confirm(id,n,amount=5000):return sql(f"set role service_role;select result_code from confirm_appointment_from_payment('{id}','ORD{n}',{amount});")
a=apt(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e: results=list(e.map(lambda _:confirm(a,1),range(2)))
assert sum('ALREADY_CONFIRMED' in x for x in results)==1,results
assert sum(x.endswith('\nCONFIRMED') for x in results)==1,results
assert sql('select count(*) from audit_notifications')=='1'
assert 'ALREADY_CONFIRMED' in confirm(a,1)
print('same appointment concurrent + duplicate + refresh:',results,'one notification event')
b=apt(2,'12:00');c=apt(3,'12:00')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e: collision=list(e.map(lambda x:confirm(*x),[(b,2),(c,3)]))
assert sum('SLOT_COLLISION_LATE_PAYMENT' in x for x in collision)==1,collision
assert sum(x.endswith('\nCONFIRMED') for x in collision)==1,collision
assert sql("select count(*) from appointment_payment_orders where reconciliation_status='PAID_LATE_REVIEW'")=='1'
print('competing appointments:',collision,'late payment persisted for review')
d=apt(4,'15:00');assert 'PAYMENT_MISMATCH' in confirm(d,4,1)
assert 'PAYMENT_MISMATCH' in confirm(d,999)
e=apt(5,'16:00','CANCELLED');assert 'APPOINTMENT_CANCELLED' in confirm(e,5)
f=apt(6,'17:00',day='current_date-1');assert 'SLOT_COLLISION_LATE_PAYMENT' in confirm(f,6)
print('wrong amount, crossed order, cancelled and past slot: PASS')
for role in ['anon','authenticated']:
 p=subprocess.run(prefix,input=f"set role {role};select * from confirm_appointment_from_payment('{d}','ORD4',5000);",text=True,capture_output=True)
 assert p.returncode and 'permission denied' in p.stderr,(role,p.stdout,p.stderr)
print('anon/authenticated cannot confirm: PASS')
print('DATABASE AUDIT PASS')

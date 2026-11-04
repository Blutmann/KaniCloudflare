-- Standalone security fix: no dependency on the five-account migrations or a Worker release.
-- Keep existing row policies, public read functions, view, data and staff grants intact.
set local lock_timeout = '5s';

revoke select on public.barber_availability_slots from public,anon;
revoke select(internal_note) on public.barber_availability_slots from public,anon;
grant select(id,barber_id,slot_date,start_time,end_time,status)
 on public.barber_availability_slots to anon;

-- Fail atomically if an unexpected inherited grant would still expose the note.
do $$ begin
 if has_column_privilege('anon','public.barber_availability_slots','internal_note','SELECT') then
  raise exception 'Anonymous availability notes remain readable through another inherited grant';
 end if;
end; $$;

notify pgrst,'reload schema';

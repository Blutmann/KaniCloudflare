-- Must commit before the next migration uses the new enum value.
alter type public.staff_role add value if not exists 'MANAGER';

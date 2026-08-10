-- Debug helper (temporary): describe a table's constraints
create or replace function public.table_keys(tname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'constraint_name', conname,
    'type', contype::text,
    'definition', pg_get_constraintdef(oid)
  ))
  into result
  from pg_constraint
  where conrelid = tname::regclass;
  return coalesce(result, '[]'::jsonb);
end;
$$;

grant execute on function public.table_keys(text) to anon, authenticated;

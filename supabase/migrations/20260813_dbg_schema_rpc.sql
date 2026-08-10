-- Debug helper (temporary): describe a table's columns
create or replace function public.table_columns(tname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'column_name', column_name,
    'data_type', data_type,
    'is_nullable', is_nullable,
    'column_default', column_default
  ) order by ordinal_position)
  into result
  from information_schema.columns
  where table_name = tname;
  return coalesce(result, '[]'::jsonb);
end;
$$;

grant execute on function public.table_columns(text) to anon, authenticated;

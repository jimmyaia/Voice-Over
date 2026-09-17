-- Run once after database/schema.sql. This lets a signed-in user securely
-- create their first tenant without exposing a Supabase secret key.
create or replace function public.create_my_organization(
  organization_name text,
  organization_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(organization_name)) < 1 or char_length(trim(organization_name)) > 160 then
    raise exception 'Organization name must be between 1 and 160 characters';
  end if;

  if organization_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Organization slug is invalid';
  end if;

  insert into public.organizations (name, slug)
  values (trim(organization_name), organization_slug)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, auth.uid(), 'owner');

  insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, action)
  values (new_organization_id, auth.uid(), 'organization', new_organization_id, 'created');

  return new_organization_id;
end;
$$;

revoke all on function public.create_my_organization(text, text) from public;
grant execute on function public.create_my_organization(text, text) to authenticated;

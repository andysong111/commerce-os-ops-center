-- Harden organization membership bootstrap policy.
-- The first migration allowed a user to insert themselves as a member with only user_id = auth.uid().
-- This follow-up restricts self-membership insertion to organizations owned by the same user.

create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = org_id
      and o.owner_user_id = auth.uid()
  );
$$;

drop policy if exists "owners can add themselves as member" on public.organization_members;

create policy "owners can add themselves as member"
  on public.organization_members for insert
  with check (
    user_id = auth.uid()
    and public.is_org_owner(organization_id)
  );

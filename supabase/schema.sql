-- Optional future design. Not applied by the local or Android app.
create table if not exists public.focus_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object' and state->>'version' is not null and state->>'version' = '1'),
  updated_at timestamptz not null default now()
);
alter table public.focus_snapshots enable row level security;
create policy own_read on public.focus_snapshots for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_insert on public.focus_snapshots for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy own_update on public.focus_snapshots for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
grant select, insert, update on public.focus_snapshots to authenticated;

-- Optimistic concurrency for the cooperating client. RLS also applies to this
-- SECURITY INVOKER function. Do not provide a service-role key to the client.
create or replace function public.save_focus_snapshot(expected_revision bigint, new_state jsonb)
returns public.focus_snapshots language plpgsql security invoker set search_path = '' as $$
declare saved public.focus_snapshots;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision = 0 then
    insert into public.focus_snapshots(owner_id, revision, state)
      values(auth.uid(), 1, new_state)
      on conflict (owner_id) do nothing returning * into saved;
  else
    update public.focus_snapshots
      set state = new_state, revision = revision + 1, updated_at = now()
      where owner_id = auth.uid() and revision = expected_revision
      returning * into saved;
  end if;
  if not found then raise exception 'Revision conflict' using errcode = '40001'; end if;
  return saved;
end;
$$;
revoke all on function public.save_focus_snapshot(bigint, jsonb) from public;
grant execute on function public.save_focus_snapshot(bigint, jsonb) to authenticated;

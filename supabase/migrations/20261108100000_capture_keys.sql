-- Per-user capture keys for capture clients, replacing the single static
-- CAPTURE_KEY secret (which also hardcoded who captures land as:
-- OWNER_USER_ID).
--
-- capture_keys holds one key per user, as the sha256 (hex) of the key — the
-- plaintext exists only in rotate_capture_key()'s answer. The capture edge
-- function hashes the bearer token and looks the row up with its
-- service-role client; that row's user_id is who the capture is written as.
--
-- Client privileges follow minimal_table_grants: anon nothing; authenticated
-- may only SELECT created_at and last_used_at (column privileges), so the
-- hash never reaches a client — `select *` and `select key_hash` are refused.
-- Keys are created and replaced only by rotate_capture_key().

create table public.capture_keys (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.capture_keys enable row level security;

create policy "owner read" on public.capture_keys
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.capture_keys from anon, authenticated;
grant select (created_at, last_used_at) on public.capture_keys to authenticated;

-- Rotation is rate-limited like the edge functions (rate_limit_for owns the
-- limits): 10 per hour is plenty for a human pressing a button.
create or replace function public.rate_limit_for(p_action text, out max_calls int, out time_window interval)
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_action
    when 'capture'     then max_calls := 120; time_window := interval '1 hour';
    when 'translate'   then max_calls := 20;  time_window := interval '1 hour';
    when 'snippet'     then max_calls := 30;  time_window := interval '1 hour';
    when 'file-import' then max_calls := 30;  time_window := interval '1 hour';
    when 'pdf-import'  then max_calls := 30;  time_window := interval '1 hour';
    when 'capture-key' then max_calls := 10;  time_window := interval '1 hour';
    else
      raise exception 'rate_limit_for: unknown action %', p_action using errcode = '22023';
  end case;
end;
$$;

-- Generates a new key for the caller, stores its hash (replacing any previous
-- key, which stops working at once) and returns the plaintext — the only
-- time it is ever available. "rlk_" + 32 random bytes as unpadded base64url.
-- Over the rate limit: SQLSTATE PT429, which PostgREST answers as HTTP 429.
create function public.rotate_capture_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_key text;
begin
  if uid is null then
    raise exception 'rotate_capture_key: no user' using errcode = '42501';
  end if;
  if not public.bump_rate_limit_for_user(uid, 'capture-key') then
    raise exception 'rate limit exceeded' using errcode = 'PT429';
  end if;

  new_key := 'rlk_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into public.capture_keys (user_id, key_hash, created_at, last_used_at)
  values (uid, encode(sha256(convert_to(new_key, 'UTF8')), 'hex'), now(), null)
  on conflict (user_id) do update
    set key_hash = excluded.key_hash,
        created_at = excluded.created_at,
        last_used_at = null;

  return new_key;
end;
$$;

revoke execute on function public.rotate_capture_key() from public, anon;
grant execute on function public.rotate_capture_key() to authenticated;

-- Rate limits are decided by the database, not by the caller.
--
-- bump_rate_limit(action, max, window) was granted to every signed-in user
-- and trusted the max/window it was given: calling it with a 1 ms window
-- reset the counter, so any account could lift every edge function's limit
-- (and drain the shared DeepL quota). It also accepted any action string.
--
-- Now rate_limit_for() owns the per-action limits, and both RPCs take only
-- the action name. An unknown action is an error.

drop function public.bump_rate_limit(text, int, interval);
drop function public.bump_rate_limit_for_user(uuid, text, int, interval);

create function public.rate_limit_for(p_action text, out max_calls int, out time_window interval)
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
    else
      raise exception 'rate_limit_for: unknown action %', p_action using errcode = '22023';
  end case;
end;
$$;

create function public.bump_rate_limit_for_user(p_user_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim record;
  current_count int;
begin
  if p_user_id is null then
    raise exception 'bump_rate_limit: no user' using errcode = '42501';
  end if;
  lim := public.rate_limit_for(p_action);

  insert into public.rate_limits as r (user_id, action, window_start, count)
  values (p_user_id, p_action, now(), 1)
  on conflict (user_id, action) do update
    set window_start = case when r.window_start <= now() - lim.time_window
                            then now() else r.window_start end,
        count        = case when r.window_start <= now() - lim.time_window
                            then 1 else least(r.count + 1, lim.max_calls + 1) end
  returning r.count into current_count;

  if current_count is null then
    raise exception 'bump_rate_limit: nothing recorded' using errcode = 'P0002';
  end if;
  return current_count <= lim.max_calls;
end;
$$;

-- The JWT-authed edge functions call this as the user: the counter is keyed
-- on the caller's own auth.uid(), never on a client-supplied id.
create function public.bump_rate_limit(p_action text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.bump_rate_limit_for_user((select auth.uid()), p_action);
$$;

revoke execute on function public.rate_limit_for(text) from public, anon, authenticated;
revoke execute on function public.bump_rate_limit_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_rate_limit_for_user(uuid, text) to service_role;
revoke execute on function public.bump_rate_limit(text) from public, anon;
grant execute on function public.bump_rate_limit(text) to authenticated;

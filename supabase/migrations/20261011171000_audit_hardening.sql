-- Audit hardening (2026-10-11):
--   1. tags become per-user; tags / bookmark_tags RLS scoped to the owner
--      (was: any authenticated user could read/edit every tag and link, and
--      through the security-definer bump trigger, touch anyone's updated_at).
--   2. Every policy uses (select auth.uid()) — evaluated once per statement,
--      not once per row.
--   3. rate_limits + bump_rate_limit(): per-user fixed-window limits for the
--      edge functions (DeepL quota, capture/import abuse).
--   4. Storage: bucket MIME allow-lists; list_orphaned_storage_objects() for
--      the storage-sweep edge function.

-- ─── 1. Per-user tags ──────────────────────────────────────────────────────

alter table tags add column user_id uuid references auth.users(id) on delete cascade;

-- Names were globally unique; they become unique per user.
alter table tags drop constraint tags_name_key;

-- Owner of an existing tag: the user owning most of the bookmarks it's
-- attached to (ties → lowest user id, just to be deterministic).
with link_users as (
  select bt.tag_id, b.user_id, count(*) as links
  from bookmark_tags bt
  join bookmarks b on b.id = bt.bookmark_id
  group by bt.tag_id, b.user_id
),
ranked as (
  select tag_id, user_id,
         row_number() over (partition by tag_id order by links desc, user_id) as rn
  from link_users
)
update tags t
set user_id = r.user_id
from ranked r
where r.tag_id = t.id and r.rn = 1;

-- A tag that other users had also attached to their own bookmarks: give
-- each of them their own copy (same name and color)…
insert into tags (name, color, user_id)
select distinct t.name, t.color, b.user_id
from tags t
join bookmark_tags bt on bt.tag_id = t.id
join bookmarks b on b.id = bt.bookmark_id
where b.user_id <> t.user_id;

-- …and repoint their links at it. bookmark_tags_touch_bookmark only fires
-- on insert/delete, so bump those bookmarks explicitly for delta sync.
with moved as (
  update bookmark_tags bt
  set tag_id = c.id
  from tags old, bookmarks b, tags c
  where old.id = bt.tag_id
    and b.id = bt.bookmark_id
    and b.user_id <> old.user_id
    and c.user_id = b.user_id
    and c.name = old.name
    and c.id <> old.id
  returning bt.bookmark_id
)
update bookmarks set updated_at = now()
where id in (select bookmark_id from moved);

-- Tags attached to nothing: keep them only when ownership is unambiguous
-- (a single-account install), otherwise drop them.
update tags
set user_id = (select id from auth.users)
where user_id is null
  and (select count(*) from auth.users) = 1;

delete from tags where user_id is null;

alter table tags
  alter column user_id set not null,
  alter column user_id set default auth.uid();

-- Leading user_id column also serves the RLS filter.
alter table tags add constraint tags_user_id_name_key unique (user_id, name);

drop policy "authenticated only" on tags;
create policy "owner access" on tags
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A link is visible/writable only when both ends belong to the caller:
-- owning the bookmark alone must not let you attach someone else's tag id.
drop policy "authenticated only" on bookmark_tags;
create policy "owner access" on bookmark_tags
  for all to authenticated
  using (
    exists (select 1 from bookmarks b
            where b.id = bookmark_id and b.user_id = (select auth.uid()))
    and exists (select 1 from tags t
                where t.id = tag_id and t.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from bookmarks b
            where b.id = bookmark_id and b.user_id = (select auth.uid()))
    and exists (select 1 from tags t
                where t.id = tag_id and t.user_id = (select auth.uid()))
  );

comment on function bookmark_tags_touch_bookmark() is
  'security definer: bumps bookmarks.updated_at for the bookmark of an inserted/deleted '
  'bookmark_tags row. Only reachable for the caller''s own bookmarks since bookmark_tags '
  'RLS is owner-scoped (20261011171000).';

-- ─── 2. Policies on (select auth.uid()) ────────────────────────────────────

drop policy "owner access" on bookmarks;
create policy "owner access" on bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy "owner read" on bookmark_deletions;
create policy "owner read" on bookmark_deletions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy "owner read own pdfs" on storage.objects;
drop policy "owner write own pdfs" on storage.objects;
drop policy "owner delete own pdfs" on storage.objects;

create policy "owner read own pdfs" on storage.objects
  for select to authenticated
  using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner write own pdfs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner delete own pdfs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─── 3. Rate limiting ──────────────────────────────────────────────────────

-- One fixed window per (user, action). No policies and no grants to
-- anon/authenticated: only the security-definer functions below touch it.
create table rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  count        int not null,
  primary key (user_id, action)
);

alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

-- Counts one call of p_action for p_user_id and returns whether it is within
-- p_max calls per p_window. A single upsert: concurrent calls serialize on
-- the row, so two requests can't both see the last free slot. Refused calls
-- keep counting (capped at p_max + 1) — retrying while limited doesn't help.
create function bump_rate_limit_for_user(
  p_user_id uuid, p_action text, p_max int, p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count int;
begin
  if p_user_id is null then
    raise exception 'bump_rate_limit: no user' using errcode = '42501';
  end if;
  if p_max < 1 or p_window <= interval '0' then
    raise exception 'bump_rate_limit: invalid limit' using errcode = '22023';
  end if;

  insert into public.rate_limits as r (user_id, action, window_start, count)
  values (p_user_id, p_action, now(), 1)
  on conflict (user_id, action) do update
    set window_start = case when r.window_start <= now() - p_window
                            then now() else r.window_start end,
        count        = case when r.window_start <= now() - p_window
                            then 1 else least(r.count + 1, p_max + 1) end
  returning r.count into current_count;

  if current_count is null then
    raise exception 'bump_rate_limit: nothing recorded' using errcode = 'P0002';
  end if;
  return current_count <= p_max;
end;
$$;

-- The JWT-authed edge functions call this as the user: the counter is keyed
-- on the caller's own auth.uid(), never on a client-supplied id.
create function bump_rate_limit(p_action text, p_max int, p_window interval)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.bump_rate_limit_for_user((select auth.uid()), p_action, p_max, p_window);
$$;

revoke execute on function bump_rate_limit_for_user(uuid, text, int, interval) from public, anon, authenticated;
grant execute on function bump_rate_limit_for_user(uuid, text, int, interval) to service_role;
revoke execute on function bump_rate_limit(text, int, interval) from public, anon;
grant execute on function bump_rate_limit(text, int, interval) to authenticated;

-- ─── 4. Storage ────────────────────────────────────────────────────────────

update storage.buckets
set allowed_mime_types = array['application/pdf']
where id = 'bookmark-pdfs';

-- YouTube thumbnails (worker/src/storage.ts uploads with the response's
-- content-type, falling back to image/jpeg).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
where id = 'bookmark-assets';

-- Objects no bookmark references, for the storage-sweep edge function to
-- remove through the Storage API (Supabase blocks direct deletes from
-- storage.objects). Path formats:
--   bookmark-pdfs   name = '{user_id}/{uuid}.pdf' = bookmarks.pdf_path
--   bookmark-assets name = 'youtube/{uuid}.{ext}'; bookmarks.thumbnail_url
--                   holds the public URL '…/storage/v1/object/public/bookmark-assets/{name}'
--                   (the youtube content_md embeds the same URL; checked
--                   too, so a row whose thumbnail_url was cleared but whose
--                   markdown still shows the image keeps it).
-- p_min_age skips fresh objects, so an upload whose bookmark insert is still
-- in flight (pdf-import uploads, then inserts) is never swept.
create function list_orphaned_storage_objects(
  p_min_age interval default interval '1 day',
  p_limit int default 1000
)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.created_at < now() - p_min_age
    and (
      (o.bucket_id = 'bookmark-pdfs'
        and not exists (select 1 from public.bookmarks b where b.pdf_path = o.name))
      or
      (o.bucket_id = 'bookmark-assets'
        and not exists (
          select 1 from public.bookmarks b
          where right(split_part(b.thumbnail_url, '?', 1), length(o.name) + 17)
                  = '/bookmark-assets/' || o.name
             or (b.type = 'youtube'
                 and strpos(b.content_md, '/bookmark-assets/' || o.name) > 0)
        ))
    )
  order by o.created_at
  limit p_limit;
$$;

revoke execute on function list_orphaned_storage_objects(interval, int) from public, anon, authenticated;
grant execute on function list_orphaned_storage_objects(interval, int) to service_role;

-- Scheduling (not done here: pg_cron/pg_net aren't enabled in this project,
-- and the URL and key are per-environment). Once both extensions are
-- enabled and the service-role key is stored in Vault as
-- 'service_role_key':
--
--   select cron.schedule('storage-sweep', '17 3 * * *', $cron$
--     select net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/storage-sweep',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                        where name = 'service_role_key'),
--         'Content-Type', 'application/json'),
--       body    := '{}'::jsonb);
--   $cron$);

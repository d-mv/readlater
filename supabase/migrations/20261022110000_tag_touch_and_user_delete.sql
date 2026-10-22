-- 1. Delta sync sees every tag change.
--
-- Bookmarks embed their tags (name, colour), and other devices learn about
-- changes through bookmarks.updated_at. Attaching and detaching already bump
-- it; renaming or recolouring a tag, or re-pointing a bookmark_tags row, did
-- not — e.g. an import that recolours an existing tag left every other
-- device showing the old colour.

-- bookmark_tags: updates too, bumping both the old and the new bookmark.
create or replace function bookmark_tags_touch_bookmark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookmarks set updated_at = now()
    where id in (new.bookmark_id, old.bookmark_id);
  return null;
end;
$$;

drop trigger bookmark_tags_touch_bookmark on bookmark_tags;
create trigger bookmark_tags_touch_bookmark
  after insert or update or delete on bookmark_tags
  for each row execute function bookmark_tags_touch_bookmark();

-- tags: a changed name or colour bumps the bookmarks carrying the tag.
-- security definer for the same reason as bookmark_tags_touch_bookmark: the
-- caller passed the tags RLS check; the bump touches only bookmarks linked
-- to this exact tag (tags and links are owner-only, so they are the
-- caller's).
create function tags_touch_bookmarks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookmarks set updated_at = now()
    where id in (select bookmark_id from bookmark_tags where tag_id = new.id);
  return null;
end;
$$;

create trigger tags_touch_bookmarks
  after update of name, color on tags
  for each row
  when (old.name is distinct from new.name or old.color is distinct from new.color)
  execute function tags_touch_bookmarks();

revoke execute on function tags_touch_bookmarks() from public, anon, authenticated;

-- 2. Deleting an auth user takes their bookmarks along.
--
-- bookmarks.user_id had no ON DELETE action (tags, tombstones and rate limits
-- all cascade), so removing a user from the dashboard failed with
-- bookmarks_user_id_fkey until their bookmarks were purged by hand.
alter table bookmarks drop constraint bookmarks_user_id_fkey;
alter table bookmarks
  add constraint bookmarks_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Those cascaded deletes would record tombstones for a user who no longer
-- exists (and whose tombstones the same delete removes). Nobody is left to
-- sync them, so skip them.
create or replace function bookmarks_record_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null;
  end if;
  insert into bookmark_deletions (bookmark_id, user_id)
    values (old.id, old.user_id)
    on conflict (bookmark_id) do update set deleted_at = excluded.deleted_at;
  return null;
end;
$$;

-- Replaces the dead `tags text[]` column (never read or written anywhere in
-- the app) with a relational many-to-many model. See docs/plans/read-later-new-capabilities.md §2.
alter table bookmarks drop column tags;

create table tags (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null,
  color text default '#888888'
);

create table bookmark_tags (
  bookmark_id uuid not null references bookmarks(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  primary key (bookmark_id, tag_id)
);

-- The composite PK indexes (bookmark_id, tag_id), which only helps
-- bookmark_id-first lookups. Tag-filter queries go the other direction
-- ("find all bookmarks with tag X"), so index tag_id separately.
create index bookmark_tags_tag_idx on bookmark_tags (tag_id);

-- Single-owner app: no per-row ownership to scope these to, but RLS must
-- still be turned on and gated to authenticated — otherwise the anon
-- (publishable) key, which is intentionally public/embedded in client JS,
-- gets full read/write on both tables.
alter table tags enable row level security;
alter table bookmark_tags enable row level security;

create policy "authenticated only" on tags
  for all using (auth.role() = 'authenticated');

create policy "authenticated only" on bookmark_tags
  for all using (auth.role() = 'authenticated');

-- RLS gates rows, not API exposure. This project's config.toml notes new
-- tables are NOT auto-exposed to PostgREST roles by default (the legacy
-- `auto_expose_new_tables` behaviour is off) — without an explicit grant
-- here, these tables would be invisible to the Data API even with RLS
-- policies in place, and every query would silently return nothing.
grant select, insert, update, delete on tags, bookmark_tags to authenticated;

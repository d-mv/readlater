create table bookmarks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  url           text not null,
  type          text not null check (type in ('article', 'youtube')),
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'ready', 'failed')),
  title         text,
  author        text,
  excerpt       text,
  content_md    text,
  thumbnail_url text,
  word_count    int,
  reading_time  int,
  tags          text[] default '{}',
  archived      boolean not null default false,
  read_at       timestamptz,
  error_message text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index bookmarks_status_idx on bookmarks (status) where status = 'pending';
create index bookmarks_user_created_idx on bookmarks (user_id, created_at desc);

alter table bookmarks enable row level security;

create policy "owner access" on bookmarks
  for all using (auth.uid() = user_id);

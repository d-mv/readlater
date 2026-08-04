-- PDFs: uploaded originals are parsed to Markdown when possible. The
-- original stays in Storage so it can be opened natively or trashed once the
-- Markdown extraction is trusted.
alter table bookmarks drop constraint bookmarks_type_check;
alter table bookmarks add constraint bookmarks_type_check
  check (type in ('article', 'youtube', 'note', 'pdf'));

-- PDFs have no source URL (they're uploaded files), same as notes.
alter table bookmarks drop constraint bookmarks_url_required_unless_note;
alter table bookmarks add constraint bookmarks_url_required_unless_note
  check (type in ('note', 'pdf') or url is not null);

-- Path of the original file in the bookmark-pdfs bucket. Cleared once the
-- user trashes the original (only offered when pdf_parsed = true, since
-- that's the only case where content_md stands on its own).
alter table bookmarks add column pdf_path text;
-- Whether formatted-text extraction produced usable content. False means
-- content_md is empty and the reader can only show the original PDF.
alter table bookmarks add column pdf_parsed boolean not null default false;
-- Persisted per-bookmark reader toggle between the extracted Markdown and
-- the original PDF. Null defers to the default (markdown when parsed, else
-- original).
alter table bookmarks add column view_mode text check (view_mode in ('markdown', 'original'));

alter table bookmarks add constraint bookmarks_pdf_path_requires_type
  check (pdf_path is null or type = 'pdf');

-- Private bucket: unlike bookmark-assets (public YouTube thumbnails), PDFs
-- are user content, so this is never public — access goes through
-- short-lived signed URLs generated for the owning user.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bookmark-pdfs', 'bookmark-pdfs', false, 20971520)
on conflict (id) do nothing;

-- Objects live at `{user_id}/{uuid}.pdf`, so ownership is checked from the
-- path itself with no join back to bookmarks.
create policy "owner read own pdfs" on storage.objects
  for select using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner write own pdfs" on storage.objects
  for insert with check (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner delete own pdfs" on storage.objects
  for delete using (bucket_id = 'bookmark-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

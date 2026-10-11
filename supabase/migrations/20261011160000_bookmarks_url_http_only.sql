-- Saved URLs are rendered into href attributes ("Open original"), so only
-- http(s) may be stored: a javascript: or data: URL would run script on the
-- app origin when clicked. The app and the capture edge function check this
-- too; the constraint covers every other writer (direct PostgREST inserts).
--
-- NOT VALID: enforced for every insert and update from now on without failing
-- the migration on rows saved before the check existed. The app also refuses
-- to render a non-http(s) URL as a link, so such rows are inert.
alter table bookmarks
  add constraint bookmarks_url_http_only
  check (url is null or url ~* '^https?://')
  not valid;

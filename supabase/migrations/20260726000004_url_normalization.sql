-- Normalized-URL uniqueness enforced at the DB level so the capture
-- endpoint's duplicate check (find-then-insert) can't race itself into two
-- rows for the same URL. See docs/plans/read-later-new-capabilities.md §5.
alter table bookmarks
  add column url_normalized text
  generated always as (
    lower(regexp_replace(url, '/+$', ''))
  ) stored;

create unique index bookmarks_url_normalized_uniq on bookmarks (url_normalized);

-- Add 'note' as a bookmark type: free-text captures that skip the worker
-- entirely and land directly at status='ready'. See docs/plans/read-later-new-capabilities.md §4.
alter table bookmarks drop constraint bookmarks_type_check;
alter table bookmarks add constraint bookmarks_type_check
  check (type in ('article', 'youtube', 'note'));

-- Notes have no source URL. The original schema had `url` as `not null`
-- (fine when every row was a fetched article/video); notes need it nullable,
-- with everything else still required to carry one.
alter table bookmarks alter column url drop not null;
alter table bookmarks add constraint bookmarks_url_required_unless_note
  check (type = 'note' or url is not null);

-- Add reading progress tracking per bookmark (value between 0.0 and 1.0)
alter table bookmarks add column progress double precision default 0;

-- Full-text search via a generated tsvector column, title weighted above
-- body. See docs/plans/read-later-new-capabilities.md §1.
alter table bookmarks
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
  ) stored;

create index bookmarks_search_idx on bookmarks using gin(search_vector);

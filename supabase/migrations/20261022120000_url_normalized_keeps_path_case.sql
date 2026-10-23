-- Duplicate detection: lowercase only the scheme and host.
--
-- url_normalized lowercased the whole URL, so URLs whose paths or queries
-- differ only in case — short links (bit.ly/AbC vs bit.ly/abc), YouTube ids,
-- case-sensitive servers — counted as the same bookmark and the second could
-- not be saved. Scheme and host are case-insensitive by definition; the rest
-- is not. Trailing slashes are still stripped.
--
-- The app (app/src/utils/normalizeUrl.ts) and the capture function
-- (supabase/functions/capture/captureLogic.ts) compute the same value.
--
-- The new value is finer than the old one, so existing rows can't start to
-- collide; the unique index is rebuilt along with the column.

drop index bookmarks_user_url_normalized_uniq;
alter table bookmarks drop column url_normalized;

alter table bookmarks
  add column url_normalized text generated always as (
    regexp_replace(
      lower(coalesce(substring(url from '^[^/?#]*//[^/?#]*'), ''))
        || substr(url, length(coalesce(substring(url from '^[^/?#]*//[^/?#]*'), '')) + 1),
      '/+$', ''
    )
  ) stored;

create unique index bookmarks_user_url_normalized_uniq on bookmarks (user_id, url_normalized);

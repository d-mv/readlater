-- URL uniqueness becomes per user. bookmarks_url_normalized_uniq was global
-- (the single-owner assumption): a second user couldn't save a URL anyone
-- else had saved, and the 23505 duplicate lookup could match another user's
-- row. Same semantics otherwise: not partial, and url_normalized is null for
-- URL-less rows (notes, PDFs), which never collide (nulls are distinct).
--
-- Every existing row satisfied the global index, so it satisfies this one.
-- (user_id, url_normalized) also serves the owner-scoped duplicate lookups
-- (app findByNormalizedUrl, capture's service-role lookup).

drop index bookmarks_url_normalized_uniq;
create unique index bookmarks_user_url_normalized_uniq on bookmarks (user_id, url_normalized);

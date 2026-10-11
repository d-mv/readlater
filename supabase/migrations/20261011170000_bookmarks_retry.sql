-- Worker retries: a bookmark that fails for a transient reason (open circuit
-- breaker, 429, 5xx, network error, timeout) goes back to 'pending' with a
-- backoff instead of failing for good. The worker gives up after 4 attempts.

alter table bookmarks
  add column attempts        int not null default 0,
  add column next_attempt_at timestamptz; -- null = due now

-- The worker's queue poll: status = 'pending' and (next_attempt_at is null or
-- next_attempt_at <= now()). Replaces the status-only partial index.
drop index if exists bookmarks_status_idx;
create index bookmarks_pending_due_idx on bookmarks (next_attempt_at nulls first)
  where status = 'pending';

-- A user-initiated re-queue (refresh / "Try again" in the app, the capture
-- endpoint's refresh) starts the retry budget over. Those writes only set
-- status (+ error_message/content_edited); the worker's own re-queues always
-- set attempts (transient retry) or next_attempt_at (shutdown hand-back), so
-- an update to 'pending' that touches neither is the user's. (That includes
-- refreshing a row still waiting out a backoff: it becomes due immediately.)
create function bookmarks_reset_retry()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'pending'
     and new.attempts = old.attempts
     and new.next_attempt_at is not distinct from old.next_attempt_at then
    new.attempts := 0;
    new.next_attempt_at := null;
  end if;
  return new;
end;
$$;

create trigger bookmarks_reset_retry
  before update of status on bookmarks
  for each row execute function bookmarks_reset_retry();

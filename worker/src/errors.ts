import { CircuitBreakerOpenError } from "./circuitBreaker";

/** A non-2xx HTTP response. 429 and 5xx are worth retrying; other 4xx aren't. */
export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    statusText = "",
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "HttpStatusError";
  }
}

/** The URL serves something other than HTML (a PDF, an image, a zip…). */
export class UnsupportedContentTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported content type: ${contentType} (only HTML pages can be saved as articles)`);
    this.name = "UnsupportedContentTypeError";
  }
}

/** Readability ran past its time limit on this page and was stopped. Not
 * transient: the same page would stall the same way on every retry. */
export class ExtractionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Article extraction took longer than ${Math.round(timeoutMs / 1000)} s`);
    this.name = "ExtractionTimeoutError";
  }
}

/** A database write the worker needed failed. `code` is the Postgres
 * SQLSTATE (or PostgREST code); empty when the request never got an answer. */
export class DatabaseWriteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(`Database update failed: ${message}`);
    this.name = "DatabaseWriteError";
  }
}

// SQLSTATE classes that say "try again": connection exceptions (08),
// transaction rollbacks such as deadlocks (40), insufficient resources (53)
// and operator intervention such as statement timeouts (57).
const TRANSIENT_SQLSTATE_CLASSES = new Set(["08", "40", "53", "57"]);

function isTransientDatabaseError(err: DatabaseWriteError): boolean {
  return err.code === "" || TRANSIENT_SQLSTATE_CLASSES.has(err.code.slice(0, 2));
}

/** The server compressed the body with something readBodyCapped can't decode. */
export class UnsupportedContentEncodingError extends Error {
  constructor(encoding: string) {
    super(`Unsupported content encoding: ${encoding}`);
    this.name = "UnsupportedContentEncodingError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    this.name = "ResponseTooLargeError";
  }
}

/** The headless browser itself is unusable (failed to launch, crashed or
 * disconnected) — as opposed to a page that failed to load. */
export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

// Connection-level failures from Bun's fetch, node:net and node:dns. ENOTFOUND
// is left out on purpose: a domain that doesn't exist won't start existing.
const NETWORK_ERROR_CODES = new Set([
  "ConnectionRefused",
  "ConnectionClosed",
  "FailedToOpenSocket",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code);
}

/** Errors that say "the dependency is unhealthy", for circuit breakers: 5xx,
 * timeouts, connection failures and a dead browser. A 4xx is the service
 * answering correctly about a bad request, so it doesn't count. */
export function isBreakerFailure(err: unknown): boolean {
  if (err instanceof HttpStatusError) return err.status >= 500;
  return err instanceof BrowserUnavailableError || isTimeout(err) || isNetworkError(err);
}

/** Errors worth retrying the bookmark for later: everything that counts as a
 * breaker failure, plus an open breaker and 429 rate limiting. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof CircuitBreakerOpenError) return true;
  if (err instanceof DatabaseWriteError) return isTransientDatabaseError(err);
  if (err instanceof HttpStatusError && err.status === 429) return true;
  return isBreakerFailure(err);
}

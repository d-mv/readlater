import type { BrowserContext, Request, Route, WebSocketRoute } from "@playwright/test";

import type { Bookmark, Tag } from "../src/lib/supabase";
import { normalizeUrl } from "../src/utils/normalizeUrl";
import { SUPABASE_HOST, SUPABASE_URL } from "./supabaseEnv";

/**
 * An in-memory stand-in for the Supabase project the app talks to — Auth,
 * PostgREST, Storage, Edge Functions and Realtime — served through
 * Playwright's request/WebSocket routing. It runs in the test process, so a
 * spec seeds rows before navigating and asserts on what the app wrote
 * afterwards (`backend.bookmark(id)`, `backend.calls`).
 *
 * It implements only the subset of each protocol the app uses (see
 * app/src/stores/*.ts). Anything else is answered with a 501 and recorded in
 * `unhandled`, which the `backend` fixture asserts is empty after each test —
 * so a new query shape in the app fails loudly here instead of silently
 * returning nothing.
 */

export const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "reader@example.com",
  password: "correct horse battery staple",
};

export type ServerBookmark = Omit<Bookmark, "tags" | "progress"> & {
  user_id: string;
  url_normalized: string | null;
  progress: number;
};

interface ServerTag extends Tag {
  user_id: string;
}

interface BookmarkTag {
  bookmark_id: string;
  tag_id: string;
}

interface Deletion {
  bookmark_id: string;
  deleted_at: string;
}

export type BookmarkSeed = Partial<ServerBookmark> & {
  // Tag names; created on first use.
  tags?: string[];
};

/** What one intercepted call looked like — for assertions and failure matching. */
export interface BackendCall {
  service: "auth" | "rest" | "rpc" | "functions" | "storage";
  method: string;
  // Table, RPC/function name, auth grant/endpoint, or storage bucket.
  name: string;
  params: URLSearchParams;
  body: unknown;
}

interface Failure {
  match: (call: BackendCall) => boolean;
  status: number;
  body: unknown;
  remaining: number;
}

export type RealtimeMode = "respond" | "ignore" | "close";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD",
  "access-control-expose-headers": "*",
};

const TAG_COLORS = ["#c0392b", "#2c7a7b", "#6b46c1", "#b7791f", "#2b6cb0"];

// A tiny but valid single-page PDF, served for signed PDF URLs.
const PDF_BYTES = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

// 1×1 transparent PNG.
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An unsigned JWT — supabase-js and realtime-js only decode the payload. */
export function fakeJwt(expiresAt: number): string {
  return [
    base64url({ alg: "HS256", typ: "JWT" }),
    base64url({
      sub: USER.id,
      email: USER.email,
      role: "authenticated",
      aud: "authenticated",
      exp: expiresAt,
    }),
    "e2e-signature",
  ].join(".");
}

export function makeSession(options: { expired?: boolean; refreshToken?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = options.expired ? now - 3600 : now + 60 * 60 * 24;
  return {
    access_token: fakeJwt(expiresAt),
    refresh_token: options.refreshToken ?? "e2e-refresh-token",
    token_type: "bearer",
    expires_in: expiresAt - now,
    expires_at: expiresAt,
    user: {
      id: USER.id,
      aud: "authenticated",
      role: "authenticated",
      email: USER.email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of input) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

function compareValues(column: string, actual: unknown, raw: string): number | null {
  if (actual === null || actual === undefined) return null;
  if (typeof actual === "number") return actual - Number(raw);
  if (typeof actual === "boolean") return actual === (raw === "true") ? 0 : 1;
  const text = String(actual);
  if (column.endsWith("_at")) return micros(text) - micros(raw);
  return text < raw ? -1 : text > raw ? 1 : 0;
}

// A timestamp in microseconds, like Postgres keeps it: Date.parse drops
// everything past the millisecond, and PostgREST sends six fraction digits.
function micros(text: string): number {
  const fraction = /\.(\d+)/.exec(text)?.[1] ?? "";
  const whole = Date.parse(text.replace(/\.\d+/, ""));
  return whole * 1000 + Number(fraction.padEnd(6, "0").slice(0, 6));
}

function textMatches(row: Row, query: string): boolean {
  const haystack = [row.title, row.excerpt, row.content_md]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term.replace(/^"|"$/g, "")));
}

// `column.operator.value` from a query param or a logic-tree item.
function condition(column: string, expression: string): Predicate {
  const dot = expression.indexOf(".");
  const op = expression.slice(0, dot);
  const raw = unquote(expression.slice(dot + 1));
  switch (op) {
    case "eq":
      return (row) => {
        if (raw === "null") return row[column] === null;
        return compareValues(column, row[column], raw) === 0;
      };
    case "neq":
      return (row) => compareValues(column, row[column], raw) !== 0;
    case "gt":
      return (row) => (compareValues(column, row[column], raw) ?? -1) > 0;
    case "gte":
      return (row) => (compareValues(column, row[column], raw) ?? -1) >= 0;
    case "lt":
      return (row) => (compareValues(column, row[column], raw) ?? 1) < 0;
    case "lte":
      return (row) => (compareValues(column, row[column], raw) ?? 1) <= 0;
    case "is":
      return (row) => String(row[column]) === raw;
    case "in": {
      // `in.(a,"b,c")`: a parenthesised list; quoted items may hold commas.
      const items = (raw.slice(1, -1).match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []).map(unquote);
      return (row) => items.some((item) => compareValues(column, row[column], item) === 0);
    }
    case "fts":
    case "plfts":
    case "phfts":
    case "wfts":
      return (row) => textMatches(row, raw);
    default:
      throw new Error(`unsupported operator ${op}`);
  }
}

// PostgREST's logic tree, e.g. `(a.lt."x",and(a.eq."x",b.lt."y"))`.
function logicTree(kind: "and" | "or", body: string): Predicate {
  const inner = body.replace(/^\(/, "").replace(/\)$/, "");
  const predicates = splitTopLevel(inner).map((item): Predicate => {
    const nested = /^(and|or)\((.*)\)$/s.exec(item);
    if (nested) return logicTree(nested[1] as "and" | "or", `(${nested[2]})`);
    const dot = item.indexOf(".");
    return condition(item.slice(0, dot), item.slice(dot + 1));
  });
  return kind === "and"
    ? (row) => predicates.every((p) => p(row))
    : (row) => predicates.some((p) => p(row));
}

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

// The tables' columns as the migrations define them. Real PostgREST refuses a
// request naming any other column, so a typo in the app's select, filter,
// order or write body must fail here too instead of reading back null.
const TABLE_COLUMNS: Record<string, ReadonlySet<string>> = {
  bookmarks: new Set([
    "id",
    "user_id",
    "url",
    "url_normalized",
    "type",
    "status",
    "title",
    "author",
    "excerpt",
    "content_md",
    "translated_content_md",
    "translated_lang",
    "thumbnail_url",
    "youtube_video_id",
    "content_edited",
    "word_count",
    "reading_time",
    "is_public",
    "pdf_path",
    "pdf_parsed",
    "view_mode",
    "progress",
    "search_vector",
    "archived",
    "read_at",
    "error_message",
    "created_at",
    "processed_at",
    "updated_at",
    "attempts",
    "next_attempt_at",
  ]),
  tags: new Set(["id", "user_id", "name", "color"]),
  bookmark_tags: new Set(["bookmark_id", "tag_id"]),
  bookmark_deletions: new Set(["bookmark_id", "user_id", "deleted_at"]),
};
// Generated columns: Postgres refuses a value for them.
const GENERATED_COLUMNS = new Set(["url_normalized", "search_vector"]);
// Embeddable relations, by table.
const EMBEDS: Record<string, Record<string, string>> = { bookmarks: { tags: "tags" } };

type RestError = { status: number; body: unknown };

function restError(status: number, code: string, message: string): RestError {
  return { status, body: { code, message, details: null, hint: null } };
}

function filterColumns(params: URLSearchParams): string[] {
  const columns: string[] = [];
  const fromTree = (body: string) => {
    for (const item of splitTopLevel(body.replace(/^\(/, "").replace(/\)$/, ""))) {
      const nested = /^(and|or)\((.*)\)$/s.exec(item);
      if (nested) fromTree(`(${nested[2]})`);
      else columns.push(item.slice(0, item.indexOf(".")));
    }
  };
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === "or" || key === "and") fromTree(value);
    else columns.push(key);
  }
  return columns;
}

function unknownColumn(table: string, columns: Iterable<string>): string | null {
  const known = TABLE_COLUMNS[table]!;
  for (const column of columns) if (!known.has(column)) return column;
  return null;
}

/** The 400 PostgREST answers for a column the table doesn't have. */
function schemaError(table: string, params: URLSearchParams, body: unknown): RestError | null {
  const select = parseSelect(params.get("select"));
  const check = (t: string, selection: Selection): RestError | null => {
    const bad = unknownColumn(t, selection.columns);
    if (bad) return restError(400, "42703", `column ${t}.${bad} does not exist`);
    for (const [name, inner] of selection.embeds) {
      const target = EMBEDS[t]?.[name];
      if (!target) {
        return restError(
          400,
          "PGRST200",
          `Could not find a relationship between '${t}' and '${name}'`,
        );
      }
      const nested = check(target, inner);
      if (nested) return nested;
    }
    return null;
  };
  const selectError = check(table, select);
  if (selectError) return selectError;

  const order = (params.get("order") ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split(".")[0]!);
  const badRead = unknownColumn(table, [...filterColumns(params), ...order]);
  if (badRead) return restError(400, "42703", `column ${table}.${badRead} does not exist`);

  for (const item of (Array.isArray(body) ? body : body ? [body] : []) as Row[]) {
    const badWrite = unknownColumn(table, Object.keys(item));
    if (badWrite) {
      return restError(
        400,
        "PGRST204",
        `Could not find the '${badWrite}' column of '${table}' in the schema cache`,
      );
    }
    const generated = Object.keys(item).find((key) => GENERATED_COLUMNS.has(key));
    if (generated) {
      return restError(
        400,
        "428C9",
        `cannot insert a non-DEFAULT value into column "${generated}"`,
      );
    }
  }
  return null;
}

/** The NOT NULL and CHECK constraints a new bookmark row must meet. */
function bookmarkConstraintError(item: Row, row: ServerBookmark): RestError | null {
  if (item.type === undefined || item.type === null) {
    return restError(400, "23502", 'null value in column "type" violates not-null constraint');
  }
  if (item.user_id === undefined || item.user_id === null) {
    return restError(400, "23502", 'null value in column "user_id" violates not-null constraint');
  }
  const violated = (name: string) =>
    restError(400, "23514", `new row for relation "bookmarks" violates check constraint "${name}"`);
  if (!["article", "youtube", "note", "pdf"].includes(row.type))
    return violated("bookmarks_type_check");
  if (!["pending", "processing", "ready", "failed"].includes(row.status)) {
    return violated("bookmarks_status_check");
  }
  if (row.view_mode !== null && !["markdown", "original"].includes(row.view_mode)) {
    return violated("bookmarks_view_mode_check");
  }
  if (row.url !== null && !/^https?:\/\//i.test(row.url))
    return violated("bookmarks_url_http_only");
  if (row.url === null && row.type !== "note" && row.type !== "pdf") {
    return violated("bookmarks_url_required_unless_note");
  }
  if (row.pdf_path !== null && row.type !== "pdf")
    return violated("bookmarks_pdf_path_requires_type");
  return null;
}

function filtersFrom(params: URLSearchParams): Predicate[] {
  const predicates: Predicate[] = [];
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === "or" || key === "and") predicates.push(logicTree(key, value));
    else predicates.push(condition(key, value));
  }
  return predicates;
}

function ordered(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column: column!, desc: direction === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const av = a[column];
      const bv = b[column];
      let cmp = 0;
      if (column.endsWith("_at")) cmp = micros(String(av)) - micros(String(bv));
      else cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

interface Selection {
  star: boolean;
  columns: string[];
  embeds: Map<string, Selection>;
}

function parseSelect(select: string | null): Selection {
  const selection: Selection = { star: !select, columns: [], embeds: new Map() };
  if (!select) return selection;
  for (const item of splitTopLevel(select.replace(/\s+/g, ""))) {
    const embed = /^(\w+)\((.*)\)$/.exec(item);
    if (embed) selection.embeds.set(embed[1]!, parseSelect(embed[2]!));
    else if (item === "*") selection.star = true;
    else selection.columns.push(item);
  }
  return selection;
}

function project(row: Row, selection: Selection): Row {
  if (selection.star) return { ...row };
  return Object.fromEntries(selection.columns.map((c) => [c, row[c] ?? null]));
}

export class FakeBackend {
  bookmarks: ServerBookmark[] = [];
  tags: ServerTag[] = [];
  bookmarkTags: BookmarkTag[] = [];
  deletions: Deletion[] = [];
  /** Storage objects by `bucket/path`. */
  storage = new Map<string, { body: Buffer; contentType: string }>();
  /** Responses for hosts other than the app and Supabase (article images, YouTube…), by URL. */
  external = new Map<string, { body: Buffer; contentType: string; status?: number }>();

  /** Every call the app made, in order. */
  calls: BackendCall[] = [];
  /** Calls the fake doesn't implement (answered 501). */
  unhandled: string[] = [];

  realtimeMode: RealtimeMode = "respond";
  /** Joined Realtime channels: topic → server binding ids. */
  private channels = new Map<string, { socket: WebSocketRoute; ids: number[] }>();

  /** Refresh tokens the auth endpoint refuses (the session is over). */
  revokedRefreshTokens = new Set<string>();
  /** Every PostgREST call answers 401 while set (expired/revoked JWT). */
  rejectJwt = false;
  /**
   * While set, every Supabase and external request fails at the network
   * level. `context.setOffline(true)` alone doesn't do that: routed requests
   * are still answered by the handlers here.
   */
  offline = false;

  private failures: Failure[] = [];
  // Seeded rows go back in time from here; writes go forward from `clock`, so
  // anything the app creates sorts newest.
  private seedCount = 0;
  private clock = Date.parse("2026-06-01T12:00:00.000Z");

  now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  // ---- seeding & inspection ---------------------------------------------

  addBookmark(seed: BookmarkSeed = {}): ServerBookmark {
    const { tags: tagNames = [], ...fields } = seed;
    const createdAt =
      fields.created_at ??
      new Date(Date.parse("2026-05-01T12:00:00.000Z") - this.seedCount * 60_000).toISOString();
    this.seedCount += 1;
    const row = this.newBookmarkRow({
      title: `Article ${this.seedCount}`,
      url: `https://example.com/article-${this.seedCount}`,
      status: "ready",
      content_md: `Body of article ${this.seedCount}.`,
      word_count: 200,
      reading_time: 1,
      processed_at: createdAt,
      ...fields,
      created_at: createdAt,
      updated_at: fields.updated_at ?? createdAt,
    });
    this.bookmarks.push(row);
    for (const name of tagNames) {
      const tag = this.upsertTag(name);
      this.bookmarkTags.push({ bookmark_id: row.id, tag_id: tag.id });
    }
    return row;
  }

  addBookmarks(
    count: number,
    seed: (index: number) => BookmarkSeed = () => ({}),
  ): ServerBookmark[] {
    return Array.from({ length: count }, (_, index) => this.addBookmark(seed(index)));
  }

  bookmark(id: string): ServerBookmark | undefined {
    return this.bookmarks.find((b) => b.id === id);
  }

  tagNamesOf(bookmarkId: string): string[] {
    return this.bookmarkTags
      .filter((bt) => bt.bookmark_id === bookmarkId)
      .map((bt) => this.tags.find((t) => t.id === bt.tag_id)?.name ?? "?");
  }

  /** Calls matching a service (and optionally a name/method). */
  callsTo(service: BackendCall["service"], name?: string, method?: string): BackendCall[] {
    return this.calls.filter(
      (c) =>
        c.service === service &&
        (name === undefined || c.name === name) &&
        (method === undefined || c.method === method),
    );
  }

  /**
   * Answers the next `times` calls matching `match` with an error instead of
   * handling them.
   */
  fail(
    match: (call: BackendCall) => boolean,
    options: { status?: number; body?: unknown; times?: number } = {},
  ) {
    this.failures.push({
      match,
      status: options.status ?? 500,
      body: options.body ?? {
        code: "XX000",
        message: "injected failure",
        details: null,
        hint: null,
      },
      remaining: options.times ?? 1,
    });
  }

  // ---- installation -------------------------------------------------------

  async install(context: BrowserContext) {
    // Anything that isn't the dev server or Supabase: answered from
    // `external`, else 404 — the suite never reaches the real network.
    await context.route(
      (url) => url.hostname !== "localhost" && url.host !== SUPABASE_HOST,
      (route) => this.handleExternal(route),
    );
    await context.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => this.onSocket(ws));
  }

  private async handleExternal(route: Route) {
    if (this.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    const resource = this.external.get(route.request().url());
    if (!resource) {
      await route.fulfill({ status: 404, headers: CORS_HEADERS, body: "" });
      return;
    }
    await route.fulfill({
      status: resource.status ?? 200,
      headers: CORS_HEADERS,
      contentType: resource.contentType,
      body: resource.body,
    });
  }

  private async handle(route: Route) {
    const request = route.request();
    if (this.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const url = new URL(request.url());
    const path = url.pathname;
    let response: { status: number; body?: unknown; raw?: Buffer; contentType?: string };
    try {
      if (path.startsWith("/auth/v1/")) response = this.handleAuth(request, url);
      else if (path.startsWith("/rest/v1/rpc/")) response = this.handleRpc(request, url);
      else if (path.startsWith("/rest/v1/")) response = this.handleRest(request, url);
      else if (path.startsWith("/functions/v1/")) response = this.handleFunction(request, url);
      else if (path.startsWith("/storage/v1/")) response = this.handleStorage(request, url);
      else response = this.notImplemented(`${request.method()} ${path}`);
    } catch (err) {
      response = this.notImplemented(`${request.method()} ${url.pathname}${url.search}: ${err}`);
    }
    await route.fulfill({
      status: response.status,
      headers: CORS_HEADERS,
      contentType: response.contentType ?? "application/json",
      body: response.raw ?? (response.body === undefined ? "" : JSON.stringify(response.body)),
    });
  }

  private notImplemented(what: string) {
    this.unhandled.push(what);
    return { status: 501, body: { message: `fake backend: not implemented: ${what}` } };
  }

  private record(call: BackendCall): { status: number; body: unknown } | null {
    this.calls.push(call);
    const failure = this.failures.find((f) => f.remaining > 0 && f.match(call));
    if (!failure) return null;
    failure.remaining -= 1;
    return { status: failure.status, body: failure.body };
  }

  private static bodyOf(request: Request): unknown {
    const text = request.postData();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---- auth -----------------------------------------------------------------

  private handleAuth(request: Request, url: URL) {
    const endpoint = url.pathname.slice("/auth/v1/".length);
    const name = endpoint === "token" ? `token:${url.searchParams.get("grant_type")}` : endpoint;
    const body = FakeBackend.bodyOf(request) as Record<string, string> | undefined;
    const failed = this.record({
      service: "auth",
      method: request.method(),
      name,
      params: url.searchParams,
      body,
    });
    if (failed) return failed;

    switch (name) {
      case "token:password":
        if (body?.email === USER.email && body?.password === USER.password) {
          return { status: 200, body: makeSession() };
        }
        return {
          status: 400,
          body: {
            code: 400,
            error_code: "invalid_credentials",
            msg: "Invalid login credentials",
          },
        };
      case "token:refresh_token":
        if (!body?.refresh_token || this.revokedRefreshTokens.has(body.refresh_token)) {
          return {
            status: 400,
            body: {
              code: 400,
              error_code: "refresh_token_not_found",
              msg: "Invalid Refresh Token: Refresh Token Not Found",
            },
          };
        }
        return { status: 200, body: makeSession() };
      case "logout":
        return { status: 204 };
      case "user":
        // A revoked token is refused by the auth server too, as by GoTrue.
        if (this.rejectJwt) {
          return {
            status: 401,
            body: { code: 401, error_code: "bad_jwt", msg: "invalid JWT: token is expired" },
          };
        }
        return { status: 200, body: makeSession().user };
      default:
        return this.notImplemented(`auth ${request.method()} ${endpoint}`);
    }
  }

  // ---- PostgREST ------------------------------------------------------------

  private handleRpc(request: Request, url: URL) {
    const name = url.pathname.slice("/rest/v1/rpc/".length);
    const body = FakeBackend.bodyOf(request) as Record<string, string> | undefined;
    const failed = this.record({
      service: "rpc",
      method: request.method(),
      name,
      params: url.searchParams,
      body,
    });
    if (failed) return failed;
    if (name !== "get_public_bookmark") return this.notImplemented(`rpc ${name}`);
    const row = this.bookmarks.find((b) => b.id === body?.bookmark_id && b.is_public);
    if (!row) return { status: 200, body: [] };
    const {
      id,
      type,
      title,
      author,
      excerpt,
      content_md,
      thumbnail_url,
      youtube_video_id,
      word_count,
      reading_time,
      created_at,
    } = row;
    return {
      status: 200,
      body: [
        {
          id,
          type,
          title,
          author,
          excerpt,
          content_md,
          thumbnail_url,
          youtube_video_id,
          word_count,
          reading_time,
          created_at,
        },
      ],
    };
  }

  private handleRest(request: Request, url: URL) {
    const table = url.pathname.slice("/rest/v1/".length);
    const method = request.method();
    const body = FakeBackend.bodyOf(request);
    const failed = this.record({
      service: "rest",
      method,
      name: table,
      params: url.searchParams,
      body,
    });
    if (failed) return failed;
    if (this.rejectJwt) {
      return {
        status: 401,
        body: { code: "PGRST301", message: "JWT expired", details: null, hint: null },
      };
    }

    const invalid = schemaError(table, url.searchParams, body);
    if (invalid) return invalid;

    const headers = request.headers();
    const wantsObject = (headers["accept"] ?? "").includes("application/vnd.pgrst.object+json");
    const prefer = headers["prefer"] ?? "";
    const selection = parseSelect(url.searchParams.get("select"));
    const predicates = filtersFrom(url.searchParams);
    const matches = (row: Row) => predicates.every((p) => p(row));

    let result: Row[];
    let status = 200;
    switch (method) {
      case "GET":
      case "HEAD": {
        let rows = ordered(this.tableRows(table).filter(matches), url.searchParams.get("order"));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = url.searchParams.get("limit");
        rows = rows.slice(offset, limit === null ? undefined : offset + Number(limit));
        result = rows;
        break;
      }
      case "POST": {
        const items = (Array.isArray(body) ? body : [body]) as Row[];
        const inserted = this.insert(table, items, url.searchParams.get("on_conflict"));
        if ("error" in inserted) return inserted.error;
        result = inserted.rows;
        status = 201;
        break;
      }
      case "PATCH":
        result = this.update(table, matches, body as Row);
        status = prefer.includes("return=representation") ? 200 : 204;
        break;
      case "DELETE":
        result = this.remove(table, matches);
        status = prefer.includes("return=representation") ? 200 : 204;
        break;
      default:
        return this.notImplemented(`rest ${method} ${table}`);
    }

    if (status === 204 || (method === "POST" && !prefer.includes("return=representation"))) {
      return { status: status === 204 ? 204 : 201 };
    }
    const projected = result.map((row) => this.projectRow(table, row, selection));
    if (wantsObject) {
      if (projected.length !== 1) {
        return {
          status: 406,
          body: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: `The result contains ${projected.length} rows`,
            hint: null,
          },
        };
      }
      return { status, body: projected[0] };
    }
    return { status, body: projected };
  }

  private tableRows(table: string): Row[] {
    switch (table) {
      case "bookmarks":
        return this.bookmarks as unknown as Row[];
      case "tags":
        return this.tags as unknown as Row[];
      case "bookmark_tags":
        return this.bookmarkTags as unknown as Row[];
      case "bookmark_deletions":
        return this.deletions as unknown as Row[];
      default:
        throw new Error(`unknown table ${table}`);
    }
  }

  private projectRow(table: string, row: Row, selection: Selection): Row {
    const projected = project(row, selection);
    if (table === "bookmarks") {
      const tagSelection = selection.embeds.get("tags");
      if (tagSelection) {
        projected.tags = this.bookmarkTags
          .filter((bt) => bt.bookmark_id === row.id)
          .map((bt) => this.tags.find((t) => t.id === bt.tag_id))
          .filter((t): t is ServerTag => t !== undefined)
          .map((t) => project(t as unknown as Row, tagSelection));
      }
    }
    return projected;
  }

  private newBookmarkRow(fields: Partial<ServerBookmark>): ServerBookmark {
    const now = fields.created_at ?? this.now();
    const row: ServerBookmark = {
      id: crypto.randomUUID(),
      user_id: USER.id,
      url: null,
      url_normalized: null,
      type: "article",
      status: "pending",
      title: null,
      author: null,
      excerpt: null,
      content_md: null,
      translated_content_md: null,
      translated_lang: null,
      thumbnail_url: null,
      youtube_video_id: null,
      content_edited: false,
      word_count: null,
      reading_time: null,
      is_public: false,
      archived: false,
      read_at: null,
      error_message: null,
      created_at: now,
      processed_at: null,
      updated_at: now,
      pdf_path: null,
      pdf_parsed: false,
      view_mode: null,
      progress: 0,
      ...fields,
    };
    row.url_normalized = row.url ? normalizeUrl(row.url) : null;
    return row;
  }

  private upsertTag(name: string, color?: string): ServerTag {
    const existing = this.tags.find((t) => t.name === name);
    if (existing) {
      if (color) existing.color = color;
      return existing;
    }
    const tag: ServerTag = {
      id: crypto.randomUUID(),
      user_id: USER.id,
      name,
      color: color ?? TAG_COLORS[this.tags.length % TAG_COLORS.length]!,
    };
    this.tags.push(tag);
    return tag;
  }

  private touch(bookmarkId: string) {
    const row = this.bookmark(bookmarkId);
    if (row) row.updated_at = this.now();
  }

  private insert(
    table: string,
    items: Row[],
    onConflict: string | null,
  ): { rows: Row[] } | { error: { status: number; body: unknown } } {
    switch (table) {
      case "bookmarks": {
        const taken = new Set(this.bookmarks.map((b) => b.url_normalized).filter(Boolean));
        const rows = items.map((item) => this.newBookmarkRow(item as Partial<ServerBookmark>));
        for (const [index, row] of rows.entries()) {
          const violation = bookmarkConstraintError(items[index]!, row);
          if (violation) return { error: violation };
          if (row.url_normalized && taken.has(row.url_normalized)) {
            return {
              error: {
                status: 409,
                body: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "bookmarks_url_normalized_uniq"',
                  details: null,
                  hint: null,
                },
              },
            };
          }
          if (row.url_normalized) taken.add(row.url_normalized);
        }
        this.bookmarks.push(...rows);
        return { rows: rows as unknown as Row[] };
      }
      case "tags": {
        if (onConflict !== "user_id,name") throw new Error(`tags insert without upsert`);
        return {
          rows: items.map(
            (item) =>
              this.upsertTag(String(item.name), item.color as string | undefined) as unknown as Row,
          ),
        };
      }
      case "bookmark_tags": {
        const rows = items.map((item) => {
          const pair = { bookmark_id: String(item.bookmark_id), tag_id: String(item.tag_id) };
          const exists = this.bookmarkTags.some(
            (bt) => bt.bookmark_id === pair.bookmark_id && bt.tag_id === pair.tag_id,
          );
          if (!exists) {
            this.bookmarkTags.push(pair);
            this.touch(pair.bookmark_id);
          }
          return pair as unknown as Row;
        });
        return { rows };
      }
      default:
        throw new Error(`insert into ${table}`);
    }
  }

  private update(table: string, matches: Predicate, patch: Row): Row[] {
    if (table !== "bookmarks") throw new Error(`update ${table}`);
    const rows = this.bookmarks.filter((b) => matches(b as unknown as Row));
    for (const row of rows) {
      Object.assign(row, patch, { updated_at: this.now() });
      row.url_normalized = row.url ? normalizeUrl(row.url) : null;
    }
    return rows as unknown as Row[];
  }

  private remove(table: string, matches: Predicate): Row[] {
    if (table === "bookmarks") {
      const removed = this.bookmarks.filter((b) => matches(b as unknown as Row));
      const ids = new Set(removed.map((b) => b.id));
      this.bookmarks = this.bookmarks.filter((b) => !ids.has(b.id));
      this.bookmarkTags = this.bookmarkTags.filter((bt) => !ids.has(bt.bookmark_id));
      for (const id of ids) this.deletions.push({ bookmark_id: id, deleted_at: this.now() });
      return removed as unknown as Row[];
    }
    if (table === "bookmark_tags") {
      const removed = this.bookmarkTags.filter((bt) => matches(bt as unknown as Row));
      this.bookmarkTags = this.bookmarkTags.filter((bt) => !removed.includes(bt));
      for (const bt of removed) this.touch(bt.bookmark_id);
      return removed as unknown as Row[];
    }
    throw new Error(`delete from ${table}`);
  }

  // ---- Edge Functions --------------------------------------------------------

  private handleFunction(request: Request, url: URL) {
    const name = url.pathname.slice("/functions/v1/".length);
    const body = (FakeBackend.bodyOf(request) ?? {}) as Record<string, string>;
    const failed = this.record({
      service: "functions",
      method: request.method(),
      name,
      params: url.searchParams,
      body,
    });
    if (failed) return failed;

    const insertNote = (fields: Partial<ServerBookmark>) => {
      const row = this.newBookmarkRow({ type: "note", status: "ready", ...fields });
      this.bookmarks.push(row);
      return { status: 200, body: { bookmark: { ...row, tags: [] } } };
    };

    switch (name) {
      case "capture": {
        if (body.url) {
          const row = this.newBookmarkRow({ url: body.url, title: body.title ?? null });
          this.bookmarks.push(row);
          return { status: 200, body: { status: "saved", id: row.id } };
        }
        return insertNote({ content_md: body.text, title: body.text?.slice(0, 100) ?? null });
      }
      case "snippet": {
        // Stand-in for Turndown: tags stripped, bold kept as Markdown.
        const markdown = (body.html ?? "")
          .replace(/<(strong|b)>(.*?)<\/\1>/g, "**$2**")
          .replace(/<[^>]+>/g, "")
          .trim();
        const content = markdown || body.text || "";
        return insertNote({ content_md: content, title: content.slice(0, 100) });
      }
      case "file-import": {
        const text = Buffer.from(body.contentBase64 ?? "", "base64").toString("utf8");
        const content = body.filename?.endsWith(".docx") ? "Converted Word document" : text;
        return insertNote({ content_md: content, title: body.filename ?? "Imported" });
      }
      case "pdf-import": {
        const path = `${USER.id}/${crypto.randomUUID()}.pdf`;
        this.storage.set(`bookmark-pdfs/${path}`, {
          body: Buffer.from(body.contentBase64 ?? "", "base64"),
          contentType: "application/pdf",
        });
        return insertNote({
          type: "pdf",
          title: body.filename ?? "PDF",
          content_md: "Extracted PDF text.",
          pdf_path: path,
          pdf_parsed: true,
        });
      }
      case "translate": {
        const row = this.bookmark(body.bookmark_id ?? "");
        if (!row?.content_md) return { status: 404, body: { error: "not found" } };
        row.translated_content_md = `[${body.target_lang}] ${row.content_md}`;
        row.translated_lang = body.target_lang ?? "EN";
        row.updated_at = this.now();
        return {
          status: 200,
          body: {
            translated_text: row.translated_content_md,
            translated_lang: row.translated_lang,
          },
        };
      }
      default:
        return this.notImplemented(`function ${name}`);
    }
  }

  // ---- Storage ----------------------------------------------------------------

  private handleStorage(request: Request, url: URL) {
    const method = request.method();
    const rest = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length));
    const body = FakeBackend.bodyOf(request) as Record<string, unknown> | undefined;

    // Signed URL issued: GET object/sign/<bucket>/<path>?token=…
    if (method === "GET" && rest.startsWith("sign/")) {
      const object = this.storage.get(rest.slice("sign/".length));
      if (!object) return { status: 404, body: { message: "Object not found" } };
      return { status: 200, raw: object.body, contentType: object.contentType };
    }
    if (method === "GET" && rest.startsWith("public/")) {
      const object = this.storage.get(rest.slice("public/".length));
      if (!object) return { status: 404, body: { message: "Object not found" } };
      return { status: 200, raw: object.body, contentType: object.contentType };
    }

    const bucket = rest.startsWith("sign/") ? rest.split("/")[1]! : rest.split("/")[0]!;
    const failed = this.record({
      service: "storage",
      method,
      name: bucket,
      params: url.searchParams,
      body,
    });
    if (failed) return failed;

    if (method === "POST" && rest.startsWith("sign/")) {
      const key = rest.slice("sign/".length);
      if (!this.storage.has(key)) return { status: 400, body: { message: "Object not found" } };
      return { status: 200, body: { signedURL: `/object/sign/${key}?token=e2e-signed` } };
    }
    if (method === "DELETE") {
      const prefixes = (body?.prefixes ?? []) as string[];
      const removed = prefixes.filter((path) => this.storage.delete(`${bucket}/${path}`));
      return { status: 200, body: removed.map((name) => ({ name, bucket_id: bucket })) };
    }
    return this.notImplemented(`storage ${method} ${rest}`);
  }

  /** Puts a PDF in the private bucket; returns its path for `pdf_path`. */
  addPdfObject(path = `${USER.id}/${crypto.randomUUID()}.pdf`): string {
    this.storage.set(`bookmark-pdfs/${path}`, { body: PDF_BYTES, contentType: "application/pdf" });
    return path;
  }

  // ---- Realtime -----------------------------------------------------------------

  private onSocket(socket: WebSocketRoute) {
    if (this.realtimeMode === "close") {
      void socket.close({ code: 1011, reason: "e2e: realtime unavailable" });
      return;
    }
    socket.onMessage((message) => {
      if (this.realtimeMode !== "respond" || typeof message !== "string") return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(message) as [
        string | null,
        string | null,
        string,
        string,
        Record<string, unknown>,
      ];
      const reply = (response: unknown) =>
        socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]));
      if (event === "phx_join") {
        const config = (payload.config ?? {}) as { postgres_changes?: Row[] };
        const bindings = (config.postgres_changes ?? []).map((binding, index) => ({
          ...binding,
          id: index + 1,
        }));
        this.channels.set(topic, { socket, ids: bindings.map((b) => b.id) });
        reply({ postgres_changes: bindings });
      } else if (event === "phx_leave") {
        this.channels.delete(topic);
        reply({});
      } else {
        // heartbeat, access_token
        reply({});
      }
    });
    socket.onClose(() => {
      for (const [topic, channel] of this.channels) {
        if (channel.socket === socket) this.channels.delete(topic);
      }
    });
  }

  /** Whether the app currently has a joined Realtime channel. */
  get realtimeJoined(): boolean {
    return this.channels.size > 0;
  }

  /**
   * Sends a postgres_changes event for a bookmark row to every joined channel,
   * the way the Realtime publication would (no body columns).
   */
  pushChange(type: "INSERT" | "UPDATE" | "DELETE", row: ServerBookmark) {
    const { content_md: _c, translated_content_md: _t, ...record } = row;
    const columns = Object.keys(record).map((name) => ({ name, type: "text" }));
    for (const [topic, channel] of this.channels) {
      channel.socket.send(
        JSON.stringify([
          null,
          null,
          topic,
          "postgres_changes",
          {
            ids: channel.ids,
            data: {
              schema: "public",
              table: "bookmarks",
              commit_timestamp: this.now(),
              type,
              columns,
              record: type === "DELETE" ? {} : record,
              old_record: type === "INSERT" ? undefined : { id: row.id },
              errors: null,
            },
          },
        ]),
      );
    }
  }
}

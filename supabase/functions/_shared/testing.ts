// Test-only helpers shared by the functions' index.test.ts files (never
// imported by a function, so never deployed).

export interface StubbedCall {
  method: string;
  path: string;
  headers: Headers;
  body: string | null;
}

// A stand-in for the network beneath supabase-js: replaces globalThis.fetch,
// records each request and answers from `routes` (keyed by URL path; anything
// else is a 500), so an env-wired handler can be exercised end to end without
// a Supabase instance. supabase-js resolves fetch when a client is created,
// so install this before the handler builds its client.
export function stubFetch(routes: Record<string, (req: Request) => Response>) {
  const calls: StubbedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path, headers: req.headers, body: await req.clone().text() });
    const route = routes[path];
    return route ? route(req) : new Response("no route", { status: 500 });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

// Wraps a test body so it runs with `vars` set (undefined = unset) and the
// previous values restored afterwards.
export function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): () => Promise<void> {
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  };
  return async () => {
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, Deno.env.get(key)]));
    apply(vars);
    try {
      await fn();
    } finally {
      apply(saved);
    }
  };
}

// Runs fn with console.error (and console.log) silenced, for tests that
// expect a server-side error log.
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const [log, error] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

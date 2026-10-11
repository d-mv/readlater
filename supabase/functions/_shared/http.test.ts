import { assertEquals } from "jsr:@std/assert@1.0.19";
import { isUuid, readJsonBody, serverError } from "./http.ts";

const cors = { "Access-Control-Allow-Origin": "*" };

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/fn", { method: "POST", headers, body });
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

Deno.test("readJsonBody: parses a JSON object", async () => {
  const result = await readJsonBody(post('{"a":1}'), 100, cors);
  assertEquals(result.ok && result.body, { a: 1 });
});

for (const [label, body] of [
  ["malformed JSON", "{a:1}"],
  ["an empty body", ""],
  ["a JSON array", "[1]"],
  ["a JSON primitive", "42"],
  ["JSON null", "null"],
] as const) {
  Deno.test(`readJsonBody: ${label} → 400 with CORS headers`, async () => {
    const result = await readJsonBody(post(body), 100, cors);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 400);
      assertEquals(result.response.headers.get("Access-Control-Allow-Origin"), "*");
    }
  });
}

Deno.test("readJsonBody: a declared Content-Length over the cap → 413 without reading", async () => {
  let pulled = false;
  // highWaterMark 0: the stream isn't pulled until someone reads it.
  const body = new ReadableStream<Uint8Array>({
    pull() {
      pulled = true;
    },
  }, { highWaterMark: 0 });
  const result = await readJsonBody(post(body, { "content-length": "1000" }), 100, cors);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 413);
    assertEquals(result.response.headers.get("Access-Control-Allow-Origin"), "*");
  }
  assertEquals(pulled, false);
});

Deno.test("readJsonBody: a streamed body without Content-Length is still capped → 413", async () => {
  const result = await readJsonBody(post(streamOf(['{"a":"', "x".repeat(200), '"}'])), 100, cors);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.response.status, 413);
});

Deno.test("readJsonBody: a garbage Content-Length → 400", async () => {
  const result = await readJsonBody(post("{}", { "content-length": "lots" }), 100, cors);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.response.status, 400);
});

Deno.test("serverError: answers a fixed message and never the cause", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const res = serverError(cors, "test", { message: 'duplicate key value violates "secret_idx"' });
    assertEquals(res.status, 500);
    assertEquals(await res.json(), "internal error");
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  } finally {
    console.error = original;
  }
});

Deno.test("isUuid: accepts a uuid, rejects anything else", () => {
  assertEquals(isUuid("6f1c1c3e-2b4a-4c55-9d1e-0a3b5c7d9e11"), true);
  assertEquals(isUuid("b1"), false);
  assertEquals(isUuid("6f1c1c3e-2b4a-4c55-9d1e-0a3b5c7d9e11; drop"), false);
});

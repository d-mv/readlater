import { assertEquals } from "jsr:@std/assert";
import { checkAuth } from "./checkAuth.ts";

Deno.test("accepts a matching bearer token", () => {
  assertEquals(checkAuth("Bearer secret123", "secret123"), true);
});

Deno.test("rejects a mismatched bearer token", () => {
  assertEquals(checkAuth("Bearer wrong", "secret123"), false);
});

Deno.test("rejects a missing header", () => {
  assertEquals(checkAuth(null, "secret123"), false);
});

Deno.test("rejects a header missing the Bearer prefix", () => {
  assertEquals(checkAuth("secret123", "secret123"), false);
});

Deno.test("rejects when the expected key is empty (misconfiguration)", () => {
  assertEquals(checkAuth("Bearer ", ""), false);
});

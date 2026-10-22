import { describe, expect, test } from "bun:test";
import { createTurndownService } from "../src/parseArticle";

// Same escaping as Turndown's own link and image rules (and the edge
// functions' copy of this rule, supabase/functions/_shared/turndown.ts).
describe("createTurndownService escaping", () => {
  test("an unwrapped image escapes parentheses, spaces, quotes and alt markdown", () => {
    const md = createTurndownService().turndown(
      '<a href="https://x.test/Foo_(bar) 1.png" title=\'Say "hi"\'><img src="https://x.test/Foo_(bar) 1.png" alt="a *star*"></a>',
    );
    expect(md).toBe('![a \\*star\\*](<https://x.test/Foo_\\(bar\\) 1.png> "Say \\"hi\\"")');
  });

  test("a block link escapes its destination and title", () => {
    const md = createTurndownService().turndown(
      '<a href="https://x.test/wiki/Foo_(bar)" title=\'A "b"\'><div><p>Read</p></div></a>',
    );
    expect(md).toBe('[Read](https://x.test/wiki/Foo_\\(bar\\) "A \\"b\\"")');
  });
});

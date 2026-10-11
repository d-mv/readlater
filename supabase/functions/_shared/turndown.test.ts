import { assertEquals } from "jsr:@std/assert@1.0.19";
import { createTurndownService } from "./turndown.ts";

// Plain Turndown would give `[![](https://x.test/a.png)](https://x.test/a.png)`.
Deno.test("createTurndownService: a link wrapping the same image becomes a plain image", () => {
  const md = createTurndownService().turndown(
    '<a href="https://x.test/a.png"><img src="https://x.test/a.png"></a>',
  );
  assertEquals(md, "![](https://x.test/a.png)");
});

Deno.test("createTurndownService: a link wrapping block content stays a single-line link", () => {
  const md = createTurndownService().turndown(
    '<a href="https://x.test/post"><div>Title</div><p>Teaser</p></a>',
  );
  assertEquals(md, "[Title\nTeaser](https://x.test/post)");
});

Deno.test("createTurndownService: plain inline links are untouched", () => {
  const md = createTurndownService().turndown('<p>see <a href="https://x.test">here</a></p>');
  assertEquals(md, "see [here](https://x.test)");
});

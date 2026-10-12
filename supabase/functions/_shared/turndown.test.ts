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

const md = (html: string) => createTurndownService().turndown(html);

Deno.test("createTurndownService: a link around an image keeps its title on the unwrapped image", () => {
  assertEquals(
    md('<a href="https://x.test/a.png" title="Zoom"><img src="https://x.test/a.png"></a>'),
    '![](https://x.test/a.png "Zoom")',
  );
});

// worker/src/parseArticle.ts has the same rule; the two must change together.
Deno.test("createTurndownService: a link around its own image with alt text is unwrapped", () => {
  assertEquals(
    md('<a href="https://x.test/a.png"><img src="https://x.test/a.png" alt="A"></a>'),
    "![A](https://x.test/a.png)",
  );
});

Deno.test("createTurndownService: a link around a figure holding only its own image is unwrapped", () => {
  assertEquals(
    md('<a href="https://x.test/a.png"><figure><img src="https://x.test/a.png" alt="A"></figure></a>'),
    "![A](https://x.test/a.png)",
  );
});

Deno.test("createTurndownService: a link whose text equals the image alt stays a link", () => {
  assertEquals(
    md('<a href="https://x.test/a.png"><img src="https://x.test/a.png" alt="A">A</a>'),
    "[![A](https://x.test/a.png)A](https://x.test/a.png)",
  );
});

Deno.test("createTurndownService: a link to somewhere else than its image stays a link", () => {
  assertEquals(
    md('<a href="https://x.test/post"><img src="https://x.test/a.png" alt="A"></a>'),
    "[![A](https://x.test/a.png)](https://x.test/post)",
  );
});

Deno.test("createTurndownService: a link whose text differs from the image alt stays a link", () => {
  assertEquals(
    md('<a href="https://x.test/a.png"><img src="https://x.test/a.png">caption</a>'),
    "[![](https://x.test/a.png)caption](https://x.test/a.png)",
  );
});

Deno.test("createTurndownService: a link around an image without src (nothing to show) is dropped", () => {
  assertEquals(md('<p>see</p><a href="https://x.test/a.png"><img alt=""></a>'), "see");
});

Deno.test("createTurndownService: a link around several images stays one single-line link", () => {
  assertEquals(
    md('<a href="https://x.test/g"><img src="https://x.test/1.png"><img src="https://x.test/2.png"></a>'),
    "[![](https://x.test/1.png)![](https://x.test/2.png)](https://x.test/g)",
  );
});

Deno.test("createTurndownService: an href-less anchor around an image keeps the image", () => {
  assertEquals(md('<a><img src="https://x.test/a.png" alt="A"></a>'), "[![A](https://x.test/a.png)]()");
});

Deno.test("createTurndownService: a link around empty blocks is dropped", () => {
  assertEquals(md('<p>before</p><a href="https://x.test/post"><div> </div></a><p>after</p>'), "before\n\nafter");
});

Deno.test("createTurndownService: a link with title around block content keeps the title", () => {
  assertEquals(
    md('<a href="https://x.test/post" title="Read"><div>Title</div></a>'),
    '[Title](https://x.test/post "Read")',
  );
});

Deno.test("createTurndownService: a link around inline elements is left to the default rule", () => {
  assertEquals(md('<a href="https://x.test"><span>in</span><em>line</em></a>'), "[in_line_](https://x.test)");
});

// Regression: domino's querySelector returns undefined (not null) on a miss,
// which made the rule claim every link and bypass Turndown's own link rule —
// losing its escaping of parentheses in the href and its handling of
// href-less anchors.
Deno.test("createTurndownService: a plain link still gets Turndown's href escaping", () => {
  assertEquals(
    md('<a href="https://en.wikipedia.org/wiki/Mercury_(planet)">Mercury</a>'),
    "[Mercury](https://en.wikipedia.org/wiki/Mercury_\\(planet\\))",
  );
});

Deno.test("createTurndownService: an anchor without href is plain text", () => {
  assertEquals(md('<p>jump <a name="here">here</a></p>'), "jump here");
});

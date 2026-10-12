import TurndownService from "npm:turndown@7.2.4";

// Mirrors createTurndownService() in worker/src/parseArticle.ts — the worker
// is a separate (Bun) runtime, so the rule is duplicated across that
// boundary; keep the two in step. Without it, a link wrapping an image or a
// block element converts to a multi-line `[...](href)` that markdown-it
// renders as literal brackets.

// The structural slice of a DOM element the rule touches (Turndown parses
// with domino in Deno, so there is no global DOM lib to type against).
interface RuleNode {
  nodeName: string;
  textContent: string | null;
  children: ArrayLike<{ nodeName: string }>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

export function createTurndownService(): TurndownService {
  const turndown = new TurndownService();

  turndown.addRule("cleanLinkedImagesAndBlocks", {
    filter: (domNode: unknown) => {
      const node = domNode as RuleNode;
      if (node.nodeName !== "A") return false;
      // Loose `!= null`: domino's querySelector answers a miss with
      // undefined, not null, so a strict check matched every link.
      return (
        node.querySelector("img") != null ||
        Array.from(node.children).some((child) =>
          ["FIGURE", "DIV", "P", "SECTION"].includes(child.nodeName)
        )
      );
    },
    replacement: (content: string, domNode: unknown) => {
      const node = domNode as RuleNode;
      const href = node.getAttribute("href") || "";
      const title = node.getAttribute("title") || "";
      const titleAttr = title ? ` "${title}"` : "";

      const cleanContent = content.trim().replace(/\n{2,}/g, "\n");

      const imgs = node.querySelectorAll("img");
      const img = imgs[0];
      const textContent = node.textContent?.trim() || "";
      const imgAlt = imgs.length === 1 && img ? img.getAttribute("alt") || "" : "";

      if (imgs.length === 1 && img && href) {
        const src = img.getAttribute("src") || "";
        if (src && href.trim() === src.trim() && textContent === imgAlt) {
          return `\n\n![${imgAlt}](${src}${titleAttr})\n\n`;
        }
      }

      if (!cleanContent) return "";
      return `[${cleanContent}](${href}${titleAttr})`;
    },
  });

  return turndown;
}

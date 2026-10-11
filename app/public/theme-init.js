// Applies the saved theme before first paint so the page doesn't flash the
// wrong palette. A file rather than an inline <script> so the CSP
// (nginx.conf) can keep script-src to 'self' with no hashes to maintain.
(function () {
  // "light"/"dark" are explicit choices; anything else ("system" or
  // nothing stored) follows the OS — mirrors stores/theme.ts.
  var stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch (_error) {
    // Storage can be blocked (private mode, site-data settings): follow the OS.
  }
  var theme =
    stored === "light" || stored === "dark"
      ? stored
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
})();

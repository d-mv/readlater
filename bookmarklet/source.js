(() => {
  const params = new URLSearchParams({ url: location.href, title: document.title });
  window.open(
    "__APP_ORIGIN__/capture?" + params.toString(),
    "readlater-capture",
    "width=380,height=260",
  );
})();

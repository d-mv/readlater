(function () {
  fetch("__CAPTURE_ENDPOINT__", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer __CAPTURE_KEY__",
    },
    body: JSON.stringify({ url: location.href, title: document.title }),
  }).then(function (res) {
    var n = document.createElement("div");
    n.textContent = res.ok ? "Saved" : "Failed to save";
    n.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;padding:8px 14px;border-radius:6px;font:13px sans-serif;background:" +
      (res.ok ? "#1D9E75" : "#D85A30") +
      ";color:#fff";
    document.body.appendChild(n);
    setTimeout(function () {
      n.remove();
    }, 2000);
  });
})();

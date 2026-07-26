(function () {
  function showToast(message, ok) {
    var n = document.createElement("div");
    n.textContent = message;
    n.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;padding:8px 14px;border-radius:6px;font:13px sans-serif;background:" +
      (ok ? "#1D9E75" : "#D85A30") +
      ";color:#fff";
    document.body.appendChild(n);
    setTimeout(function () {
      n.remove();
    }, 2000);
  }

  function showDuplicateOverlay(existingId, existingTitle) {
    var n = document.createElement("div");
    n.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;padding:12px 14px;border-radius:6px;font:13px sans-serif;background:#333;color:#fff;display:flex;align-items:center;gap:10px;max-width:320px";

    var label = document.createElement("span");
    label.textContent = "Already saved" + (existingTitle ? ": " + existingTitle : "");
    label.style.cssText = "flex:1";

    var cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = "cursor:pointer;border:none;border-radius:4px;padding:4px 8px;background:#555;color:#fff;font:inherit";
    cancelBtn.onclick = function () {
      n.remove();
    };

    var continueBtn = document.createElement("button");
    continueBtn.textContent = "Continue";
    continueBtn.style.cssText = "cursor:pointer;border:none;border-radius:4px;padding:4px 8px;background:#1D9E75;color:#fff;font:inherit";
    continueBtn.onclick = function () {
      fetch("__CAPTURE_ENDPOINT__/" + encodeURIComponent(existingId) + "/refresh", {
        method: "POST",
        headers: { Authorization: "Bearer __CAPTURE_KEY__" },
      }).then(function (res) {
        n.remove();
        showToast(res.ok ? "Saved" : "Failed to save", res.ok);
      });
    };

    n.appendChild(label);
    n.appendChild(cancelBtn);
    n.appendChild(continueBtn);
    document.body.appendChild(n);
  }

  fetch("__CAPTURE_ENDPOINT__", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer __CAPTURE_KEY__",
    },
    body: JSON.stringify({ url: location.href, title: document.title }),
  }).then(function (res) {
    res
      .json()
      .catch(function () {
        return null;
      })
      .then(function (body) {
        if (res.ok && body && body.status === "duplicate") {
          showDuplicateOverlay(body.existingId, body.existingTitle);
        } else {
          showToast(res.ok ? "Saved" : "Failed to save", res.ok);
        }
      });
  });
})();

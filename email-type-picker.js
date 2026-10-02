/* Beeto app: swaps the browser-default Email type <select>s (white list, blue highlight)
   for an on-brand dropdown. The real <select>s stay in the page and stay in sync,
   so script.js works unchanged. Load AFTER script.js. */
(function () {
  var selects = [].slice.call(document.querySelectorAll("select.email-type-select"));
  if (!selects.length) return;
  var pickers = [];
  function closeAll(except) { pickers.forEach(function (p) { if (p !== except) p.close(); }); }
  function renderAll() { pickers.forEach(function (p) { p.render(); }); }

  function build(sel) {
    var wrap = document.createElement("div"); wrap.className = "etp";
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "etp-btn";
    btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", sel.getAttribute("aria-label") || "Email type");
    var label = document.createElement("span");
    var caret = document.createElement("span"); caret.className = "etp-caret"; caret.textContent = "\u25BE";
    btn.appendChild(label); btn.appendChild(caret);
    var list = document.createElement("div"); list.className = "etp-list"; list.setAttribute("role", "listbox"); list.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(list);
    sel.classList.add("etp-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
    sel.parentNode.insertBefore(wrap, sel.nextSibling);

    var api = { close: close, render: render };
    function close() { list.hidden = true; wrap.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); }
    function render() {
      var cur = sel.options[sel.selectedIndex];
      label.textContent = cur ? cur.textContent : "";
      btn.disabled = sel.disabled;
      wrap.classList.toggle("is-disabled", sel.disabled);
      wrap.classList.toggle("is-placeholder", !sel.value);
      list.innerHTML = "";
      [].slice.call(sel.options).forEach(function (o) {
        var on = o.value === sel.value;
        var b = document.createElement("button"); b.type = "button";
        b.className = "etp-opt" + (on ? " is-selected" : "");
        b.setAttribute("role", "option"); b.setAttribute("aria-selected", on ? "true" : "false");
        b.textContent = o.textContent;
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          sel.value = o.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          close(); renderAll();
        });
        list.appendChild(b);
      });
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sel.disabled) return;
      var willOpen = list.hidden;
      closeAll(api);
      list.hidden = !willOpen;
      wrap.classList.toggle("is-open", willOpen);
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) { var s = list.querySelector(".is-selected"); if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" }); }
    });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape" && !list.hidden) { e.stopPropagation(); close(); btn.focus(); } });
    new MutationObserver(renderAll).observe(sel, { childList: true, attributes: true, attributeFilter: ["disabled"] });
    render();
    return api;
  }

  selects.forEach(function (s) { pickers.push(build(s)); });
  document.addEventListener("click", function () { closeAll(); });
  /* script.js resets the category programmatically (no change event), so re-sync when the menu opens */
  var plus = document.getElementById("toolsBtn");
  if (plus) plus.addEventListener("click", function () { setTimeout(renderAll, 0); });
})();

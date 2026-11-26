// v4 設計稿的互動：對話框、旗標（顯示／隱藏）、分段按鈕、單選卡。
// 網址 ?theme=dark 切換深色；#s=名稱,名稱 打開對話框，#f=旗標,旗標 設定旗標（截圖用）。
(function () {
  var root = document.documentElement;
  try {
    var t = new URLSearchParams(location.search).get("theme");
    if (t === "dark" || t === "light") root.setAttribute("data-theme", t);
  } catch (e) {}
  var flags = {};
  function applyFlags() {
    Object.keys(flags).forEach(function (k) { root.classList.toggle("flag-" + k, !!flags[k]); });
    document.querySelectorAll("[data-when]").forEach(function (el) { el.hidden = !flags[el.getAttribute("data-when")]; });
    document.querySelectorAll("[data-unless]").forEach(function (el) { el.hidden = !!flags[el.getAttribute("data-unless")]; });
    document.querySelectorAll("[data-flag]").forEach(function (b) { b.setAttribute("aria-pressed", flags[b.getAttribute("data-flag")] ? "true" : "false"); });
    document.querySelectorAll("[data-flag-label]").forEach(function (b) {
      var p = b.getAttribute("data-flag-label").split("|"), f = b.getAttribute("data-flag");
      b.textContent = flags[f] ? p[1] : p[0];
    });
  }
  var lastFocus = null;
  function open(name) {
    var el = document.querySelector('[data-state="' + name + '"]');
    if (!el) return;
    lastFocus = document.activeElement;
    el.hidden = false;
    var f = el.querySelector("h2, [autofocus], button, input, select, textarea");
    if (f) { if (f.tagName === "H2") f.setAttribute("tabindex", "-1"); f.focus(); }
  }
  function close(el) { el.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); open(o.getAttribute("data-open")); return; }
    var c = e.target.closest("[data-close]");
    if (c) { var s = c.closest("[data-state]"); if (s) close(s); return; }
    if (e.target.classList && e.target.classList.contains("scrim")) { close(e.target); return; }
    var f = e.target.closest("[data-flag]");
    if (f) { var k = f.getAttribute("data-flag"); flags[k] = !flags[k]; applyFlags(); return; }
    var sb = e.target.closest(".seg button");
    if (sb) { var on = sb.getAttribute("aria-pressed") === "true"; sb.parentElement.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); sb.setAttribute("aria-pressed", on ? "false" : "true"); }
    var pt = e.target.closest("[data-point]");
    if (pt) {
      var n = pt.getAttribute("data-point"), was = pt.getAttribute("aria-pressed") === "true";
      document.querySelectorAll("[data-point]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      document.querySelectorAll(".pm").forEach(function (m) { m.classList.remove("pm--on"); });
      if (!was) { pt.setAttribute("aria-pressed", "true"); document.querySelectorAll('.pm[data-n="' + n + '"]').forEach(function (m) { m.classList.add("pm--on"); }); }
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches(".choice input[type=radio]")) {
      document.querySelectorAll('input[name="' + e.target.name + '"]').forEach(function (r) { var l = r.closest(".choice"); if (l) l.classList.toggle("choice--on", r.checked); });
    }
    var w = e.target.getAttribute && e.target.getAttribute("data-reveal");
    if (w) { flags[w] = e.target.value === e.target.getAttribute("data-reveal-value") || (e.target.type === "checkbox" && e.target.checked); applyFlags(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll("[data-state]").forEach(function (s) { if (!s.hidden) close(s); });
  });
  var h = location.hash;
  if (/shot/.test(h)) root.classList.add("shot");
  if (/full/.test(h)) root.classList.add("full");
  document.querySelectorAll(".tabs").forEach(function (c) { var t = c.querySelector("[aria-current]"); if (t) c.scrollLeft = t.offsetLeft - (c.clientWidth - t.offsetWidth) / 2; });
  var sm = h.match(/s=([\w,-]+)/), fm = h.match(/f=([\w,-]+)/);
  document.querySelectorAll("input[data-reveal]:checked").forEach(function (i) { var k = i.getAttribute("data-reveal"); flags[k] = flags[k] || i.value === i.getAttribute("data-reveal-value") || i.type === "checkbox"; });
  if (fm) fm[1].split(",").forEach(function (k) { flags[k] = true; });
  applyFlags();
  if (sm) sm[1].split(",").forEach(open);
})();

// SKYHUD theme before first paint. A tiny blocking classic script in <head> (same origin, so the CSP's
// script-src 'self' allows it; no inline script). It reads the saved red mode and brightness the same way
// app.js does and sets them on <html> before the body is parsed, so a red-mode visitor never sees a dark
// frame and the header doesn't reflow when app.js loads (the brightness slider is shown by CSS, keyed on
// data-theme="red"). app.js's applyTheme() still owns every later change.
(function () {
  function saved(k, d) { try { var v = localStorage.getItem("skyhud." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  var red = Boolean(saved("red", false));
  var dim = Number(saved("dim", 70));
  dim = Number.isFinite(dim) ? Math.min(100, Math.max(20, dim)) : 70;
  var html = document.documentElement;
  html.setAttribute("data-theme", red ? "red" : "dark");
  html.style.setProperty("--night-level", String(dim / 100));
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", red ? "#000000" : "#05070c");
})();

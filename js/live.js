// Shared live-update engine. One requestAnimationFrame loop drives every visualisation and feed poll.
// The loop stops when the tab is hidden, when the user presses Pause, and per task when its card is off screen.
// With prefers-reduced-motion, 1-second redraws drop to once a minute and nothing animates.

export const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener() {} };

const tasks = new Set();
let paused = false, raf = 0, timer = 0;
const pauseListeners = new Set();

const running = () => !paused && !document.hidden;
const period = (t) => (reducedMotion.matches && t.reducedMs ? Math.max(t.everyMs, t.reducedMs) : t.everyMs);

function frame(now) {
  raf = 0;
  if (!running()) return;
  const wall = Date.now();
  let next = Infinity;
  for (const t of tasks) {
    if (!t.visible) continue;
    const p = period(t);
    if (wall - t.last >= p) {
      t.last = wall;
      if (!t.busy) {
        try {
          const r = t.fn(now);
          if (r && typeof r.then === "function") { t.busy = true; r.catch(() => {}).finally(() => { t.busy = false; }); }
        } catch { /* a failing card must not stop the others */ }
      }
    }
    next = Math.min(next, t.last + p - wall);
  }
  schedule(next);
}
function schedule(inMs = 0) {
  if (raf || !running() || !tasks.size) return;
  clearTimeout(timer);
  // Sleep between due times instead of spinning at 60 fps; wake through rAF so drawing stays in step with paint.
  if (inMs > 50 && Number.isFinite(inMs)) timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, inMs - 16);
  else raf = requestAnimationFrame(frame);
}
function kick() { if (raf) { cancelAnimationFrame(raf); raf = 0; } clearTimeout(timer); timer = 0; schedule(0); }

const io = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const e of entries) for (const t of tasks) if (t.el === e.target) { t.visible = e.isIntersecting; }
    kick();
  }, { rootMargin: "200px 0px" })
  : null;

/**
 * Register a repeating task. `everyMs` is the normal period, `reducedMs` the period under reduced motion.
 * With `el`, the task only runs while that element is on (or near) the screen. With `lazy`, its first run
 * also waits for the element to be visible, so heavy feeds never load during first paint.
 * `fn` may return a promise; a task never overlaps itself.
 */
export function every(name, everyMs, fn, { el = null, reducedMs = 0, immediate = true } = {}) {
  const t = { name, everyMs, reducedMs, fn, el, visible: !el || !io, last: immediate ? 0 : Date.now(), busy: false };
  tasks.add(t);
  if (el && io) io.observe(el);
  kick();
  return () => { tasks.delete(t); if (el && io) io.unobserve(el); };
}

/** Force a task to run on the next frame (e.g. after a location change). */
export function runSoon(name) { for (const t of tasks) if (t.name === name) t.last = 0; kick(); }

export function isPaused() { return paused; }
export function setPaused(v) {
  paused = !!v;
  for (const f of pauseListeners) f(paused);
  kick();
}
export function onPause(f) { pauseListeners.add(f); }

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", kick);
  reducedMotion.addEventListener?.("change", kick);
}

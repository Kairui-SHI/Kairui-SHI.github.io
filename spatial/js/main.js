import { Desk } from './scene.js';

const root = document.documentElement;
const canvas = document.getElementById('scene');
const loaderFill = document.getElementById('loader-fill');
const hint = document.getElementById('hint');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const KEYS = ['about', 'research', 'tools', 'beyond'];
const panels = Object.fromEntries([...document.querySelectorAll('.panel')].map(p => [p.dataset.key, p]));
const dock = [...document.querySelectorAll('.dock button')];
const tags = Object.fromEntries([...document.querySelectorAll('.tag')].map(t => [t.dataset.key, t]));

let desk = null;
let current = null;
let hovered = null;

function fallback(err) {
  if (err) console.error(err);
  root.classList.add('no-webgl', 'loaded');
  Object.values(panels).forEach(p => p.removeAttribute('inert'));
}

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch (e) {
    return false;
  }
}

function updateInset() {
  if (!desk) return;
  if (!current) {
    desk.setInset(0, 0);
    return;
  }
  if (window.innerWidth <= 720) {
    const sheet = Math.min(window.innerHeight * 0.56, panels[current].scrollHeight);
    desk.setInset(0, sheet * 0.5);
  } else {
    const right = 32 + Math.min(440, window.innerWidth - 64);
    desk.setInset(right * 0.5, 0);
  }
}

function open(key, { fromKeyboard = false } = {}) {
  if (key === current) return;
  current = key;
  for (const [k, p] of Object.entries(panels)) {
    const on = k === key;
    p.classList.toggle('open', on);
    p.toggleAttribute('inert', !on);
  }
  dock.forEach(b => {
    const on = b.dataset.key === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (desk) {
    desk.setHover(null);
    desk.setFocus(key);
  }
  updateInset();
  if (key) {
    hint.classList.add('gone');
    if (fromKeyboard) panels[key].querySelector('.close').focus({ preventScroll: true });
    panels[key].scrollTop = 0;
  }
  const hash = key ? `#${key}` : window.location.pathname + window.location.search;
  history.replaceState(null, '', hash);
}

// ---- static UI wiring (works even before / without WebGL)

Object.values(panels).forEach(p => {
  p.setAttribute('inert', '');
  p.querySelector('.close').addEventListener('click', () => open(null));
});

dock.forEach(b => b.addEventListener('click', e => {
  const key = b.dataset.key;
  open(current === key ? null : key, { fromKeyboard: e.detail === 0 });
}));

document.getElementById('theme-toggle').addEventListener('click', () => {
  const dark = root.getAttribute('data-theme') !== 'dark';
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
  if (desk) desk.setNight(dark);
});

window.addEventListener('keydown', e => {
  if (root.classList.contains('no-webgl')) return;
  if (e.key === 'Escape' && current) {
    open(null);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const i = current ? KEYS.indexOf(current) : -1;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    open(KEYS[(i + step + KEYS.length) % KEYS.length]);
  }
});

window.addEventListener('resize', updateInset);

Object.values(tags).forEach(t => {
  t.addEventListener('click', () => open(t.dataset.key));
  // hovering the label lifts its object, same as hovering the object itself
  t.addEventListener('pointerenter', () => desk && desk.setHover(t.dataset.key));
  t.addEventListener('pointerleave', () => desk && desk.setHover(null));
});

// ---- scene

function onFrame(points) {
  for (const key of KEYS) {
    const p = points[key];
    const el = tags[key];
    // keep labels on screen and clear of the top bar
    const x = Math.min(Math.max(p.x, 70), window.innerWidth - 70);
    const y = Math.min(Math.max(p.y, 110), window.innerHeight - 90);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    el.classList.toggle('on', p.visible && !current);
    el.classList.toggle('hot', hovered === key && !current);
  }
}

async function boot() {
  if (!hasWebGL2()) return fallback();
  desk = new Desk(canvas, {
    video: document.getElementById('fusion-video'),
    reducedMotion,
    onHover: key => {
      hovered = key;
      canvas.classList.toggle('pointing', !!key && key !== current);
    },
    onSelect: key => {
      if (key) open(key);
      else if (current) open(null);
    },
    onFrame
  });
  desk.setNight(root.getAttribute('data-theme') === 'dark', true);
  if (new URLSearchParams(window.location.search).has('debug')) window.desk = desk;
  await desk.load(p => {
    loaderFill.style.transform = `scaleX(${p})`;
  });
  desk.start();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.add('loaded');
    const initial = window.location.hash.slice(1);
    if (KEYS.includes(initial)) setTimeout(() => open(initial), 900);
  }));
}

boot().catch(fallback);

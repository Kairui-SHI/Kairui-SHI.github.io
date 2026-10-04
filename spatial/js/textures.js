import * as THREE from 'three';

// Deterministic PRNG so the desk looks the same on every visit.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, renderer, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Kaya-style board face: the oak photo with ink grid lines and star points on top.
export function gobanFace(woodImage, { width, depth, spacingX, spacingZ }) {
  const W = 2048;
  const H = Math.round(W * depth / width);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  // crop the photo to the board's aspect without sampling past its edge
  const sw = Math.min(woodImage.width, woodImage.height * width / depth);
  ctx.drawImage(woodImage, 0, 0, sw, sw * depth / width, 0, 0, W, H);

  // warm the oak slightly towards kaya yellow
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(255, 232, 186)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const px = W / width;
  const cx = W / 2;
  const cz = H / 2;
  ctx.strokeStyle = 'rgba(22, 16, 10, 0.82)';
  ctx.lineWidth = 0.0009 * px;
  ctx.lineCap = 'square';
  for (let i = 0; i < 19; i++) {
    const x = cx + (i - 9) * spacingX * px;
    const z = cz + (i - 9) * spacingZ * px;
    ctx.beginPath();
    ctx.moveTo(x, cz - 9 * spacingZ * px);
    ctx.lineTo(x, cz + 9 * spacingZ * px);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 9 * spacingX * px, z);
    ctx.lineTo(cx + 9 * spacingX * px, z);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(22, 16, 10, 0.9)';
  for (const i of [3, 9, 15]) {
    for (const j of [3, 9, 15]) {
      ctx.beginPath();
      ctx.arc(cx + (i - 9) * spacingX * px, cz + (j - 9) * spacingZ * px, 0.0021 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

// Laptop keyboard well with keycaps.
export function keyboard() {
  const W = 1024;
  const H = 420;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9da0a6';
  ctx.fillRect(0, 0, W, H);
  const rows = [
    { n: 14, h: 0.55 },
    { n: 14, h: 1 },
    { n: 14, h: 1 },
    { n: 13, h: 1 },
    { n: 12, h: 1 },
    { n: 10, h: 1 }
  ];
  const pad = 10;
  const gap = 9;
  const unitH = (H - pad * 2 - gap * (rows.length - 1)) / rows.reduce((s, r) => s + r.h, 0);
  let y = pad;
  rows.forEach((r, ri) => {
    const h = unitH * r.h;
    const widths = new Array(r.n).fill(1);
    if (ri === 1) widths[r.n - 1] = 1.5;
    if (ri === 2) widths[0] = 1.5;
    if (ri === 3) { widths[0] = 1.8; widths[r.n - 1] = 1.8; }
    if (ri === 4) { widths[0] = 2.3; widths[r.n - 1] = 2.3; }
    if (ri === 5) widths[4] = 5.2;
    const total = widths.reduce((a, b) => a + b, 0);
    const unitW = (W - pad * 2 - gap * (r.n - 1)) / total;
    let x = pad;
    widths.forEach(wu => {
      const w = unitW * wu;
      ctx.fillStyle = '#1b1c1f';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, w - 4, h * 0.45, 6);
      ctx.fill();
      x += w + gap;
    });
    y += h + gap;
  });
  return c;
}

// Soft radial contact shadow for objects resting on the table.
export function contactShadow() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  // luminance encodes opacity (used as an alphaMap)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgb(220,220,220)');
  g.addColorStop(0.45, 'rgb(110,110,110)');
  g.addColorStop(1, 'rgb(0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

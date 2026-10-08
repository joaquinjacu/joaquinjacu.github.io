// Two little stick figures that sit on the headings and project titles. When
// the page scrolls past one, it waits a moment and then jumps onto a title that
// is on screen. They never stand on body text, so they don't get in the way of
// reading. Drawn on a fixed, click-through canvas.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const FIG_H = 21;
  const PLATFORM_SEL = 'h1, h2, .title';
  let W = 0, H = 0, dpr = 1, ink = '#1F1E1C', plats = [], lastScroll = 0;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = document.documentElement.clientWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }

  function readInk() {
    ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || ink;
  }

  // Each line of a heading or project title is a place to sit.
  function collectPlatforms() {
    const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.textContent.trim() && n.parentElement.closest(PLATFORM_SEL)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const range = document.createRange();
    const rects = [];
    for (let n; (n = walker.nextNode());) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 4 || r.height < 4) continue;
        rects.push({ x1: r.left + scrollX, x2: r.right + scrollX, top: r.top + scrollY, h: r.height });
      }
    }
    rects.sort((a, b) => a.top - b.top || a.x1 - b.x1);
    const merged = [];
    for (const r of rects) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.top - r.top) < 3 && r.x1 - last.x2 < 14) {
        last.x2 = Math.max(last.x2, r.x2);
        last.h = Math.max(last.h, r.h);
      } else merged.push({ ...r });
    }
    return merged
      .map(r => ({ x1: r.x1, x2: r.x2, y: r.top + r.h * 0.1 })) // roughly the top of the tallest letters
      .filter(p => p.x2 - p.x1 >= 26);
  }

  const onScreen = p => p.y > scrollY + 60 && p.y < scrollY + H - 30;

  // ---------------------------------------------------------------- figures
  const figs = [0, 1].map(() => ({
    x: 0, y: 0, plat: null, dir: Math.random() < 0.5 ? -1 : 1, state: 'wait',
    timer: 0, rot: 0, jump: null, off: 0, patience: rand(0.8, 1.5),
  }));

  function startJump(f, target, lx, { x0 = f.x, y0 = f.y, apex, flip = false } = {}) {
    const dist = Math.hypot(lx - x0, target.y - y0);
    const top = Math.min(y0, target.y) - (apex ?? (18 + Math.min(dist * 0.15, 45)));
    f.jump = {
      x0, y0, x1: lx, y1: target.y, t: 0,
      T: clamp(0.4 + dist / 700, 0.45, 1.1),
      cx: (x0 + lx) / 2, cy: 2 * top - (y0 + target.y) / 2, flip,
    };
    if (lx !== x0) f.dir = Math.sign(lx - x0);
    f.plat = target;
    f.state = 'jump';
  }

  // Jump onto a title that is on screen, coming in from the edge the figure
  // left by (or straight over, if it is already visible).
  function hopIn(f, flip = Math.random() < 0.25) {
    const other = figs.find(g => g !== f);
    let pool = plats.filter(p => onScreen(p) && p !== f.plat);
    const free = pool.filter(p => p !== other.plat);
    if (free.length) pool = free;
    if (!pool.length) return false;
    const p = pool[Math.floor(Math.random() * pool.length)];
    const lx = rand(p.x1 + 8, p.x2 - 8);
    const above = f.state === 'wait' || f.y < scrollY + 10;
    const below = f.y - FIG_H > scrollY + H - 10;
    if (above) startJump(f, p, lx, { x0: f.state === 'wait' ? lx : f.x, y0: scrollY - 30, apex: 12, flip });
    else if (below) startJump(f, p, lx, { y0: scrollY + H + 30, apex: 40, flip });
    else startJump(f, p, lx, { flip });
    f.off = 0;
    f.patience = rand(0.8, 1.5);
    return true;
  }

  function update(f, dt) {
    if (f.state === 'jump') {
      const j = f.jump;
      j.t += dt / j.T;
      const t = Math.min(j.t, 1), u = 1 - t;
      f.x = u * u * j.x0 + 2 * u * t * j.cx + t * t * j.x1;
      f.y = u * u * j.y0 + 2 * u * t * j.cy + t * t * j.y1;
      f.rot = j.flip ? t * Math.PI * 2 : 0;
      if (j.t >= 1) { f.state = 'land'; f.timer = 0.16; f.rot = 0; f.jump = null; }
    } else if (f.state === 'land') {
      if ((f.timer -= dt) <= 0) { f.state = 'sit'; f.timer = rand(3, 7); }
    } else if (f.state === 'sit') {
      if ((f.timer -= dt) <= 0) { f.dir *= -1; f.timer = rand(3, 8); } // look the other way now and then
    }
  }

  // ---------------------------------------------------------------- drawing
  function limb(x, y, a1, l1, a2, l2) {
    const kx = x + Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
    return [kx, ky, kx + Math.sin(a2) * l2, ky + Math.cos(a2) * l2];
  }

  // Angles are measured from straight down; positive points the way the figure faces.
  function pose(f) {
    switch (f.state) {
      case 'jump': return { legs: [[1.0, -0.2], [0.5, -0.6]], arms: [[2.5, 2.8], [-2.5, -2.8]] };
      case 'land': return { legs: [[1.0, -0.9], [0.7, -1.0]], arms: [[0.9, 1.4], [0.6, 1.2]] };
      default:     return { legs: [[1.9, 1.15], [1.65, 1.5]], arms: [[-0.6, -0.35], [1.0, 1.6]] }; // sitting, legs out, leaning on one hand
    }
  }

  function draw(f) {
    const { legs, arms } = pose(f);
    const L1 = 4.6, L2 = 4.4, A1 = 3.8, A2 = 3.6;
    const feet = legs.map(([a, b]) => limb(0, 0, a, L1, b, L2));
    const hipY = -Math.max(feet[0][3], feet[1][3], 0.5);
    const shY = hipY - 5.2, neckY = hipY - 6.4, headY = neckY - 3.2;

    ctx.save();
    ctx.translate(f.x - scrollX, f.y - scrollY);
    if (f.rot) { ctx.translate(0, hipY - 2); ctx.rotate(f.rot * f.dir); ctx.translate(0, -(hipY - 2)); }
    ctx.scale(f.dir, 1);
    ctx.strokeStyle = ctx.fillStyle = ink;
    ctx.lineWidth = 1.7;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [kx, ky, fx, fy] of feet) { ctx.moveTo(0, hipY); ctx.lineTo(kx, hipY + ky); ctx.lineTo(fx, hipY + fy); }
    for (const [a, b] of arms) {
      const [ex, ey, hx, hy] = limb(0, shY, a, A1, b, A2);
      ctx.moveTo(0, shY); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy);
    }
    ctx.moveTo(0, hipY); ctx.lineTo(0, neckY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.4, headY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const f of figs) {
      if (f.state === 'wait') continue;
      update(f, dt);
      const visible = f.y > scrollY + 10 && f.y - FIG_H < scrollY + H - 10;
      if (f.state === 'sit') {
        // Scrolled past: wait a little, and for the scrolling to settle, then come back.
        f.off = visible ? 0 : f.off + dt;
        if (f.off > f.patience && now - lastScroll > 250) hopIn(f);
      }
      if (f.y > scrollY - 60 && f.y - FIG_H < scrollY + H + 60) draw(f);
    }
    requestAnimationFrame(frame);
  }

  function relayout() {
    resize();
    plats = collectPlatforms();
    for (const f of figs) {
      if (!f.plat || f.state === 'jump') continue;
      let best = null, bd = Infinity;
      for (const p of plats) {
        const d = Math.abs(p.y - f.y) + Math.max(0, p.x1 - f.x, f.x - p.x2);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { f.plat = best; f.y = best.y; f.x = clamp(f.x, best.x1 + 4, best.x2 - 4); }
    }
  }

  // Click a figure and it flips over to another title.
  document.addEventListener('pointerdown', e => {
    const px = e.clientX + scrollX, py = e.clientY + scrollY;
    for (const f of figs) {
      if ((f.state === 'sit' || f.state === 'land') && Math.hypot(px - f.x, py - (f.y - 8)) < 22) hopIn(f, true);
    }
  });

  addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relayout, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readInk);

  function start() {
    readInk();
    resize();
    plats = collectPlatforms();
    figs.forEach((f, i) => setTimeout(function tryDrop() { if (!hopIn(f, false)) setTimeout(tryDrop, 500); }, 500 + i * 900));
    requestAnimationFrame(frame);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
})();

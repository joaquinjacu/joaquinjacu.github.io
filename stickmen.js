// Little stick figures that walk along the lines of text and jump between them.
// Platforms are the line boxes of the text in <main>; figures live in page
// coordinates and are drawn on a fixed, click-through canvas.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const FIG_H = 21;
  let W = 0, H = 0, dpr = 1, ink = '#1F1E1C', plats = [];
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

  // Only headings and project titles are platforms, so nobody walks across
  // text people are reading.
  const PLATFORM_SEL = 'h1, h2, .title';
  function collectPlatforms() {
    const root = document.querySelector('main');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
    for (const p of merged) p.y = p.top + p.h * 0.1; // roughly the top of the tallest letters

    // A figure can only stand where the line above leaves headroom, so cut out
    // the stretches that sit right under other text.
    const out = [];
    for (const p of merged) {
      let segs = [[p.x1, p.x2]];
      for (const q of merged) {
        if (q === p || q.top >= p.top || q.top + q.h - 4 <= p.y - FIG_H) continue;
        const a = q.x1 - 6, b = q.x2 + 6;
        segs = segs.flatMap(([s1, s2]) => (b <= s1 || a >= s2) ? [[s1, s2]]
          : [[s1, Math.min(s2, a)], [Math.max(s1, b), s2]].filter(([u, v]) => v > u));
      }
      for (const [x1, x2] of segs) if (x2 - x1 >= 26) out.push({ x1, x2, y: p.y });
    }
    return out;
  }

  const inView = p => p.y > scrollY + 30 && p.y < scrollY + H - 10;

  // ---------------------------------------------------------------- figures
  const figs = [];

  function newFig() {
    return { x: 0, y: 0, plat: null, dir: Math.random() < 0.5 ? -1 : 1, state: 'idle',
      phase: rand(0, 6), speed: rand(32, 48), timer: rand(1, 3), rot: 0, jump: null, off: 0 };
  }

  function startJump(f, target, lx, opts = {}) {
    const x0 = opts.x0 ?? f.x, y0 = opts.y0 ?? f.y, x1 = lx, y1 = target.y;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const apex = Math.min(y0, y1) - (opts.apex ?? (18 + Math.min(dist * 0.15, 45)));
    f.jump = {
      x0, y0, x1, y1, t: 0,
      T: clamp(0.4 + dist / 700, 0.45, 1.1),
      cx: (x0 + x1) / 2, cy: 2 * apex - (y0 + y1) / 2,
      flip: opts.flip ?? Math.random() < 0.15,
    };
    if (x1 !== x0) f.dir = Math.sign(x1 - x0);
    f.plat = target;
    f.state = 'jump';
  }

  function tryJump(f, flip) {
    const c = [];
    for (const p of plats) {
      if (p === f.plat) continue;
      const dy = p.y - f.y;
      if (dy < -260 || dy > 340) continue;
      const nx = clamp(f.x, p.x1 + 8, p.x2 - 8);
      const dx = nx - f.x;
      if (Math.abs(dx) > 260) continue;
      let w = 1;
      if (Math.sign(dx) === f.dir) w *= 2.2;
      if (inView(p)) w *= 3;
      if (Math.abs(dy) < 4) w *= 0.6;
      c.push({ p, w });
    }
    if (!c.length) return false;
    let r = Math.random() * c.reduce((s, o) => s + o.w, 0), pick = c[0].p;
    for (const o of c) { if ((r -= o.w) <= 0) { pick = o.p; break; } }
    const lx = clamp(f.x + f.dir * rand(20, 110), pick.x1 + 8, pick.x2 - 8);
    startJump(f, pick, lx, { flip });
    return true;
  }

  // Drop a figure in from above the viewport onto a visible line.
  function dropIn(f) {
    const vis = plats.filter(inView);
    const pool = vis.length ? vis : plats;
    if (!pool.length) return;
    const p = pool[Math.floor(Math.random() * pool.length)];
    const lx = rand(p.x1 + 8, p.x2 - 8);
    startJump(f, p, lx, { x0: lx + rand(-60, 60), y0: scrollY - 40, apex: 10, flip: false });
    f.off = 0;
  }

  function update(f, dt) {
    if (f.state === 'jump') {
      const j = f.jump;
      j.t += dt / j.T;
      const t = Math.min(j.t, 1), u = 1 - t;
      f.x = u * u * j.x0 + 2 * u * t * j.cx + t * t * j.x1;
      f.y = u * u * j.y0 + 2 * u * t * j.cy + t * t * j.y1;
      f.rot = j.flip ? t * Math.PI * 2 : 0;
      if (j.t >= 1) { f.state = 'land'; f.timer = 0.14; f.rot = 0; f.jump = null; }
      return;
    }
    if (f.state === 'land') {
      if ((f.timer -= dt) <= 0) { f.state = 'walk'; f.timer = rand(1, 3); }
      return;
    }
    if (f.state === 'idle') {
      f.timer -= dt;
      if (f.timer < 0.6 && !f.looked) { f.dir *= -1; f.looked = true; }
      if (f.timer <= 0) { f.state = 'walk'; f.timer = rand(1.2, 3); f.looked = false; }
      return;
    }
    // walking
    const p = f.plat;
    f.x += f.dir * f.speed * dt;
    f.phase += dt * f.speed * 0.3;
    if (f.x > p.x2 - 4 || f.x < p.x1 + 4) {
      f.x = clamp(f.x, p.x1 + 4, p.x2 - 4);
      if (!(Math.random() < 0.75 && tryJump(f))) f.dir *= -1;
      return;
    }
    if ((f.timer -= dt) <= 0) {
      const r = Math.random();
      if (r < 0.45 && tryJump(f)) return;
      if (r < 0.7) { f.state = 'idle'; f.timer = rand(1, 2.4); return; }
      f.timer = rand(1, 3);
    }
  }

  // ---------------------------------------------------------------- drawing
  function limb(x, y, a1, l1, a2, l2) {
    const kx = x + Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
    return [kx, ky, kx + Math.sin(a2) * l2, ky + Math.cos(a2) * l2];
  }

  function pose(f) {
    const s = Math.sin(f.phase);
    switch (f.state) {
      case 'walk': return { legs: [[0.5 * s, 0.5 * s - 0.35], [-0.5 * s, -0.5 * s - 0.35]],
                            arms: [[-0.55 * s, -0.55 * s + 0.4], [0.55 * s, 0.55 * s + 0.4]] };
      case 'jump': return { legs: [[1.0, -0.2], [0.5, -0.6]], arms: [[2.5, 2.8], [-2.5, -2.8]] };
      case 'land': return { legs: [[1.0, -0.9], [0.7, -1.0]], arms: [[0.9, 1.4], [0.6, 1.2]] };
      default:     return { legs: [[0.12, 0.12], [-0.12, -0.12]], arms: [[0.15, 0.2], [-0.15, -0.2]] };
    }
  }

  function draw(f) {
    const { legs, arms } = pose(f);
    const L1 = 4.6, L2 = 4.4, A1 = 3.8, A2 = 3.6;
    const feet = legs.map(([a, b]) => limb(0, 0, a, L1, b, L2));
    const hipY = -Math.max(feet[0][3], feet[1][3]);
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
      const visible = f.y > scrollY - 60 && f.y < scrollY + H + 60;
      f.off = visible || f.state === 'jump' ? 0 : f.off + dt;
      if (f.off > 2.5) dropIn(f);
      if (visible) draw(f);
    }
    requestAnimationFrame(frame);
  }

  function relayout() {
    resize();
    plats = collectPlatforms();
    for (const f of figs) {
      if (!f.plat || f.state === 'jump') continue;
      // land on whichever line is now closest to where the figure stood
      let best = null, bd = Infinity;
      for (const p of plats) {
        const d = Math.abs(p.y - f.y) + Math.max(0, p.x1 - f.x, f.x - p.x2);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { f.plat = best; f.y = best.y; f.x = clamp(f.x, best.x1 + 4, best.x2 - 4); }
    }
  }

  // Click a figure to make it flip.
  document.addEventListener('pointerdown', e => {
    const px = e.clientX + scrollX, py = e.clientY + scrollY;
    for (const f of figs) {
      if (f.state !== 'jump' && Math.hypot(px - f.x, py - (f.y - 10)) < 22) tryJump(f, true);
    }
  });

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relayout, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readInk);

  function start() {
    readInk();
    resize();
    plats = collectPlatforms();
    const n = W < 520 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const f = newFig();
      figs.push(f);
      setTimeout(() => dropIn(f), 400 + i * 700);
      f.state = 'wait';
    }
    requestAnimationFrame(frame);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
})();

/* Utilidades compartidas */
(function () {
  const FV = (window.FV = {});

  FV.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // desfase entre reloj del servidor y del dispositivo
  FV.offset = 0;
  FV.syncClock = (serverNow) => { if (serverNow) FV.offset = serverNow - Date.now(); };
  FV.now = () => Date.now() + FV.offset;

  FV.fmtTime = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
  };

  FV.initials = (p) => ((p.nombre || '?')[0] + ((p.apellidos || '')[0] || '')).toUpperCase();
  FV.fullName = (p) => `${p.nombre} ${p.apellidos}`.trim();

  FV.photoHtml = (p, cls = '') =>
    p.photo
      ? `<img class="${cls}" src="${FV.esc(p.photo)}" alt="${FV.esc(FV.fullName(p))}" loading="lazy" decoding="async">`
      : `<div class="avatar-fallback ${cls}">${FV.esc(FV.initials(p))}</div>`;

  // animación suave de números
  FV.tweenNumber = (el, to, { decimals = 0, suffix = '', duration = 700 } = {}) => {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = to.toFixed(decimals) + suffix; return; }
    const t0 = performance.now();
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(decimals) + suffix;
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };

  /* Confeti dorado / tricolor en canvas (sin dependencias externas) */
  FV.confetti = (opts = {}) => {
    const { duration = 6000, count = 260, colors = ['#f3dc9a', '#d6b25e', '#fff6dc', '#ffcc00', '#1b3f9b', '#cf142b', '#ffffff'] } = opts;
    let c = document.getElementById('fv-confetti');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'fv-confetti';
      Object.assign(c.style, { position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 });
      document.body.appendChild(c);
    }
    const ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
    resize();
    const W = () => c.width, H = () => c.height;
    const parts = [];
    const spawn = (n, burst) => {
      for (let i = 0; i < n; i++) {
        const fromLeft = Math.random() < .5;
        parts.push({
          x: burst ? (fromLeft ? 0 : W()) : Math.random() * W(),
          y: burst ? H() * .7 : -20 * dpr,
          vx: burst ? (fromLeft ? 1 : -1) * (6 + Math.random() * 12) * dpr : (Math.random() - .5) * 2 * dpr,
          vy: burst ? -(12 + Math.random() * 14) * dpr : (2 + Math.random() * 3) * dpr,
          w: (6 + Math.random() * 8) * dpr, h: (8 + Math.random() * 14) * dpr,
          r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
          c: colors[(Math.random() * colors.length) | 0],
          star: Math.random() < .15,
        });
      }
    };
    spawn(count / 2, true);
    const t0 = performance.now();
    let last = t0;
    cancelAnimationFrame(c._raf);
    const frame = (t) => {
      const dt = Math.min(2, (t - last) / 16.7); last = t;
      if (t - t0 < duration) spawn(3, false);
      ctx.clearRect(0, 0, W(), H());
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += .25 * dpr * dt; p.vx *= .99; p.vy = Math.min(p.vy, 6 * dpr);
        p.x += p.vx * dt + Math.sin((t + i) / 300) * .6; p.y += p.vy * dt; p.r += p.vr * dt;
        if (p.y > H() + 40) { parts.splice(i, 1); continue; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.star) {
          ctx.beginPath();
          for (let k = 0; k < 10; k++) { const rr = k % 2 ? p.w * .4 : p.w; const a = (k * Math.PI) / 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.fill();
        } else {
          ctx.scale(1, Math.cos(t / 200 + i)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (parts.length || t - t0 < duration) c._raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W(), H());
    };
    c._raf = requestAnimationFrame(frame);
  };

  FV.toast = (msg, type = 'info') => {
    let wrap = document.getElementById('fv-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fv-toasts';
      Object.assign(wrap.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 10000, display: 'grid', gap: '8px', width: 'min(92vw, 420px)' });
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    const bg = type === 'error' ? 'linear-gradient(135deg,#5a0f1a,#8e1a2a)' : type === 'ok' ? 'linear-gradient(135deg,#0d3b2a,#14684a)' : 'linear-gradient(135deg,#163057,#0f2142)';
    Object.assign(t.style, { background: bg, color: '#fff', padding: '12px 16px', borderRadius: '12px', boxShadow: '0 0 0 1px rgba(214,178,94,.4), 0 10px 30px rgba(0,0,0,.5)', fontWeight: 600, fontSize: '.92rem', textAlign: 'center', transition: 'opacity .3s, transform .3s', opacity: 0, transform: 'translateY(10px)' });
    t.textContent = msg;
    wrap.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = 1; t.style.transform = 'none'; });
    setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 3400);
  };
})();

// Score bug drawing engine. Everything is drawn on a canvas so the same picture
// shows on screen and gets baked into recorded video.
// drawBug(ctx, W, H, S, now)  S = { style, away, home, qtr, clock, running, dd, banner }
//   team = { abbr, name, logo:Image|null, c1, c2, score, to, ball, pulseAt }

(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function hexToRgb(h) {
    h = (h || "#888888").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb(a) { return `rgb(${a.map(v => Math.round(clamp(v, 0, 255))).join(",")})`; }
  // amt > 0 lightens toward white, amt < 0 darkens toward black
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    return rgb(c.map(v => amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  }
  function lum(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return .2126 * r + .7152 * g + .0722 * b;
  }
  // readable text color on a background
  const ink = bg => lum(bg) > .45 ? "#111" : "#fff";

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function vgrad(ctx, y, h, top, bottom) {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, top); g.addColorStop(1, bottom); return g;
  }
  // set font, shrinking until text fits maxW; returns px size used
  function fit(ctx, text, weight, size, family, maxW, stretch) {
    let s = size;
    for (; s > 6; s -= 1) {
      ctx.font = `${stretch ? stretch + " " : ""}${weight} ${s}px ${family}`;
      if (ctx.measureText(text).width <= maxW) break;
    }
    return s;
  }
  function text(ctx, str, x, y, color, align = "left", base = "middle") {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(str, x, y);
  }
  function logo(ctx, img, cx, cy, size, fallback, fallbackColor) {
    if (img && img.complete && img.naturalWidth) {
      const r = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * r, h = img.naturalHeight * r;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = size * .08; ctx.shadowOffsetY = size * .03;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h); ctx.restore();
    } else {
      fit(ctx, fallback, 800, size * .5, "Barlow", size * .9);
      text(ctx, fallback, cx, cy + size * .03, fallbackColor || "#fff", "center");
    }
  }
  function pips(ctx, x, y, n, w, h, gap, on, off) {
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < n ? on : off; rr(ctx, x + i * (w + gap), y, w, h, h / 2); ctx.fill(); }
  }
  function ball(ctx, cx, cy, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.35);
    ctx.fillStyle = "#8b4a1f"; ctx.beginPath(); ctx.ellipse(0, 0, s, s * .58, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = s * .12; ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(-s * .42, 0); ctx.lineTo(s * .42, 0);
    for (const k of [-.25, 0, .25]) { ctx.moveTo(s * k, -s * .16); ctx.lineTo(s * k, s * .16); }
    ctx.stroke(); ctx.restore();
  }
  function pulse(ctx, t, now, x, y, w, h) {
    if (!t) return; const age = (now - t) / 1000; if (age < 0 || age > 1.4) return;
    ctx.save(); ctx.globalAlpha = .55 * (1 - age / 1.4); ctx.fillStyle = "#fff"; ctx.fillRect(x, y, w, h); ctx.restore();
  }
  function clockStr(S) {
    if (S.qtr === "HALF") return { q: "HALFTIME", c: "" };
    if (S.qtr === "FINAL") return { q: "FINAL", c: "" };
    const q = { 1: "1ST", 2: "2ND", 3: "3RD", 4: "4TH" }[S.qtr] || S.qtr;
    return { q, c: S.clock };
  }

  // ---------- Style 1: PRIME (FOX-inspired, team-color bar + yellow down) ----------
  function prime(ctx, W, H, S, now, L) {
    const { u } = L, h = 80 * u;
    const seg = { lg: 84 * u, nm: 150 * u, sc: 96 * u };
    const teamW = seg.lg + seg.nm + seg.sc, div = 4 * u, clockW = 200 * u, ddW = S.dd ? 170 * u : 0;
    const total = teamW * 2 + div * 2 + clockW + ddW;
    let x = (W - total) / 2; const y = L.y;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 24 * u; ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = "#000"; ctx.fillRect(x, y, total, h); ctx.restore();
    for (const side of ["away", "home"]) {
      const T = S[side];
      ctx.fillStyle = shade(T.c1, -.35); ctx.fillRect(x, y, seg.lg, h);
      logo(ctx, T.logo, x + seg.lg / 2, y + h / 2, 62 * u, T.abbr, ink(T.c1));
      ctx.fillStyle = vgrad(ctx, y, h, shade(T.c1, .14), T.c1); ctx.fillRect(x + seg.lg, y, seg.nm, h);
      ctx.fillStyle = vgrad(ctx, y, h, shade(T.c1, -.12), shade(T.c1, -.3)); ctx.fillRect(x + seg.lg + seg.nm, y, seg.sc, h);
      ctx.fillStyle = T.c2; ctx.fillRect(x, y + h - 5 * u, teamW, 5 * u);
      const tc = ink(T.c1);
      fit(ctx, T.abbr, 800, 44 * u, "Barlow", 96 * u);
      text(ctx, T.abbr, x + seg.lg + 16 * u, y + 34 * u, tc);
      pips(ctx, x + seg.lg + 17 * u, y + 56 * u, T.to, 22 * u, 5 * u, 5 * u, tc, tc === "#fff" ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.2)");
      if (T.ball) ball(ctx, x + seg.lg + seg.nm - 20 * u, y + 34 * u, 12 * u);
      ctx.font = `800 ${62 * u}px Barlow`;
      text(ctx, String(T.score), x + seg.lg + seg.nm + seg.sc / 2, y + h / 2 + 2 * u, ink(shade(T.c1, -.2)), "center");
      pulse(ctx, T.pulseAt, now, x + seg.lg + seg.nm, y, seg.sc, h);
      x += teamW;
      ctx.fillStyle = "#fff"; ctx.fillRect(x, y, div, h); x += div;
    }
    ctx.fillStyle = vgrad(ctx, y, h, "#1d1d1f", "#050505"); ctx.fillRect(x, y, clockW, h);
    const c = clockStr(S);
    if (c.c) {
      ctx.font = `700 ${40 * u}px Barlow`; text(ctx, c.q, x + 24 * u, y + h / 2 + 2 * u, "#fff");
      ctx.font = `700 ${40 * u}px Barlow`; text(ctx, c.c, x + clockW - 22 * u, y + h / 2 + 2 * u, S.running ? "#fff" : "#ffd23f", "right");
    } else { fit(ctx, c.q, 800, 40 * u, "Barlow", clockW - 30 * u); text(ctx, c.q, x + clockW / 2, y + h / 2 + 2 * u, "#fff", "center"); }
    x += clockW;
    if (ddW) {
      ctx.fillStyle = vgrad(ctx, y, h, "#ffe066", "#f5c518"); ctx.fillRect(x, y, ddW, h);
      fit(ctx, S.dd, 800, 38 * u, "Barlow", ddW - 24 * u); text(ctx, S.dd, x + ddW / 2, y + h / 2 + 2 * u, "#111", "center");
    }
    return { x: (W - total) / 2, w: total, h };
  }

  // ---------- Style 2: NIGHT (ESPN / Sunday Night-inspired, dark glass) ----------
  function night(ctx, W, H, S, now, L) {
    const { u } = L, h = 78 * u, teamW = 336 * u, clockW = 170 * u, ddW = S.dd ? 176 * u : 0, gap = ddW ? 10 * u : 0;
    const barW = teamW * 2 + clockW + 2 * u, total = barW + gap + ddW;
    const x0 = (W - total) / 2, y = L.y;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 26 * u; ctx.shadowOffsetY = 10 * u;
    rr(ctx, x0, y, barW, h, 8 * u); ctx.fillStyle = vgrad(ctx, y, h, "#2c3039", "#0b0c10"); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x0, y, barW, h, 8 * u); ctx.clip();
    // glass sheen
    ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(x0, y, barW, h * .45);
    let x = x0;
    for (const side of ["away", "home"]) {
      const T = S[side];
      // slanted logo chip that rises above the bar
      ctx.restore(); ctx.save();
      const cx = x - 4 * u, cy = y - 16 * u, cw = 104 * u, ch = h + 16 * u;
      ctx.beginPath(); ctx.moveTo(cx + cw * .12, cy); ctx.lineTo(cx + cw, cy); ctx.lineTo(cx + cw * .88, cy + ch); ctx.lineTo(cx, cy + ch); ctx.closePath();
      const g = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch); g.addColorStop(0, shade(T.c1, .2)); g.addColorStop(.7, T.c1); g.addColorStop(1, shade(T.c1, -.25));
      ctx.fillStyle = g; ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 10 * u; ctx.fill();
      ctx.shadowColor = "transparent";
      logo(ctx, T.logo, cx + cw / 2, cy + ch / 2, 70 * u, T.abbr, ink(T.c1));
      ctx.restore(); ctx.save(); rr(ctx, x0, y, barW, h, 8 * u); ctx.clip();
      const nx = x + 112 * u, scW = 84 * u;
      const nameW = teamW - 112 * u - scW - (T.ball ? 34 * u : 8 * u);
      fit(ctx, (T.name || T.abbr).toUpperCase(), 700, 34 * u, "SairaC", nameW);
      text(ctx, (T.name || T.abbr).toUpperCase(), nx, y + 31 * u, "#fff");
      pips(ctx, nx + 1 * u, y + 52 * u, T.to, 20 * u, 5 * u, 5 * u, T.c2, "rgba(255,255,255,.18)");
      if (T.ball) ball(ctx, x + teamW - scW - 18 * u, y + 31 * u, 11 * u);
      ctx.font = `800 ${56 * u}px SairaC`;
      text(ctx, String(T.score), x + teamW - 16 * u, y + h / 2 + 3 * u, "#fff", "right");
      pulse(ctx, T.pulseAt, now, x + teamW - scW - 6 * u, y, scW + 6 * u, h);
      ctx.fillStyle = T.c2; ctx.fillRect(x + 2 * u, y + h - 5 * u, teamW - 4 * u, 5 * u);
      x += teamW;
      ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(x, y + 12 * u, 1 * u, h - 24 * u); x += 1 * u;
    }
    const c = clockStr(S);
    if (c.c) {
      ctx.font = `600 ${19 * u}px SairaC`; text(ctx, c.q + " QTR", x + clockW / 2, y + 24 * u, "#a9adb8", "center");
      ctx.font = `700 ${40 * u}px SairaC`; text(ctx, c.c, x + clockW / 2, y + 52 * u, S.running ? "#fff" : "#ffcf3f", "center");
    } else { fit(ctx, c.q, 800, 36 * u, "SairaC", clockW - 24 * u); text(ctx, c.q, x + clockW / 2, y + h / 2 + 2 * u, "#fff", "center"); }
    ctx.restore();
    if (ddW) {
      const dx = x0 + barW + gap;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 8 * u;
      rr(ctx, dx, y, ddW, h, 8 * u); ctx.fillStyle = vgrad(ctx, y, h, "#f2662a", "#c23b0b"); ctx.fill(); ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,.12)"; rr(ctx, dx, y, ddW, h * .45, 8 * u); ctx.fill();
      fit(ctx, S.dd, 800, 36 * u, "SairaC", ddW - 24 * u); text(ctx, S.dd, dx + ddW / 2, y + h / 2 + 2 * u, "#fff", "center");
    }
    return { x: x0, w: total, h };
  }

  // ---------- Style 3: CLEAN (CBS-inspired, white bar + navy clock) ----------
  function clean(ctx, W, H, S, now, L) {
    const { u } = L, h = 80 * u, lgW = 86 * u, nmW = 140 * u, scW = 96 * u, teamW = lgW + nmW + scW, clockW = 210 * u;
    const total = teamW * 2 + 5 * u + clockW, x0 = (W - total) / 2, y = L.y;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 8 * u;
    rr(ctx, x0, y, total, h, 6 * u); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x0, y, total, h, 6 * u); ctx.clip();
    ctx.fillStyle = vgrad(ctx, y, h, "#ffffff", "#e9ebef"); ctx.fillRect(x0, y, total, h);
    let x = x0;
    for (const side of ["away", "home"]) {
      const T = S[side];
      ctx.fillStyle = vgrad(ctx, y, h, shade(T.c1, .1), shade(T.c1, -.15)); ctx.fillRect(x, y, lgW, h);
      logo(ctx, T.logo, x + lgW / 2, y + h / 2, 64 * u, T.abbr, ink(T.c1));
      const abC = lum(T.c1) > .6 ? shade(T.c1, -.5) : T.c1;
      fit(ctx, T.abbr, 600, 54 * u, "Teko", nmW - 40 * u);
      text(ctx, T.abbr, x + lgW + 16 * u, y + 37 * u, abC);
      pips(ctx, x + lgW + 17 * u, y + 60 * u, T.to, 20 * u, 5 * u, 5 * u, abC, "#cdd0d6");
      if (T.ball) ball(ctx, x + lgW + nmW - 18 * u, y + 36 * u, 11 * u);
      ctx.fillStyle = "#d9dce1"; ctx.fillRect(x + lgW + nmW, y + 10 * u, 2 * u, h - 20 * u);
      ctx.font = `600 ${76 * u}px Teko`; text(ctx, String(T.score), x + lgW + nmW + scW / 2, y + h / 2 + 7 * u, "#111", "center");
      pulse(ctx, T.pulseAt, now, x + lgW + nmW, y, scW, h);
      x += teamW;
      if (side === "away") { ctx.fillStyle = "#111"; ctx.fillRect(x, y, 5 * u, h); x += 5 * u; }
    }
    ctx.fillStyle = vgrad(ctx, y, h, "#163a85", "#0a2560"); ctx.fillRect(x, y, clockW, h);
    const c = clockStr(S);
    if (c.c) {
      ctx.font = `500 ${48 * u}px Teko`; text(ctx, c.q, x + 24 * u, y + h / 2 + 5 * u, "#fff");
      text(ctx, c.c, x + clockW - 22 * u, y + h / 2 + 5 * u, S.running ? "#fff" : "#ffcc00", "right");
    } else { fit(ctx, c.q, 500, 48 * u, "Teko", clockW - 30 * u); text(ctx, c.q, x + clockW / 2, y + h / 2 + 5 * u, "#fff", "center"); }
    ctx.restore();
    if (S.dd) {
      ctx.font = `500 ${36 * u}px Teko`; const tw = Math.max(clockW, ctx.measureText(S.dd).width + 44 * u);
      const dx = x0 + total - tw, dy = y + h - 2 * u, dh = 44 * u;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 12 * u; ctx.shadowOffsetY = 5 * u;
      rr(ctx, dx, dy, tw, dh, 6 * u); ctx.fillStyle = "#0a2560"; ctx.fill(); ctx.restore();
      ctx.fillStyle = "#0a2560"; ctx.fillRect(dx, dy, tw, 8 * u);
      ctx.fillStyle = "#ffcc00"; ctx.fillRect(dx, dy + 2 * u, tw, 4 * u);
      text(ctx, S.dd, dx + tw / 2, dy + dh / 2 + 6 * u, "#fff", "center");
    }
    return { x: x0, w: total, h: h + (S.dd ? 44 * u : 0) };
  }

  // ---------- Banners: TOUCHDOWN / FIELD GOAL / FLAG / TIMEOUT ----------
  function banner(ctx, W, H, S, now, box, u) {
    const B = S.banner; if (!B) return;
    const age = (now - B.start) / 1000, dur = B.dur || 4;
    if (age < 0 || age > dur) return;
    const inP = clamp(age / .35, 0, 1), outP = clamp((dur - age) / .35, 0, 1);
    const p = Math.min(inP, outP), e = 1 - (1 - p) ** 3;
    const bh = 70 * u, by = box.y - bh - 14 * u, bw = box.w, bx = box.x;
    const T = B.team ? S[B.team] : null;
    const bg = B.kind === "flag" ? "#ffd400" : T ? T.c1 : "#111";
    const fg = B.kind === "flag" ? "#111" : ink(bg);
    ctx.save();
    const vis = bw * e; ctx.beginPath(); ctx.rect(bx + (bw - vis) / 2, by - 30 * u, vis, bh + 40 * u); ctx.clip();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 6 * u;
    rr(ctx, bx, by, bw, bh, 8 * u);
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, shade(bg, -.25)); g.addColorStop(.5, shade(bg, .1)); g.addColorStop(1, shade(bg, -.25));
    ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = "transparent";
    // moving shine
    const sx = bx + ((age * 900 * u) % (bw + 300 * u)) - 150 * u;
    const sg = ctx.createLinearGradient(sx - 80 * u, 0, sx + 80 * u, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(.5, "rgba(255,255,255,.22)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg; rr(ctx, bx, by, bw, bh, 8 * u); ctx.fill();
    if (T) { ctx.fillStyle = T.c2; ctx.fillRect(bx, by + bh - 5 * u, bw, 5 * u); }
    let tx = bx + 26 * u;
    if (T) { logo(ctx, T.logo, bx + 52 * u, by + bh / 2, 58 * u, T.abbr, fg); tx = bx + 100 * u; }
    const big = B.text.toUpperCase();
    ctx.font = `italic 800 ${50 * u}px Barlow`;
    const bigW = Math.min(ctx.measureText(big).width, bw * .55);
    fit(ctx, big, "italic 800", 50 * u, "Barlow", bw * .55);
    text(ctx, big, tx, by + bh / 2 + 3 * u, fg);
    if (B.sub) {
      fit(ctx, B.sub.toUpperCase(), 600, 28 * u, "Barlow", bx + bw - (tx + bigW + 40 * u));
      text(ctx, B.sub.toUpperCase(), bx + bw - 24 * u, by + bh / 2 + 3 * u, fg, "right");
    }
    ctx.restore();
  }

  function drawBug(ctx, W, H, S, now, opts) {
    const landscape = W >= H;
    const bugFrac = (opts && opts.frac) || (landscape ? .64 : .96);
    const u = (W * bugFrac) / 1000;
    const y = H - (landscape ? H * .065 : H * .04) - 80 * u - (S.style === "clean" && S.dd ? 40 * u : 0);
    const L = { u, y };
    const box = (S.style === "night" ? night : S.style === "clean" ? clean : prime)(ctx, W, H, S, now, L);
    box.y = y;
    banner(ctx, W, H, S, now, box, u);
  }

  window.ScoreBug = { drawBug, shade, ink, lum, hexToRgb };
})();

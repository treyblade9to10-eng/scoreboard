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

  const ddWidth = (S, u) => S.dd ? (S.spot ? 290 : 170) * u : 0;
  // down & distance, plus ball spot on the right when shown
  function ddText(ctx, S, x, y, w, h, u, fam, col, sub, dy = 2) {
    const cy = y + h / 2 + dy * u;
    if (!S.spot) { fit(ctx, S.dd, 800, 38 * u, fam, w - 24 * u); text(ctx, S.dd, x + w / 2, cy, col, "center"); return; }
    const dw = w * .56;
    fit(ctx, S.dd, 800, 36 * u, fam, dw - 18 * u); text(ctx, S.dd, x + dw / 2 + 4 * u, cy, col, "center");
    ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = col; ctx.fillRect(x + dw, y + h * .24, 2 * u, h * .52); ctx.restore();
    fit(ctx, S.spot, 700, 28 * u, fam, w - dw - 20 * u); text(ctx, S.spot, x + dw + (w - dw) / 2, cy, sub, "center");
  }
  function para(ctx, x, y, w, h, k) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w + k, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
  function shadowOn(ctx, u, a = .5) { ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 6 * u; }
  const ballTeam = S => S.away.ball ? S.away : S.home.ball ? S.home : null;

  // ---------- Style 1: PRIME (FOX-inspired, team-color bar + yellow down) ----------
  function prime(ctx, W, H, S, now, L) {
    const { u } = L, h = 80 * u;
    const seg = { lg: 84 * u, nm: 150 * u, sc: 96 * u };
    const teamW = seg.lg + seg.nm + seg.sc, div = 4 * u, clockW = 200 * u, ddW = ddWidth(S, u);
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
      ddText(ctx, S, x, y, ddW, h, u, "Barlow", "#111", "#4a3a00");
    }
    return { x: (W - total) / 2, w: total, h };
  }

  // ---------- Style 2: NIGHT (ESPN / Sunday Night-inspired, dark glass) ----------
  function night(ctx, W, H, S, now, L) {
    const { u } = L, h = 78 * u, teamW = 336 * u, clockW = 170 * u, ddW = ddWidth(S, u), gap = ddW ? 10 * u : 0;
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
      ddText(ctx, S, dx, y, ddW, h, u, "SairaC", "#fff", "#ffe2d2");
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
      const ddS = S.spot ? `${S.dd}    ${S.spot}` : S.dd;
      ctx.font = `500 ${36 * u}px Teko`; const tw = Math.max(clockW, ctx.measureText(ddS).width + 44 * u);
      const dx = x0 + total - tw, dy = y + h - 2 * u, dh = 44 * u;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 12 * u; ctx.shadowOffsetY = 5 * u;
      rr(ctx, dx, dy, tw, dh, 6 * u); ctx.fillStyle = "#0a2560"; ctx.fill(); ctx.restore();
      ctx.fillStyle = "#0a2560"; ctx.fillRect(dx, dy, tw, 8 * u);
      ctx.fillStyle = "#ffcc00"; ctx.fillRect(dx, dy + 2 * u, tw, 4 * u);
      text(ctx, ddS, dx + tw / 2, dy + dh / 2 + 6 * u, "#fff", "center");
    }
    return { x: x0, w: total, h: h + (S.dd ? 44 * u : 0) };
  }

  // ---------- Style 4: TILT (slanted slabs, sporty) ----------
  function tilt(ctx, W, H, S, now, L) {
    const { u } = L, h = 76 * u, k = 18 * u, gap = 6 * u, teamW = 296 * u, clockW = 176 * u, ddW = ddWidth(S, u);
    const total = teamW * 2 + clockW + ddW + gap * (ddW ? 3 : 2) + k;
    const x0 = (W - total) / 2, y = L.y; let x = x0;
    for (const side of ["away", "home"]) {
      const T = S[side], tc = ink(T.c1), scW = 92 * u, scX = x + teamW - scW;
      ctx.save(); shadowOn(ctx, u); para(ctx, x, y, teamW, h, k); ctx.fillStyle = vgrad(ctx, y, h, shade(T.c1, .2), shade(T.c1, -.2)); ctx.fill(); ctx.restore();
      ctx.save(); para(ctx, x, y, teamW, h, k); ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < 3; i++) { para(ctx, x + 74 * u + i * 24 * u, y, 9 * u, h, k); ctx.fill(); }
      ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(x, y, teamW + k, h * .42);
      para(ctx, scX, y, scW + k, h, k); ctx.fillStyle = shade(T.c1, -.38); ctx.fill();
      ctx.fillStyle = T.c2; ctx.fillRect(x, y + h - 6 * u, teamW + k, 6 * u);
      ctx.restore();
      logo(ctx, T.logo, x + k / 2 + 42 * u, y + h / 2 - 2 * u, 58 * u, T.abbr, tc);
      fit(ctx, T.abbr, "italic 800", 42 * u, "Barlow", 84 * u);
      text(ctx, T.abbr, x + 94 * u, y + 32 * u, tc);
      pips(ctx, x + 92 * u, y + 54 * u, T.to, 20 * u, 5 * u, 5 * u, tc, tc === "#fff" ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.2)");
      if (T.ball) ball(ctx, scX - 8 * u, y + 32 * u, 11 * u);
      ctx.font = `italic 800 ${56 * u}px Barlow`; text(ctx, String(T.score), scX + scW / 2 + k / 2, y + h / 2 + 1 * u, ink(shade(T.c1, -.38)), "center");
      pulse(ctx, T.pulseAt, now, scX, y, scW + k, h);
      x += teamW + gap;
    }
    ctx.save(); shadowOn(ctx, u); para(ctx, x, y, clockW, h, k); ctx.fillStyle = vgrad(ctx, y, h, "#24272d", "#060607"); ctx.fill(); ctx.restore();
    const c = clockStr(S), cx = x + (clockW + k) / 2;
    if (c.c) {
      ctx.font = `700 ${20 * u}px Barlow`; text(ctx, c.q + " QTR", cx, y + 21 * u, "#9aa0ab", "center");
      ctx.font = `italic 800 ${42 * u}px Barlow`; text(ctx, c.c, cx, y + 51 * u, S.running ? "#fff" : "#ffd23f", "center");
    } else { fit(ctx, c.q, "italic 800", 36 * u, "Barlow", clockW - 24 * u); text(ctx, c.q, cx, y + h / 2 + 2 * u, "#fff", "center"); }
    x += clockW + gap;
    if (ddW) {
      const BT = ballTeam(S);
      ctx.save(); shadowOn(ctx, u); para(ctx, x, y, ddW, h, k); ctx.fillStyle = vgrad(ctx, y, h, "#ffffff", "#dde1e8"); ctx.fill(); ctx.restore();
      if (BT) { ctx.save(); para(ctx, x, y, ddW, h, k); ctx.clip(); ctx.fillStyle = BT.c1; ctx.fillRect(x, y + h - 6 * u, ddW + k, 6 * u); ctx.restore(); }
      ddText(ctx, S, x + k / 2, y, ddW, h, u, "Barlow", "#111", "#4b5262");
    }
    return { x: x0, w: total, h };
  }

  // ---------- Style 5: CORNER (stacked, top-left, college TV look) ----------
  function corner(ctx, W, H, S, now, L) {
    const { u } = L, rowH = 54 * u, stripe = 7 * u, lgW = 62 * u, nmW = 150 * u, scW = 78 * u;
    const w = stripe + lgW + nmW + scW, infoH = 40 * u, spotH = S.dd && S.spot ? 30 * u : 0, totalH = rowH * 2 + infoH + spotH;
    const x0 = Math.max(W * .03, 14 * u), y0 = Math.max(H * .05, 14 * u);
    ctx.save(); shadowOn(ctx, u, .55); rr(ctx, x0, y0, w, totalH, 8 * u); ctx.fillStyle = "#0c0f16"; ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x0, y0, w, totalH, 8 * u); ctx.clip();
    let y = y0;
    for (const side of ["away", "home"]) {
      const T = S[side];
      ctx.fillStyle = T.c2; ctx.fillRect(x0, y, stripe, rowH);
      ctx.fillStyle = vgrad(ctx, y, rowH, shade(T.c1, .14), shade(T.c1, -.16)); ctx.fillRect(x0 + stripe, y, lgW, rowH);
      logo(ctx, T.logo, x0 + stripe + lgW / 2, y + rowH / 2, 44 * u, T.abbr, ink(T.c1));
      ctx.fillStyle = vgrad(ctx, y, rowH, "#20263a", "#141824"); ctx.fillRect(x0 + stripe + lgW, y, nmW + scW, rowH);
      const nx = x0 + stripe + lgW + 14 * u;
      fit(ctx, T.abbr, 800, 34 * u, "Barlow", nmW - 46 * u); text(ctx, T.abbr, nx, y + rowH / 2 - 5 * u, "#fff");
      pips(ctx, nx + 1 * u, y + rowH - 13 * u, T.to, 16 * u, 4 * u, 4 * u, "#ffd23f", "rgba(255,255,255,.18)");
      if (T.ball) ball(ctx, x0 + stripe + lgW + nmW - 16 * u, y + rowH / 2 - 2 * u, 10 * u);
      ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(x0 + w - scW, y, scW, rowH);
      ctx.font = `800 ${42 * u}px Barlow`; text(ctx, String(T.score), x0 + w - scW / 2, y + rowH / 2 + 2 * u, "#fff", "center");
      pulse(ctx, T.pulseAt, now, x0 + w - scW, y, scW, rowH);
      y += rowH;
      ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x0, y - 1 * u, w, 1 * u);
    }
    ctx.fillStyle = "#05070b"; ctx.fillRect(x0, y, w, infoH + spotH);
    const c = clockStr(S), half = S.dd ? w * .5 : w;
    if (c.c) {
      ctx.font = `700 ${22 * u}px Barlow`; text(ctx, c.q, x0 + 14 * u, y + infoH / 2 + 1 * u, "#9aa0ab");
      ctx.font = `800 ${28 * u}px Barlow`; text(ctx, c.c, x0 + half - 12 * u, y + infoH / 2 + 1 * u, S.running ? "#fff" : "#ffd23f", "right");
    } else { fit(ctx, c.q, 800, 24 * u, "Barlow", half - 24 * u); text(ctx, c.q, x0 + half / 2, y + infoH / 2 + 1 * u, "#fff", "center"); }
    if (S.dd) {
      ctx.fillStyle = vgrad(ctx, y, infoH, "#ffe066", "#f5c518"); ctx.fillRect(x0 + half, y, w - half, infoH);
      fit(ctx, S.dd, 800, 26 * u, "Barlow", w - half - 16 * u); text(ctx, S.dd, x0 + half + (w - half) / 2, y + infoH / 2 + 1 * u, "#111", "center");
    }
    if (spotH) { const t = "BALL ON " + S.spot; fit(ctx, t, 700, 18 * u, "Barlow", w - 20 * u); text(ctx, t, x0 + w / 2, y + infoH + spotH / 2, "#cfd5e4", "center"); }
    ctx.restore();
    return { x: x0, y: y0, w, h: totalH, corner: true };
  }

  // ---------- Style 6: RETRO (chrome frame, glowing digits) ----------
  function retro(ctx, W, H, S, now, L) {
    const { u } = L, h = 84 * u, pad = 6 * u, lgW = 70 * u, nmW = 104 * u, scW = 92 * u, teamW = lgW + nmW + scW, clockW = 176 * u;
    const ddW = S.dd ? (S.spot ? 280 : 160) * u : 0;
    const total = teamW * 2 + clockW + ddW + pad * (ddW ? 5 : 4), x0 = (W - total) / 2, y = L.y;
    ctx.save(); shadowOn(ctx, u, .55); rr(ctx, x0, y, total, h, 10 * u);
    const fg = ctx.createLinearGradient(0, y, 0, y + h); fg.addColorStop(0, "#f4f5f7"); fg.addColorStop(.45, "#a3a8b2"); fg.addColorStop(.55, "#7a808c"); fg.addColorStop(1, "#d7dade");
    ctx.fillStyle = fg; ctx.fill(); ctx.restore();
    let x = x0 + pad; const iy = y + pad, ih = h - pad * 2;
    const glow = (str, gx, gy, size, col) => { ctx.save(); ctx.font = `600 ${size}px Teko`; ctx.shadowColor = col; ctx.shadowBlur = 12 * u; text(ctx, str, gx, gy, col, "center"); ctx.restore(); };
    for (const side of ["away", "home"]) {
      const T = S[side];
      rr(ctx, x, iy, teamW, ih, 6 * u); ctx.fillStyle = vgrad(ctx, iy, ih, shade(T.c1, .25), shade(T.c1, -.25)); ctx.fill();
      ctx.save(); rr(ctx, x, iy, teamW, ih, 6 * u); ctx.clip(); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x, iy, teamW, ih * .42); ctx.fillStyle = T.c2; ctx.fillRect(x, iy + ih - 5 * u, teamW, 5 * u); ctx.restore();
      logo(ctx, T.logo, x + lgW / 2, iy + ih / 2, 56 * u, T.abbr, ink(T.c1));
      fit(ctx, T.abbr, 800, 38 * u, "Barlow", nmW - 14 * u);
      ctx.lineWidth = 5 * u; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.strokeText(T.abbr, x + lgW + 4 * u, iy + ih / 2 - 7 * u); text(ctx, T.abbr, x + lgW + 4 * u, iy + ih / 2 - 7 * u, "#fff");
      pips(ctx, x + lgW + 5 * u, iy + ih - 18 * u, T.to, 18 * u, 5 * u, 4 * u, "#ffd23f", "rgba(0,0,0,.35)");
      if (T.ball) ball(ctx, x + lgW + nmW - 16 * u, iy + ih - 16 * u, 9 * u);
      const sx = x + lgW + nmW, sy = iy + 6 * u, sw = scW - 6 * u, sh = ih - 12 * u;
      rr(ctx, sx, sy, sw, sh, 4 * u); ctx.fillStyle = "#0a0a0a"; ctx.fill();
      glow(String(T.score), sx + sw / 2, sy + sh / 2 + 6 * u, 62 * u, "#ffb02e");
      pulse(ctx, T.pulseAt, now, sx, sy, sw, sh);
      x += teamW + pad;
    }
    rr(ctx, x, iy, clockW, ih, 6 * u); ctx.fillStyle = "#0a0a0a"; ctx.fill();
    const c = clockStr(S);
    if (c.c) {
      ctx.font = `500 ${24 * u}px Teko`; text(ctx, c.q + " QTR", x + clockW / 2, iy + 16 * u, "#c9ccd3", "center");
      glow(c.c, x + clockW / 2, iy + ih / 2 + 14 * u, 46 * u, S.running ? "#ff5a36" : "#ffb02e");
    } else glow(c.q, x + clockW / 2, iy + ih / 2 + 6 * u, 40 * u, "#ffb02e");
    x += clockW + pad;
    if (ddW) { rr(ctx, x, iy, ddW, ih, 6 * u); ctx.fillStyle = vgrad(ctx, iy, ih, "#d42a20", "#8f140e"); ctx.fill(); ddText(ctx, S, x, iy, ddW, ih, u, "Teko", "#fff", "#ffd9a8", 6); }
    return { x: x0, w: total, h };
  }

  // ---------- Style 7: NEON (dark glass, glowing outlines) ----------
  function neon(ctx, W, H, S, now, L) {
    const { u } = L, h = 72 * u, teamW = 290 * u, clockW = 168 * u, ddW = ddWidth(S, u), gap = 10 * u;
    const total = teamW * 2 + clockW + ddW + gap * (ddW ? 3 : 2), x0 = (W - total) / 2, y = L.y;
    const glowCol = T => shade(lum(T.c1) < .06 ? T.c2 : T.c1, .3);
    const pane = (x, w, col) => {
      ctx.save(); rr(ctx, x, y, w, h, 14 * u); ctx.fillStyle = "rgba(8,10,20,.86)"; ctx.fill();
      ctx.shadowColor = col; ctx.shadowBlur = 18 * u; ctx.strokeStyle = col; ctx.lineWidth = 3 * u; ctx.stroke(); ctx.stroke(); ctx.restore();
    };
    const glowText = (str, x, yy, col, align, font) => { ctx.save(); ctx.font = font; ctx.shadowColor = col; ctx.shadowBlur = 14 * u; text(ctx, str, x, yy, "#fff", align); ctx.restore(); };
    let x = x0;
    for (const side of ["away", "home"]) {
      const T = S[side], col = glowCol(T);
      pane(x, teamW, col);
      logo(ctx, T.logo, x + 44 * u, y + h / 2, 50 * u, T.abbr, "#fff");
      fit(ctx, T.abbr, 800, 36 * u, "Barlow", 100 * u);
      glowText(T.abbr, x + 82 * u, y + 30 * u, col, "left", ctx.font);
      pips(ctx, x + 83 * u, y + 52 * u, T.to, 18 * u, 4 * u, 5 * u, col, "rgba(255,255,255,.15)");
      if (T.ball) ball(ctx, x + teamW - 104 * u, y + 30 * u, 10 * u);
      glowText(String(T.score), x + teamW - 22 * u, y + h / 2 + 2 * u, col, "right", `800 ${52 * u}px Barlow`);
      pulse(ctx, T.pulseAt, now, x + teamW - 90 * u, y, 90 * u, h);
      x += teamW + gap;
    }
    pane(x, clockW, "#e8ecff");
    const c = clockStr(S);
    if (c.c) {
      ctx.font = `700 ${18 * u}px Barlow`; text(ctx, c.q + " QTR", x + clockW / 2, y + 20 * u, "#aab1d6", "center");
      glowText(c.c, x + clockW / 2, y + 48 * u, S.running ? "#8fd8ff" : "#ffd23f", "center", `800 ${36 * u}px Barlow`);
    } else { fit(ctx, c.q, 800, 32 * u, "Barlow", clockW - 24 * u); glowText(c.q, x + clockW / 2, y + h / 2 + 2 * u, "#8fd8ff", "center", ctx.font); }
    x += clockW + gap;
    if (ddW) { pane(x, ddW, "#ff3bd8"); ddText(ctx, S, x, y, ddW, h, u, "Barlow", "#fff", "#ffc2f1"); }
    return { x: x0, w: total, h };
  }

  // ---------- Style 8: MINIMAL (small white pill) ----------
  function minimal(ctx, W, H, S, now, L) {
    const { u } = L, h = 54 * u, lg = 54 * u, ab = 76 * u, sc = 58 * u, side = lg + ab + sc, clockW = 150 * u;
    const ddW = S.dd ? (S.spot ? 236 : 130) * u : 0, total = side * 2 + clockW + ddW, x0 = (W - total) / 2, y = L.y;
    ctx.save(); shadowOn(ctx, u, .4); rr(ctx, x0, y, total, h, h / 2); ctx.fillStyle = "rgba(255,255,255,.96)"; ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, x0, y, total, h, h / 2); ctx.clip();
    let x = x0;
    for (const sd of ["away", "home"]) {
      const T = S[sd], home = sd === "home";
      const lx = home ? x + ab + sc : x, ax = home ? x + sc : x + lg, sx = home ? x : x + lg + ab;
      ctx.fillStyle = T.c1; ctx.fillRect(lx, y, lg, h);
      logo(ctx, T.logo, lx + lg / 2, y + h / 2, 38 * u, T.abbr, ink(T.c1));
      fit(ctx, T.abbr, 800, 30 * u, "Barlow", ab - 16 * u); text(ctx, T.abbr, ax + ab / 2, y + h / 2 - 3 * u, "#16181d", "center");
      pips(ctx, ax + ab / 2 - 23 * u, y + h - 12 * u, T.to, 13 * u, 3 * u, 3 * u, T.c1, "#d5d8de");
      ctx.font = `800 ${36 * u}px Barlow`; text(ctx, String(T.score), sx + sc / 2, y + h / 2 + 1 * u, "#16181d", "center");
      if (T.ball) { ctx.fillStyle = T.c1; ctx.fillRect(ax + 6 * u, y + h - 4 * u, ab - 12 * u, 4 * u); }
      pulse(ctx, T.pulseAt, now, sx, y, sc, h);
      x += side;
      if (!home) { ctx.fillStyle = "#e3e5ea"; ctx.fillRect(x - 1 * u, y + 10 * u, 2 * u, h - 20 * u); }
    }
    ctx.fillStyle = "#16181d"; ctx.fillRect(x, y, clockW + ddW, h);
    const c = clockStr(S);
    if (c.c) { ctx.font = `700 ${24 * u}px Barlow`; text(ctx, c.q, x + 18 * u, y + h / 2 + 1 * u, "#9aa0ab"); text(ctx, c.c, x + clockW - 14 * u, y + h / 2 + 1 * u, S.running ? "#fff" : "#ffd23f", "right"); }
    else { fit(ctx, c.q, 800, 24 * u, "Barlow", clockW - 20 * u); text(ctx, c.q, x + clockW / 2, y + h / 2 + 1 * u, "#fff", "center"); }
    if (ddW) { ctx.fillStyle = "#2b2f38"; ctx.fillRect(x + clockW, y, ddW, h); ddText(ctx, S, x + clockW - 6 * u, y, ddW, h, u, "Barlow", "#fff", "#aab0bd", 1); }
    ctx.restore();
    return { x: x0, w: total, h };
  }

  // ---------- Style 9: VARSITY (felt patches, stitched letters) ----------
  function varsity(ctx, W, H, S, now, L) {
    const { u } = L, h = 84 * u, teamW = 300 * u, clockW = 180 * u, ddW = ddWidth(S, u), gap = 6 * u;
    const total = teamW * 2 + clockW + ddW + gap * (ddW ? 3 : 2), x0 = (W - total) / 2, y = L.y;
    const stitch = (x, w, col) => { ctx.save(); ctx.setLineDash([7 * u, 5 * u]); ctx.strokeStyle = col; ctx.lineWidth = 2 * u; rr(ctx, x + 6 * u, y + 6 * u, w - 12 * u, h - 12 * u, 8 * u); ctx.stroke(); ctx.restore(); };
    const chenille = (str, x, yy, size, fill, edge, align) => {
      ctx.font = `800 ${size}px Barlow`; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      ctx.lineWidth = size * .22; ctx.strokeStyle = edge; ctx.strokeText(str, x, yy);
      ctx.lineWidth = size * .08; ctx.strokeStyle = "#111"; ctx.strokeText(str, x, yy);
      ctx.fillStyle = fill; ctx.fillText(str, x, yy);
    };
    let x = x0;
    for (const side of ["away", "home"]) {
      const T = S[side];
      ctx.save(); shadowOn(ctx, u); rr(ctx, x, y, teamW, h, 12 * u); ctx.fillStyle = vgrad(ctx, y, h, shade(T.c1, .08), shade(T.c1, -.22)); ctx.fill(); ctx.restore();
      stitch(x, teamW, shade(T.c2, .2));
      logo(ctx, T.logo, x + 50 * u, y + h / 2, 56 * u, T.abbr, ink(T.c1));
      const lum1 = lum(T.c1) > .5;
      chenille(T.abbr, x + 96 * u, y + h / 2 - 6 * u, Math.min(40 * u, fit(ctx, T.abbr, 800, 40 * u, "Barlow", 96 * u)), lum1 ? "#111" : "#fff", T.c2, "left");
      pips(ctx, x + 97 * u, y + h - 20 * u, T.to, 18 * u, 5 * u, 5 * u, T.c2, "rgba(0,0,0,.3)");
      if (T.ball) ball(ctx, x + 208 * u, y + h - 22 * u, 9 * u);
      chenille(String(T.score), x + teamW - 46 * u, y + h / 2 + 2 * u, 54 * u, "#fff", T.c2, "center");
      pulse(ctx, T.pulseAt, now, x + teamW - 92 * u, y, 92 * u, h);
      x += teamW + gap;
    }
    ctx.save(); shadowOn(ctx, u); rr(ctx, x, y, clockW, h, 12 * u); ctx.fillStyle = "#17191c"; ctx.fill(); ctx.restore();
    stitch(x, clockW, "#6d6f74");
    const c = clockStr(S);
    if (c.c) { ctx.font = `700 ${20 * u}px Barlow`; text(ctx, c.q + " QTR", x + clockW / 2, y + 24 * u, "#c7c9cc", "center"); chenille(c.c, x + clockW / 2, y + 54 * u, 34 * u, S.running ? "#fff" : "#ffd23f", "#3a3c40", "center"); }
    else chenille(c.q, x + clockW / 2, y + h / 2, Math.min(34 * u, fit(ctx, c.q, 800, 34 * u, "Barlow", clockW - 36 * u)), "#fff", "#3a3c40", "center");
    x += clockW + gap;
    if (ddW) {
      ctx.save(); shadowOn(ctx, u); rr(ctx, x, y, ddW, h, 12 * u); ctx.fillStyle = vgrad(ctx, y, h, "#f3d26a", "#d9a92c"); ctx.fill(); ctx.restore();
      stitch(x, ddW, "#8a6a12"); ddText(ctx, S, x, y, ddW, h, u, "Barlow", "#1a1406", "#5c4708");
    }
    return { x: x0, w: total, h };
  }

  // ---------- Style 10: JUMBO (stadium scoreboard with LED digits) ----------
  function led(ctx, str, x, y, size, col, align, u) {
    ctx.save(); ctx.font = `700 ${size}px Teko`; ctx.textAlign = align; ctx.textBaseline = "middle";
    const w = ctx.measureText(str).width, lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.shadowColor = col; ctx.shadowBlur = size * .3; ctx.fillStyle = col; ctx.fillText(str, x, y + size * .08); ctx.shadowBlur = 0;
    const st = Math.max(3, size / 10); ctx.fillStyle = "rgba(0,0,0,.38)";
    for (let gx = lx - 2; gx < lx + w + 2; gx += st) ctx.fillRect(gx, y - size * .5, st * .2, size);
    for (let gy = y - size * .5; gy < y + size * .5; gy += st) ctx.fillRect(lx - 2, gy, w + 4, st * .2);
    ctx.restore();
  }
  function jumbo(ctx, W, H, S, now, L) {
    const { u } = L, row1 = 74 * u, row2 = S.ddRaw ? 38 * u : 0, h = row1 + row2 + 12 * u, teamW = 250 * u, clockW = 230 * u;
    const total = teamW * 2 + clockW + 24 * u, x0 = (W - total) / 2, y = L.y;
    ctx.save(); shadowOn(ctx, u, .55); rr(ctx, x0, y, total, h, 10 * u);
    const fr = ctx.createLinearGradient(0, y, 0, y + h); fr.addColorStop(0, "#4a4e57"); fr.addColorStop(1, "#1d1f24"); ctx.fillStyle = fr; ctx.fill(); ctx.restore();
    rr(ctx, x0 + 6 * u, y + 6 * u, total - 12 * u, h - 12 * u, 6 * u); ctx.fillStyle = "#060607"; ctx.fill();
    let x = x0 + 12 * u; const ry = y + 6 * u;
    for (const side of ["away", "home"]) {
      const T = S[side];
      ctx.fillStyle = T.c1; ctx.fillRect(x + 10 * u, ry + 8 * u, teamW - 20 * u, 22 * u);
      fit(ctx, (T.name || T.abbr).toUpperCase(), 700, 18 * u, "Barlow", teamW - 60 * u); text(ctx, (T.name || T.abbr).toUpperCase(), x + teamW / 2, ry + 20 * u, ink(T.c1), "center");
      if (T.ball) { ctx.save(); ctx.fillStyle = "#ff3b2f"; ctx.shadowColor = "#ff3b2f"; ctx.shadowBlur = 8 * u; ctx.beginPath(); ctx.arc(side === "away" ? x + teamW - 18 * u : x + 18 * u, ry + 52 * u, 6 * u, 0, 7); ctx.fill(); ctx.restore(); }
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < T.to ? "#ffcf3f" : "#2a2a2a"; ctx.beginPath(); ctx.arc((side === "away" ? x + 18 * u : x + teamW - 18 * u), ry + 40 * u + i * 9 * u, 3 * u, 0, 7); ctx.fill(); }
      led(ctx, String(T.score), x + teamW / 2, ry + 52 * u, 44 * u, "#ffb02e", "center", u);
      pulse(ctx, T.pulseAt, now, x, ry, teamW, row1);
      x += teamW;
      if (side === "away") x += clockW;
    }
    const cx = x0 + 12 * u + teamW, c = clockStr(S);
    if (c.c) { ctx.font = `600 ${18 * u}px Barlow`; text(ctx, "QTR " + c.q, cx + clockW / 2, ry + 18 * u, "#c9ccd3", "center"); led(ctx, c.c, cx + clockW / 2, ry + 50 * u, 48 * u, S.running ? "#ff4a2f" : "#ffb02e", "center", u); }
    else led(ctx, c.q, cx + clockW / 2, ry + row1 / 2, 40 * u, "#ffb02e", "center", u);
    if (row2) {
      const D = S.ddRaw, cells = [["DOWN", String(D.down)], ["TO GO", D.toGo === "Goal" ? "G" : String(D.toGo)], ["BALL ON", D.spotNum != null ? String(D.spotNum) : "-"], ["QTR", { HALF: "H", FINAL: "F" }[S.qtr] || String(S.qtr)]];
      const cw = (total - 24 * u) / 4, by = ry + row1 + 2 * u;
      ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(x0 + 12 * u, by - 2 * u, total - 24 * u, 1 * u);
      cells.forEach(([l, v], i) => {
        const bx = x0 + 12 * u + cw * i;
        ctx.font = `600 ${15 * u}px Barlow`; text(ctx, l, bx + cw * .48, by + row2 / 2, "#c9ccd3", "right");
        led(ctx, v, bx + cw * .56, by + row2 / 2, 30 * u, "#ffb02e", "left", u);
      });
    }
    return { x: x0, y, w: total, h };
  }

  // ---------- extra layers: info tab, player card, intro, stats panel, replay tag ----------
  function infoTab(ctx, W, H, S, box, u) {
    if (!S.drive && !S.wp) return 0;
    const th = 32 * u, below = box.corner || S.top, ty = below ? box.y + box.h + 6 * u : box.y - th - 6 * u;
    ctx.font = `700 ${19 * u}px Barlow`;
    const dW = S.drive ? ctx.measureText(S.drive).width + 96 * u : 0, wW = S.wp ? 300 * u : 0;
    const tot = dW + wW + (dW && wW ? 4 * u : 0), x0 = box.corner ? box.x : box.x + (box.w - tot) / 2;
    ctx.save(); shadowOn(ctx, u, .4); rr(ctx, x0, ty, tot, th, 6 * u); ctx.fillStyle = "rgba(10,12,18,.9)"; ctx.fill(); ctx.restore();
    let x = x0;
    if (dW) {
      ctx.save(); rr(ctx, x, ty, dW, th, 6 * u); ctx.clip(); ctx.fillStyle = "#ffcf3f"; ctx.fillRect(x, ty, 70 * u, th); ctx.restore();
      ctx.font = `800 ${17 * u}px Barlow`; text(ctx, "DRIVE", x + 35 * u, ty + th / 2 + 1 * u, "#111", "center");
      ctx.font = `700 ${19 * u}px Barlow`; text(ctx, S.drive, x + 82 * u, ty + th / 2 + 1 * u, "#fff");
      x += dW + 4 * u;
    }
    if (wW) {
      const A = S.away, Hm = S.home, a = S.wp.away, bx = x + 92 * u, bw = wW - 184 * u, by = ty + th / 2 - 6 * u;
      ctx.font = `700 ${18 * u}px Barlow`;
      text(ctx, `${A.abbr} ${a}%`, x + 12 * u, ty + th / 2 + 1 * u, "#fff");
      text(ctx, `${100 - a}% ${Hm.abbr}`, x + wW - 12 * u, ty + th / 2 + 1 * u, "#fff", "right");
      ctx.save(); rr(ctx, bx, by, bw, 12 * u, 6 * u); ctx.clip();
      ctx.fillStyle = lum(A.c1) < .03 ? A.c2 : A.c1; ctx.fillRect(bx, by, bw * a / 100, 12 * u);
      ctx.fillStyle = lum(Hm.c1) < .03 ? Hm.c2 : Hm.c1; ctx.fillRect(bx + bw * a / 100, by, bw, 12 * u);
      ctx.fillStyle = "#fff"; ctx.fillRect(bx + bw * a / 100 - 1 * u, by, 2 * u, 12 * u); ctx.restore();
      ctx.font = `600 ${11 * u}px Barlow`; text(ctx, "WIN CHANCE", bx + bw / 2, ty + 5 * u, "#9aa0ab", "center");
    }
    return th;
  }
  function playerCard(ctx, S, B, box, u, age, e, below) {
    const T = B.team ? S[B.team] : S.away, bh = (B.sub2 ? 86 : 72) * u, bw = Math.max(560 * u, Math.min(box.w, 700 * u));
    const bx = box.corner ? box.x : box.x + (box.w - bw) / 2, by = below ? box.y + box.h + 12 * u : box.y - bh - 12 * u;
    ctx.save(); ctx.beginPath(); ctx.rect(bx - 20 * u, by - 20 * u, (bw + 40 * u) * e, bh + 40 * u); ctx.clip();
    ctx.save(); shadowOn(ctx, u); rr(ctx, bx, by, bw, bh, 8 * u); ctx.fillStyle = vgrad(ctx, by, bh, shade(T.c1, .12), shade(T.c1, -.25)); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, bx, by, bw, bh, 8 * u); ctx.clip();
    ctx.fillStyle = T.c2; ctx.fillRect(bx, by, 104 * u, bh);
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(bx, by, bw, bh * .4);
    ctx.restore();
    const nc = ink(T.c2), tc = ink(T.c1);
    fit(ctx, B.num || "", "italic 800", 46 * u, "Barlow", 90 * u); text(ctx, B.num || "", bx + 52 * u, by + bh / 2 + 2 * u, nc, "center");
    const big = (B.text || "").toUpperCase();
    fit(ctx, big, 800, 34 * u, "Barlow", bw - 200 * u); text(ctx, big, bx + 122 * u, by + 26 * u, tc);
    ctx.save(); ctx.globalAlpha = .92; fit(ctx, (B.sub || "").toUpperCase(), 700, 22 * u, "Barlow", bw - 200 * u); text(ctx, (B.sub || "").toUpperCase(), bx + 122 * u, by + 54 * u, tc); ctx.restore();
    if (B.sub2) { ctx.save(); ctx.globalAlpha = .7; fit(ctx, B.sub2.toUpperCase(), 600, 18 * u, "Barlow", bw - 200 * u); text(ctx, B.sub2.toUpperCase(), bx + 122 * u, by + 74 * u, tc); ctx.restore(); }
    logo(ctx, T.logo, bx + bw - 44 * u, by + bh / 2, 54 * u, T.abbr, tc);
    ctx.restore();
  }
  function intro(ctx, W, H, S, B, age, dur) {
    const a = clamp(Math.min(age / .4, (dur - age) / .4), 0, 1), e = 1 - (1 - a) ** 3, m = Math.min(W, H * 1.6);
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "rgba(4,6,12,.82)"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    const off = (1 - e) * W * .5;
    for (const side of ["away", "home"]) {
      const T = S[side], L = side === "away", cx = L ? W * .27 - off : W * .73 + off;
      ctx.save(); ctx.beginPath();
      if (L) { ctx.moveTo(-off, H * .18); ctx.lineTo(W * .52 - off, H * .18); ctx.lineTo(W * .46 - off, H * .82); ctx.lineTo(-off, H * .82); }
      else { ctx.moveTo(W * .54 + off, H * .18); ctx.lineTo(W + off, H * .18); ctx.lineTo(W + off, H * .82); ctx.lineTo(W * .48 + off, H * .82); }
      ctx.closePath(); const gr = ctx.createLinearGradient(0, H * .18, 0, H * .82); gr.addColorStop(0, shade(T.c1, .15)); gr.addColorStop(1, shade(T.c1, -.35));
      ctx.fillStyle = gr; ctx.fill(); ctx.fillStyle = T.c2; ctx.fillRect(L ? -off : W * .48 + off, H * .82 - m * .012, W * .52, m * .012); ctx.restore();
      logo(ctx, T.logo, cx, H * .44, m * .26, T.abbr, ink(T.c1));
      fit(ctx, (T.name || T.abbr).toUpperCase(), 800, m * .07, "Barlow", W * .4); text(ctx, (T.name || T.abbr).toUpperCase(), cx, H * .66, ink(T.c1), "center");
      if (T.rec) { ctx.font = `600 ${m * .035}px Barlow`; text(ctx, T.rec, cx, H * .74, ink(T.c1), "center"); }
    }
    ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(W / 2, H * .5, m * .06, 0, 7); ctx.fillStyle = "#111"; ctx.fill(); ctx.lineWidth = m * .006; ctx.strokeStyle = "#ffcf3f"; ctx.stroke();
    ctx.font = `italic 800 ${m * .06}px Barlow`; text(ctx, "VS", W / 2, H * .505, "#ffcf3f", "center");
    fit(ctx, (B.text || "").toUpperCase(), 800, m * .06, "Barlow", W * .8); text(ctx, (B.text || "").toUpperCase(), W / 2, H * .1, "#fff", "center");
    if (B.sub) { fit(ctx, B.sub.toUpperCase(), 600, m * .035, "Barlow", W * .8); text(ctx, B.sub.toUpperCase(), W / 2, H * .9, "#c9ccd3", "center"); }
    ctx.restore(); ctx.restore();
  }
  function statsPanel(ctx, W, H, S, B, age, dur, u) {
    const a = clamp(Math.min(age / .3, (dur - age) / .3), 0, 1), rows = B.rows || [];
    const pw = 640 * u, rh = 40 * u, ph = 96 * u + rows.length * rh, px = (W - pw) / 2, py = Math.max(10 * u, (H - ph) / 2 - 40 * u);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, py + ph / 2); const sc = .92 + .08 * a; ctx.scale(sc, sc); ctx.translate(-W / 2, -(py + ph / 2));
    ctx.save(); shadowOn(ctx, u, .6); rr(ctx, px, py, pw, ph, 12 * u); ctx.fillStyle = "rgba(10,12,20,.94)"; ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, px, py, pw, ph, 12 * u); ctx.clip();
    ctx.fillStyle = S.away.c1; ctx.fillRect(px, py, pw / 2, 56 * u); ctx.fillStyle = S.home.c1; ctx.fillRect(px + pw / 2, py, pw / 2, 56 * u); ctx.restore();
    logo(ctx, S.away.logo, px + 40 * u, py + 28 * u, 42 * u, S.away.abbr, ink(S.away.c1));
    logo(ctx, S.home.logo, px + pw - 40 * u, py + 28 * u, 42 * u, S.home.abbr, ink(S.home.c1));
    ctx.font = `800 ${28 * u}px Barlow`; text(ctx, S.away.abbr, px + pw * .3, py + 30 * u, ink(S.away.c1), "center"); text(ctx, S.home.abbr, px + pw * .7, py + 30 * u, ink(S.home.c1), "center");
    ctx.font = `700 ${16 * u}px Barlow`; text(ctx, (B.text || "TEAM STATS").toUpperCase(), W / 2, py + 76 * u, "#ffcf3f", "center");
    rows.forEach(([l, av, hv], i) => {
      const ry = py + 96 * u + i * rh + rh / 2;
      if (i % 2 === 0) { ctx.fillStyle = "rgba(255,255,255,.04)"; ctx.fillRect(px, ry - rh / 2, pw, rh); }
      ctx.font = `800 ${26 * u}px Barlow`; text(ctx, String(av), px + pw * .14, ry, "#fff", "center"); text(ctx, String(hv), px + pw * .86, ry, "#fff", "center");
      ctx.font = `600 ${20 * u}px Barlow`; text(ctx, l.toUpperCase(), W / 2, ry, "#c9ccd3", "center");
    });
    ctx.restore();
  }
  function replayTag(ctx, W, H, S, now, u) {
    const x = S.style === "corner" ? W - 220 * u - W * .03 : W * .03, y = H * .05, w = 200 * u, h = 50 * u;
    ctx.save(); shadowOn(ctx, u, .5); rr(ctx, x, y, w, h, 8 * u); ctx.fillStyle = "#c8102e"; ctx.fill(); ctx.restore();
    const blink = Math.floor(now / 500) % 2 === 0;
    ctx.fillStyle = blink ? "#fff" : "rgba(255,255,255,.4)"; ctx.beginPath(); ctx.moveTo(x + 22 * u, y + 14 * u); ctx.lineTo(x + 42 * u, y + h / 2); ctx.lineTo(x + 22 * u, y + h - 14 * u); ctx.closePath(); ctx.fill();
    ctx.font = `italic 800 ${30 * u}px Barlow`; text(ctx, "REPLAY", x + 54 * u, y + h / 2 + 2 * u, "#fff");
    ctx.font = `700 ${14 * u}px Barlow`; text(ctx, S.replaySpeed || "", x + w - 12 * u, y + h / 2 + 2 * u, "rgba(255,255,255,.8)", "right");
  }
  function wipe(ctx, W, H, p, col, col2) { // p 0..1 sweeps a slanted team-color band across the screen
    const x = -W * .4 + p * W * 1.8, k = W * .2;
    ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * .35, 0); ctx.lineTo(x + W * .35 - k, H); ctx.lineTo(x - k, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col2; ctx.fillRect(0, 0, 0, 0); ctx.beginPath(); ctx.moveTo(x + W * .35, 0); ctx.lineTo(x + W * .38, 0); ctx.lineTo(x + W * .38 - k, H); ctx.lineTo(x + W * .35 - k, H); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // ---------- Banners: TOUCHDOWN / FIELD GOAL / FLAG / TIMEOUT ----------
  function banner(ctx, W, H, S, now, box, u) {
    const B = S.banner; if (!B) return;
    const age = (now - B.start) / 1000, dur = B.dur || 4;
    if (age < 0 || age > dur) return;
    const inP = clamp(age / .35, 0, 1), outP = clamp((dur - age) / .35, 0, 1);
    const p = Math.min(inP, outP), e = 1 - (1 - p) ** 3;
    if (B.kind === "player") return playerCard(ctx, S, B, box, u, age, e, box.corner || S.top);
    if (B.kind === "intro") return intro(ctx, W, H, S, B, age, dur);
    if (B.kind === "stats") return statsPanel(ctx, W, H, S, B, age, dur, u);
    const bh = (B.kind === "td" ? 80 : 70) * u, bw = Math.max(box.w, 640 * u);
    const bx = box.corner ? box.x : W / 2 - bw / 2;
    const below = box.corner || S.top;
    const by = below ? box.y + box.h + 14 * u : box.y - bh - 14 * u;
    const T = B.team ? S[B.team] : null;
    const bg = B.kind === "flag" ? "#ffd400" : T ? T.c1 : "#111";
    const fg = B.kind === "flag" ? "#111" : ink(bg);
    ctx.save();
    const vis = bw * e; ctx.beginPath(); ctx.rect(box.corner ? bx : bx + (bw - vis) / 2, by - 30 * u, vis, bh + 40 * u); ctx.clip();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 6 * u;
    rr(ctx, bx, by, bw, bh, 8 * u);
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, shade(bg, -.25)); g.addColorStop(.5, shade(bg, .1)); g.addColorStop(1, shade(bg, -.25));
    ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = "transparent";
    ctx.save(); rr(ctx, bx, by, bw, bh, 8 * u); ctx.clip();
    if (B.kind === "td" && T) { // racing stripes in the second color
      ctx.globalAlpha = .35; ctx.fillStyle = T.c2;
      const off = (age * 260 * u) % (60 * u);
      for (let sx = bx + bw * .62 - 60 * u + off; sx < bx + bw + 60 * u; sx += 60 * u) { para(ctx, sx, by, 22 * u, bh, -26 * u); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    const sx = bx + ((age * 900 * u) % (bw + 300 * u)) - 150 * u;
    const sg = ctx.createLinearGradient(sx - 80 * u, 0, sx + 80 * u, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(.5, "rgba(255,255,255,.22)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg; ctx.fillRect(bx, by, bw, bh);
    if (B.kind === "td" && age < .6) { ctx.fillStyle = `rgba(255,255,255,${.6 * (1 - age / .6)})`; ctx.fillRect(bx, by, bw, bh); }
    ctx.restore();
    if (T) { ctx.fillStyle = T.c2; ctx.fillRect(bx, by + bh - 5 * u, bw, 5 * u); }
    let tx = bx + 26 * u;
    if (T) { logo(ctx, T.logo, bx + 52 * u, by + bh / 2, 58 * u, T.abbr, fg); tx = bx + 100 * u; }
    const big = B.text.toUpperCase();
    let sz = (B.kind === "td" ? 58 : 50) * u;
    if (B.kind === "td") sz *= 1 + .4 * (1 - clamp(age / .45, 0, 1)) ** 2;
    const used = fit(ctx, big, "italic 800", sz, "Barlow", bw * .55);
    const bigW = ctx.measureText(big).width;
    text(ctx, big, tx, by + bh / 2 + 3 * u, fg);
    if (B.sub) {
      fit(ctx, B.sub.toUpperCase(), 600, 28 * u, "Barlow", bx + bw - (tx + bigW + 40 * u));
      text(ctx, B.sub.toUpperCase(), bx + bw - 24 * u, by + bh / 2 + 3 * u, fg, "right");
    }
    ctx.restore();
  }

  function drawBug(ctx, W, H, S, now, opts) {
    const landscape = W >= H;
    const base = (opts && opts.frac) || (landscape ? .64 : .96);
    const isCorner = S.style === "corner";
    let u = W * base * (S.size || 1) / 1000;
    if (!isCorner) u = Math.min(u, W * .97 / (S.dd && S.spot ? 1180 : 1060));
    if (S.style === "jumbo") u = Math.min(u * 1.15, W * .97 / 800);
    const bugH = S.style === "jumbo" ? (S.ddRaw ? 124 : 86) * u : ({ retro: 84, varsity: 84, minimal: 54, neon: 72, tilt: 76 }[S.style] || 80) * u + (S.style === "clean" && S.dd ? 40 * u : 0);
    const margin = landscape ? H * .065 : H * .04;
    const y = S.top ? margin : H - margin - bugH;
    const L = { u, y };
    const fn = { night, clean, tilt, corner, retro, neon, minimal, varsity, jumbo }[S.style] || prime;
    const box = fn(ctx, W, H, S, now, L);
    if (box.y == null) box.y = y;
    const th = infoTab(ctx, W, H, S, box, u);
    if (th) { if (box.corner || S.top) box.h += th + 6 * u; else box.y -= th + 6 * u; }
    banner(ctx, W, H, S, now, box, u);
    if (S.replay) replayTag(ctx, W, H, S, now, Math.max(u, W * .64 / 1000));
  }

  window.ScoreBug = { drawBug, shade, ink, lum, hexToRgb, wipe, rr, fit, logo };
})();

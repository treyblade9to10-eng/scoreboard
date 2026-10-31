// Scoreboard: teams with logos, saved games, live score bug, play-by-play stats,
// and a camera mode that records video with the bug baked in.
// Everything is stored on this phone (localStorage). "Save a backup" exports it all.

const { drawBug, ink } = window.ScoreBug;
const DB_KEY = "scoreboard-v1", OLD_KEYS = ["adfl-scorebug-v2"];
const $app = document.getElementById("app");
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ord = n => ({ 1: "1ST", 2: "2ND", 3: "3RD", 4: "4TH" })[n] || String(n);
const other = side => side === "away" ? "home" : "away";
const fmtClock = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const STYLES = [
  { id: "prime", name: "Prime", note: "Team-color bar, yellow down box" },
  { id: "night", name: "Night", note: "Dark and sleek, full team names" },
  { id: "clean", name: "Clean", note: "White bar, bold team colors" },
  { id: "tilt", name: "Tilt", note: "Slanted team slabs, sporty" },
  { id: "corner", name: "Corner", note: "Stacked in the top corner, college TV look" },
  { id: "retro", name: "Retro", note: "Chrome frame, glowing scoreboard digits" },
];
const Q_SHORT = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", HALF: "Half", OT: "OT", FINAL: "Final" };
const Q_LONG = { 1: "1st Quarter", 2: "2nd Quarter", 3: "3rd Quarter", 4: "4th Quarter", HALF: "Halftime", OT: "Overtime", FINAL: "Final" };
const Q_NEXT_LABEL = { 2: "To 2nd", HALF: "Halftime", 3: "To 3rd", 4: "To 4th", OT: "To OT", FINAL: "End game" };
const Q_ORDER = ["1", "2", "HALF", "3", "4", "OT", "FINAL"];
function nextQ(g) {
  const q = g.s.qtr;
  if (q === "4") return g.s.away.score === g.s.home.score ? "OT" : "FINAL";
  return { 1: "2", 2: "HALF", HALF: "3", 3: "4", OT: "FINAL" }[q] || null;
}
function prevQ(g) { const i = Q_ORDER.indexOf(g.s.qtr); return i > 0 ? Q_ORDER[i - 1] : null; }

// ---------------- storage ----------------
let DB = load();
function load() {
  for (const k of [DB_KEY, ...OLD_KEYS]) {
    try { const d = JSON.parse(localStorage.getItem(k)); if (d && d.teams) return d; } catch (e) {}
  }
  return { teams: [], games: [] };
}
function persist() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  catch (e) { toast("Phone storage is full. Try smaller logos, or save a backup and delete old games."); }
}
const team = id => DB.teams.find(t => t.id === id);
const game = id => DB.games.find(g => g.id === id);

// runtime-only bits (not saved)
const RT = { banner: null, pulse: {}, imgs: {}, raf: 0 };
function img(src) {
  if (!src) return null;
  if (!RT.imgs[src]) { const i = new Image(); i.src = src; RT.imgs[src] = i; }
  return RT.imgs[src];
}

// ---------------- helpers ----------------
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}
function go(hash) { location.hash = hash; }
function curClock(s) { return s.running ? Math.max(0, s.startClock - Math.floor((Date.now() - s.startedAt) / 1000)) : s.clock; }
function freezeClock(s) { s.clock = curClock(s); s.running = false; }
function setClock(s, sec) { s.clock = Math.max(0, sec); if (s.running) { s.startClock = s.clock; s.startedAt = Date.now(); } }

function newGameState(qLen) {
  return {
    away: { score: 0, to: 3 }, home: { score: 0, to: 3 },
    qtr: "1", clock: qLen * 60, running: false, startedAt: 0, startClock: 0,
    ball: "away", down: 1, toGo: 10, ddShow: false, pos: 25,
  };
}
// ball spot: s.pos = yards from the OFFENSE's own goal line (1-99)
const clampPos = v => Math.max(1, Math.min(99, Math.round(v)));
function spotText(g) {
  const s = g.s, p = s.pos || 25;
  if (p === 50) return "50";
  const terr = p < 50 ? s.ball : other(s.ball);
  return `${sideTeam(g, terr).abbr} ${p < 50 ? p : 100 - p}`;
}
function sideTeam(g, side) { return team(side === "away" ? g.awayId : g.homeId) || { name: side.toUpperCase(), abbr: side === "away" ? "AWY" : "HOM", c1: "#333", c2: "#999", roster: [] }; }

function bugState(g, now, styleOverride) {
  const s = g.s, S = { style: styleOverride || g.style, qtr: s.qtr, running: s.running, banner: RT.banner && RT.banner.gid === g.id ? RT.banner : null };
  for (const side of ["away", "home"]) {
    const T = sideTeam(g, side);
    S[side] = { abbr: T.abbr, name: T.name, logo: img(T.logo), c1: T.c1, c2: T.c2, score: s[side].score, to: s[side].to,
      ball: s.ball === side && !["HALF", "FINAL"].includes(s.qtr), pulseAt: RT.pulse[g.id + side] };
  }
  S.clock = fmtClock(curClock(s));
  S.dd = s.ddShow && s.down && !["HALF", "FINAL"].includes(s.qtr) ? `${ord(s.down)} & ${s.toGo === "Goal" ? "GOAL" : s.toGo}` : null;
  S.spot = S.dd && g.spotShow !== false && s.pos ? spotText(g) : null;
  S.size = g.bugSize || 1; S.top = g.bugPos === "top";
  return S;
}
function onClockZero(g) {
  const s = g.s; freezeClock(s);
  if (Q_LONG[s.qtr] && !["HALF", "FINAL"].includes(s.qtr)) banner(g, "to", "End of " + Q_LONG[s.qtr], "", null, 4);
  persist(); refreshLive(g);
}
function banner(g, kind, text, sub, side, dur) { RT.banner = { gid: g.id, kind, text, sub, team: side, start: performance.now(), dur: dur || 4 }; }

// field-ish backdrop for previews
function drawBackdrop(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1b2333"); g.addColorStop(.35, "#24522c"); g.addColorStop(1, "#1d4524");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .18; ctx.strokeStyle = "#fff"; ctx.lineWidth = W / 300;
  for (let i = -4; i < 14; i++) { ctx.beginPath(); const x = i * W / 9; ctx.moveTo(x + W * .25, H * .3); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H * .45, H * .2, W / 2, H * .5, W * .7); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// pull the main colors out of a logo
function logoColors(image) {
  const c = document.createElement("canvas"), n = 64; c.width = c.height = n;
  const x = c.getContext("2d"); x.drawImage(image, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data, buckets = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const k = [d[i] >> 4, d[i + 1] >> 4, d[i + 2] >> 4].join(",");
    (buckets[k] = buckets[k] || { n: 0, r: 0, g: 0, b: 0 }); const B = buckets[k]; B.n++; B.r += d[i]; B.g += d[i + 1]; B.b += d[i + 2];
  }
  const list = Object.values(buckets).map(B => {
    const r = B.r / B.n, g = B.g / B.n, b = B.b / B.n, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    return { r, g, b, n: B.n, w: B.n * (0.35 + sat) };
  }).sort((a, b) => b.w - a.w);
  const out = [];
  for (const C of list) {
    if (out.every(O => Math.hypot(O.r - C.r, O.g - C.g, O.b - C.b) > 70)) out.push(C);
    if (out.length >= 6) break;
  }
  const hex = C => "#" + [C.r, C.g, C.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  const res = out.map(hex);
  for (const extra of ["#ffffff", "#111111"]) if (!res.includes(extra)) res.push(extra);
  return res;
}
// shrink an uploaded logo so it fits in phone storage
function shrinkImage(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => {
      const i = new Image();
      i.onload = () => {
        const max = 320, k = Math.min(1, max / Math.max(i.width, i.height));
        const c = document.createElement("canvas"); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
        c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/png"));
      };
      i.onerror = bad; i.src = r.result;
    };
    r.onerror = bad; r.readAsDataURL(file);
  });
}

// ---------------- plays + stats ----------------
function snapshot(g) { g.undo = g.undo || []; g.undo.push(JSON.stringify({ s: g.s, n: g.plays.length })); if (g.undo.length > 60) g.undo.shift(); }
function addPts(g, side, pts) { g.s[side].score += pts; RT.pulse[g.id + side] = performance.now(); }
function fixGoal(s) { if (s.toGo !== "Goal" && (s.pos || 25) + s.toGo >= 100) s.toGo = "Goal"; }
function turnover(s, toSide) { if (toSide !== s.ball) s.pos = clampPos(100 - (s.pos || 25)); s.ball = toSide; s.down = 1; s.toGo = 10; fixGoal(s); }
function kickoffSpot(s) { s.pos = 25; s.down = 1; s.toGo = 10; }
function advance(s, gain) {
  s.pos = clampPos((s.pos || 25) + gain);
  if (s.toGo === "Goal") { s.down++; }
  else if (gain >= s.toGo) { s.down = 1; s.toGo = 10; fixGoal(s); return "first"; }
  else { s.down++; s.toGo = Math.max(1, s.toGo - gain); }
  if (s.down > 4) { turnover(s, other(s.ball)); return "downs"; }
}
const pName = p => p ? `#${p.num}${p.name ? " " + p.name : ""}` : "";
const pShort = p => p ? (p.name ? p.name.split(" ").slice(-1)[0] : "#" + p.num) : "";

function applyPlay(g, p) {
  snapshot(g);
  const s = g.s, off = p.team, def = other(off), O = sideTeam(g, off), D = sideTeam(g, def), y = +p.yards || 0, ret = +p.ret || 0;
  p.id = uid(); p.qtr = s.qtr; p.clock = fmtClock(curClock(s)); p.pts = 0; p.ptsSide = null;
  p.pre = { down: s.down, toGo: s.toGo, pos: s.pos, ball: s.ball };
  const score = (side, pts) => { addPts(g, side, pts); p.pts = pts; p.ptsSide = side; };
  const afterScore = side => { turnover(s, other(side)); kickoffSpot(s); s.ddShow = true; };
  const adv = gain => { const r = advance(s, gain); s.ddShow = true; if (r === "first") p.first = true; return r === "downs" ? " (turnover on downs)" : ""; };
  let desc = "";
  switch (p.type) {
    case "pass":
      s.ball = off;
      if (p.result === "comp") {
        desc = `${pName(p.passer)} pass complete to ${pName(p.target)} for ${y} yds`;
        if (p.td) { score(off, 6); s.ddShow = false; desc += ", TOUCHDOWN"; banner(g, "td", "Touchdown", `${pShort(p.target)} ${y} yd pass from ${pShort(p.passer)}`, off); }
        else if (p.fumble) { s.pos = clampPos(s.pos + y); turnover(s, def); s.ddShow = true; desc += ", FUMBLE recovered by " + D.abbr + (p.defender ? " " + pName(p.defender) : ""); banner(g, "to", "Fumble", `${D.abbr} ball`, def, 3); }
        else desc += adv(y);
      } else if (p.result === "inc") {
        desc = `${pName(p.passer)} pass incomplete${p.target ? " to " + pName(p.target) : ""}` + adv(0);
      } else {
        desc = `${pName(p.passer)} pass INTERCEPTED by ${D.abbr} ${pName(p.defender)}`;
        if (p.td) { score(def, 6); s.ball = def; s.ddShow = false; desc += ", returned for a TOUCHDOWN"; banner(g, "td", "Pick Six", `${pShort(p.defender)} interception return`, def); }
        else { turnover(s, def); s.pos = clampPos(s.pos + ret); fixGoal(s); s.ddShow = true; if (ret) desc += `, returned ${ret} yds`; banner(g, "to", "Interception", `${pShort(p.defender)}`, def, 3); }
      }
      break;
    case "run":
      s.ball = off;
      desc = `${pName(p.runner)} run for ${y} yds`;
      if (p.td) { score(off, 6); s.ddShow = false; desc += ", TOUCHDOWN"; banner(g, "td", "Touchdown", `${pShort(p.runner)} ${y} yd run`, off); }
      else if (p.fumble) { s.pos = clampPos(s.pos + y); turnover(s, def); s.ddShow = true; desc += ", FUMBLE recovered by " + D.abbr + (p.defender ? " " + pName(p.defender) : ""); banner(g, "to", "Fumble", `${D.abbr} ball`, def, 3); }
      else desc += adv(y);
      break;
    case "kick":
      if (p.kind === "fg") {
        desc = `${pName(p.kicker)} ${y} yd field goal ${p.good ? "is GOOD" : "is NO GOOD"}`;
        if (p.good) { score(off, 3); banner(g, "fg", "Field Goal", `${pShort(p.kicker)} from ${y}`, off); afterScore(off); }
        else { s.ball = off; turnover(s, def); s.ddShow = true; }
      } else {
        desc = `${pName(p.kicker)} extra point ${p.good ? "is GOOD" : "is NO GOOD"}`;
        if (p.good) score(off, 1);
        afterScore(off);
      }
      break;
    case "two":
      desc = `2-point try by ${pName(p.player)} ${p.good ? "is GOOD" : "fails"}`;
      if (p.good) { score(off, 2); banner(g, "fg", "2-Point Good", pShort(p.player), off, 3); }
      afterScore(off);
      break;
    case "punt": { // p.team = punting team
      s.ball = off;
      const land = (s.pos || 25) + y;
      desc = `${p.kicker ? pName(p.kicker) : O.abbr} punts ${y} yds`;
      let spot = 100 - land;
      if (p.result === "tb" || land >= 100) { spot = 20; desc += ", touchback"; }
      else if (p.result === "fc") desc += `, fair catch${p.returner ? " by " + pName(p.returner) : ""}`;
      else if (p.result === "down") desc += ", downed";
      else { spot += ret; desc += `, returned ${ret} yds${p.returner ? " by " + pName(p.returner) : ""}`; }
      if (p.result === "ret" && p.td) { score(def, 6); s.ball = def; s.ddShow = false; desc += ", TOUCHDOWN"; banner(g, "td", "Punt Return TD", pShort(p.returner), def); }
      else { s.ball = def; s.pos = clampPos(spot); s.down = 1; s.toGo = 10; fixGoal(s); s.ddShow = true; }
      break;
    }
    case "kickoff": { // p.team = kicking team
      desc = `${p.kicker ? pName(p.kicker) : O.abbr} kicks off`;
      if (p.result === "onside") {
        s.ball = off; s.pos = clampPos(y || 45); s.down = 1; s.toGo = 10; fixGoal(s); s.ddShow = true;
        desc += `, ONSIDE kick recovered by ${O.abbr}`; banner(g, "to", "Onside Recovery", O.abbr + " ball", off, 3.5);
      } else if (p.result === "tb") {
        s.ball = def; s.pos = 25; s.down = 1; s.toGo = 10; s.ddShow = true; desc += ", touchback";
      } else {
        const spot = (y || 0) + ret;
        desc += `, returned ${ret} yds${p.returner ? " by " + pName(p.returner) : ""}`;
        if (p.td || spot >= 100) { p.td = true; score(def, 6); s.ball = def; s.ddShow = false; desc += ", TOUCHDOWN"; banner(g, "td", "Kick Return TD", pShort(p.returner), def); }
        else { s.ball = def; s.pos = clampPos(spot); s.down = 1; s.toGo = 10; s.ddShow = true; }
      }
      break;
    }
    case "defense": // here p.team is the DEFENSE
      if (p.kind === "sack") {
        desc = `${pName(p.defender)} SACK for -${Math.abs(y)} yds`;
        s.ball = def; desc += adv(-Math.abs(y));
        banner(g, "to", "Sack", pShort(p.defender), off, 3);
      } else if (p.kind === "tackle") { desc = `Tackle by ${pName(p.defender)}`; }
      else if (p.kind === "ff") { desc = `Forced fumble by ${pName(p.defender)}`; }
      else if (p.kind === "safety") {
        desc = `SAFETY${p.defender ? " by " + pName(p.defender) : ""}`;
        score(off, 2); banner(g, "fg", "Safety", O.abbr + " +2", off, 3); s.ball = off; kickoffSpot(s); s.ddShow = true;
      }
      break;
    case "penalty": { // p.team is the team that got the flag
      const yd = Math.abs(y), pos = s.pos || 25;
      desc = `PENALTY on ${O.abbr}, ${yd} yds${p.note ? " (" + p.note + ")" : ""}`;
      if (off === s.ball) { // offense pushed back, half the distance to the goal max
        const mv = Math.min(yd, Math.floor(pos / 2)); s.pos = clampPos(pos - mv);
        if (s.toGo !== "Goal") s.toGo += mv;
      } else {
        const mv = Math.min(yd, Math.floor((100 - pos) / 2)); s.pos = clampPos(pos + mv);
        if (s.toGo === "Goal") { if (p.auto) s.down = 1; }
        else if (p.auto || mv >= s.toGo) { s.down = 1; s.toGo = 10; p.first = true; }
        else s.toGo -= mv;
        fixGoal(s);
      }
      s.ddShow = true;
      banner(g, "flag", "Flag", `${yd} yds, ${O.abbr}${p.note ? ", " + p.note : ""}`, null, 3.5);
      break;
    }
  }
  p.desc = desc;
  g.plays.push(p);
  g.updated = Date.now();
  persist();
}
function undoPlay(g) {
  if (!g.undo || !g.undo.length) return toast("Nothing to undo");
  const u = JSON.parse(g.undo.pop());
  const keepClock = { clock: curClock(g.s), running: g.s.running, startedAt: g.s.startedAt, startClock: g.s.startClock, qtr: g.s.qtr };
  g.s = Object.assign(u.s, keepClock); g.plays.length = u.n;
  RT.banner = null; persist(); toast("Undone");
}

function computeStats(g) {
  const P = { away: {}, home: {} }, line = { away: {}, home: {} };
  const TS = () => ({ fd: 0, pass: 0, rush: 0, sackY: 0, sacked: 0, plays: 0, to: 0, pen: 0, penY: 0, d3a: 0, d3c: 0, d4a: 0, d4c: 0, punts: 0, puntY: 0 });
  const TM = { away: TS(), home: TS() };
  const get = (side, pl) => {
    const k = pl.id || "#" + pl.num;
    return P[side][k] = P[side][k] || { num: pl.num, name: pl.name || "", pass: { c: 0, a: 0, y: 0, td: 0, i: 0 }, rush: { n: 0, y: 0, td: 0, lg: 0 }, rec: { n: 0, y: 0, td: 0, lg: 0 }, def: { t: 0, s: 0, i: 0, ff: 0 }, kick: { fm: 0, fa: 0, pm: 0, pa: 0 }, punt: { n: 0, y: 0, lg: 0 }, ret: { kr: 0, kry: 0, pr: 0, pry: 0, td: 0 } };
  };
  const downStat = (p, offSide, converted) => {
    const d = p.pre && p.pre.down, T = TM[offSide];
    if (d === 3) { T.d3a++; if (converted) T.d3c++; }
    if (d === 4) { T.d4a++; if (converted) T.d4c++; }
  };
  for (const p of g.plays) {
    if (p.pts) { const q = ["1", "2", "3", "4"].includes(p.qtr) ? p.qtr : "OT"; line[p.ptsSide][q] = (line[p.ptsSide][q] || 0) + p.pts; }
    const off = p.team, def = other(off), y = +p.yards || 0, ret = +p.ret || 0, T = TM[off];
    if (p.type === "pass") {
      T.plays++; if (p.result === "comp") T.pass += y;
      if (p.result === "int" || p.fumble) T.to++;
      const conv = !!(p.first || (p.td && p.result === "comp"));
      if (conv) T.fd++;
      downStat(p, off, conv);
      if (p.passer) { const S = get(off, p.passer).pass; S.a++; if (p.result === "comp") { S.c++; S.y += y; if (p.td) S.td++; } if (p.result === "int") S.i++; }
      if (p.result === "comp" && p.target) { const R = get(off, p.target).rec; R.n++; R.y += y; R.lg = Math.max(R.lg, y); if (p.td) R.td++; }
      if (p.result === "int" && p.defender) get(def, p.defender).def.i++;
      if (p.tackler) get(def, p.tackler).def.t++;
    } else if (p.type === "run") {
      T.plays++; T.rush += y; if (p.fumble) T.to++;
      const conv = !!(p.first || p.td);
      if (conv) T.fd++;
      downStat(p, off, conv);
      if (p.runner) { const R = get(off, p.runner).rush; R.n++; R.y += y; R.lg = Math.max(R.lg, y); if (p.td) R.td++; }
      if (p.tackler) get(def, p.tackler).def.t++;
    } else if (p.type === "kick" && p.kicker) {
      const K = get(off, p.kicker).kick; if (p.kind === "fg") { K.fa++; if (p.good) K.fm++; } else { K.pa++; if (p.good) K.pm++; }
    } else if (p.type === "punt") {
      T.punts++; T.puntY += y;
      if (p.kicker) { const K = get(off, p.kicker).punt; K.n++; K.y += y; K.lg = Math.max(K.lg, y); }
      if (p.returner && p.result === "ret") { const R = get(def, p.returner).ret; R.pr++; R.pry += ret; if (p.td) R.td++; }
    } else if (p.type === "kickoff") {
      if (p.returner && p.result === "ret") { const R = get(def, p.returner).ret; R.kr++; R.kry += ret; if (p.td) R.td++; }
    } else if (p.type === "defense") {
      if (p.kind === "sack") { const O = TM[def]; O.plays++; O.sacked++; O.sackY += Math.abs(y); downStat(p, def, false); }
      if (p.defender) { const D = get(off, p.defender).def; if (p.kind === "sack") { D.s++; D.t++; } if (p.kind === "tackle") D.t++; if (p.kind === "ff") D.ff++; }
    } else if (p.type === "penalty") {
      T.pen++; T.penY += Math.abs(y);
      if (p.first) TM[def].fd++;
    }
  }
  return { P, line, team: TM };
}

// ---------------- views ----------------
function route() {
  cancelAnimationFrame(RT.raf);
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [v, id, tab] = parts;
  if (v === "team") return viewTeam(id);
  if (v === "new") return viewNewGame();
  if (v === "game" && game(id)) return viewGame(game(id), tab || "live");
  return viewHome();
}
window.addEventListener("hashchange", route);

function teamChip(T) {
  return `<span class="chip" style="--c1:${T.c1};--c2:${T.c2}">${T.logo ? `<img src="${T.logo}" alt="">` : `<b>${esc(T.abbr)}</b>`}</span>`;
}

function viewHome() {
  const games = [...DB.games].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $app.innerHTML = `
  <header class="top"><div><div class="kicker">Football</div><h1>Scoreboard</h1></div></header>
  <section>
    <div class="sechead"><h2>Games</h2><button class="primary" data-act="newGame">+ New game</button></div>
    ${games.length ? games.map(g => {
      const A = sideTeam(g, "away"), H = sideTeam(g, "home");
      const q = g.s.qtr === "FINAL" ? "Final" : g.s.qtr === "HALF" ? "Half" : `Q${g.s.qtr}`;
      return `<a class="gamecard" href="#/game/${g.id}">
        <div class="gc-team">${teamChip(A)}<span>${esc(A.abbr)}</span><b>${g.s.away.score}</b></div>
        <div class="gc-mid"><span>${esc(g.title || "")}</span><small>${q} · ${new Date(g.created).toLocaleDateString()}</small></div>
        <div class="gc-team r"><b>${g.s.home.score}</b><span>${esc(H.abbr)}</span>${teamChip(H)}</div></a>`;
    }).join("") : `<p class="empty">No games yet. Make your teams first, then start a game.</p>`}
  </section>
  <section>
    <div class="sechead"><h2>Teams</h2><button data-act="newTeam">+ New team</button></div>
    <div class="teamgrid">
      ${DB.teams.map(T => `<a class="teamcard" href="#/team/${T.id}" style="--c1:${T.c1};--c2:${T.c2}">
        ${T.logo ? `<img src="${T.logo}" alt="">` : `<b class="ab">${esc(T.abbr)}</b>`}
        <span>${esc(T.name)}</span><small>${T.roster.length} players</small></a>`).join("") || `<p class="empty">No teams yet.</p>`}
    </div>
  </section>
  <section class="backup">
    <h2>Backup</h2>
    <p class="muted">Everything is saved on this phone. Save a backup now and then so nothing gets lost if Safari's data is cleared.</p>
    <div class="row"><button data-act="exportAll">Save a backup</button><label class="btn">Load a backup<input type="file" accept="application/json,.json" data-change="importAll" hidden></label></div>
  </section>`;
}

let TE = null; // team being edited
function viewTeam(id) {
  const existing = team(id);
  if (!TE || TE.id !== id) TE = existing ? JSON.parse(JSON.stringify(existing)) : { id, name: "", abbr: "", logo: "", c1: "#1d3c78", c2: "#f2b632", roster: [], swatches: [] };
  TE.slot = TE.slot || "c1";
  $app.innerHTML = `
  <header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>${existing ? "Edit team" : "New team"}</h1></header>
  <section>
    <canvas id="tprev" width="1280" height="250" class="tprev"></canvas>
    <div class="logo-up">
      <label class="logo-box" style="--c1:${TE.c1}">${TE.logo ? `<img src="${TE.logo}">` : `<span>Add logo</span>`}
        <input type="file" accept="image/*" data-change="logoFile" hidden></label>
      <div class="grow">
        <label class="lbl">Team name</label><input data-input="tName" value="${esc(TE.name)}" maxlength="22" placeholder="Storm">
        <label class="lbl">Short name (3–4 letters)</label><input data-input="tAbbr" value="${esc(TE.abbr)}" maxlength="4" placeholder="STM" style="text-transform:uppercase">
      </div>
    </div>
    ${TE.logo ? `<button class="small ghost" data-act="removeLogo">Remove logo</button>` : ""}
  </section>
  <section>
    <h2>Colors</h2>
    <div class="slots">
      <button class="slot ${TE.slot === "c1" ? "on" : ""}" data-act="slot" data-v="c1"><i style="background:${TE.c1}"></i>Main color</button>
      <button class="slot ${TE.slot === "c2" ? "on" : ""}" data-act="slot" data-v="c2"><i style="background:${TE.c2}"></i>Second color</button>
    </div>
    ${TE.swatches.length ? `<p class="muted">Colors from your logo. Pick a slot above, then tap a color.</p>
      <div class="swatches">${TE.swatches.map(c => `<button class="sw" data-act="swatch" data-v="${c}" style="background:${c}"></button>`).join("")}</div>` : `<p class="muted">Add a logo and I'll pull its colors out for you.</p>`}
    <div class="row"><label class="btn colorbtn">Pick any color<input type="color" data-input="tColor" value="${TE[TE.slot]}"></label></div>
  </section>
  <section>
    <h2>Roster</h2>
    <div class="roster">${TE.roster.sort((a, b) => a.num - b.num).map(p => `<div class="rp"><b>#${esc(p.num)}</b><span>${esc(p.name)}</span><small>${esc(p.pos || "")}</small><button class="x" data-act="delPlayer" data-v="${p.id}">✕</button></div>`).join("") || `<p class="muted">No players yet. You can also add players during a game.</p>`}</div>
    <div class="addp"><input id="pNum" inputmode="numeric" placeholder="#" maxlength="3"><input id="pName" placeholder="Name"><input id="pPos" placeholder="Pos" maxlength="4"><button data-act="addPlayer">Add</button></div>
  </section>
  <div class="savebar"><button class="primary big" data-act="saveTeam">Save team</button>${existing ? `<button class="danger" data-act="deleteTeam">Delete</button>` : ""}</div>`;
  drawTeamPreview();
}
function drawTeamPreview() {
  const c = document.getElementById("tprev"); if (!c) return;
  const ctx = c.getContext("2d");
  const fake = { id: "_prev", style: "prime", spotShow: false, awayId: "_", homeId: "_", s: Object.assign(newGameState(12), { ddShow: true, down: 1, toGo: 10 }) };
  const T = { abbr: (TE.abbr || "TEAM").toUpperCase(), name: TE.name || "Team", logo: TE.logo, c1: TE.c1, c2: TE.c2 };
  const draw = () => {
    ctx.clearRect(0, 0, c.width, c.height); drawBackdrop(ctx, c.width, c.height);
    const S = bugState(fake, performance.now());
    S.away = Object.assign({}, T, { logo: img(T.logo), score: 14, to: 3, ball: true });
    S.home = { abbr: "OPP", name: "Opponent", logo: null, c1: "#555b66", c2: "#9aa0a8", score: 7, to: 3 };
    S.clock = "8:24";
    drawBug(ctx, c.width, c.height, S, performance.now(), { frac: .93 });
  };
  draw(); if (TE.logo) img(TE.logo).onload = draw;
}

function viewNewGame() {
  if (DB.teams.length < 2) { $app.innerHTML = `<header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>New game</h1></header>
    <section><p>You need at least two teams first.</p><button class="primary" data-act="newTeam">+ Make a team</button></section>`; return; }
  const opts = sel => DB.teams.map(T => `<option value="${T.id}" ${T.id === sel ? "selected" : ""}>${esc(T.name)} (${esc(T.abbr)})</option>`).join("");
  const NG = window.NG = window.NG || { awayId: DB.teams[0].id, homeId: DB.teams[1].id, style: "prime", qLen: 12, title: "" };
  $app.innerHTML = `
  <header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>New game</h1></header>
  <section>
    <label class="lbl">Away team</label><select data-input="ngAway">${opts(NG.awayId)}</select>
    <label class="lbl">Home team</label><select data-input="ngHome">${opts(NG.homeId)}</select>
    <label class="lbl">Game name (optional)</label><input data-input="ngTitle" value="${esc(NG.title)}" placeholder="Week 3">
    <label class="lbl">Minutes per quarter</label><input data-input="ngQ" type="number" inputmode="numeric" value="${NG.qLen}" min="1" max="20">
  </section>
  <section><h2>Score bug look</h2><div class="styles">${STYLES.map(st => `
    <button class="stylecard ${NG.style === st.id ? "on" : ""}" data-act="ngStyle" data-v="${st.id}">
      <canvas width="1280" height="${st.id === "corner" ? 360 : 250}" data-prev="${st.id}"></canvas><b>${st.name}</b><small>${st.note}</small></button>`).join("")}</div></section>
  <div class="savebar"><button class="primary big" data-act="createGame">Start game</button></div>`;
  const fake = { id: "_ng", awayId: NG.awayId, homeId: NG.homeId, s: Object.assign(newGameState(NG.qLen), { ddShow: true, down: 3, toGo: 4, ball: "away", pos: 68 }) };
  fake.s.away.score = 14; fake.s.home.score = 10;
  document.querySelectorAll("canvas[data-prev]").forEach(c => {
    const ctx = c.getContext("2d");
    const draw = () => { ctx.clearRect(0, 0, c.width, c.height); drawBackdrop(ctx, c.width, c.height); drawBug(ctx, c.width, c.height, bugState(fake, 0, c.dataset.prev), 0, { frac: .93 }); };
    draw(); setTimeout(draw, 400);
  });
}

// ---------------- game view ----------------
function viewGame(g, tab) {
  const A = sideTeam(g, "away"), H = sideTeam(g, "home");
  $app.innerHTML = `
  <header class="top game"><button class="back" data-act="backHome">‹ Games</button><h1>${esc(A.abbr)} vs ${esc(H.abbr)}</h1></header>
  <nav class="tabs">${[["live", "Live"], ["record", "Record"], ["stats", "Stats"], ["setup", "Setup"]].map(([k, l]) => `<a href="#/game/${g.id}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
  <div id="tab"></div>`;
  const el = document.getElementById("tab");
  if (tab === "live") liveTab(g, el);
  else if (tab === "record") recordTab(g, el);
  else if (tab === "stats") statsTab(g, el);
  else setupTab(g, el);
}

function startPreviewLoop(g, canvas, withBackdrop, opts) {
  const ctx = canvas.getContext("2d");
  const loop = () => {
    const now = performance.now(); const s = g.s;
    if (s.running && curClock(s) === 0) onClockZero(g);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (withBackdrop) drawBackdrop(ctx, canvas.width, canvas.height);
    drawBug(ctx, canvas.width, canvas.height, bugState(g, now), now, opts);
    RT.raf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(RT.raf); loop();
}

function liveTab(g, el) {
  el.innerHTML = `
    <canvas id="prev" width="1280" height="420" class="preview"></canvas>
    <div id="liveCtl"></div>`;
  startPreviewLoop(g, document.getElementById("prev"), true, { frac: .93 });
  refreshLive(g);
}
const PLAY_BTNS = [["pass", "Pass"], ["run", "Run"], ["kick", "FG / XP"], ["two", "2-pt"], ["punt", "Punt"], ["kickoff", "Kickoff"], ["defense", "Defense"], ["penalty", "Flag"]];
const POPS = [["td", "Touchdown"], ["first", "First down"], ["turnover", "Turnover"], ["flag", "Flag"], ["sack", "Sack"], ["stop", "4th down stop"], ["bigplay", "Big play"], ["twomin", "2-min warning"], ["injury", "Injury timeout"], ["custom", "Custom..."]];
function qBar(g) {
  const s = g.s, nq = nextQ(g), pq = prevQ(g);
  return `<div class="qbar"><button class="qarrow" data-act="qPrev" ${pq ? "" : "disabled"}>‹</button><span class="qnow">${Q_LONG[s.qtr] || s.qtr}</span>
    ${nq ? `<button class="primary" data-act="qNext">${Q_NEXT_LABEL[nq]} ›</button>` : `<button data-act="qtr" data-v="OT">Add OT</button>`}</div>`;
}
function controlsHTML(g) {
  const s = g.s, A = sideTeam(g, "away"), H = sideTeam(g, "home");
  const teamBox = (side, T) => `
    <div class="tbox" style="--c1:${T.c1};--ink:${ink(T.c1)}">
      <div class="tb-head">${teamChip(T)}<span>${esc(T.abbr)}</span><b>${s[side].score}</b></div>
      <div class="tb-btns">
        <button data-act="pts" data-side="${side}" data-v="6">+6</button><button data-act="pts" data-side="${side}" data-v="3">+3</button>
        <button data-act="pts" data-side="${side}" data-v="2">+2</button><button data-act="pts" data-side="${side}" data-v="1">+1</button>
        <button data-act="pts" data-side="${side}" data-v="-1" class="ghost">−1</button>
      </div>
      <div class="tb-row">
        <button class="${s.ball === side ? "on" : ""}" data-act="ball" data-side="${side}">${s.ball === side ? "Has ball" : "Give ball"}</button>
        <button data-act="timeout" data-side="${side}">Timeout (${s[side].to} left)</button>
      </div>
    </div>`;
  return `
  <section class="card">
    <h2>Log a play <small>updates score, stats, downs and ball spot</small></h2>
    <div class="playbtns">${PLAY_BTNS.map(([v, l]) => `<button class="pb ${v === "penalty" ? "flag" : ""}" data-act="play" data-v="${v}">${l}</button>`).join("")}</div>
    <button class="ghost wide" data-act="undo">Undo last play</button>
  </section>
  <section class="card">
    <h2>Clock &amp; quarter</h2>
    <div class="clockrow"><span class="bigclock ${s.running ? "run" : ""}" id="bigClock">${fmtClock(curClock(s))}</span>
      <button class="${s.running ? "stop" : "go"} big" data-act="clock">${s.running ? "Stop" : "Start"}</button></div>
    <div class="row"><button data-act="clockAdj" data-v="-10">−10s</button><button data-act="clockAdj" data-v="-1">−1s</button><button data-act="clockAdj" data-v="1">+1s</button><button data-act="clockAdj" data-v="10">+10s</button><button data-act="setClock">Set</button></div>
    ${qBar(g)}
    <div class="row qrow">${Q_ORDER.map(q => `<button class="${s.qtr === q ? "on" : ""}" data-act="qtr" data-v="${q}">${Q_SHORT[q]}</button>`).join("")}</div>
  </section>
  <section class="card">
    <h2>Down, distance &amp; spot <small>${s.ddShow ? "showing" : "hidden"}</small></h2>
    <div class="row">${[1, 2, 3, 4].map(d => `<button class="${s.down === d ? "on" : ""}" data-act="down" data-v="${d}">${ord(d).toLowerCase()}</button>`).join("")}</div>
    <div class="row togo"><button data-act="toGo" data-v="-1">−</button><span>${s.toGo === "Goal" ? "Goal" : s.toGo + " to go"}</span><button data-act="toGo" data-v="1">+</button>
      <button data-act="toGoSet" data-v="10">10</button><button class="${s.toGo === "Goal" ? "on" : ""}" data-act="toGoSet" data-v="Goal">Goal</button></div>
    <div class="lbl">Ball on <i>(+ moves toward the end zone)</i></div>
    <div class="row spotrow"><button data-act="spot" data-v="-5">−5</button><button data-act="spot" data-v="-1">−1</button><span>${esc(spotText(g))}</span><button data-act="spot" data-v="1">+1</button><button data-act="spot" data-v="5">+5</button></div>
    <div class="row"><button data-act="first">1st &amp; 10</button><button data-act="ddShow">${s.ddShow ? "Hide downs" : "Show downs"}</button><button data-act="spotShow">${g.spotShow !== false ? "Hide spot" : "Show spot"}</button></div>
  </section>
  <section class="two">${teamBox("away", A)}${teamBox("home", H)}</section>
  <section class="card">
    <h2>Pop-ups</h2>
    <div class="pops">${POPS.map(([v, l]) => `<button data-act="pop" data-v="${v}">${l}</button>`).join("")}</div>
  </section>`;
}
function refreshLive(g) {
  const el = document.getElementById("liveCtl"); if (el) el.innerHTML = controlsHTML(g);
  const rc = document.getElementById("recCtl"); if (rc) rc.innerHTML = recControlsHTML(g);
}
setInterval(() => { // keep the big clock text ticking
  const b = document.getElementById("bigClock"); const g = currentGame();
  if (b && g) b.textContent = fmtClock(curClock(g.s));
}, 250);
function currentGame() { const m = location.hash.match(/#\/game\/([^/]+)/); return m && game(m[1]); }

// ---------------- play sheet ----------------
let PS = null;
function openPlay(g, type) {
  const s = g.s;
  PS = { type, team: type === "defense" || type === "kickoff" ? other(s.ball) : s.ball, yards: "", ret: "",
    result: type === "punt" || type === "kickoff" ? "ret" : "comp", kind: type === "kick" ? (s.ddShow ? "fg" : "pat") : type === "defense" ? "tackle" : "", good: true, td: false, fumble: false, auto: false };
  if (type === "punt") { PS.yards = "35"; PS.ret = "0"; }
  if (type === "kickoff") { PS.yards = "5"; PS.ret = "20"; }
  if (type === "kick" && PS.kind === "fg") PS.yards = String(Math.max(17, 100 - (s.pos || 75) + 17));
  renderSheet(g);
}
function numField(key, label) {
  return `<div class="lbl">${label}</div><div class="yds">
    <button data-act="yd" data-k="${key}" data-v="-5">−5</button><button data-act="yd" data-k="${key}" data-v="-1">−1</button>
    <input id="num_${key}" inputmode="numeric" pattern="-?[0-9]*" value="${esc(PS[key])}" data-input="num" data-k="${key}" placeholder="0">
    <button data-act="yd" data-k="${key}" data-v="1">+1</button><button data-act="yd" data-k="${key}" data-v="5">+5</button></div>`;
}
function picker(g, side, key, label, optional) {
  const T = sideTeam(g, side), sel = PS[key];
  const roster = [...(team(T.id)?.roster || [])].sort((a, b) => a.num - b.num);
  return `<div class="pk" data-pk="${key}"><div class="lbl">${label}${optional ? " <i>(optional)</i>" : ""}</div><div class="chips">
    ${optional ? `<button class="${!sel ? "on" : ""}" data-act="pk" data-k="${key}" data-v="">None</button>` : ""}
    ${roster.map(p => `<button class="${sel && sel.id === p.id ? "on" : ""}" data-act="pk" data-k="${key}" data-v="${p.id}" data-side="${side}"><b>#${esc(p.num)}</b> ${esc(p.name.split(" ").slice(-1)[0] || "")}</button>`).join("")}
    <button class="add" data-act="pkAdd" data-k="${key}" data-side="${side}">+ New</button></div></div>`;
}
function seg(key, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${String(PS[key]) === String(v) ? "on" : ""}" data-act="ps" data-k="${key}" data-v="${v}">${l}</button>`).join("")}</div>`;
}
const yardsField = label => numField("yards", label);
function renderSheet(g) {
  if (!PS) { document.getElementById("sheet")?.remove(); return; }
  const off = PS.team, def = other(off), O = sideTeam(g, off), D = sideTeam(g, def);
  const teamSeg = label => `<div class="lbl">${label}</div><div class="seg">${["away", "home"].map(sd => { const T = sideTeam(g, sd); return `<button class="${PS.team === sd ? "on" : ""}" data-act="ps" data-k="team" data-v="${sd}">${esc(T.abbr)}</button>`; }).join("")}</div>`;
  let body = "", title = "";
  if (PS.type === "pass") {
    title = "Pass";
    body = teamSeg("Offense") + seg("result", [["comp", "Complete"], ["inc", "Incomplete"], ["int", "Intercepted"]]) + picker(g, off, "passer", "Thrown by");
    if (PS.result === "comp") body += picker(g, off, "target", "Caught by") + yardsField("Yards gained") + seg("td", [[false, "No score"], [true, "Touchdown"]])
      + (PS.td ? "" : seg("fumble", [[false, "No fumble"], [true, "Fumble, lost"]])) + picker(g, def, PS.fumble && !PS.td ? "defender" : "tackler", PS.fumble && !PS.td ? "Recovered by" : "Tackled by", true);
    if (PS.result === "inc") body += picker(g, off, "target", "Intended for", true);
    if (PS.result === "int") body += picker(g, def, "defender", "Picked off by") + seg("td", [[false, "No score"], [true, "Returned for TD"]]) + (PS.td ? "" : numField("ret", "Return yards <i>(optional)</i>"));
  } else if (PS.type === "run") {
    title = "Run";
    body = teamSeg("Offense") + picker(g, off, "runner", "Ball carrier") + yardsField("Yards gained") + seg("td", [[false, "No score"], [true, "Touchdown"]])
      + seg("fumble", [[false, "No fumble"], [true, "Fumble, lost"]]) + picker(g, def, PS.fumble ? "defender" : "tackler", PS.fumble ? "Recovered by" : "Tackled by", true);
  } else if (PS.type === "kick") {
    title = "Kick";
    body = teamSeg("Kicking team") + seg("kind", [["fg", "Field goal"], ["pat", "Extra point"]]) + picker(g, off, "kicker", "Kicker")
      + (PS.kind === "fg" ? yardsField("Distance (yds)") : "") + seg("good", [[true, "Good"], [false, "No good"]]);
  } else if (PS.type === "two") {
    title = "2-point try";
    body = teamSeg("Team") + picker(g, off, "player", "Scored by (or tried)") + seg("good", [[true, "Good"], [false, "Failed"]]);
  } else if (PS.type === "punt") {
    title = "Punt";
    body = teamSeg("Punting team") + picker(g, off, "kicker", "Punter", true) + numField("yards", "Punt distance (yds)")
      + seg("result", [["ret", "Returned"], ["fc", "Fair catch"], ["down", "Downed / out"], ["tb", "Touchback"]]);
    if (PS.result === "ret") body += picker(g, def, "returner", "Returned by", true) + numField("ret", "Return yards") + seg("td", [[false, "No score"], [true, "Returned for TD"]]);
  } else if (PS.type === "kickoff") {
    title = "Kickoff";
    body = teamSeg("Kicking team") + picker(g, off, "kicker", "Kicker", true) + seg("result", [["ret", "Returned"], ["tb", "Touchback"], ["onside", "Onside, kicking team kept it"]]);
    if (PS.result === "ret") body += picker(g, def, "returner", "Returned by", true) + numField("yards", `Caught at ${esc(D.abbr)}'s own yard line`) + numField("ret", "Return yards") + seg("td", [[false, "No score"], [true, "Returned for TD"]]);
    if (PS.result === "onside") body += numField("yards", `Recovered at ${esc(O.abbr)}'s own yard line`);
  } else if (PS.type === "defense") {
    title = "Defense";
    body = teamSeg("Defense") + seg("kind", [["tackle", "Tackle"], ["sack", "Sack"], ["ff", "Forced fumble"], ["safety", "Safety"]]) + picker(g, off, "defender", "Player", PS.kind === "safety")
      + (PS.kind === "sack" ? yardsField("Yards lost") : "");
  } else if (PS.type === "penalty") {
    title = "Flag";
    body = teamSeg("Flag on") + yardsField("Penalty yards") + `<div class="lbl">What was it? <i>(optional)</i></div>
      <div class="chips">${["Holding", "False start", "Offside", "Pass interference", "Delay of game", "Facemask", "Unsportsmanlike"].map(n => `<button class="${PS.note === n ? "on" : ""}" data-act="ps" data-k="note" data-v="${n}">${n}</button>`).join("")}</div>`
      + (off !== g.s.ball ? seg("auto", [[false, "Normal"], [true, "Automatic 1st down"]]) : "");
  }
  let sh = document.getElementById("sheet");
  if (!sh) { sh = document.createElement("div"); sh.id = "sheet"; sh.className = "sheet"; document.body.appendChild(sh); }
  sh.innerHTML = `<div class="sheet-in" style="--c1:${O.c1}">
    <div class="sheet-head"><h3>${title}</h3><button class="x" data-act="closeSheet">✕</button></div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot"><button class="primary big" data-act="savePlay">Save play</button></div></div>`;
}
function savePlay(g) {
  const need = { pass: ["passer"], run: ["runner"], kick: ["kicker"], two: [], punt: [], kickoff: [], defense: PS.kind === "safety" ? [] : ["defender"], penalty: [] }[PS.type];
  if (PS.type === "pass" && PS.result === "comp") need.push("target");
  if (PS.type === "pass" && PS.result === "int") need.push("defender");
  for (const k of need) if (!PS[k]) return toast("Pick a player first (or tap + New)");
  const p = Object.assign({}, PS);
  p.yards = parseInt(PS.yards, 10) || 0; p.ret = parseInt(PS.ret, 10) || 0;
  p.td = PS.td === true || PS.td === "true"; p.good = PS.good === true || PS.good === "true"; p.fumble = PS.fumble === true || PS.fumble === "true"; p.auto = PS.auto === true || PS.auto === "true";
  if (p.td) p.fumble = false;
  if (PS.type === "run" || (PS.type === "pass" && PS.result === "comp")) { if (p.fumble) delete p.tackler; else delete p.defender; }
  if ((PS.type === "punt" || PS.type === "kickoff") && PS.result !== "ret") { delete p.returner; p.td = false; p.ret = 0; }
  applyPlay(g, p);
  PS = null; renderSheet(g); refreshLive(g);
  if (location.hash.endsWith("/stats")) route();
}

// ---------------- record mode ----------------
const REC = { stream: null, rec: null, chunks: [], facing: "environment", t0: 0, canvas: null, video: null, lock: null };
function recordTab(g, el) {
  el.innerHTML = `
  <section class="card">
    <h2>Record with the score bug</h2>
    <p class="muted">The camera fills the screen with the bug on top. All the game controls sit on top of the camera, and they are <b>not</b> in the video. Only the camera and the bug get recorded.</p>
    <ol class="steps"><li>Turn the phone sideways.</li><li>Tap <b>Open camera</b>, then the red button to record.</li>
      <li>Score buttons are on the left and right. The middle has tabs: <b>Clock</b> (start/stop, next quarter), <b>Downs</b> (down, distance, ball spot), <b>Plays</b> (log a pass, run, punt...), <b>Pop-ups</b> and <b>Look</b> (change the bug).</li>
      <li>Tap <b>Hide</b> to see the whole picture. The video keeps recording.</li>
      <li>When you stop, tap <b>Save video</b> and pick <b>Save Video</b> to put it in Photos.</li></ol>
    <p class="muted">First time? Record a 10 second test clip and check it saved right before the real game.</p>
    <button class="primary big wide" data-act="openCam">Open camera</button>
  </section>`;
}
const REC_PAGES = [["game", "Clock"], ["down", "Downs"], ["plays", "Plays"], ["pops", "Pop-ups"], ["look", "Look"]];
function recControlsHTML(g) {
  const s = g.s, A = sideTeam(g, "away"), H = sideTeam(g, "home");
  if (REC.hide) return `<button class="rc-show" data-act="recHide">Show controls</button>`;
  const side = (sd, T) => `<div class="rc-team ${sd}" style="--c1:${T.c1}"><span>${esc(T.abbr)} <b>${s[sd].score}</b></span>
    <button data-act="pts" data-side="${sd}" data-v="6">+6</button><button data-act="pts" data-side="${sd}" data-v="3">+3</button>
    <button data-act="pts" data-side="${sd}" data-v="2">+2</button><button data-act="pts" data-side="${sd}" data-v="1">+1</button>
    <button data-act="pts" data-side="${sd}" data-v="-1" class="sm">−1</button><button data-act="timeout" data-side="${sd}" class="sm">TO ${s[sd].to}</button>
    <button data-act="ball" data-side="${sd}" class="wide2 ${s.ball === sd ? "on" : ""}">${s.ball === sd ? "Has ball" : "Give ball"}</button></div>`;
  const P = REC.page || "game", nq = nextQ(g);
  let row = "";
  if (P === "game") row = `
    <button class="${s.running ? "stop" : "go"}" data-act="clock">${s.running ? "Stop" : "Start"}</button>
    <button data-act="clockAdj" data-v="-10">−10s</button><button data-act="clockAdj" data-v="-1">−1s</button><button data-act="clockAdj" data-v="1">+1s</button><button data-act="clockAdj" data-v="10">+10s</button>
    <button data-act="setClock">Set</button>
    <button data-act="qPrev" ${prevQ(g) ? "" : "disabled"}>‹ Qtr</button><span class="rc-q">${Q_SHORT[s.qtr]}</span>
    ${nq ? `<button class="yel" data-act="qNext">${Q_NEXT_LABEL[nq]} ›</button>` : `<button data-act="qtr" data-v="OT">Add OT</button>`}`;
  else if (P === "down") row = `
    ${[1, 2, 3, 4].map(d => `<button class="${s.down === d ? "on" : ""}" data-act="down" data-v="${d}">${ord(d).toLowerCase()}</button>`).join("")}
    <button data-act="first">1st &amp; 10</button>
    <button data-act="toGo" data-v="-1">− yd</button><span class="rc-q">${s.toGo === "Goal" ? "Goal" : s.toGo + " to go"}</span><button data-act="toGo" data-v="1">+ yd</button>
    <button class="${s.toGo === "Goal" ? "on" : ""}" data-act="toGoSet" data-v="Goal">Goal</button>
    <button data-act="spot" data-v="-5">Spot −5</button><button data-act="spot" data-v="-1">−1</button><span class="rc-q">${esc(spotText(g))}</span><button data-act="spot" data-v="1">+1</button><button data-act="spot" data-v="5">+5</button>
    <button data-act="ddShow">${s.ddShow ? "Hide downs" : "Show downs"}</button>`;
  else if (P === "plays") row = PLAY_BTNS.map(([v, l]) => `<button class="${v === "penalty" ? "yel" : ""}" data-act="play" data-v="${v}">${l}</button>`).join("") + `<button data-act="undo">Undo</button>`;
  else if (P === "pops") row = POPS.map(([v, l]) => `<button data-act="pop" data-v="${v}">${l}</button>`).join("");
  else row = STYLES.map(st => `<button class="${g.style === st.id ? "on" : ""}" data-act="gStyleRec" data-v="${st.id}">${st.name}</button>`).join("")
    + [[.85, "Small"], [1, "Medium"], [1.15, "Large"]].map(([v, l]) => `<button class="${(g.bugSize || 1) === v ? "on" : ""}" data-act="gSize" data-v="${v}">${l}</button>`).join("")
    + `<button data-act="gPos" data-v="${g.bugPos === "top" ? "bottom" : "top"}">Bug to ${g.bugPos === "top" ? "bottom" : "top"}</button><button data-act="spotShow">${g.spotShow !== false ? "Hide spot" : "Show spot"}</button>`;
  return `${side("away", A)}
    <div class="rc-mid">
      <div class="rc-tabs">${REC_PAGES.map(([k, l]) => `<button class="${P === k ? "on" : ""}" data-act="recPage" data-v="${k}">${l}</button>`).join("")}<button data-act="recHide">Hide</button></div>
      <div class="rc-row">${row}</div>
    </div>${side("home", H)}`;
}
async function openCam(g) {
  const ov = document.createElement("div"); ov.id = "recov"; ov.className = "recov";
  ov.innerHTML = `
    <video id="camv" playsinline muted autoplay></video>
    <canvas id="recc"></canvas>
    <div class="rec-top">
      <button class="x" data-act="closeCam">✕</button>
      <span class="rec-time" id="recTime"></span><span class="sp"></span>
      <button data-act="flipCam" class="flip">Flip</button>
      <button class="recbtn" id="recBtn" data-act="recToggle"><i></i></button>
    </div>
    <div class="rec-ctl" id="recCtl"></div>
    <div class="rotate-hint">Turn your phone sideways for the best video</div>`;
  document.body.appendChild(ov); document.body.classList.add("noscroll");
  REC.canvas = ov.querySelector("#recc"); REC.video = ov.querySelector("#camv");
  refreshLive(g);
  try { await startCamera(); } catch (e) { toast("Camera didn't open. Check that Safari is allowed to use the camera."); console.error(e); }
  try { REC.lock = await navigator.wakeLock?.request("screen"); } catch (e) {}
  const ctx = REC.canvas.getContext("2d");
  const loop = () => {
    if (!document.getElementById("recov")) return;
    const v = REC.video, vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
    let W = vw, H = vh; const k = Math.min(1, 1920 / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
    if (REC.canvas.width !== W || REC.canvas.height !== H) { REC.canvas.width = W; REC.canvas.height = H; }
    if (v.readyState >= 2) ctx.drawImage(v, 0, 0, W, H); else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    const s = g.s; if (s.running && curClock(s) === 0) onClockZero(g);
    const now = performance.now(); drawBug(ctx, W, H, bugState(g, now), now);
    if (REC.rec && REC.rec.state === "recording") { const t = Math.floor((Date.now() - REC.t0) / 1000); document.getElementById("recTime").textContent = "REC " + fmtClock(t); }
    REC.loop = requestAnimationFrame(loop);
  };
  loop();
}
async function startCamera() {
  REC.stream?.getTracks().forEach(t => t.stop());
  const video = { facingMode: { ideal: REC.facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  try { REC.stream = await navigator.mediaDevices.getUserMedia({ video, audio: true }); }
  catch (e) { REC.stream = await navigator.mediaDevices.getUserMedia({ video }); toast("Recording without sound (no microphone permission)"); }
  REC.video.srcObject = REC.stream; await REC.video.play().catch(() => {});
}
function pickMime() {
  const opts = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return opts.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
}
function recToggle(g) {
  if (REC.rec && REC.rec.state === "recording") { REC.rec.stop(); return; }
  if (!window.MediaRecorder || !REC.canvas.captureStream) return toast("This browser can't record. Update iOS, then try again in Safari.");
  const cs = REC.canvas.captureStream(30);
  REC.stream?.getAudioTracks().forEach(t => cs.addTrack(t));
  const mime = pickMime();
  try { REC.rec = new MediaRecorder(cs, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined); }
  catch (e) { REC.rec = new MediaRecorder(cs); }
  REC.chunks = [];
  REC.rec.ondataavailable = e => e.data && e.data.size && REC.chunks.push(e.data);
  REC.rec.onstop = () => {
    document.getElementById("recBtn")?.classList.remove("on"); const rt = document.getElementById("recTime"); if (rt) rt.textContent = "";
    const type = REC.rec.mimeType || mime || "video/mp4";
    const blob = new Blob(REC.chunks, { type }); const ext = type.includes("mp4") ? "mp4" : "webm";
    const A = sideTeam(g, "away"), H = sideTeam(g, "home"), stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
    showSaveDialog(new File([blob], `Scoreboard-${A.abbr}-vs-${H.abbr}-${stamp}.${ext}`, { type }));
  };
  REC.rec.start(1000); REC.t0 = Date.now();
  document.getElementById("recBtn").classList.add("on");
}
function showSaveDialog(file) {
  const url = URL.createObjectURL(file);
  const d = document.createElement("div"); d.className = "savedlg";
  d.innerHTML = `<div class="savedlg-in"><h3>Clip ready</h3><video src="${url}" playsinline controls></video>
    <button class="primary big" data-act="shareClip">Save video</button>
    <a class="btn" href="${url}" download="${esc(file.name)}">Download file</a>
    <button class="ghost" data-act="closeDlg">Done</button></div>`;
  d._file = file; document.body.appendChild(d);
}
function closeCam() {
  if (REC.rec && REC.rec.state === "recording" && !confirm("You're still recording. Stop and close the camera?")) return;
  if (REC.rec && REC.rec.state === "recording") REC.rec.stop();
  cancelAnimationFrame(REC.loop); REC.stream?.getTracks().forEach(t => t.stop()); REC.stream = null;
  REC.lock?.release?.(); document.getElementById("recov")?.remove(); document.body.classList.remove("noscroll");
}

// ---------------- stats tab ----------------
function statsTab(g, el) {
  const { P, line, team: TM } = computeStats(g), A = sideTeam(g, "away"), H = sideTeam(g, "home");
  const pct = (c, a) => a ? `${c}-${a}` : "0-0";
  const teamRows = [
    ["First downs", x => x.fd], ["Total yards", x => x.pass - x.sackY + x.rush], ["Passing yards", x => x.pass - x.sackY], ["Rushing yards", x => x.rush],
    ["Plays", x => x.plays], ["Yards per play", x => x.plays ? ((x.pass - x.sackY + x.rush) / x.plays).toFixed(1) : "0.0"],
    ["3rd down", x => pct(x.d3c, x.d3a)], ["4th down", x => pct(x.d4c, x.d4a)], ["Turnovers", x => x.to], ["Sacked", x => `${x.sacked}-${x.sackY}`],
    ["Penalties", x => `${x.pen}-${x.penY}`], ["Punts", x => x.punts ? `${x.punts}, ${(x.puntY / x.punts).toFixed(1)} avg` : "0"],
  ];
  const qs = ["1", "2", "3", "4"].concat(g.plays.some(p => p.qtr === "OT") ? ["OT"] : []);
  const table = (title, cols, rows) => rows.length ? `<h4>${title}</h4><table><tr><th>Player</th>${cols.map(c => `<th>${c}</th>`).join("")}</tr>${rows.join("")}</table>` : "";
  const pl = x => `<td class="pn">#${esc(x.num)} ${esc(x.name)}</td>`;
  const sideHTML = (side, T) => {
    const L = Object.values(P[side]).sort((a, b) => a.num - b.num);
    const body = table("Passing", ["C/ATT", "YDS", "TD", "INT"], L.filter(x => x.pass.a).map(x => `<tr>${pl(x)}<td>${x.pass.c}/${x.pass.a}</td><td>${x.pass.y}</td><td>${x.pass.td}</td><td>${x.pass.i}</td></tr>`))
      + table("Rushing", ["CAR", "YDS", "AVG", "TD", "LONG"], L.filter(x => x.rush.n).map(x => `<tr>${pl(x)}<td>${x.rush.n}</td><td>${x.rush.y}</td><td>${(x.rush.y / x.rush.n).toFixed(1)}</td><td>${x.rush.td}</td><td>${x.rush.lg}</td></tr>`))
      + table("Receiving", ["REC", "YDS", "TD", "LONG"], L.filter(x => x.rec.n).map(x => `<tr>${pl(x)}<td>${x.rec.n}</td><td>${x.rec.y}</td><td>${x.rec.td}</td><td>${x.rec.lg}</td></tr>`))
      + table("Defense", ["TKL", "SACK", "INT", "FF"], L.filter(x => x.def.t || x.def.s || x.def.i || x.def.ff).map(x => `<tr>${pl(x)}<td>${x.def.t}</td><td>${x.def.s}</td><td>${x.def.i}</td><td>${x.def.ff}</td></tr>`))
      + table("Kicking", ["FG", "XP"], L.filter(x => x.kick.fa || x.kick.pa).map(x => `<tr>${pl(x)}<td>${x.kick.fm}/${x.kick.fa}</td><td>${x.kick.pm}/${x.kick.pa}</td></tr>`))
      + table("Punting", ["PUNTS", "YDS", "AVG", "LONG"], L.filter(x => x.punt.n).map(x => `<tr>${pl(x)}<td>${x.punt.n}</td><td>${x.punt.y}</td><td>${(x.punt.y / x.punt.n).toFixed(1)}</td><td>${x.punt.lg}</td></tr>`))
      + table("Returns", ["KR", "YDS", "PR", "YDS", "TD"], L.filter(x => x.ret.kr || x.ret.pr).map(x => `<tr>${pl(x)}<td>${x.ret.kr}</td><td>${x.ret.kry}</td><td>${x.ret.pr}</td><td>${x.ret.pry}</td><td>${x.ret.td}</td></tr>`));
    return `<section class="card boxteam" style="--c1:${T.c1}"><h3>${teamChip(T)} ${esc(T.name)}</h3>${body || `<p class="muted">No stats yet. Log plays from the Live tab.</p>`}</section>`;
  };
  el.innerHTML = `
  <section class="card">
    <h2>Box score</h2>
    <table class="linescore"><tr><th></th>${qs.map(q => `<th>${q === "OT" ? "OT" : "Q" + q}</th>`).join("")}<th>T</th></tr>
      ${[["away", A], ["home", H]].map(([sd, T]) => `<tr><td class="pn">${esc(T.abbr)}</td>${qs.map(q => `<td>${line[sd][q] || 0}</td>`).join("")}<td><b>${g.s[sd].score}</b></td></tr>`).join("")}</table>
    <p class="muted">Quarter scores come from logged plays and the + buttons.</p>
    <div class="row"><button data-act="shareStats">Share stats (spreadsheet)</button><button data-act="copySummary">Copy summary</button></div>
  </section>
  <section class="card">
    <h2>Team stats</h2>
    <table class="teamstats"><tr><th></th><th>${esc(A.abbr)}</th><th>${esc(H.abbr)}</th></tr>
      ${teamRows.map(([l, f]) => `<tr><td class="pn">${l}</td><td>${f(TM.away)}</td><td>${f(TM.home)}</td></tr>`).join("")}</table>
  </section>
  ${sideHTML("away", A)}${sideHTML("home", H)}
  <section class="card"><h2>Play by play</h2>
    <ol class="pbp">${[...g.plays].reverse().map(p => `<li><small>${p.qtr === "HALF" || p.qtr === "FINAL" ? p.qtr : "Q" + p.qtr} ${p.clock}</small> <b>${esc(sideTeam(g, p.type === "defense" || p.type === "penalty" ? p.team : p.team).abbr)}</b> ${esc(p.desc)}</li>`).join("") || `<p class="muted">No plays logged yet.</p>`}</ol>
  </section>`;
}
function statsCSV(g) {
  const { P } = computeStats(g), rows = [["Team", "Number", "Name", "Pass C", "Pass Att", "Pass Yds", "Pass TD", "INT thrown", "Rush", "Rush Yds", "Rush TD", "Rec", "Rec Yds", "Rec TD", "Tackles", "Sacks", "Def INT", "Forced fumbles", "FG", "FG Att", "XP", "XP Att", "Punts", "Punt Yds", "KR", "KR Yds", "PR", "PR Yds", "Return TD"]];
  for (const side of ["away", "home"]) {
    const T = sideTeam(g, side);
    for (const x of Object.values(P[side]).sort((a, b) => a.num - b.num))
      rows.push([T.name, x.num, x.name, x.pass.c, x.pass.a, x.pass.y, x.pass.td, x.pass.i, x.rush.n, x.rush.y, x.rush.td, x.rec.n, x.rec.y, x.rec.td, x.def.t, x.def.s, x.def.i, x.def.ff, x.kick.fm, x.kick.fa, x.kick.pm, x.kick.pa, x.punt.n, x.punt.y, x.ret.kr, x.ret.kry, x.ret.pr, x.ret.pry, x.ret.td]);
  }
  return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
}
async function shareFile(file, fallbackName) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = fallbackName || file.name; a.click();
}

// ---------------- setup tab ----------------
function setupTab(g, el) {
  el.innerHTML = `
  <section class="card"><h2>Score bug look</h2><div class="styles">${STYLES.map(st => `
    <button class="stylecard ${g.style === st.id ? "on" : ""}" data-act="gStyle" data-v="${st.id}"><canvas width="1280" height="${st.id === "corner" ? 360 : 250}" data-prev="${st.id}"></canvas><b>${st.name}</b><small>${st.note}</small></button>`).join("")}</div></section>
  <section class="card">
    <h2>Bug options</h2>
    <div class="lbl">Size</div><div class="seg">${[[.85, "Small"], [1, "Medium"], [1.15, "Large"]].map(([v, l]) => `<button class="${(g.bugSize || 1) === v ? "on" : ""}" data-act="gSize" data-v="${v}">${l}</button>`).join("")}</div>
    <div class="lbl">Where on the video</div><div class="seg">${[["bottom", "Bottom"], ["top", "Top"]].map(([v, l]) => `<button class="${(g.bugPos || "bottom") === v ? "on" : ""}" data-act="gPos" data-v="${v}">${l}</button>`).join("")}</div>
    <p class="muted">Corner always sits in the top left.</p>
    <div class="lbl">Ball spot on the bug</div><div class="seg"><button class="${g.spotShow !== false ? "on" : ""}" data-act="spotShow" data-v="1">Show</button><button class="${g.spotShow === false ? "on" : ""}" data-act="spotShow" data-v="0">Hide</button></div>
  </section>
  <section class="card">
    <label class="lbl">Game name</label><input data-input="gTitle" value="${esc(g.title || "")}" placeholder="Week 3">
    <label class="lbl">Minutes per quarter</label><input data-input="gQ" type="number" inputmode="numeric" value="${g.qLen}">
    <div class="row" style="margin-top:12px"><a class="btn" href="#/team/${g.awayId}">Edit ${esc(sideTeam(g, "away").abbr)}</a><a class="btn" href="#/team/${g.homeId}">Edit ${esc(sideTeam(g, "home").abbr)}</a></div>
  </section>
  <section class="card">
    <div class="row"><button data-act="rematch">New game, same teams</button><button class="danger" data-act="deleteGame">Delete game</button></div>
  </section>`;
  document.querySelectorAll("canvas[data-prev]").forEach(c => {
    const ctx = c.getContext("2d");
    const draw = () => { ctx.clearRect(0, 0, c.width, c.height); drawBackdrop(ctx, c.width, c.height); const S = bugState(g, 0, c.dataset.prev); S.banner = null; drawBug(ctx, c.width, c.height, S, 0, { frac: .93 }); };
    draw(); setTimeout(draw, 400);
  });
}

function setQtr(g, q, quiet) {
  const s = g.s; freezeClock(s); s.qtr = q;
  if (!["HALF", "FINAL"].includes(q)) s.clock = (q === "OT" ? Math.min(10, g.qLen) : g.qLen) * 60;
  if (q === "3" && !quiet) { s.away.to = 3; s.home.to = 3; }
  if (q === "OT" && !quiet) { s.away.to = Math.max(s.away.to, 2); s.home.to = Math.max(s.home.to, 2); }
  const AB = sideTeam(g, "away").abbr, HB = sideTeam(g, "home").abbr;
  if (!quiet) {
    if (q === "HALF") banner(g, "to", "Halftime", `${AB} ${s.away.score}  ${HB} ${s.home.score}`, null, 5);
    else if (q === "FINAL") { const w = s.away.score === s.home.score ? null : s.away.score > s.home.score ? "away" : "home"; banner(g, "fg", "Final", w ? sideTeam(g, w).name + " win" : "Tie game", w, 6); }
    else banner(g, "to", Q_LONG[q], `${AB} ${s.away.score}  ${HB} ${s.home.score}`, null, 3.5);
  }
  persist(); refreshLive(g); toast(Q_LONG[q]);
}
// small in-page question box (prompt() would freeze the recording)
function ask(title, fields, cb) {
  const d = document.createElement("div"); d.className = "savedlg";
  d.innerHTML = `<form class="savedlg-in"><h3>${esc(title)}</h3>${fields.map(f => `<label class="lbl">${esc(f.label)}</label><input name="${f.k}" value="${esc(f.value ?? "")}" ${f.mode ? `inputmode="${f.mode}"` : ""} autocomplete="off">`).join("")}
    <div class="row"><button type="button" class="ghost" data-act="askCancel">Cancel</button><button type="submit" class="primary">OK</button></div></form>`;
  document.body.appendChild(d);
  const form = d.querySelector("form");
  form.onsubmit = e => { e.preventDefault(); const out = {}; fields.forEach(f => out[f.k] = form.elements[f.k].value.trim()); d.remove(); cb(out); };
  setTimeout(() => { const i = form.elements[fields[0].k]; i.focus(); i.select?.(); }, 50);
}

// ---------------- actions ----------------
const ACT = {
  backHome: () => { TE = null; go("#/"); },
  newTeam: () => { TE = null; go("#/team/" + uid()); },
  newGame: () => { window.NG = null; go("#/new"); },
  slot: el => { TE.slot = el.dataset.v; route(); },
  swatch: el => { TE[TE.slot] = el.dataset.v; if (TE.slot === "c1") TE.slot = "c2"; route(); },
  removeLogo: () => { TE.logo = ""; TE.swatches = []; route(); },
  addPlayer: () => {
    const num = document.getElementById("pNum").value.trim(), name = document.getElementById("pName").value.trim(), pos = document.getElementById("pPos").value.trim().toUpperCase();
    if (!num) return toast("Add a jersey number");
    TE.roster.push({ id: uid(), num: +num || num, name, pos }); route();
    setTimeout(() => document.getElementById("pNum")?.focus(), 50);
  },
  delPlayer: el => { TE.roster = TE.roster.filter(p => p.id !== el.dataset.v); route(); },
  saveTeam: () => {
    if (!TE.name.trim()) return toast("Give the team a name");
    TE.abbr = (TE.abbr || TE.name.slice(0, 3)).toUpperCase();
    const { slot, swatches, ...clean } = TE; clean.swatches = swatches;
    const i = DB.teams.findIndex(t => t.id === TE.id); if (i >= 0) DB.teams[i] = clean; else DB.teams.push(clean);
    persist(); TE = null; toast("Team saved"); history.length > 1 ? history.back() : go("#/");
  },
  deleteTeam: () => {
    if (DB.games.some(g => g.awayId === TE.id || g.homeId === TE.id)) return toast("This team is in a saved game. Delete those games first.");
    if (!confirm("Delete this team?")) return;
    DB.teams = DB.teams.filter(t => t.id !== TE.id); persist(); TE = null; go("#/");
  },
  ngStyle: el => { window.NG.style = el.dataset.v; route(); },
  createGame: () => {
    const NG = window.NG; if (NG.awayId === NG.homeId) return toast("Pick two different teams");
    const g = { id: uid(), created: Date.now(), updated: Date.now(), awayId: NG.awayId, homeId: NG.homeId, title: NG.title, style: NG.style, spotShow: true, qLen: +NG.qLen || 12, s: newGameState(+NG.qLen || 12), plays: [], undo: [] };
    DB.games.push(g); persist(); window.NG = null; go(`#/game/${g.id}/live`);
  },
  pts: (el, g) => {
    snapshot(g); const side = el.dataset.side, v = +el.dataset.v;
    g.s[side].score = Math.max(0, g.s[side].score + v);
    if (v > 0) { RT.pulse[g.id + side] = performance.now(); g.plays.push({ id: uid(), type: "adj", team: side, qtr: g.s.qtr, clock: fmtClock(curClock(g.s)), pts: v, ptsSide: side, desc: `${sideTeam(g, side).abbr} +${v} (score button)` }); }
    else { const i = g.plays.map(p => p.type === "adj" && p.ptsSide === side).lastIndexOf(true); if (i >= 0) g.plays.splice(i, 1); }
    if (v === 6) { banner(g, "td", "Touchdown", "", side); g.s.ddShow = false; }
    if (v === 3) { banner(g, "fg", "Field Goal", "", side); g.s.ball = side; turnover(g.s, other(side)); kickoffSpot(g.s); g.s.ddShow = true; }
    if (v === 1) { g.s.ball = side; turnover(g.s, other(side)); kickoffSpot(g.s); g.s.ddShow = true; }
    persist(); refreshLive(g);
  },
  ball: (el, g) => { snapshot(g); turnover(g.s, el.dataset.side); g.s.ddShow = true; persist(); refreshLive(g); },
  timeout: (el, g) => {
    const side = el.dataset.side; if (g.s[side].to <= 0) return toast("No timeouts left");
    snapshot(g); g.s[side].to--; freezeClock(g.s); banner(g, "to", "Timeout", sideTeam(g, side).name, side, 3.5); persist(); refreshLive(g);
  },
  clock: (el, g) => {
    const s = g.s;
    if (s.running) freezeClock(s); else { if (curClock(s) === 0) return toast("Clock is at 0:00. Pick the next quarter."); s.running = true; s.startClock = s.clock; s.startedAt = Date.now(); }
    persist(); refreshLive(g);
  },
  clockAdj: (el, g) => { setClock(g.s, curClock(g.s) + (+el.dataset.v)); persist(); refreshLive(g); },
  setClock: (el, g) => {
    const c = curClock(g.s);
    ask("Set the clock", [{ k: "m", label: "Minutes", value: Math.floor(c / 60), mode: "numeric" }, { k: "sec", label: "Seconds", value: c % 60, mode: "numeric" }], r => {
      setClock(g.s, (parseInt(r.m, 10) || 0) * 60 + Math.min(59, parseInt(r.sec, 10) || 0)); persist(); refreshLive(g);
    });
  },
  qtr: (el, g) => setQtr(g, el.dataset.v),
  qNext: (el, g) => { const q = nextQ(g); if (q) setQtr(g, q); },
  qPrev: (el, g) => { const q = prevQ(g); if (q) setQtr(g, q, true); },
  spot: (el, g) => { const s = g.s; s.pos = clampPos((s.pos || 25) + (+el.dataset.v)); if (s.toGo === "Goal" && s.pos <= 90) s.toGo = Math.min(10, 100 - s.pos); fixGoal(s); s.ddShow = true; persist(); refreshLive(g); },
  spotShow: (el, g) => { g.spotShow = el.dataset.v ? el.dataset.v === "1" : g.spotShow === false; persist(); if (location.hash.endsWith("/setup")) route(); else refreshLive(g); },
  gSize: (el, g) => { g.bugSize = +el.dataset.v; persist(); if (location.hash.endsWith("/setup")) route(); else refreshLive(g); },
  gPos: (el, g) => { g.bugPos = el.dataset.v; persist(); if (location.hash.endsWith("/setup")) route(); else refreshLive(g); },
  gStyleRec: (el, g) => { g.style = el.dataset.v; persist(); refreshLive(g); },
  recPage: (el, g) => { REC.page = el.dataset.v; refreshLive(g); },
  recHide: (el, g) => { REC.hide = !REC.hide; refreshLive(g); },
  askCancel: el => el.closest(".savedlg").remove(),
  down: (el, g) => { g.s.down = +el.dataset.v; g.s.ddShow = true; persist(); refreshLive(g); },
  nextDown: (el, g) => { const s = g.s; s.down = s.down >= 4 ? 1 : s.down + 1; s.ddShow = true; persist(); refreshLive(g); },
  first: (el, g) => { g.s.down = 1; g.s.toGo = 10; g.s.ddShow = true; persist(); refreshLive(g); },
  toGo: (el, g) => { const s = g.s; s.toGo = Math.max(1, (s.toGo === "Goal" ? 10 : s.toGo) + (+el.dataset.v)); s.ddShow = true; persist(); refreshLive(g); },
  toGoSet: (el, g) => { g.s.toGo = el.dataset.v === "Goal" ? "Goal" : +el.dataset.v; g.s.ddShow = true; persist(); refreshLive(g); },
  ddShow: (el, g) => { g.s.ddShow = !g.s.ddShow; persist(); refreshLive(g); },
  pop: (el, g) => {
    const v = el.dataset.v, b = g.s.ball, d = other(b), T = side => sideTeam(g, side).abbr;
    if (v === "td") banner(g, "td", "Touchdown", "", b);
    else if (v === "flag") banner(g, "flag", "Flag", "On the play", null, 3.5);
    else if (v === "first") banner(g, "to", "First Down", T(b), b, 3);
    else if (v === "turnover") banner(g, "to", "Turnover", T(b) + " ball", b, 3.5);
    else if (v === "sack") banner(g, "to", "Sack", T(d) + " defense", d, 3);
    else if (v === "stop") banner(g, "to", "4th Down Stop", T(d) + " ball", d, 3.5);
    else if (v === "bigplay") banner(g, "td", "Big Play", T(b), b, 3);
    else if (v === "twomin") banner(g, "to", "Two-Minute Warning", "", null, 4);
    else if (v === "injury") banner(g, "to", "Injury Timeout", "", null, 4);
    else ask("Pop-up text", [{ k: "t", label: "Big text (like GOAL LINE STAND)" }, { k: "sub", label: "Small text (optional)" }], r => { if (r.t) banner(g, "to", r.t, r.sub, null, 4); });
  },
  undo: (el, g) => { undoPlay(g); refreshLive(g); },
  play: (el, g) => openPlay(g, el.dataset.v),
  closeSheet: (el, g) => { PS = null; renderSheet(g); },
  ps: (el, g) => {
    let v = el.dataset.v; if (v === "true") v = true; else if (v === "false") v = false;
    if (el.dataset.k === "team" && v !== PS.team) { ["passer", "target", "tackler", "defender", "runner", "kicker", "player", "returner"].forEach(k => delete PS[k]); }
    if (PS.type === "kickoff" && el.dataset.k === "result") PS.yards = v === "onside" ? "45" : "5";
    if (el.dataset.k === "note" && PS.note === v) v = "";
    PS[el.dataset.k] = v; renderSheet(g);
  },
  pk: (el, g) => {
    const k = el.dataset.k; if (!el.dataset.v) { delete PS[k]; return renderSheet(g); }
    const T = team(sideTeam(g, el.dataset.side).id); const p = T.roster.find(r => r.id === el.dataset.v);
    PS[k] = { id: p.id, num: p.num, name: p.name }; renderSheet(g);
  },
  pkAdd: (el, g) => {
    const T = team(sideTeam(g, el.dataset.side).id); if (!T) return; const k = el.dataset.k;
    ask(`New ${T.abbr} player`, [{ k: "num", label: "Jersey number", mode: "numeric" }, { k: "name", label: "Name (optional)" }], r => {
      if (!r.num) return toast("Add a jersey number");
      const p = { id: uid(), num: +r.num || r.num, name: r.name, pos: "" }; T.roster.push(p); persist();
      if (PS) { PS[k] = { id: p.id, num: p.num, name: p.name }; renderSheet(g); }
    });
  },
  yd: el => { const k = el.dataset.k || "yards", i = document.getElementById("num_" + k); PS[k] = String((parseInt(i.value, 10) || 0) + (+el.dataset.v)); i.value = PS[k]; },
  savePlay: (el, g) => savePlay(g),
  openCam: (el, g) => openCam(g),
  closeCam: () => closeCam(),
  flipCam: async () => { if (REC.rec && REC.rec.state === "recording") return toast("Stop recording to flip the camera"); REC.facing = REC.facing === "environment" ? "user" : "environment"; await startCamera(); },
  recToggle: (el, g) => recToggle(g),
  shareClip: el => { const d = el.closest(".savedlg"); shareFile(d._file); },
  closeDlg: el => el.closest(".savedlg").remove(),
  shareStats: (el, g) => { const A = sideTeam(g, "away"), H = sideTeam(g, "home"); shareFile(new File([statsCSV(g)], `Scoreboard-stats-${A.abbr}-vs-${H.abbr}.csv`, { type: "text/csv" })); },
  copySummary: (el, g) => {
    const { P } = computeStats(g), A = sideTeam(g, "away"), H = sideTeam(g, "home");
    let t = `${A.name} ${g.s.away.score}, ${H.name} ${g.s.home.score}${g.title ? " (" + g.title + ")" : ""}\n`;
    for (const [sd, T] of [["away", A], ["home", H]]) {
      t += `\n${T.name}\n`;
      for (const x of Object.values(P[sd])) {
        const bits = [];
        if (x.pass.a) bits.push(`${x.pass.c}/${x.pass.a} ${x.pass.y} pass yds, ${x.pass.td} TD, ${x.pass.i} INT`);
        if (x.rush.n) bits.push(`${x.rush.n} car ${x.rush.y} yds${x.rush.td ? ", " + x.rush.td + " TD" : ""}`);
        if (x.rec.n) bits.push(`${x.rec.n} rec ${x.rec.y} yds${x.rec.td ? ", " + x.rec.td + " TD" : ""}`);
        if (x.def.t || x.def.s || x.def.i) bits.push(`${x.def.t} tkl${x.def.s ? ", " + x.def.s + " sack" : ""}${x.def.i ? ", " + x.def.i + " INT" : ""}`);
        if (bits.length) t += `#${x.num} ${x.name}: ${bits.join("; ")}\n`;
      }
    }
    navigator.clipboard?.writeText(t).then(() => toast("Copied"), () => toast("Couldn't copy"));
  },
  gStyle: (el, g) => { g.style = el.dataset.v; persist(); route(); },
  rematch: (el, g) => {
    const n = { id: uid(), created: Date.now(), updated: Date.now(), awayId: g.awayId, homeId: g.homeId, title: "", style: g.style, bugSize: g.bugSize, bugPos: g.bugPos, spotShow: g.spotShow, qLen: g.qLen, s: newGameState(g.qLen), plays: [], undo: [] };
    DB.games.push(n); persist(); go(`#/game/${n.id}/live`);
  },
  deleteGame: (el, g) => { if (!confirm("Delete this game and its stats?")) return; DB.games = DB.games.filter(x => x.id !== g.id); persist(); go("#/"); },
  exportAll: () => shareFile(new File([JSON.stringify(DB)], `Scoreboard-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" })),
};
const INPUT = {
  tName: v => { TE.name = v; drawTeamPreview(); },
  tAbbr: v => { TE.abbr = v.toUpperCase(); drawTeamPreview(); },
  tColor: (v) => { TE[TE.slot] = v; document.querySelectorAll(".slot.on i").forEach(i => i.style.background = v); drawTeamPreview(); },
  ngAway: v => { window.NG.awayId = v; route(); }, ngHome: v => { window.NG.homeId = v; route(); },
  ngTitle: v => window.NG.title = v, ngQ: v => window.NG.qLen = +v || 12,
  num: (v, g, el) => { PS[el.dataset.k] = v; },
  gTitle: (v, g) => { g.title = v; persist(); },
  gQ: (v, g) => { g.qLen = +v || 12; persist(); },
};
const CHANGE = {
  logoFile: async el => {
    const f = el.files[0]; if (!f) return;
    try {
      TE.logo = await shrinkImage(f);
      const i = new Image(); i.onload = () => { TE.swatches = logoColors(i); TE.c1 = TE.swatches[0]; TE.c2 = TE.swatches[1] || "#ffffff"; TE.slot = "c1"; route(); }; i.src = TE.logo;
    } catch (e) { toast("Couldn't read that picture"); }
  },
  importAll: async el => {
    const f = el.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!d.teams || !d.games) throw 0;
      if (!confirm(`Load this backup? It has ${d.teams.length} teams and ${d.games.length} games, and it replaces what's on this phone now.`)) return;
      DB = d; persist(); route(); toast("Backup loaded"); } catch (e) { toast("That file isn't a scoreboard backup"); }
  },
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(el, currentGame());
});
document.addEventListener("input", e => { const k = e.target.dataset.input; if (k && INPUT[k] && e.target.tagName !== "SELECT") INPUT[k](e.target.value, currentGame(), e.target); });
document.addEventListener("change", e => {
  const k = e.target.dataset.change; if (k && CHANGE[k]) CHANGE[k](e.target);
  const i = e.target.dataset.input; if (i && e.target.tagName === "SELECT" && INPUT[i]) INPUT[i](e.target.value, currentGame());
});

document.fonts.ready.then(() => Promise.all(["800 40px Barlow", "700 40px Barlow", "600 40px Barlow", "700 40px SairaC", "800 40px SairaC", "600 40px SairaC", "600 40px Teko", "500 40px Teko"].map(f => document.fonts.load(f)))).finally(route);

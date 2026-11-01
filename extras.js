// Extras: drive tracker, win chance, player pop-ups, player of the game, share cards.

// ---------- time + drive ----------
function gameSec(g) {
  const s = g.s, L = g.qLen * 60;
  if (s.qtr === "HALF") return 2 * L;
  if (s.qtr === "FINAL") return 4 * L;
  if (s.qtr === "OT") return 4 * L + (Math.min(10, g.qLen) * 60 - curClock(s));
  const qi = { 1: 0, 2: 1, 3: 2, 4: 3 }[s.qtr] ?? 0;
  return qi * L + (L - curClock(s));
}
function newDrive(g) { const s = g.s; s.drv = { side: s.ball, start: s.pos || 25, plays: 0, t0: gameSec(g) }; }
function updateDrive(g, p, preBall) {
  const s = g.s;
  const kickish = ["kickoff", "punt", "kick", "two"].includes(p.type) || (p.type === "defense" && p.kind === "safety");
  if (kickish || s.ball !== preBall) return newDrive(g);
  if (!s.drv || s.drv.side !== s.ball) s.drv = { side: s.ball, start: p.pre ? p.pre.pos : s.pos, plays: 0, t0: gameSec(g) };
  if (p.type === "pass" || p.type === "run" || (p.type === "defense" && p.kind === "sack")) s.drv.plays++;
}
function driveText(g) {
  const s = g.s, d = s.drv;
  if (!d || d.side !== s.ball || !d.plays) return null;
  const yds = (s.pos || 25) - d.start, t = Math.max(0, gameSec(g) - d.t0);
  return `${d.plays} PLAY${d.plays === 1 ? "" : "S"}  ·  ${yds} YDS  ·  ${fmtClock(Math.round(t))}`;
}

// ---------- win chance ----------
// Simple model: score gap + value of having the ball at this spot, shrinking uncertainty as time runs out.
function winProb(g) {
  const s = g.s, L = g.qLen * 60, total = 4 * L;
  let diff = s.home.score - s.away.score;
  if (s.qtr === "FINAL") { const h = diff > 0 ? 100 : diff < 0 ? 0 : 50; return { home: h, away: 100 - h }; }
  const left = s.qtr === "OT" ? Math.max(30, curClock(s)) : Math.max(0, total - gameSec(g));
  if (s.ddShow && s.qtr !== "HALF") { const ep = -0.7 + (s.pos || 25) * 0.07; diff += s.ball === "home" ? ep : -ep; }
  const sd = 13 * Math.sqrt(left / total) + 0.8;
  const home = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-1.65 * diff / sd)))));
  return { home, away: 100 - home };
}

// ---------- after every logged play ----------
function afterPlay(g, p, preBall) {
  updateDrive(g, p, preBall);
  p.wp = winProb(g).home;
  playerPop(g, p);
}
function gameLine(g, side, who) {
  const x = computeStats(g).P[side][who.id || "#" + who.num]; if (!x) return "";
  const b = [];
  if (x.pass.a) b.push(`${x.pass.c}/${x.pass.a}, ${x.pass.y} pass yds${x.pass.td ? ", " + x.pass.td + " TD" : ""}`);
  if (x.rush.n) b.push(`${x.rush.n} car, ${x.rush.y} yds${x.rush.td ? ", " + x.rush.td + " TD" : ""}`);
  if (x.rec.n) b.push(`${x.rec.n} rec, ${x.rec.y} yds${x.rec.td ? ", " + x.rec.td + " TD" : ""}`);
  if (x.def.t || x.def.s || x.def.i) b.push([x.def.t && `${x.def.t} tkl`, x.def.s && `${x.def.s} sack${x.def.s > 1 ? "s" : ""}`, x.def.i && `${x.def.i} INT`].filter(Boolean).join(", "));
  if (x.kick.fa) b.push(`${x.kick.fm}/${x.kick.fa} FG`);
  return b.length ? "Today: " + b.slice(0, 2).join("  ·  ") : "";
}
function playerPop(g, p) {
  const mode = g.popMode || "all"; if (mode === "off") return;
  const y = +p.yards || 0, ret = +p.ret || 0;
  let who = null, side = p.team, line = "", big = false;
  if (p.type === "pass") {
    if (p.result === "comp" && p.target) { who = p.target; line = `${y} yd ${p.td ? "touchdown " : ""}catch${p.passer ? ", from " + pShort(p.passer) : ""}`; big = p.td || y >= 15 || p.fumble; }
    else if (p.result === "int" && p.defender) { who = p.defender; side = other(p.team); line = p.td ? "Pick six" : "Interception" + (ret ? `, ${ret} yd return` : ""); big = true; }
  } else if (p.type === "run" && p.runner) { who = p.runner; line = y < 0 ? `Loss of ${-y}` : `${y} yd ${p.td ? "touchdown " : ""}run`; big = p.td || y >= 10 || p.fumble; }
  else if (p.type === "kick" && p.kind === "fg" && p.kicker && p.good) { who = p.kicker; line = `${y} yd field goal`; big = true; }
  else if ((p.type === "punt" || p.type === "kickoff") && p.result === "ret" && p.returner) { who = p.returner; side = other(p.team); line = `${ret} yd ${p.type === "punt" ? "punt" : "kick"} return${p.td ? ", touchdown" : ""}`; big = p.td || ret >= 20; }
  else if (p.type === "defense" && p.defender) { who = p.defender; line = { sack: `Sack, ${Math.abs(y)} yd loss`, tackle: "Tackle", ff: "Forced fumble", safety: "Safety" }[p.kind]; big = p.kind !== "tackle"; }
  if (!who || (mode === "big" && !big)) return;
  banner(g, "player", who.name || `#${who.num}`, line, side, 4.5, { num: "#" + who.num, sub2: gameLine(g, side, who) });
}

// ---------- player of the game ----------
function statLines(x) {
  const L = [];
  if (x.pass.a) L.push(`${x.pass.c}/${x.pass.a}  ${x.pass.y} pass yds  ${x.pass.td} TD${x.pass.i ? "  " + x.pass.i + " INT" : ""}`);
  if (x.rush.n) L.push(`${x.rush.n} carries  ${x.rush.y} yds${x.rush.td ? "  " + x.rush.td + " TD" : ""}`);
  if (x.rec.n) L.push(`${x.rec.n} catches  ${x.rec.y} yds${x.rec.td ? "  " + x.rec.td + " TD" : ""}`);
  if (x.def.t || x.def.s || x.def.i || x.def.ff) L.push([x.def.t && `${x.def.t} tackles`, x.def.s && `${x.def.s} sacks`, x.def.i && `${x.def.i} INT`, x.def.ff && `${x.def.ff} FF`].filter(Boolean).join("  "));
  if (x.kick.fa || x.kick.pa) L.push(`${x.kick.fm}/${x.kick.fa} FG  ${x.kick.pm}/${x.kick.pa} XP`);
  if (x.ret.kr || x.ret.pr) L.push(`${x.ret.kr + x.ret.pr} returns  ${x.ret.kry + x.ret.pry} yds${x.ret.td ? "  " + x.ret.td + " TD" : ""}`);
  return L;
}
function potg(g) {
  const { P } = computeStats(g), s = g.s, win = s.away.score > s.home.score ? "away" : s.home.score > s.away.score ? "home" : null;
  let best = null;
  for (const side of ["away", "home"]) for (const x of Object.values(P[side])) {
    let sc = x.pass.y * .04 + x.pass.td * 4 - x.pass.i * 2 + x.rush.y * .1 + x.rush.td * 6 + x.rec.y * .1 + x.rec.td * 6 + x.rec.n * .5
      + x.def.t + x.def.s * 3 + x.def.i * 5 + x.def.ff * 3 + x.kick.fm * 3 + x.kick.pm * .5 + (x.ret.kry + x.ret.pry) * .04 + x.ret.td * 6;
    if (side === win) sc += 2;
    if (!best || sc > best.sc) best = { x, side, sc };
  }
  return best && best.sc > 0 ? best : null;
}

// ---------- pop-up extras ----------
function popExtra(g, v) {
  const A = sideTeam(g, "away"), H = sideTeam(g, "home");
  if (v === "intro") {
    const se = season(g.seasonId);
    banner(g, "intro", g.title || (se ? se.name : "Today's game"), [se && g.title ? se.name : "", new Date(g.created).toLocaleDateString(undefined, { month: "long", day: "numeric" })].filter(Boolean).join("  ·  "),
      null, 6.5, { now: true, recs: { away: teamRecord(g, "away"), home: teamRecord(g, "home") } });
    return true;
  }
  if (v === "stats") {
    const t = computeStats(g).team, f = x => x.pass - x.sackY + x.rush, pc = (c, a) => `${c}-${a}`;
    banner(g, "stats", (Q_LONG[g.s.qtr] || "") + " team stats", "", null, 8, { now: true, rows: [
      ["Total yards", f(t.away), f(t.home)], ["Passing", t.away.pass - t.away.sackY, t.home.pass - t.home.sackY], ["Rushing", t.away.rush, t.home.rush],
      ["First downs", t.away.fd, t.home.fd], ["3rd down", pc(t.away.d3c, t.away.d3a), pc(t.home.d3c, t.home.d3a)], ["Turnovers", t.away.to, t.home.to]] });
    return true;
  }
  if (v === "potg") {
    const b = potg(g); if (!b) { toast("Log some plays first"); return true; }
    banner(g, "player", b.x.name || "#" + b.x.num, "Player of the game", b.side, 7, { now: true, num: "#" + b.x.num, sub2: statLines(b.x).slice(0, 2).join("  ·  ") });
    return true;
  }
  return false;
}

// ---------- settings UI ----------
const onOff = (k, g, on, off) => `<div class="seg"><button class="${g[k] !== false ? "on" : ""}" data-act="gTog" data-k="${k}" data-v="1">${on || "On"}</button><button class="${g[k] === false ? "on" : ""}" data-act="gTog" data-k="${k}" data-v="0">${off || "Off"}</button></div>`;
function setupExtrasHTML(g) {
  const pm = g.popMode || "all";
  return `<section class="card"><h2>Extras on the video</h2>
    <div class="lbl">Drive tracker <i>(plays, yards and time on this drive)</i></div>${onOff("driveShow", g)}
    <div class="lbl">Win chance bar</div>${onOff("wpShow", g)}
    <div class="lbl">Player pop-ups after each play</div><div class="seg">${[["all", "Every play"], ["big", "Big plays"], ["off", "Off"]].map(([v, l]) => `<button class="${pm === v ? "on" : ""}" data-act="popMode" data-v="${v}">${l}</button>`).join("")}</div>
    <div class="lbl">Sound effects <i>(horn on touchdowns, whistle on flags, crowd...)</i></div>${onOff("sfx", g)}
    <div class="lbl">Hear sounds out loud while filming <i>(this phone only)</i></div><div class="seg"><button class="${SFX.S.hear ? "on" : ""}" data-act="hear" data-v="1">Yes</button><button class="${!SFX.S.hear ? "on" : ""}" data-act="hear" data-v="0">No, only in the video</button></div>
    <div class="lbl">Highlight button <i>(keeps the last 24 seconds ready to save)</i></div>${onOff("hlOn", g)}
  </section>`;
}
function lookExtrasHTML(g) {
  const pm = g.popMode || "all";
  return `<button class="${g.driveShow !== false ? "on" : ""}" data-act="gTog" data-k="driveShow">Drive</button>
    <button class="${g.wpShow !== false ? "on" : ""}" data-act="gTog" data-k="wpShow">Win %</button>
    <button class="${pm !== "off" ? "on" : ""}" data-act="popMode" data-v="${pm === "all" ? "big" : pm === "big" ? "off" : "all"}">Player pops: ${{ all: "all", big: "big", off: "off" }[pm]}</button>
    <button class="${g.sfx !== false ? "on" : ""}" data-act="gTog" data-k="sfx">Sounds</button>
    <button class="${SFX.S.hear ? "on" : ""}" data-act="hear" data-v="${SFX.S.hear ? "0" : "1"}">Hear sounds</button>
    <button class="${g.hlOn !== false ? "on" : ""}" data-act="gTog" data-k="hlOn">Highlights</button>`;
}

// ---------- stats tab extras ----------
function wpChart(g) {
  const pts = [50, ...g.plays.filter(p => p.wp != null).map(p => p.wp)];
  if (pts.length < 3) return "";
  const A = sideTeam(g, "away"), H = sideTeam(g, "home"), W = 600, Hh = 160, n = pts.length - 1;
  const xy = pts.map((v, i) => [Math.round(i / n * W), Math.round(Hh - v / 100 * Hh)]);
  const line = xy.map(([x, y]) => `${x},${y}`).join(" ");
  const ca = ink(A.c1) === "#111" ? A.c2 : A.c1, ch = H.c1;
  return `<section class="card"><h2>Win chance <small>how the game swung, play by play</small></h2>
    <div class="wpc"><span style="color:${esc(ch)}">${esc(H.abbr)}</span><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">
      <defs><linearGradient id="wpg" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="${esc(ch)}" stop-opacity=".55"/><stop offset=".5" stop-color="${esc(ca)}" stop-opacity=".55"/></linearGradient></defs>
      <polygon points="0,${Hh / 2} ${line} ${W},${Hh / 2}" fill="url(#wpg)"/>
      <line x1="0" y1="${Hh / 2}" x2="${W}" y2="${Hh / 2}" stroke="rgba(255,255,255,.25)" stroke-dasharray="6 6"/>
      <polyline points="${line}" fill="none" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/></svg><span style="color:${esc(ca)}">${esc(A.abbr)}</span></div>
    <p class="muted">Right now: ${esc(A.abbr)} ${winProb(g).away}%, ${esc(H.abbr)} ${winProb(g).home}%</p></section>`;
}
function statsExtrasHTML(g) {
  const b = potg(g), T = b && sideTeam(g, b.side);
  return `<section class="card"><h2>Player of the game</h2>
    ${b ? `<div class="potg" style="--c1:${T.c1};--c2:${T.c2}"><b>#${esc(b.x.num)}</b><div><span>${esc(b.x.name || "#" + b.x.num)}</span><small>${esc(T.name)}</small>${statLines(b.x).map(l => `<i>${esc(l)}</i>`).join("")}</div></div>` : `<p class="muted">Log some plays and the best player shows up here.</p>`}
    <div class="row">${b ? `<button data-act="potgCard">Share player card</button>` : ""}<button data-act="recapCard">Share final score card</button></div>
  </section>${wpChart(g)}`;
}

// ---------- share cards (1080x1350 pictures) ----------
function loadImg(src) { return new Promise(ok => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
function cardBase(c1, c2) {
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350; const x = c.getContext("2d");
  const gr = x.createLinearGradient(0, 0, 0, 1350); gr.addColorStop(0, ScoreBug.shade(c1, .05)); gr.addColorStop(1, ScoreBug.shade(c1, -.7)); x.fillStyle = gr; x.fillRect(0, 0, 1080, 1350);
  x.save(); x.globalAlpha = .12; x.fillStyle = c2; for (let i = -4; i < 12; i++) { x.beginPath(); x.moveTo(i * 160, 0); x.lineTo(i * 160 + 60, 0); x.lineTo(i * 160 - 340, 1350); x.lineTo(i * 160 - 400, 1350); x.fill(); } x.restore();
  return [c, x];
}
const T_ = (x, s, X, Y, font, col, al = "left") => { x.font = font; x.fillStyle = col; x.textAlign = al; x.textBaseline = "middle"; x.fillText(s, X, Y); };
async function potgCard(g) {
  const b = potg(g); if (!b) return toast("No player of the game yet");
  const T = sideTeam(g, b.side), O = sideTeam(g, other(b.side)), [c, x] = cardBase(T.c1, T.c2), tc = ink(T.c1);
  const [lg, lo] = await Promise.all([loadImg(T.logo), loadImg(O.logo)]);
  if (lg) { x.save(); x.globalAlpha = .14; const k = 760 / Math.max(lg.width, lg.height); x.drawImage(lg, 1080 - lg.width * k * .8, 1350 - lg.height * k - 200, lg.width * k, lg.height * k); x.restore(); }
  x.fillStyle = "#ffcf3f"; x.fillRect(80, 92, 10, 66);
  T_(x, "PLAYER OF THE GAME", 110, 126, "800 64px Barlow", "#ffcf3f");
  T_(x, [g.title, season(g.seasonId)?.name, new Date(g.created).toLocaleDateString()].filter(Boolean).join("  ·  ").toUpperCase(), 112, 190, "600 32px Barlow", tc);
  x.save(); x.font = "italic 800 300px Barlow"; x.lineWidth = 10; x.strokeStyle = T.c2; x.textBaseline = "middle"; x.textAlign = "left"; x.strokeText("#" + b.x.num, 72, 420); x.restore();
  const nm = (b.x.name || "#" + b.x.num).toUpperCase(); ScoreBug.fit(x, nm, 800, 130, "Barlow", 920); x.fillStyle = tc; x.textAlign = "left"; x.fillText(nm, 80, 640);
  T_(x, T.name.toUpperCase(), 84, 730, "700 44px Barlow", T.c2 === T.c1 ? tc : T.c2);
  statLines(b.x).slice(0, 4).forEach((l, i) => { const y = 800 + i * 96; x.fillStyle = "rgba(0,0,0,.35)"; ScoreBug.rr(x, 80, y, 920, 78, 14); x.fill(); T_(x, l.toUpperCase(), 112, y + 41, "800 46px Barlow", "#fff"); });
  x.fillStyle = "rgba(0,0,0,.55)"; x.fillRect(0, 1210, 1080, 140);
  const sa = g.s[b.side].score, so = g.s[other(b.side)].score;
  if (lg) { const k = 90 / Math.max(lg.width, lg.height); x.drawImage(lg, 80, 1235, lg.width * k, lg.height * k); }
  T_(x, `${T.abbr} ${sa}`, 190, 1282, "800 64px Barlow", "#fff");
  T_(x, `${so} ${O.abbr}`, 890, 1282, "800 64px Barlow", "#fff", "right");
  if (lo) { const k = 90 / Math.max(lo.width, lo.height); x.drawImage(lo, 1000 - lo.width * k, 1235, lo.width * k, lo.height * k); }
  T_(x, g.s.qtr === "FINAL" ? "FINAL" : (Q_LONG[g.s.qtr] || "").toUpperCase(), 540, 1282, "700 34px Barlow", "#ffcf3f", "center");
  shareCanvas(c, `POTG-${T.abbr}-${(b.x.name || b.x.num).toString().replace(/\W+/g, "")}.png`);
}
async function recapCard(g) {
  const A = sideTeam(g, "away"), H = sideTeam(g, "home"), s = g.s, w = s.away.score > s.home.score ? A : s.home.score > s.away.score ? H : null;
  const [c, x] = cardBase((w || A).c1, (w || A).c2), [la, lh] = await Promise.all([loadImg(A.logo), loadImg(H.logo)]);
  T_(x, s.qtr === "FINAL" ? "FINAL" : (Q_LONG[s.qtr] || "").toUpperCase(), 540, 110, "italic 800 100px Barlow", "#ffcf3f", "center");
  T_(x, [g.title, season(g.seasonId)?.name, new Date(g.created).toLocaleDateString()].filter(Boolean).join("  ·  ").toUpperCase(), 540, 185, "600 32px Barlow", "#fff", "center");
  [[A, la, s.away.score, 270], [H, lh, s.home.score, 810]].forEach(([T, im, sc, cx]) => {
    x.fillStyle = T.c1; ScoreBug.rr(x, cx - 230, 240, 460, 420, 26); x.fill(); x.fillStyle = T.c2; x.fillRect(cx - 230, 640, 460, 20);
    if (im) { const k = 200 / Math.max(im.width, im.height); x.drawImage(im, cx - im.width * k / 2, 270, im.width * k, im.height * k); } else T_(x, T.abbr, cx, 370, "800 110px Barlow", ink(T.c1), "center");
    T_(x, T.name.toUpperCase(), cx, 515, "800 48px Barlow", ink(T.c1), "center");
    T_(x, String(sc), cx, 595, "800 120px Barlow", ink(T.c1), "center");
  });
  const { team: t, P } = computeStats(g), f = q => q.pass - q.sackY + q.rush;
  const rows = [["Total yards", f(t.away), f(t.home)], ["Passing", t.away.pass - t.away.sackY, t.home.pass - t.home.sackY], ["Rushing", t.away.rush, t.home.rush], ["First downs", t.away.fd, t.home.fd], ["Turnovers", t.away.to, t.home.to]];
  x.fillStyle = "rgba(0,0,0,.45)"; ScoreBug.rr(x, 60, 700, 960, 60 * rows.length + 30, 20); x.fill();
  rows.forEach(([l, a, h], i) => { const y = 745 + i * 60; T_(x, String(a), 200, y, "800 46px Barlow", "#fff", "center"); T_(x, l.toUpperCase(), 540, y, "600 34px Barlow", "#c9ccd3", "center"); T_(x, String(h), 880, y, "800 46px Barlow", "#fff", "center"); });
  const all = ["away", "home"].flatMap(sd => Object.values(P[sd]).map(q => ({ q, sd })));
  const lead = (key, fn, fmt) => { const b = all.filter(o => fn(o.q) > 0).sort((a, b2) => fn(b2.q) - fn(a.q))[0]; return b ? [key, `${sideTeam(g, b.sd).abbr} #${b.q.num} ${b.q.name || ""}`.trim(), fmt(b.q)] : null; };
  const L = [lead("Passing", q => q.pass.y, q => `${q.pass.y} yds, ${q.pass.td} TD`), lead("Rushing", q => q.rush.y, q => `${q.rush.y} yds, ${q.rush.td} TD`), lead("Receiving", q => q.rec.y, q => `${q.rec.n} rec, ${q.rec.y} yds`), lead("Defense", q => q.def.t + q.def.s * 2 + q.def.i * 3, q => `${q.def.t} tkl, ${q.def.s} sk, ${q.def.i} INT`)].filter(Boolean);
  let y = 730 + 60 * rows.length + 70;
  if (L.length) T_(x, "TOP PERFORMERS", 70, y, "800 34px Barlow", "#ffcf3f");
  L.forEach(([k, who, st], i) => { const yy = y + 52 + i * 50; T_(x, k.toUpperCase(), 70, yy, "700 30px Barlow", "#9aa0ab"); ScoreBug.fit(x, who.toUpperCase(), 700, 32, "Barlow", 470); x.fillStyle = "#fff"; x.textAlign = "left"; x.fillText(who.toUpperCase(), 270, yy); T_(x, st.toUpperCase(), 1010, yy, "700 30px Barlow", "#fff", "right"); });
  shareCanvas(c, `Final-${A.abbr}-vs-${H.abbr}.png`);
}
function shareCanvas(c, name) { c.toBlob(b => { const f = new File([b], name, { type: "image/png" }); showImageDialog(f); }, "image/png"); }
function showImageDialog(file) {
  const url = URL.createObjectURL(file), d = document.createElement("div"); d.className = "savedlg";
  d.innerHTML = `<div class="savedlg-in"><h3>Card ready</h3><img src="${url}" class="cardimg" alt=""><button class="primary big" data-act="shareClip">Save or share</button><button class="ghost" data-act="closeDlg">Done</button></div>`;
  d._file = file; document.body.appendChild(d);
}

// ---------- actions ----------
function refreshAfterSetting(g) { persist(); if (location.hash.endsWith("/setup")) route(); else refreshLive(g); }
Object.assign(ACT, {
  gTog: (el, g) => {
    const k = el.dataset.k; g[k] = el.dataset.v ? el.dataset.v === "1" : g[k] === false;
    if (k === "hlOn" && document.getElementById("recov")) { if (g[k]) hlStart(); else hlStop(); }
    refreshAfterSetting(g);
  },
  popMode: (el, g) => { g.popMode = el.dataset.v; refreshAfterSetting(g); },
  hear: (el, g) => { SFX.setHear(el.dataset.v === "1"); refreshAfterSetting(g); },
  sfxPlay: el => SFX.play(el.dataset.v),
  potgCard: (el, g) => potgCard(g),
  recapCard: (el, g) => recapCard(g),
});

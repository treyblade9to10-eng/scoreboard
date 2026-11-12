// import.js - bring a team in from NFL Rebuilder: starters (or the whole roster), logo and colors.
// Three ways in: read a Rebuilder save on this phone, pick a real NFL team, or a link/code sent from Rebuilder.
// Every import stops on a "Is this the New Orleans Saints?" check screen before anything is saved.
const NFLR_PATH = "../nfl-franchise/";
const NFL_STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, G: 2, C: 1, EDGE: 2, DT: 2, LB: 2, CB: 3, S: 2, K: 1, P: 1 };
const NFL_POS = ["QB", "RB", "FB", "WR", "TE", "OT", "G", "C", "EDGE", "DT", "LB", "CB", "S", "K", "P", "LS"];
const NFL_UNIT = pos => ["QB", "RB", "FB", "WR", "TE", "OT", "G", "C"].includes(pos) ? "Offense" : ["K", "P", "LS"].includes(pos) ? "Special teams" : "Defense";
const IMP = { league: null, pay: null, keep: null, full: false, sep: false, busy: false };

// ---------- reading NFL Rebuilder ----------
function rbxSaves() {
  const out = [];
  for (let i = 1; i <= 3; i++) {
    if (!localStorage.getItem("nflr_slot_" + i)) continue;
    let m = null; try { m = JSON.parse(localStorage.getItem("nflr_meta_" + i)); } catch (e) {}
    out.push({ slot: i, m: m || { team: "Save " + i } });
  }
  return out;
}
function rbxRead(slot) {
  const j = localStorage.getItem("nflr_slot_" + slot); if (!j) return null;
  try { return JSON.parse(j[0] === "z" ? LZString.decompressFromUTF16(j.slice(1)) : j); } catch (e) { return null; }
}
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
}
async function realLeague() {
  if (!window.NFL_TEAMS) await loadScript(NFLR_PATH + "js/data.js?v=sb");
  const teams = {}; NFL_TEAMS.forEach(t => teams[t.id] = t);
  return { kind: "real", from: "Real NFL rosters", teams, order: NFL_TEAMS.map(t => t.id), players: NFL_PLAYERS, user: null };
}
function saveLeague(slot) {
  const s = rbxRead(slot); if (!s || !s.teams || !s.players) return null;
  const order = Object.keys(s.teams).sort((a, b) => (b === s.user) - (a === s.user) || (s.teams[a].city + s.teams[a].name).localeCompare(s.teams[b].city + s.teams[b].name));
  return { kind: "save", slot, from: "NFL Rebuilder", season: s.season, teams: s.teams, order, players: Object.values(s.players), user: s.user };
}
// one team -> the shared "sbteam" package (NFL Rebuilder's SEND TO SCOREBOARD makes the same thing)
function packTeam(Lg, tid) {
  const t = Lg.teams[tid], mine = tid === Lg.user, dc = (mine && t.depth) || {};
  const by = {}; Lg.players.forEach(p => { if (p.t === tid) (by[p.pos] = by[p.pos] || []).push(p); });
  const rows = [];
  NFL_POS.forEach(pos => {
    const order = dc[pos] || [];
    const list = (by[pos] || []).sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia >= 0 && ib >= 0) return ia - ib; if (ia >= 0) return -1; if (ib >= 0) return 1;
      return b.ovr - a.ovr;
    });
    let need = NFL_STARTERS[pos] || 0;
    list.forEach(p => { const hurt = p.inj > 0, st = !hurt && need > 0; if (st) need--; rows.push([p.n, p.num || 0, pos, p.ovr, st ? 1 : 0, hurt ? 1 : 0]); });
  });
  return { f: "sbteam", v: 1, from: Lg.from, slot: Lg.slot || 0, season: Lg.season || "", mine: mine ? 1 : 0,
    rec: t.w != null && Lg.kind === "save" ? t.w + "-" + t.l + (t.t ? "-" + t.t : "") : "",
    t: { id: t.id, city: t.city, name: t.name, c1: t.c1, c2: t.c2, logo: t.logo || "" }, p: rows };
}
function unpackCode(code) {
  code = String(code || "").trim(); const m = code.match(/\/code\/([^\s?#]+)/); if (m) code = m[1];
  try { const d = JSON.parse(LZString.decompressFromEncodedURIComponent(code)); return d && d.f === "sbteam" && d.t && Array.isArray(d.p) ? d : null; } catch (e) { return null; }
}
// players without a jersey number (rookies, made-up guys) get a free one that fits their spot
function fillNumbers(rows) {
  const used = new Set(rows.map(r => +r[1]).filter(Boolean));
  const range = { QB: [1, 19], K: [1, 19], P: [1, 19], RB: [20, 49], WR: [10, 19], TE: [80, 89], OT: [60, 79], G: [60, 79], C: [50, 79], LS: [40, 69], EDGE: [90, 99], DT: [90, 99], LB: [40, 59], CB: [20, 39], S: [20, 49], FB: [30, 49] };
  rows.forEach(r => {
    if (+r[1]) return; const [a, b] = range[r[2]] || [1, 99];
    let n = a; while (n <= b && used.has(n)) n++; if (n > b) { n = 1; while (used.has(n) && n < 99) n++; }
    r[1] = n; used.add(n);
  });
}
const fullName = t => { const f = (t.city ? t.city + " " : "") + t.name; return f.length > 22 ? t.name : f; };
const sameTeam = (T, t) => (T.src && T.src.id === t.id) || T.name.toLowerCase() === fullName(t).toLowerCase();

// ---------- screens ----------
function startCheck(pay) {
  fillNumbers(pay.p);
  IMP.pay = pay; IMP.full = false; IMP.sep = false; IMP.keep = pay.p.map(r => !!r[4]);
}
async function viewImport(a, b) {
  if (a === "code" && b) {
    const pay = unpackCode(decodeURIComponent(b));
    if (!pay) { toast("That team code didn't work. Try sending it again."); return location.replace("#/import"); }
    startCheck(pay); return location.replace("#/import/check");
  }
  if (a === "check" && IMP.pay) return viewImportCheck();
  if (a === "slot" || a === "real") {
    if (!IMP.league || IMP.league.kind !== (a === "slot" ? "save" : "real") || (a === "slot" && IMP.league.slot !== +b)) {
      if (a === "slot") IMP.league = saveLeague(+b);
      else { $app.innerHTML = `<header class="top"><button class="back" data-act="impHome">‹ Back</button><h1>Real NFL teams</h1></header><p class="empty">Loading rosters...</p>`;
        try { IMP.league = await realLeague(); } catch (e) { IMP.league = null; } }
      if (!IMP.league) { toast(a === "slot" ? "Couldn't open that NFL Rebuilder save" : "Couldn't load the NFL rosters. Check your internet."); return location.replace("#/import"); }
    }
    return viewImportTeams();
  }
  const saves = rbxSaves();
  $app.innerHTML = `
  <header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>Import a team</h1></header>
  <p class="muted">Bring a team over with its starters, logo and colors, so you can just play and keep stats. You check every player before it's saved.</p>
  <section><h2>From NFL Rebuilder</h2>
    ${saves.length ? `<div class="implist">${saves.map(x => `<button class="impsrc" data-act="impSlot" data-v="${x.slot}" style="--c1:${esc(x.m.c1 || "#26304a")}">
        ${x.m.logo ? `<img src="${esc(x.m.logo)}" alt="">` : `<b>${esc(x.m.id || "")}</b>`}
        <span><small>Save ${x.slot}</small>${esc(x.m.team)}<i>${esc([x.m.season, x.m.rec].filter(Boolean).join(" · "))}</i></span></button>`).join("")}</div>
      <p class="muted">Pick a save, then your team or anyone in that league.</p>`
    : `<p class="empty">No NFL Rebuilder saves on this phone. If you play NFL Rebuilder from a home screen icon, open a team there and tap <b>Send to Scoreboard</b>.</p>`}
  </section>
  <section><h2>Real NFL teams</h2>
    <button class="impsrc" data-act="impReal" style="--c1:#13284f"><b>NFL</b><span><small>All 32 teams</small>Real rosters<i>Starters from the real depth charts</i></span></button>
  </section>
  <section><h2>Team code</h2>
    <p class="muted">Got a code from NFL Rebuilder's <b>Send to Scoreboard</b>? Paste it here.</p>
    <div class="addp"><input id="impCode" placeholder="Paste team code or link" autocomplete="off"><button data-act="impCode">Use code</button></div>
  </section>`;
}
function viewImportTeams() {
  const Lg = IMP.league;
  const title = Lg.kind === "real" ? "Real NFL teams" : `Save ${Lg.slot} · ${Lg.season}`;
  $app.innerHTML = `
  <header class="top"><button class="back" data-act="impHome">‹ Back</button><h1>Pick a team</h1></header>
  <p class="muted">${esc(title)}. Tap a team to check its starters.</p>
  <div class="teamgrid">${Lg.order.map(id => { const t = Lg.teams[id], have = DB.teams.some(T => sameTeam(T, t));
    return `<button class="teamcard impteam" data-act="impPick" data-v="${esc(id)}" style="--c1:${esc(t.c1)};--c2:${esc(t.c2)}">
      ${id === Lg.user ? `<em>Your team</em>` : have ? `<em class="have">In Scoreboard</em>` : ""}
      ${t.logo ? `<img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">` : `<b class="ab">${esc(id)}</b>`}
      <span>${esc(t.name)}</span><small>${esc(t.city || "")}</small></button>`; }).join("")}</div>`;
}
function viewImportCheck() {
  const P = IMP.pay, t = P.t, name = fullName(t), have = DB.teams.find(T => sameTeam(T, t));
  const starters = P.p.filter(r => r[4]).length;
  const shown = P.p.map((r, i) => ({ r, i })).filter(x => IMP.full || x.r[4]);
  const picked = IMP.keep.filter(Boolean).length;
  const ask = P.mine ? `Is this your team?` : `Is this the ${esc(name)}?`;
  const sub = [P.from, P.slot ? "Save " + P.slot : "", P.season, P.rec].filter(Boolean).map(esc).join(" · ");
  let units = "";
  ["Offense", "Defense", "Special teams"].forEach(u => {
    const list = shown.filter(x => NFL_UNIT(x.r[2]) === u); if (!list.length) return;
    units += `<h4>${u}</h4><div class="implayers">${list.map(({ r, i }) => `<button class="ip ${IMP.keep[i] ? "on" : ""}" data-act="impTog" data-v="${i}">
      <i class="tick"></i><b>#${esc(r[1])}</b><span>${esc(r[0])}</span><small>${esc(r[2])}${r[5] ? ` <em>INJ</em>` : ""}${IMP.full && r[4] ? ` <em class="st">START</em>` : ""}</small><strong>${esc(r[3])}</strong></button>`).join("")}</div>`;
  });
  $app.innerHTML = `
  <header class="top"><button class="back" data-act="impNo">‹ Back</button><h1>Check the team</h1></header>
  <section class="imphero" style="--c1:${esc(t.c1)};--c2:${esc(t.c2)}">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">` : `<b class="ab">${esc(t.id)}</b>`}
    <div><div class="kicker">${P.mine ? "Your team" : "Double check"}</div><h2>${ask}</h2><p>${esc(name)}</p><small>${sub}</small></div>
  </section>
  <canvas id="tprev" width="1280" height="250" class="tprev"></canvas>
  <div class="seg"><button class="${IMP.full ? "" : "on"}" data-act="impFull" data-v="0">Starters (${starters})</button><button class="${IMP.full ? "on" : ""}" data-act="impFull" data-v="1">Whole roster (${P.p.length})</button></div>
  <p class="muted">Tap a player to leave him out. ${have ? "" : "You can add more players later in the team editor."}</p>
  ${units}
  ${have ? `<section class="card impold"><b>You already have the ${esc(have.name)}.</b>
    <p class="muted">${IMP.sep ? "This will be added as a second, separate team." : "Yes will swap in this roster. Old games keep their stats; your logo and colors stay."}</p>
    <button class="small" data-act="impSep">${IMP.sep ? "Update the one I have instead" : "Add as a separate team instead"}</button></section>` : ""}
  <div class="savebar"><button class="primary big" data-act="impYes" ${picked ? "" : "disabled"}>${IMP.busy ? "Saving..." : `Yes, ${have && !IMP.sep ? "update" : "add"} them (${picked})`}</button><button data-act="impNo">No, pick again</button></div>`;
  // score bug preview with this team's look
  const c = document.getElementById("tprev");
  if (c) {
    const prevTE = TE; TE = { abbr: t.id, name: t.name, logo: "", c1: t.c1, c2: t.c2 }; drawTeamPreview(); TE = prevTE;
    if (t.logo) logoData(t.logo).then(src => { if (!src || !document.getElementById("tprev")) return; const p2 = TE; TE = { abbr: t.id, name: t.name, logo: src, c1: t.c1, c2: t.c2 }; drawTeamPreview(); TE = p2; });
  }
}
// ESPN logos -> small picture saved inside the team (so recording never breaks and it works offline)
const LOGO_CACHE = {};
function logoData(url) {
  if (!url || url.startsWith("data:")) return Promise.resolve(url || "");
  return LOGO_CACHE[url] = LOGO_CACHE[url] || fetch(url, { mode: "cors" }).then(r => { if (!r.ok) throw 0; return r.blob(); }).then(b => shrinkImage(b, 200)).catch(() => { delete LOGO_CACHE[url]; return ""; });
}
async function impSave() {
  const P = IMP.pay, t = P.t; if (IMP.busy) return; IMP.busy = true; route();
  const rows = P.p.filter((r, i) => IMP.keep[i]);
  const have = IMP.sep ? null : DB.teams.find(T => sameTeam(T, t));
  const logo = have && have.logo ? have.logo : await logoData(t.logo);
  IMP.busy = false;
  if (t.logo && !logo) toast("Couldn't grab the logo (no internet?). You can add one in the team editor.");
  const src = { id: t.id, from: P.from, season: P.season || "", at: Date.now() };
  if (have) {
    const old = have.roster;
    have.roster = rows.map(r => { const o = old.find(p => p.name === r[0]); return { id: o ? o.id : uid(), num: +r[1], name: r[0], pos: r[2] }; });
    have.src = src; if (!have.logo) have.logo = logo;
    persist(); toast(`${have.name} updated: ${rows.length} players`);
  } else {
    let swatches = [];
    if (logo) swatches = await new Promise(ok => { const i = new Image(); i.onload = () => { try { ok(logoColors(i)); } catch (e) { ok([]); } }; i.onerror = () => ok([]); i.src = logo; });
    DB.teams.push({ id: uid(), name: fullName(t), abbr: String(t.id).toUpperCase().slice(0, 4), logo, c1: t.c1, c2: t.c2,
      roster: rows.map(r => ({ id: uid(), num: +r[1], name: r[0], pos: r[2] })), swatches, src });
    persist(); toast(`${fullName(t)} added: ${rows.length} players`);
  }
  IMP.pay = null; go("#/");
}
Object.assign(ACT, {
  importTeam: () => go("#/import"),
  impHome: () => go("#/import"),
  impSlot: el => go("#/import/slot/" + el.dataset.v),
  impReal: () => go("#/import/real"),
  impCode: () => {
    const pay = unpackCode(document.getElementById("impCode").value);
    if (!pay) return toast("That isn't a team code from NFL Rebuilder");
    startCheck(pay); go("#/import/check");
  },
  impPick: el => { startCheck(packTeam(IMP.league, el.dataset.v)); go("#/import/check"); },
  impTog: el => { const i = +el.dataset.v; IMP.keep[i] = !IMP.keep[i]; const y = scrollY; route(); scrollTo(0, y); },
  impFull: el => {
    IMP.full = el.dataset.v === "1";
    IMP.keep = IMP.pay.p.map(r => IMP.full ? !r[5] : !!r[4]); // whole roster: everyone healthy; starters: just starters
    const y = scrollY; route(); scrollTo(0, y);
  },
  impSep: () => { IMP.sep = !IMP.sep; const y = scrollY; route(); scrollTo(0, y); },
  impNo: () => { const L = IMP.league; IMP.pay = null; go(L ? (L.kind === "real" ? "#/import/real" : "#/import/slot/" + L.slot) : "#/import"); },
  impYes: () => impSave(),
});

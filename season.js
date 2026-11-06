// Season mode: link games together for standings, leaders and season stats.
DB.seasons = DB.seasons || [];
const season = id => id && (DB.seasons || []).find(x => x.id === id);
const seasonGames = se => DB.games.filter(g => g.seasonId === se.id);
const isFinal = g => g.s.qtr === "FINAL";

function standings(se) {
  const ids = new Set(se.teamIds || []); seasonGames(se).forEach(g => { ids.add(g.awayId); ids.add(g.homeId); });
  const R = {}; ids.forEach(id => { if (team(id)) R[id] = { id, w: 0, l: 0, t: 0, pf: 0, pa: 0, res: [] }; });
  seasonGames(se).filter(isFinal).sort((a, b) => a.created - b.created).forEach(g => {
    for (const [side, id] of [["away", g.awayId], ["home", g.homeId]]) {
      const r = R[id]; if (!r) continue; const me = g.s[side].score, op = g.s[other(side)].score;
      r.pf += me; r.pa += op; const k = me > op ? "w" : me < op ? "l" : "t"; r[k]++; r.res.push(k.toUpperCase());
    }
  });
  const pct = r => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
  return Object.values(R).map(r => {
    let st = ""; if (r.res.length) { const last = r.res[r.res.length - 1]; let n = 0; for (let i = r.res.length - 1; i >= 0 && r.res[i] === last; i--) n++; st = last + n; }
    return Object.assign(r, { pct: pct(r), streak: st });
  }).sort((a, b) => b.pct - a.pct || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf);
}
function teamRecord(g, side) {
  const se = season(g.seasonId); if (!se) return "";
  const id = side === "away" ? g.awayId : g.homeId; let w = 0, l = 0, t = 0;
  seasonGames(se).filter(x => isFinal(x) && x.id !== g.id).forEach(x => {
    const sd = x.awayId === id ? "away" : x.homeId === id ? "home" : null; if (!sd) return;
    const me = x.s[sd].score, op = x.s[other(sd)].score; if (me > op) w++; else if (me < op) l++; else t++;
  });
  return `${w}-${l}${t ? "-" + t : ""}`;
}
function addDeep(a, b) { for (const k in b) { if (typeof b[k] === "number") a[k] = k === "lg" ? Math.max(a[k] || 0, b[k]) : (a[k] || 0) + b[k]; else if (b[k] && typeof b[k] === "object") addDeep(a[k] = a[k] || {}, b[k]); } }
function seasonPlayers(se) {
  const M = {};
  for (const g of seasonGames(se)) {
    const { P } = computeStats(g);
    for (const side of ["away", "home"]) {
      const tid = side === "away" ? g.awayId : g.homeId;
      for (const [k, x] of Object.entries(P[side])) {
        const key = tid + ":" + k, A = M[key] = M[key] || { tid, num: x.num, name: x.name, gp: 0 };
        A.gp++; const { num, name, ...nums } = x; addDeep(A, nums);
      }
    }
  }
  return Object.values(M);
}
const LEADERS = [
  ["Passing yards", x => x.pass?.y], ["Passing TD", x => x.pass?.td], ["Rushing yards", x => x.rush?.y], ["Receiving yards", x => x.rec?.y],
  ["Catches", x => x.rec?.n], ["Touchdowns", x => (x.rush?.td || 0) + (x.rec?.td || 0) + (x.ret?.td || 0)], ["Tackles", x => x.def?.t], ["Sacks", x => x.def?.s],
  ["Interceptions", x => x.def?.i], ["Field goals", x => x.kick?.fm],
];

function seasonsHomeHTML() {
  const list = DB.seasons || [];
  return `<section>
    <div class="sechead"><h2>Seasons</h2><button data-act="newSeason">+ New season</button></div>
    ${list.length ? list.map(se => {
      const st = standings(se), top = st[0] && team(st[0].id), n = seasonGames(se).length;
      return `<a class="gamecard seasoncard" href="#/season/${se.id}"><div class="gc-mid" style="text-align:left"><span>${esc(se.name)}</span><small>${n} game${n === 1 ? "" : "s"} · ${st.length} teams</small></div>
        ${top ? `<div class="gc-team r"><small class="muted">1st</small>${teamChip(top)}<span>${esc(top.abbr)} ${st[0].w}-${st[0].l}${st[0].t ? "-" + st[0].t : ""}</span></div>` : ""}</a>`;
    }).join("") : `<p class="empty">Make a season to track standings and season stats across games.</p>`}
  </section>`;
}
function seasonSelectHTML(sel, key) {
  if (!(DB.seasons || []).length) return "";
  return `<label class="lbl">Season</label><select data-input="${key}"><option value="">No season (just a game)</option>${DB.seasons.map(se => `<option value="${se.id}" ${se.id === sel ? "selected" : ""}>${esc(se.name)}</option>`).join("")}</select>`;
}

let SE = null; // season being edited
function viewSeasonEdit(id) {
  const ex = season(id);
  if (!SE || SE.id !== id) SE = ex ? JSON.parse(JSON.stringify(ex)) : { id, name: "", teamIds: DB.teams.map(t => t.id), created: Date.now() };
  $app.innerHTML = `<header class="top"><button class="back" data-act="backHome">‹ Back</button><h1>${ex ? "Edit season" : "New season"}</h1></header>
  <section><label class="lbl">Season name</label><input data-input="seName" value="${esc(SE.name)}" placeholder="Fall ${new Date().getFullYear()}" maxlength="30">
    <div class="lbl">Teams in this season</div>
    <div class="chips">${DB.teams.map(T => `<button class="${SE.teamIds.includes(T.id) ? "on" : ""}" data-act="seTeam" data-v="${T.id}">${teamChip(T)} ${esc(T.name)}</button>`).join("") || `<p class="muted">Make some teams first.</p>`}</div>
  </section>
  <div class="savebar"><button class="primary big" data-act="saveSeason">Save season</button>${ex ? `<button class="danger" data-act="deleteSeason">Delete</button>` : ""}</div>`;
}
function viewSeason(se) {
  const st = standings(se), games = seasonGames(se).sort((a, b) => b.created - a.created), pl = seasonPlayers(se);
  const rec = r => `${r.w}-${r.l}${r.t ? "-" + r.t : ""}`;
  $app.innerHTML = `<header class="top"><button class="back" data-act="backHome">‹ Home</button><h1>${esc(se.name)}</h1></header>
  <div class="row"><button class="primary" data-act="seasonGame" data-v="${se.id}">+ New game in this season</button><a class="btn" href="#/seasonedit/${se.id}">Edit</a></div>
  <section class="card"><h2>Standings <small>only finished games count</small></h2>
    <table class="standings"><tr><th>Team</th><th>W-L</th><th>PF</th><th>PA</th><th>DIFF</th><th>STRK</th></tr>
    ${st.map((r, i) => { const T = team(r.id); return `<tr><td class="pn"><span class="rk">${i + 1}</span>${teamChip(T)} ${esc(T.abbr)}</td><td><b>${rec(r)}</b></td><td>${r.pf}</td><td>${r.pa}</td><td>${r.pf - r.pa > 0 ? "+" : ""}${r.pf - r.pa}</td><td>${r.streak || "-"}</td></tr>`; }).join("")}</table>
  </section>
  <section><h2>Games</h2>${games.map(g => {
    const A = sideTeam(g, "away"), H = sideTeam(g, "home"), q = isFinal(g) ? "Final" : g.s.qtr === "HALF" ? "Half" : `Q${g.s.qtr}`;
    return `<div class="gcwrap"><a class="gamecard" href="#/game/${g.id}"><div class="gc-team">${teamChip(A)}<span>${esc(A.abbr)}</span><b>${g.s.away.score}</b></div>
      <div class="gc-mid"><span>${esc(g.title || "")}</span><small>${q} · ${new Date(g.created).toLocaleDateString()}</small></div>
      <div class="gc-team r"><b>${g.s.home.score}</b><span>${esc(H.abbr)}</span>${teamChip(H)}</div></a><button class="gcdel" data-act="delGame" data-v="${g.id}" aria-label="Delete game">✕</button></div>`;
  }).join("") || `<p class="empty">No games in this season yet.</p>`}</section>
  <section class="card"><h2>Season leaders</h2><div class="leaders">${LEADERS.map(([l, f]) => {
    const top = pl.filter(x => (f(x) || 0) > 0).sort((a, b) => f(b) - f(a)).slice(0, 3);
    return top.length ? `<div class="ld"><h4>${l}</h4>${top.map((x, i) => { const T = team(x.tid); return `<div class="ldr"><span class="rk">${i + 1}</span>${T ? teamChip(T) : ""}<span class="nm">#${esc(x.num)} ${esc(x.name)}</span><b>${f(x)}</b></div>`; }).join("")}</div>` : "";
  }).join("") || `<p class="muted">Leaders show up once games have logged plays.</p>`}</div></section>
  ${st.map(r => {
    const T = team(r.id), L = pl.filter(x => x.tid === r.id).sort((a, b) => a.num - b.num); if (!L.length) return "";
    return `<details class="card boxteam" style="--c1:${T.c1}"><summary><h3>${teamChip(T)} ${esc(T.name)} season stats</h3></summary>
      <table><tr><th>Player</th><th>GP</th><th>PASS</th><th>RUSH</th><th>REC</th><th>TD</th><th>TKL</th><th>SK</th><th>INT</th></tr>
      ${L.map(x => `<tr><td class="pn">#${esc(x.num)} ${esc(x.name)}</td><td>${x.gp}</td><td>${x.pass?.y || 0}</td><td>${x.rush?.y || 0}</td><td>${x.rec?.y || 0}</td><td>${(x.pass?.td || 0) + (x.rush?.td || 0) + (x.rec?.td || 0) + (x.ret?.td || 0)}</td><td>${x.def?.t || 0}</td><td>${x.def?.s || 0}</td><td>${x.def?.i || 0}</td></tr>`).join("")}</table></details>`;
  }).join("")}`;
}

Object.assign(ACT, {
  newSeason: () => { SE = null; go("#/seasonedit/" + uid()); },
  seTeam: el => { const id = el.dataset.v; SE.teamIds = SE.teamIds.includes(id) ? SE.teamIds.filter(x => x !== id) : [...SE.teamIds, id]; route(); },
  saveSeason: () => {
    if (!SE.name.trim()) return toast("Give the season a name");
    const i = DB.seasons.findIndex(x => x.id === SE.id); if (i >= 0) DB.seasons[i] = SE; else DB.seasons.push(SE);
    persist(); const id = SE.id; SE = null; toast("Season saved"); go("#/season/" + id);
  },
  deleteSeason: () => {
    if (!confirm("Delete this season? Its games stay, they just won't be part of a season.")) return;
    DB.games.forEach(g => { if (g.seasonId === SE.id) g.seasonId = ""; }); DB.seasons = DB.seasons.filter(x => x.id !== SE.id); persist(); SE = null; go("#/");
  },
  seasonGame: el => {
    const se = season(el.dataset.v), ids = (se.teamIds || []).filter(team);
    window.NG = { awayId: ids[0] || DB.teams[0]?.id, homeId: ids[1] || DB.teams[1]?.id, style: "prime", qLen: 12, title: "", seasonId: se.id };
    go("#/new");
  },
});
Object.assign(INPUT, {
  seName: v => { SE.name = v; },
  ngSeason: v => { window.NG.seasonId = v; },
  gSeason: (v, g) => { g.seasonId = v; persist(); },
});

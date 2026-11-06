// Remote mode: one phone is the CAMERA (shows only camera + score bug, good for a TV),
// another phone is the REMOTE (does all the scoring). They talk through Firebase (REST + live stream).
const FB_BASE = localStorage.getItem("sb-fb") || "https://cardio-game-3713-default-rtdb.firebaseio.com";
const REMOTE = { role: null, code: null, gid: null, es: null, seen: new Set(), q: [], lastTeams: "", lastGame: "", timer: 0, screen: null, applying: false, hb: 0 };
const roomUrl = (code, path = "") => `${FB_BASE}/scoreboard/rooms/${code}${path}.json`;
async function fb(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("denied"), { denied: true });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
function fbErr(e) {
  if (e && e.denied) return toast("Remote isn't set up yet. Ask Brooke about the Firebase rules step.");
  toast("Couldn't reach the internet. Check both phones are online.");
}
function listen(url, onEvent) {
  const es = new EventSource(url);
  for (const t of ["put", "patch"]) es.addEventListener(t, e => { try { onEvent(t, JSON.parse(e.data)); } catch (er) { console.warn(er); } });
  es.addEventListener("cancel", () => toast("Remote was blocked by Firebase rules"));
  return es;
}

// ================= CAMERA side =================
async function beCamera() {
  const code = String(1000 + Math.floor(Math.random() * 9000));
  const g = { id: "rm_" + code, awayId: "", homeId: "", style: "prime", qLen: 12, s: newGameState(12), plays: [], undo: [], remoteWaiting: true };
  Object.assign(REMOTE, { role: "screen", code, gid: g.id, seen: new Set(), screen: null });
  REC.g = g;
  openCam(g); // opened on this tap so the iPhone allows the camera + sound
  try { await fb("PUT", roomUrl(code), { at: Date.now(), screen: { at: Date.now(), ready: true } }); }
  catch (e) { fbErr(e); stopRemote(); closeCam(); return; }
  REMOTE.es = listen(roomUrl(code), (t, m) => screenEvent(g, t, m));
  REMOTE.hb = setInterval(() => sendScreenStatus(), 5000);
  refreshLive(g);
}
function screenEvent(g, type, { path, data }) {
  if (path === "/") { // first full snapshot: remember old events so they don't replay
    if (!data) return;
    Object.keys(data.ev || {}).forEach(k => REMOTE.seen.add("ev" + k)); Object.keys(data.cmd || {}).forEach(k => REMOTE.seen.add("cmd" + k));
    if (data.teams) applyTeams(data.teams); if (data.game) applyGame(g, data.game);
    return;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "teams") return applyTeams(type === "put" && parts.length === 1 ? data : null);
  if (parts[0] === "game" && parts.length === 1 && data) return applyGame(g, data);
  if ((parts[0] === "ev" || parts[0] === "cmd") && parts.length === 1 && data && type === "put") { // reset of list: mark all seen
    Object.keys(data).forEach(k => REMOTE.seen.add(parts[0] + k)); return;
  }
  if ((parts[0] === "ev" || parts[0] === "cmd") && parts.length === 2 && data) {
    const key = parts[0] + parts[1]; if (REMOTE.seen.has(key)) return; REMOTE.seen.add(key);
    if (parts[0] === "ev") { const { kind, text, sub, team: side, dur, ...extra } = data; delete extra.now; banner(g, kind, text, sub, side, dur, Object.assign(extra, data.now ? { now: true } : {})); }
    else screenCmd(g, data.k);
  }
}
function applyTeams(teams) {
  if (!teams) return;
  for (const T of Object.values(teams)) { const i = DB.teams.findIndex(t => t.id === T.id); T.roster = T.roster || []; if (i >= 0) DB.teams[i] = T; else DB.teams.push(T); }
  persist(); const g = REC.g; if (g) { g.remoteWaiting = !g.awayId; refreshLive(g); }
}
function applyGame(g, inc) {
  const lag = Date.now() - (inc.sentAt || Date.now()); // the two phones' clocks don't match exactly
  const s = inc.s || newGameState(inc.qLen || 12);
  if (s.running) s.startedAt = (s.startedAt || 0) + lag;
  const wasWaiting = g.remoteWaiting;
  Object.assign(g, inc, { id: g.id, s, plays: [], undo: [], remoteWaiting: !team(inc.awayId) });
  if (wasWaiting && !g.remoteWaiting) { toast("Remote connected"); sendScreenStatus(); }
  refreshLive(g);
}
function screenCmd(g, k) {
  if (k === "rec") recToggle(g);
  else if (k === "replay") startReplay(g);
  else if (k === "highlight") grabHighlight(g);
  else if (k === "flip") ACT.flipCam();
  else if (k === "live") { if (LIVE.code) stopLive(); else goLive(g); }
  setTimeout(sendScreenStatus, 400);
}
function sendScreenStatus() {
  if (REMOTE.role !== "screen") return;
  const rec = !!(REC.rec && REC.rec.state === "recording");
  fb("PUT", roomUrl(REMOTE.code, "/screen"), { at: Date.now(), rec, recSec: rec ? Math.floor((Date.now() - REC.t0) / 1000) : 0, hl: HL.count || 0, live: LIVE.code || "", watching: liveCount(), mic: !!(REC.stream && REC.stream.getAudioTracks().length), cam: !!REC.stream }).catch(() => {});
}
function screenOverlayHTML(g) {
  if (g.remoteWaiting) return `<div class="rm-wait"><small>CAMERA MODE</small><b class="rm-code">${REMOTE.code}</b><span>On your other phone: open the game, go to <b>Record</b>, tap <b>Connect to camera</b> and type this code.</span>
    <button data-act="closeCam">Cancel</button></div>`;
  return `<div class="rm-badge">Camera · code ${REMOTE.code} · remote connected</div>`;
}

// ================= REMOTE side =================
async function connectRemote(g, code) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length !== 4) return toast("The code is 4 numbers");
  try {
    const room = await fb("GET", roomUrl(code));
    if (!room || !room.screen) return toast("No camera with that code. Check the number on the camera phone.");
    stopRemote();
    Object.assign(REMOTE, { role: "remote", code, gid: g.id, q: [], lastTeams: "", lastGame: "", screen: room.screen });
    await fb("PATCH", roomUrl(code), { ev: null, cmd: null, remote: { at: Date.now() } });
    await flushRemote(true);
    REMOTE.es = listen(roomUrl(code, "/screen"), (t, m) => { if (m.path === "/") REMOTE.screen = m.data; else if (REMOTE.screen) REMOTE.screen[m.path.slice(1)] = m.data; remoteRefresh(); });
    toast("Connected to the camera"); remoteRefresh();
  } catch (e) { fbErr(e); }
}
function stopRemote() {
  REMOTE.es?.close(); REMOTE.es = null; clearInterval(REMOTE.hb); clearTimeout(REMOTE.timer);
  if (REMOTE.role === "screen" && REMOTE.code) fb("DELETE", roomUrl(REMOTE.code)).catch(() => {});
  Object.assign(REMOTE, { role: null, code: null, gid: null, screen: null, q: [] });
}
function remotePushSoon() { if (REMOTE.role !== "remote") return; clearTimeout(REMOTE.timer); REMOTE.timer = setTimeout(() => flushRemote(), 120); }
async function flushRemote(force) {
  const g = game(REMOTE.gid); if (!g || REMOTE.role !== "remote") return;
  if (REMOTE.busy) { REMOTE.again = true; return; } REMOTE.busy = true;
  try {
    const teams = {}; for (const id of [g.awayId, g.homeId]) { const T = team(id); if (T) { const { swatches, ...t } = T; teams[id] = t; } }
    const tj = JSON.stringify(teams);
    if (force || tj !== REMOTE.lastTeams) { await fb("PUT", roomUrl(REMOTE.code, "/teams"), teams); REMOTE.lastTeams = tj; }
    const { plays, undo, ...rest } = g, gj = JSON.stringify(rest);
    if (force || gj !== REMOTE.lastGame) { await fb("PUT", roomUrl(REMOTE.code, "/game"), Object.assign(JSON.parse(gj), { sentAt: Date.now(), _np: plays.length })); REMOTE.lastGame = gj; }
    while (REMOTE.q.length) await fb("POST", roomUrl(REMOTE.code, "/ev"), REMOTE.q.shift());
  } catch (e) { if (e.denied) fbErr(e); }
  REMOTE.busy = false; if (REMOTE.again) { REMOTE.again = false; flushRemote(); }
}
function remoteBanner(g, b) {
  if (REMOTE.role !== "remote" || g.id !== REMOTE.gid) return;
  const { gid, start, ...ev } = b; REMOTE.q.push(JSON.parse(JSON.stringify(ev))); remotePushSoon();
}
function remoteBarHTML(g) {
  if (REMOTE.role !== "remote" || REMOTE.gid !== g.id) return "";
  const sc = REMOTE.screen || {}, alive = sc.at && Date.now() - sc.at < 20000;
  return `<section class="card rmbar"><h2>Camera phone <small>code ${REMOTE.code} · ${alive ? (sc.rec ? `<span class="recdot">REC ${fmtClock(sc.recSec || 0)}</span>` : "connected") : "not responding"}</small></h2>
    <div class="row"><button class="${sc.rec ? "stop" : "go"}" data-act="rmCmd" data-v="rec">${sc.rec ? "Stop recording" : "Start recording"}</button>
      <button data-act="rmCmd" data-v="replay">Replay</button><button data-act="rmCmd" data-v="highlight">Highlight${sc.hl ? ` (${sc.hl})` : ""}</button></div>
    <div class="row"><button class="livebtn ${sc.live ? "on" : ""}" data-act="rmCmd" data-v="live">${sc.live ? `LIVE · code ${sc.live} · ${sc.watching || 0} watching (tap to stop)` : "Go live (private)"}</button></div>
    <div class="row"><button data-act="rmCmd" data-v="flip">Flip camera</button><button class="ghost" data-act="rmStop">Disconnect</button></div>
    ${sc.mic === false ? `<p class="muted">The camera phone has no microphone permission, so its video won't have sound.</p>` : ""}
  </section>`;
}
function remoteSetupHTML(g) { return `<div id="rmSec">${remoteSetupInner(g)}</div>`; }
function remoteRefresh() { const g = game(REMOTE.gid); if (!g) return; refreshLive(g); const el = document.getElementById("rmSec"); if (el) el.innerHTML = remoteSetupInner(g); }
function remoteSetupInner(g) {
  if (REMOTE.role === "remote" && REMOTE.gid === g.id) return remoteBarHTML(g);
  return `<section class="card"><h2>Use a second phone as the camera</h2>
    <p class="muted">Great for a TV: the camera phone shows only the video and the score bug, with no buttons ever. You score on this phone.</p>
    <ol class="steps"><li>On the camera phone, open Scoreboard and tap <b>Be the camera</b> on the home page. It shows a 4-number code.</li><li>Type that code here and tap <b>Connect to camera</b>.</li></ol>
    <div class="row"><input id="rmCode" inputmode="numeric" maxlength="4" placeholder="Code" style="flex:1"><button class="primary" data-act="rmConnect">Connect to camera</button></div></section>`;
}

Object.assign(ACT, {
  beCamera: () => beCamera(),
  rmConnect: (el, g) => connectRemote(g, document.getElementById("rmCode")?.value),
  rmCmd: (el, g) => { if (REMOTE.role !== "remote") return; fb("POST", roomUrl(REMOTE.code, "/cmd"), { k: el.dataset.v, at: Date.now() }).catch(fbErr); },
  rmStop: (el, g) => { stopRemote(); toast("Disconnected"); refreshLive(g); const s = document.getElementById("rmSec"); if (s) s.innerHTML = remoteSetupInner(g); },
});

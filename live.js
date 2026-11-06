// Private live stream: the camera phone sends its video (camera + score bug + sound) straight to
// at most 2 screens that type the 4-number code. Firebase only passes the "hello" messages; video goes phone-to-screen.
const LIVE_MAX = 2;
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
const liveUrl = (code, path = "") => `${FB_BASE}/scoreboard/live/${code}${path}.json`;
const LIVE = { code: null, es: null, peers: {}, hb: 0, started: 0 };
const W = { pc: null, es: null, code: null, vid: null };

function iceDone(pc, ms = 3500) { // wait until the phone has found its network routes (or give up after a few seconds)
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(ok => { const t = setTimeout(ok, ms); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } }); });
}
const liveCount = () => Object.values(LIVE.peers).filter(p => p.ok).length;

// ================= camera phone =================
async function goLive(g) {
  if (LIVE.code) return;
  if (!REC.canvas || !REC.canvas.captureStream || !window.RTCPeerConnection) return toast("This phone can't live stream");
  const code = String(1000 + Math.floor(Math.random() * 9000));
  try { await fb("PUT", liveUrl(code), { at: Date.now(), host: { at: Date.now() }, title: liveTitle(g) }); }
  catch (e) { return fbErr(e); }
  LIVE.code = code; LIVE.started = Date.now(); LIVE.peers = {};
  LIVE.stream = new MediaStream([...REC.canvas.captureStream(30).getVideoTracks(), ...camAudioTracks()]);
  LIVE.es = listen(liveUrl(code, "/viewers"), (t, m) => hostViewerEvent(t, m));
  LIVE.hb = setInterval(() => fb("PATCH", liveUrl(code, "/host"), { at: Date.now(), n: liveCount() }).catch(() => {}), 10000);
  liveUI(); if (typeof sendScreenStatus === "function") sendScreenStatus();
}
function liveTitle(g) { const A = sideTeam(g, "away"), H = sideTeam(g, "home"); return `${A.name} at ${H.name}`; }
function hostViewerEvent(type, { path, data }) {
  if (path === "/") { if (data) Object.entries(data).forEach(([vid, v]) => hostOffer(vid, v)); return; }
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && data) hostOffer(parts[0], data);
  if (parts.length === 1 && data === null && LIVE.peers[parts[0]]) dropPeer(parts[0]); // viewer closed the stream
}
async function hostOffer(vid, v) {
  if (!LIVE.code || !v || !v.offer || v.answer || v.full || LIVE.peers[vid]) return;
  if (Date.now() - (v.at || 0) > 120000) return; // old leftover
  if (liveCount() + Object.values(LIVE.peers).filter(p => !p.ok).length >= LIVE_MAX) return fb("PATCH", liveUrl(LIVE.code, "/viewers/" + vid), { full: true }).catch(() => {});
  const pc = new RTCPeerConnection(ICE), P = LIVE.peers[vid] = { pc, ok: false };
  LIVE.stream.getTracks().forEach(t => pc.addTrack(t, LIVE.stream));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") { P.ok = true; liveUI(); toast("Someone is watching live"); capBitrate(pc); }
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) dropPeer(vid);
  };
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: v.offer });
    await pc.setLocalDescription(await pc.createAnswer()); await iceDone(pc);
    await fb("PATCH", liveUrl(LIVE.code, "/viewers/" + vid), { answer: pc.localDescription.sdp });
  } catch (e) { console.warn("live answer failed", e); dropPeer(vid); }
  setTimeout(() => { if (LIVE.peers[vid] && !LIVE.peers[vid].ok) dropPeer(vid); }, 30000);
}
function capBitrate(pc) {
  pc.getSenders().forEach(s => { if (s.track && s.track.kind === "video") { const p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = 2500000; s.setParameters(p).catch(() => {}); } });
}
function dropPeer(vid) {
  const P = LIVE.peers[vid]; if (!P) return; delete LIVE.peers[vid];
  try { P.pc.close(); } catch (e) {}
  if (LIVE.code) fb("DELETE", liveUrl(LIVE.code, "/viewers/" + vid)).catch(() => {});
  liveUI();
}
function stopLive() {
  if (!LIVE.code) return;
  Object.keys(LIVE.peers).forEach(dropPeer);
  LIVE.es?.close(); clearInterval(LIVE.hb);
  fb("DELETE", liveUrl(LIVE.code)).catch(() => {});
  LIVE.code = null; LIVE.es = null; liveUI(); if (typeof sendScreenStatus === "function") sendScreenStatus();
}
function liveUI() {
  const b = document.getElementById("liveBtn");
  if (b) { b.classList.toggle("on", !!LIVE.code); b.textContent = LIVE.code ? `LIVE ${LIVE.code} · ${liveCount()} watching` : "Go live"; }
}
function liveBtnHTML() { return `<button data-act="liveToggle" id="liveBtn" class="livebtn ${LIVE.code ? "on" : ""}">${LIVE.code ? `LIVE ${LIVE.code} · ${liveCount()} watching` : "Go live"}</button>`; }

// ================= watching screen =================
function viewWatch(code) {
  $app.innerHTML = `<header class="top"><button class="back" data-act="watchBack">‹ Back</button><h1>Watch live</h1></header>
  <section class="card"><p class="muted">Type the 4-number code from the phone that's filming. Only 2 screens can watch at once.</p>
    <div class="row"><input id="watchCode" inputmode="numeric" maxlength="4" placeholder="Code" value="${esc(code || "")}" style="flex:1"><button class="primary" data-act="watchGo">Watch</button></div></section>`;
  if (code && code.length === 4) setTimeout(() => ACT.watchGo(), 50);
}
async function watch(code) {
  code = String(code || "").replace(/\D/g, ""); if (code.length !== 4) return toast("The code is 4 numbers");
  let room; try { room = await fb("GET", liveUrl(code)); } catch (e) { return fbErr(e); }
  if (!room || !room.host || Date.now() - (room.host.at || 0) > 60000) return toast("That game isn't live right now");
  stopWatch();
  const ov = document.createElement("div"); ov.id = "watchov"; ov.className = "watchov";
  ov.innerHTML = `<video id="watchv" playsinline autoplay muted></video><div class="w-top"><button class="x" data-act="watchClose">✕</button><span class="w-live">LIVE</span><span class="w-title">${esc(room.title || "")}</span></div>
    <div class="w-msg" id="wMsg">Connecting...</div><button class="w-sound" id="wSound" data-act="watchSound">Tap for sound</button>`;
  document.body.appendChild(ov); document.body.classList.add("noscroll");
  const pc = new RTCPeerConnection(ICE), v = ov.querySelector("video"), msg = t => { const m = document.getElementById("wMsg"); if (m) { m.textContent = t; m.style.display = t ? "" : "none"; } };
  Object.assign(W, { pc, code, vid: uid() });
  pc.addTransceiver("video", { direction: "recvonly" }); pc.addTransceiver("audio", { direction: "recvonly" });
  const ms = new MediaStream(); v.srcObject = ms;
  pc.ontrack = e => { ms.addTrack(e.track); v.play().catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") msg("");
    if (pc.connectionState === "failed") msg("Couldn't connect. Some networks block live video between phones. Try the same Wi-Fi, or another network.");
    if (pc.connectionState === "disconnected" || pc.connectionState === "closed") msg("The stream ended");
  };
  await pc.setLocalDescription(await pc.createOffer()); await iceDone(pc);
  try { await fb("PUT", liveUrl(code, "/viewers/" + W.vid), { at: Date.now(), offer: pc.localDescription.sdp }); } catch (e) { return fbErr(e); }
  W.es = listen(liveUrl(code, "/viewers/" + W.vid), async (t, m) => {
    const d = m.path === "/" ? m.data : { [m.path.slice(1)]: m.data };
    if (!d) { if (pc.remoteDescription) { msg("The stream ended"); try { pc.close(); } catch (e) {} } return; }
    if (d.full) { msg("Two screens are already watching. Try again later."); return; }
    if (d.answer && !pc.remoteDescription) { try { await pc.setRemoteDescription({ type: "answer", sdp: d.answer }); } catch (e) { msg("Couldn't connect"); } }
  });
  setTimeout(() => { if (W.pc === pc && pc.connectionState !== "connected" && !pc.remoteDescription) msg("The camera phone isn't answering. Check the code."); }, 15000);
}
function stopWatch() {
  W.es?.close(); try { W.pc?.close(); } catch (e) {}
  if (W.code && W.vid) fb("DELETE", liveUrl(W.code, "/viewers/" + W.vid)).catch(() => {});
  Object.assign(W, { pc: null, es: null, code: null, vid: null });
  document.getElementById("watchov")?.remove(); document.body.classList.remove("noscroll");
}

Object.assign(ACT, {
  liveToggle: (el, g) => { if (LIVE.code) { if (confirm("Stop the live stream?")) stopLive(); } else goLive(g); },
  watchHome: () => go("#/watch"),
  watchBack: () => { stopWatch(); go("#/"); },
  watchGo: () => watch(document.getElementById("watchCode")?.value),
  watchClose: () => stopWatch(),
  watchSound: () => { const v = document.getElementById("watchv"); if (v) { v.muted = false; v.play().catch(() => {}); } document.getElementById("wSound")?.remove(); },
});

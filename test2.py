import subprocess, time, os, sys
from playwright.sync_api import sync_playwright
ROOT = "/home/node/.openclaw/workspace/scorebug"
OUT = "/home/node/.openclaw/workspace/local/sb2-"
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = "http://127.0.0.1:8765/index.html"
LOGOS = {
 "storm": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="300" height="300"><path d="M50 4 L90 16 V48 C90 72 72 88 50 96 C28 88 10 72 10 48 V16 Z" fill="#f2b632"/><path d="M50 12 L83 22 V48 C83 68 68 81 50 88 C32 81 17 68 17 48 V22 Z" fill="#0f2a52"/><path d="M56 20 L34 54 H49 L42 82 L68 44 H53 L60 20 Z" fill="#f2b632"/></svg>',
 "wolves": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="300" height="300"><circle cx="50" cy="50" r="46" fill="#c9ccd1"/><circle cx="50" cy="50" r="39" fill="#7a1f2b"/><path d="M22 32 H34 L41 60 L50 36 L59 60 L66 32 H78 L64 72 H55 L50 58 L45 72 H36 Z" fill="#fff"/></svg>',
}
errs = []
try:
  with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, permissions=["camera", "microphone"])
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append("console: " + m.text))
    for name, svg in LOGOS.items():
        pg.set_content(f"<body style='margin:0;background:transparent'>{svg}</body>")
        pg.locator("svg").screenshot(path=f"/tmp/{name}.png", omit_background=True)
    pg.goto(URL); pg.wait_for_timeout(800)
    def make_team(logo, name, abbr, players):
        pg.click("text=+ New team"); pg.wait_for_timeout(300)
        pg.set_input_files("input[data-change=logoFile]", logo); pg.wait_for_timeout(700)
        pg.fill("input[data-input=tName]", name); pg.fill("input[data-input=tAbbr]", abbr)
        for num, nm, pos in players:
            pg.fill("#pNum", num); pg.fill("#pName", nm); pg.fill("#pPos", pos); pg.click("button[data-act=addPlayer]"); pg.wait_for_timeout(100)
        pg.screenshot(path=OUT + f"team-{abbr}.png", full_page=True)
        pg.click("button[data-act=saveTeam]"); pg.wait_for_timeout(400)
    make_team("/tmp/storm.png", "Storm", "STM", [("12", "Trey Howard", "QB"), ("7", "Jay Ruiz", "WR"), ("22", "Max Bell", "RB"), ("9", "Kade Long", "K")])
    make_team("/tmp/wolves.png", "Wolves", "WLV", [("3", "Eli Grant", "QB"), ("55", "Owen Pike", "LB"), ("24", "Sam Ortiz", "CB")])
    pg.goto(URL + "#/"); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + "home-teams.png", full_page=True)
    pg.click("text=+ New game"); pg.wait_for_timeout(700)
    pg.screenshot(path=OUT + "newgame.png", full_page=True)
    pg.click("button[data-act=createGame]"); pg.wait_for_timeout(600)
    # play: Storm pass 12 -> 7 for 8 yds
    def play(kind, steps):
        pg.click(f"#liveCtl button[data-act=play][data-v={kind}]"); pg.wait_for_timeout(150)
        for s in steps:
            if s.startswith("yds:"): pg.fill("#ydIn", s[4:])
            else: pg.click(f"#sheet {s}")
            pg.wait_for_timeout(80)
        pg.click("#sheet button[data-act=savePlay]"); pg.wait_for_timeout(200)
    play("pass", ["[data-pk=passer] button:has-text('#12')", "[data-pk=target] button:has-text('#7')", "yds:8"])
    play("run", ["[data-pk=runner] button:has-text('#22')", "yds:4"])
    play("pass", ["[data-pk=passer] button:has-text('#12')", "[data-pk=target] button:has-text('#7')", "yds:31", "button:has-text('Touchdown')"])
    pg.wait_for_timeout(900)
    pg.screenshot(path=OUT + "live-td.png")
    pg.locator("#prev").screenshot(path=OUT + "bug-td-banner.png")
    play("kick", ["button:has-text('Extra point')", "[data-pk=kicker] button:has-text('#9')"])
    play("defense", ["button:has-text('Sack')", "[data-pk=defender] button:has-text('#22')", "yds:6"])
    play("penalty", ["yds:5"])
    pg.wait_for_timeout(4500)
    print("dd state:", pg.evaluate("JSON.stringify(currentGame().s)"))
    pg.locator("#prev").screenshot(path=OUT + "bug-prime.png")
    pg.screenshot(path=OUT + "live-full.png", full_page=True)
    gid = pg.evaluate("currentGame().id")
    pg.goto(URL + f"#/game/{gid}/stats"); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + "stats.png", full_page=True)
    pg.goto(URL + f"#/game/{gid}/setup"); pg.wait_for_timeout(700)
    pg.screenshot(path=OUT + "setup.png", full_page=True)
    for st in ["night", "clean"]:
        pg.click(f"button[data-act=gStyle][data-v={st}]"); pg.wait_for_timeout(300)
        pg.goto(URL + f"#/game/{gid}/live"); pg.wait_for_timeout(600)
        pg.locator("#prev").screenshot(path=OUT + f"bug-{st}.png")
        pg.goto(URL + f"#/game/{gid}/setup"); pg.wait_for_timeout(400)
    # record mode, iPhone landscape
    pg.set_viewport_size({"width": 844, "height": 390})
    pg.goto(URL + f"#/game/{gid}/record"); pg.wait_for_timeout(400)
    pg.click("button[data-act=openCam]"); pg.wait_for_timeout(2000)
    pg.click("#recBtn"); pg.wait_for_timeout(2500)
    pg.click("#recCtl button[data-act=pts][data-side=home][data-v='3']"); pg.wait_for_timeout(700)
    pg.screenshot(path=OUT + "record.png")
    pg.click("#recBtn"); pg.wait_for_timeout(1500)
    print("save dialog:", pg.locator(".savedlg").count(), pg.evaluate("document.querySelector('.savedlg') && document.querySelector('.savedlg')._file ? [document.querySelector('.savedlg')._file.name, document.querySelector('.savedlg')._file.size] : null"))
    pg.screenshot(path=OUT + "saved.png")
    print("errors:", errs)
    b.close()
finally:
    srv.terminate()

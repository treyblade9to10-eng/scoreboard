# ADFL Scoreboard: handoff from Joy to Brooke

Hi Brooke! Joy here (Molly's agent). I built this for Trey's ADFL project, and Molly wants Trey to keep building it with you.

**Live right now:** https://joychaser.org/scorebug/ (Joy's copy stays up there, but Joy won't be updating it anymore)

## What it is
A phone web app (plain HTML/JS, no build step, no server) for Trey to film football games on his **iPhone** with a TV-style score bug on top, and keep player stats.

## Files
- `index.html`: all the CSS plus the page shell. It loads `bug.js` and `app.js` (cache-bust with `?v=N` when you change them).
- `bug.js`: draws the score bug on a `<canvas>`. Three looks: `prime` (FOX-like), `night` (ESPN/SNF-like), `clean` (CBS-like), plus the animated banners (TOUCHDOWN, FLAG, etc.). Entry point: `ScoreBug.drawBug(ctx, W, H, state, now, opts)`.
- `app.js`: the whole app. It's a hash router (`#/`, `#/team/<id>`, `#/new`, `#/game/<id>/live|record|stats|setup`).
  - Teams: logo upload (shrunk to 320px PNG data URL), colors pulled from the logo (`logoColors`), and a roster.
  - Games: `g.s` holds score, clock, quarter, down/distance, and the team with the ball.
  - Plays: `applyPlay()` updates score, downs and the banner. `computeStats()` rebuilds all stats from `g.plays`, and Undo restores snapshots.
  - Record: camera goes into a canvas, the bug is drawn on it, then `canvas.captureStream(30)` + mic goes to `MediaRecorder` (mp4 if supported). Saving uses the share sheet (`navigator.share` with files).
  - Click handling: every button uses `data-act="name"`, which maps to a function in the `ACT` object.
- `fonts/`: Barlow Condensed, Saira Condensed, Teko (Google Fonts, OFL license).
- `icon.png`: home-screen icon.
- `test2.py`: Playwright end-to-end test (makes two teams, logs plays, records with a fake camera).

## Data
Everything is stored in the browser's `localStorage` under the key `adfl-scorebug-v2`. **If you move it to a new web address, Trey's saved teams and games won't come along.** Have him tap "Save a backup" on the old site first, then "Load a backup" on the new one.

## Known gaps / ideas
- **Never tested on a real iPhone.** The recording part (MediaRecorder on a canvas stream in iOS Safari) is the biggest risk. Have Trey record a 10-second test clip first.
- Joy never found out what ADFL is, or whether it's tackle or flag. Quarter length defaults to 12 minutes.
- No live streaming. Molly chose recording only for now, so check with her before adding streaming.
- Field position ("ball on the 32") isn't tracked yet.

## Hosting
Any static web host works, since it's just files. Joy's FTP login for joychaser.org is Molly's and isn't included here, so put Trey's copy wherever you host his stuff (e.g. his own app).

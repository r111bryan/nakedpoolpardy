# Jeopardy Party — multiplayer with buzzers

A Node.js app with a host screen (the board) and a player screen (buzzers), synced live over WebSocket. Can run locally on your own WiFi, or be deployed so friends anywhere can join.

## Playing over WiFi only (no deployment needed)

1. Install [Node.js](https://nodejs.org) if you don't have it.
2. In this folder, run `npm install`, then `npm start`.
3. The terminal prints a Host screen link (open it yourself) and a lobby code. Everyone else needs to be on the same WiFi and go to `http://<your-computer's-IP>:3000/player.html`.

This is the easiest way to test things out, but only works for people in the same building as you.

## Playing with friends anywhere (deploy it online)

To let out-of-state friends join, the server needs to run somewhere always-on with a public address, instead of on your laptop. **Render** has a free tier that works well for this and doesn't require much technical setup.

### 1. Put the code on GitHub
Render deploys from a GitHub repository.
1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Create a new repository (e.g. `jeopardy-party`), and upload this entire folder to it — GitHub's website lets you drag-and-drop files directly if you'd rather not use git commands.

### 2. Deploy on Render
1. Create a free account at [render.com](https://render.com) and connect your GitHub account.
2. Click **New → Web Service**, and pick the repo you just created.
3. Render should auto-detect Node — confirm these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Click **Create Web Service**. After a minute or two, Render gives you a public URL like `https://jeopardy-party-xxxx.onrender.com`.
5. Open `https://jeopardy-party-xxxx.onrender.com/host.html` yourself to run the game, and send friends `https://jeopardy-party-xxxx.onrender.com/player.html` with the lobby code shown on your host screen (there's a "Copy Player Link" button).

**Good to know about the free tier:** Render spins the service down after ~15 minutes with no visitors, so if nobody's visited in a while, the first person to open a link that day might see a ~30 second delay while it wakes up. Once it's awake and people are connected, it stays up fine for the whole game.

Railway (railway.app) and Fly.io (fly.io) are similar alternatives if you want other options — same idea: connect a GitHub repo, it runs `npm install && npm start`, and gives you a public URL.

## Playing

- **Edit Mode** (top-left, host screen only) lets you rename categories/teams, edit questions and answers, upload an image/GIF/video per question, and set up Daily Doubles — all before or between rounds.
- **Round Robin vs Free-for-All** (top bar): choose whether teams take turns having one designated buzzer-holder each round, or anyone on the team can buzz in.
- Click a question to open it, read it aloud, then click **Start Buzzing** to unlock players' phones. The first buzz locks everyone else out instantly. Judge Correct/Wrong — a wrong answer excludes that team and lets you reopen buzzing for the rest.
- **Daily Double**: mark questions with a ✓ in the Daily Double panel, then Shuffle to secretly place one (or more). No buzzing needed — you just pick the wagering team and amount.

## Notes

- One game/lobby runs per server instance — restarting the server resets everything and issues a fresh lobby code, so avoid redeploying mid-game.
- Anyone with the player link and lobby code can join — treat the code like a room key. There's no login system.
- If players can't connect over WiFi, make sure their phone is on the **same WiFi network** as the host computer, and that your computer's firewall allows incoming connections on port 3000.

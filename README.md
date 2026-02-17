# HEIST — Online Co-Op Terminal Heist Game

A 2-player co-op heist game played in the browser. One player is the **Thief** (sneaking through a building), the other is the **Drone Operator** (hacking security systems from above). Communicate, coordinate, and pull off the heist.

## Quick Start (Local)

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs (or two different devices on the same network).

1. **Tab 1**: Click "Host Game" → get a 4-letter room code
2. **Tab 2**: Click "Join Game" → enter the room code
3. Play!

## How to Play

### Thief (Host)
- **WASD** — Move through the building
- **E (hold)** — Pick physical locks (3 seconds)
- Collect all primary loot (*), then reach the exit (>)
- Limited vision (4 tiles) — rely on the Drone for guidance

### Drone Operator (Guest)
- **Arrow Keys** — Move cursor over the full map
- **Space** — Hack target (opens electronic doors, disables cameras, freezes guards, cancels alarms)
- Each hack costs 25% battery — recharge by hovering on charging pads (^)
- Guide the Thief through chat

### Chat
- Click the chat bar at the bottom and type messages to coordinate

## Deploy to Railway (Free Tier)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) and sign in with GitHub
3. Click **"New Project"** → **"Deploy from GitHub Repo"**
4. Select your repo
5. Railway auto-detects Node.js. No config needed — it runs `npm start` by default
6. Once deployed, click **"Generate Domain"** in Settings to get a public URL
7. Share the URL with your co-op partner!

**Environment variables**: None required. The server uses `process.env.PORT` which Railway sets automatically.

## Deploy to Render (Free Tier)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) and sign in with GitHub
3. Click **"New"** → **"Web Service"**
4. Connect your repo
5. Configure:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Click **"Create Web Service"**
7. Render gives you a `.onrender.com` URL — share it with your partner

> **Note**: Render free tier spins down after inactivity. First load may take ~30 seconds.

## Deploy to Fly.io (Free Tier)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# From the project directory:
fly launch    # follow prompts, pick a region
fly deploy
```

## Project Structure

```
├── server.js          # Node.js game server (Express + WebSocket)
├── public/
│   └── index.html     # Client (Canvas rendering, WebSocket client, UI)
├── package.json
├── index.html          # Original local co-op version (standalone, no server)
└── README.md
```

## Architecture

- **Server** (`server.js`): Owns all game state. Runs game loop at 100ms ticks. Handles rooms, input processing, and broadcasts state to both clients.
- **Client** (`public/index.html`): Purely a thin client. Sends inputs, receives state, renders, plays sounds.
- **Rooms**: Each game is a room with a 4-letter code. Host = Thief, Guest = Drone.
- **Reconnection**: If a player disconnects, the game pauses. They can reconnect and resume.
- **Chat**: Real-time text chat relayed through the server.

All game logic runs server-side in pure functions that take state and return new state — ready for scaling to multiple rooms or adding spectator mode.

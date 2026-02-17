// ============================================================
// HEIST — Multiplayer Server (Node.js + Express + ws)
// ============================================================
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ROOM MANAGEMENT
// ============================================================
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function generatePlayerId() {
  return crypto.randomBytes(8).toString('hex');
}

// ============================================================
// MAP GENERATOR (server-side, identical logic to original)
// ============================================================
function generateLevel(level) {
  const W = 40, H = 30;
  const map = [];
  for (let y = 0; y < H; y++) {
    map[y] = [];
    for (let x = 0; x < W; x++) map[y][x] = '#';
  }

  const rooms_ = [];
  const minRooms = 6 + level;
  const maxRooms = 8 + level;
  const targetRooms = minRooms + Math.floor(Math.random() * (maxRooms - minRooms + 1));

  for (let attempt = 0; attempt < 300 && rooms_.length < targetRooms; attempt++) {
    const rw = 4 + Math.floor(Math.random() * 5);
    const rh = 3 + Math.floor(Math.random() * 4);
    const rx = 1 + Math.floor(Math.random() * (W - rw - 2));
    const ry = 1 + Math.floor(Math.random() * (H - rh - 2));
    let overlap = false;
    for (const r of rooms_) {
      if (rx - 1 < r.x + r.w && rx + rw + 1 > r.x && ry - 1 < r.y + r.h && ry + rh + 1 > r.y) {
        overlap = true; break;
      }
    }
    if (overlap) continue;
    rooms_.push({ x: rx, y: ry, w: rw, h: rh });
    for (let dy = 0; dy < rh; dy++)
      for (let dx = 0; dx < rw; dx++)
        map[ry + dy][rx + dx] = '.';
  }

  // Connect rooms
  const connected = [0];
  const unconnected = rooms_.map((_, i) => i).slice(1);
  while (unconnected.length > 0) {
    let bestDist = Infinity, bestC = 0, bestU = 0;
    for (const ci of connected) {
      for (const ui of unconnected) {
        const cx = rooms_[ci].x + Math.floor(rooms_[ci].w / 2);
        const cy = rooms_[ci].y + Math.floor(rooms_[ci].h / 2);
        const ux = rooms_[ui].x + Math.floor(rooms_[ui].w / 2);
        const uy = rooms_[ui].y + Math.floor(rooms_[ui].h / 2);
        const d = Math.abs(cx - ux) + Math.abs(cy - uy);
        if (d < bestDist) { bestDist = d; bestC = ci; bestU = ui; }
      }
    }
    const r1 = rooms_[bestC], r2 = rooms_[bestU];
    let x1 = r1.x + Math.floor(r1.w / 2), y1 = r1.y + Math.floor(r1.h / 2);
    let x2 = r2.x + Math.floor(r2.w / 2), y2 = r2.y + Math.floor(r2.h / 2);
    let cx = x1, cy = y1;
    while (cx !== x2) { if (map[cy][cx] === '#') map[cy][cx] = '.'; cx += cx < x2 ? 1 : -1; }
    while (cy !== y2) { if (map[cy][cx] === '#') map[cy][cx] = '.'; cy += cy < y2 ? 1 : -1; }
    connected.push(bestU);
    unconnected.splice(unconnected.indexOf(bestU), 1);
  }

  // Place doors
  const doors = [];
  const eDoorPositions = [];
  const pDoorPositions = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (map[y][x] !== '.') continue;
      const hWall = map[y][x-1] === '#' && map[y][x+1] === '#' && map[y-1][x] === '.' && map[y+1][x] === '.';
      const vWall = map[y-1][x] === '#' && map[y+1][x] === '#' && map[y][x-1] === '.' && map[y][x+1] === '.';
      if ((hWall || vWall) && Math.random() < 0.35) {
        if (Math.random() < 0.5) eDoorPositions.push({ x, y });
        else pDoorPositions.push({ x, y });
      }
    }
  }
  const maxEDoors = 3 + level;
  const maxPDoors = 2 + level;
  const eDoors = eDoorPositions.sort(() => Math.random() - 0.5).slice(0, maxEDoors);
  const pDoors = pDoorPositions.sort(() => Math.random() - 0.5).slice(0, maxPDoors);
  eDoors.forEach(d => { map[d.y][d.x] = 'D'; doors.push({ x: d.x, y: d.y, type: 'electronic', open: false }); });
  pDoors.forEach(d => { map[d.y][d.x] = 'L'; doors.push({ x: d.x, y: d.y, type: 'physical', open: false }); });

  function getFloorTiles() {
    const tiles = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (map[y][x] === '.') tiles.push({ x, y });
    return tiles;
  }
  function pickAndRemove(tiles) {
    const idx = Math.floor(Math.random() * tiles.length);
    return tiles.splice(idx, 1)[0];
  }
  function tileInRoom(tile, room) {
    return tile.x >= room.x && tile.x < room.x + room.w && tile.y >= room.y && tile.y < room.y + room.h;
  }

  const floors = getFloorTiles();

  // Thief in first room
  const thiefRoom = rooms_[0];
  let thiefPos = null;
  for (let i = floors.length - 1; i >= 0; i--) {
    if (tileInRoom(floors[i], thiefRoom)) { thiefPos = floors.splice(i, 1)[0]; break; }
  }
  if (!thiefPos) thiefPos = pickAndRemove(floors);

  // Exit in last room
  const exitRoom = rooms_[rooms_.length - 1];
  let exitPos = null;
  for (let i = floors.length - 1; i >= 0; i--) {
    if (tileInRoom(floors[i], exitRoom)) { exitPos = floors.splice(i, 1)[0]; break; }
  }
  if (!exitPos) exitPos = pickAndRemove(floors);
  map[exitPos.y][exitPos.x] = '>';

  // Loot
  const loot = [];
  for (let i = 0; i < 3; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = '*'; loot.push({ x: p.x, y: p.y, primary: true, collected: false }); }
  }
  const bonusCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < bonusCount; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = '*'; loot.push({ x: p.x, y: p.y, primary: false, collected: false }); }
  }

  // Charging pads
  const chargingPads = [];
  for (let i = 0; i < 2; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = '^'; chargingPads.push({ x: p.x, y: p.y }); }
  }

  // Alarm panel
  const alarmPanels = [];
  const ap = pickAndRemove(floors);
  if (ap) { map[ap.y][ap.x] = 'A'; alarmPanels.push({ x: ap.x, y: ap.y }); }

  // Cameras
  const cameras = [];
  const camCount = 2 + level;
  for (let i = 0; i < camCount; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = 'C'; cameras.push({ x: p.x, y: p.y, active: true }); }
  }

  // Guards
  const guards = [];
  const guardCount = 3 + Math.min(level, 2);
  for (let i = 0; i < guardCount; i++) {
    const roomIdx = (i + 1) % rooms_.length;
    const room = rooms_[roomIdx];
    const route = [];
    const gx = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
    const gy = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
    route.push({ x: gx, y: gy });
    const waypointCount = 2 + Math.floor(Math.random() * 3);
    for (let w = 0; w < waypointCount; w++) {
      const wx = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
      const wy = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
      route.push({ x: wx, y: wy });
    }
    guards.push({
      x: gx, y: gy, route, routeIdx: 0, dir: 0,
      frozen: false, frozenTimer: 0,
      speed: Math.max(300, 500 - level * 50), moveTimer: 0,
    });
  }

  return { width: W, height: H, map, rooms: rooms_, doors, loot, chargingPads, alarmPanels, cameras, guards, thiefStart: thiefPos, exitPos };
}

// ============================================================
// GAME STATE FACTORY
// ============================================================
function createGameState(level) {
  const ld = generateLevel(level);
  return {
    level,
    map: ld.map,
    mapWidth: ld.width,
    mapHeight: ld.height,
    thief: {
      x: ld.thiefStart.x, y: ld.thiefStart.y,
      hp: 3, maxHp: 3, loot: 0, totalLoot: 0,
      picking: false, pickTimer: 0, pickTarget: null,
      spotted: false, invulnTimer: 0, action: 'Idle',
    },
    drone: {
      x: Math.floor(ld.width / 2), y: Math.floor(ld.height / 2),
      battery: 100, maxBattery: 100, hacks: 0,
      charging: false, chargeTimer: 0,
    },
    guards: ld.guards,
    doors: ld.doors,
    loot: ld.loot,
    cameras: ld.cameras,
    chargingPads: ld.chargingPads,
    alarmPanels: ld.alarmPanels,
    exitPos: ld.exitPos,
    alarmActive: false,
    alarmTimer: 0,
    primaryLootTotal: ld.loot.filter(l => l.primary).length,
    primaryLootCollected: 0,
    bonusLootCollected: 0,
    exitOpen: false,
    gameOver: false,
    gameWon: false,
    timer: 0,
    score: 0,
    alertTriggered: false,
    // Sound events queue — sent to clients once then cleared
    sounds: [],
  };
}

// ============================================================
// SERVER-SIDE GAME LOGIC
// ============================================================
function isWalkable(state, x, y) {
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return false;
  const tile = state.map[y][x];
  if (tile === '#') return false;
  if (tile === 'D' || tile === 'L') {
    const door = state.doors.find(d => d.x === x && d.y === y);
    if (door && !door.open) return false;
  }
  return true;
}

function moveThief(state, dx, dy) {
  if (state.gameOver || state.gameWon || state.thief.picking) return;
  const nx = state.thief.x + dx;
  const ny = state.thief.y + dy;
  if (!isWalkable(state, nx, ny)) return;
  state.thief.x = nx;
  state.thief.y = ny;
  state.sounds.push('move');

  const lootItem = state.loot.find(l => l.x === nx && l.y === ny && !l.collected);
  if (lootItem) {
    lootItem.collected = true;
    state.thief.loot++;
    state.thief.totalLoot++;
    if (lootItem.primary) state.primaryLootCollected++;
    else state.bonusLootCollected++;
    state.map[ny][nx] = '.';
    state.sounds.push('loot');
    if (state.primaryLootCollected >= state.primaryLootTotal) state.exitOpen = true;
  }

  if (state.map[ny][nx] === '>' && state.exitOpen) {
    state.gameWon = true;
    state.score += state.primaryLootCollected * 1000;
    state.score += state.bonusLootCollected * 500;
    state.score += Math.max(0, 3000 - Math.floor(state.timer / 1000) * 10);
    if (!state.alertTriggered) state.score += 2000;
    state.sounds.push('victory');
  }
}

function startPickLock(state) {
  if (state.gameOver || state.gameWon || state.thief.picking) return;
  const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
  for (const d of dirs) {
    const tx = state.thief.x + d.x;
    const ty = state.thief.y + d.y;
    const door = state.doors.find(dr => dr.x === tx && dr.y === ty && dr.type === 'physical' && !dr.open);
    if (door) {
      state.thief.picking = true;
      state.thief.pickTimer = 3000;
      state.thief.pickTarget = { x: door.x, y: door.y };
      state.thief.action = 'Picking lock...';
      state.sounds.push('lock');
      return;
    }
  }
}

function stopPickLock(state) {
  if (state.thief.picking) {
    state.thief.picking = false;
    state.thief.pickTimer = 0;
    state.thief.pickTarget = null;
    state.thief.action = 'Idle';
  }
}

function updatePickLock(state, dt) {
  if (!state.thief.picking) return;
  state.thief.pickTimer -= dt;
  if (state.thief.pickTimer <= 0) {
    const door = state.doors.find(d => d.x === state.thief.pickTarget.x && d.y === state.thief.pickTarget.y);
    if (door) {
      door.open = true;
      state.map[door.y][door.x] = '.';
    }
    state.thief.picking = false;
    state.thief.pickTarget = null;
    state.thief.action = 'Idle';
    state.sounds.push('doorOpen');
  }
}

function droneHack(state) {
  if (state.gameOver || state.gameWon || state.drone.battery <= 0) return;
  const dx = state.drone.x, dy = state.drone.y;

  const door = state.doors.find(d => d.x === dx && d.y === dy && d.type === 'electronic' && !d.open);
  if (door) {
    door.open = true;
    state.map[dy][dx] = '.';
    state.drone.battery = Math.max(0, state.drone.battery - 25);
    state.drone.hacks++;
    state.sounds.push('hack');
    state.sounds.push('doorOpen');
    return;
  }

  const cam = state.cameras.find(c => c.x === dx && c.y === dy && c.active);
  if (cam) {
    cam.active = false;
    state.map[dy][dx] = '.';
    state.drone.battery = Math.max(0, state.drone.battery - 25);
    state.drone.hacks++;
    state.sounds.push('hack');
    return;
  }

  const guard = state.guards.find(g => g.x === dx && g.y === dy && !g.frozen);
  if (guard) {
    guard.frozen = true;
    guard.frozenTimer = 5000;
    state.drone.battery = Math.max(0, state.drone.battery - 25);
    state.drone.hacks++;
    state.sounds.push('hack');
    return;
  }

  if (state.alarmActive) {
    const panel = state.alarmPanels.find(a => a.x === dx && a.y === dy);
    if (panel) {
      state.alarmActive = false;
      state.alarmTimer = 0;
      state.thief.spotted = false;
      state.drone.battery = Math.max(0, state.drone.battery - 25);
      state.drone.hacks++;
      state.sounds.push('hack');
      return;
    }
  }
}

function updateDroneCharge(state, dt) {
  const pad = state.chargingPads.find(p => p.x === state.drone.x && p.y === state.drone.y);
  if (pad && state.drone.battery < state.drone.maxBattery) {
    state.drone.charging = true;
    state.drone.chargeTimer += dt;
    if (state.drone.chargeTimer >= 3000) {
      state.drone.battery = Math.min(state.drone.maxBattery, state.drone.battery + 25);
      state.drone.chargeTimer = 0;
      state.sounds.push('charge');
    }
  } else {
    state.drone.charging = false;
    state.drone.chargeTimer = 0;
  }
}

function updateGuards(state, dt) {
  for (const guard of state.guards) {
    if (guard.frozen) {
      guard.frozenTimer -= dt;
      if (guard.frozenTimer <= 0) { guard.frozen = false; guard.frozenTimer = 0; }
      continue;
    }
    guard.moveTimer += dt;
    if (guard.moveTimer < guard.speed) continue;
    guard.moveTimer = 0;

    const target = guard.route[guard.routeIdx];
    let moved = false;
    if (guard.x !== target.x || guard.y !== target.y) {
      let gdx = 0, gdy = 0;
      if (Math.abs(target.x - guard.x) > Math.abs(target.y - guard.y)) gdx = target.x > guard.x ? 1 : -1;
      else gdy = target.y > guard.y ? 1 : -1;
      const nx = guard.x + gdx, ny = guard.y + gdy;
      if (isWalkable(state, nx, ny)) {
        guard.x = nx; guard.y = ny;
        if (gdx === 1) guard.dir = 1;
        else if (gdx === -1) guard.dir = 3;
        else if (gdy === -1) guard.dir = 0;
        else if (gdy === 1) guard.dir = 2;
        moved = true;
      }
    }
    if (!moved || (guard.x === target.x && guard.y === target.y)) {
      guard.routeIdx = (guard.routeIdx + 1) % guard.route.length;
    }

    // Vision check
    if (!guard.frozen) {
      const dirVecs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
      const dv = dirVecs[guard.dir];
      let canSee = false;
      for (let i = 1; i <= 3; i++) {
        const vx = guard.x + dv.x * i, vy = guard.y + dv.y * i;
        if (vx < 0 || vx >= state.mapWidth || vy < 0 || vy >= state.mapHeight) break;
        if (state.map[vy][vx] === '#') break;
        if (vx === state.thief.x && vy === state.thief.y) { canSee = true; break; }
      }
      if (guard.x === state.thief.x && guard.y === state.thief.y) canSee = true;

      if (canSee && !state.alarmActive) {
        state.alarmActive = true;
        state.alarmTimer = 10000;
        state.thief.spotted = true;
        state.thief.action = 'SPOTTED!';
        state.alertTriggered = true;
        state.sounds.push('alarm');
      }

      if (guard.x === state.thief.x && guard.y === state.thief.y && state.thief.invulnTimer <= 0) {
        state.thief.hp--;
        state.thief.invulnTimer = 1500;
        state.sounds.push('hit');
        if (state.thief.hp <= 0) {
          state.gameOver = true;
          state.sounds.push('gameOver');
        }
      }
    }
  }

  // Camera checks
  for (const cam of state.cameras) {
    if (!cam.active) continue;
    const dist = Math.abs(cam.x - state.thief.x) + Math.abs(cam.y - state.thief.y);
    if (dist <= 2 && !state.alarmActive) {
      state.alarmActive = true;
      state.alarmTimer = 10000;
      state.thief.spotted = true;
      state.thief.action = 'SPOTTED!';
      state.alertTriggered = true;
      state.sounds.push('alarm');
    }
  }
}

function updateAlarm(state, dt) {
  if (!state.alarmActive) {
    if (state.thief.spotted) { state.thief.spotted = false; state.thief.action = 'Idle'; }
    return;
  }
  state.alarmTimer -= dt;
  if (state.alarmTimer <= 0) {
    state.thief.hp--;
    state.sounds.push('hit');
    state.alarmActive = false;
    state.alarmTimer = 0;
    if (state.thief.hp <= 0) {
      state.gameOver = true;
      state.sounds.push('gameOver');
    } else {
      state.thief.spotted = false;
      state.thief.action = 'Idle';
    }
  }
}

function updateInvuln(state, dt) {
  if (state.thief.invulnTimer > 0) state.thief.invulnTimer -= dt;
}

// ============================================================
// ROOM GAME LOOP
// ============================================================
function tickRoom(room, dt) {
  const state = room.gameState;
  if (!state || state.gameOver || state.gameWon || room.paused) return;

  state.timer += dt;
  updatePickLock(state, dt);
  updateGuards(state, dt);
  updateAlarm(state, dt);
  updateDroneCharge(state, dt);
  updateInvuln(state, dt);

  // Periodic alarm sound
  if (state.alarmActive && Math.floor(state.timer / 500) % 2 === 0 && Math.floor((state.timer - dt) / 500) % 2 !== 0) {
    state.sounds.push('alarm');
  }
}

function broadcastState(room) {
  const state = room.gameState;
  if (!state) return;

  // Strip patrol routes from broadcast to save bandwidth
  const guardsBroadcast = state.guards.map(g => ({
    x: g.x, y: g.y, dir: g.dir, frozen: g.frozen, frozenTimer: g.frozenTimer,
  }));

  const payload = {
    type: 'state',
    level: state.level,
    map: state.map,
    mapWidth: state.mapWidth,
    mapHeight: state.mapHeight,
    thief: {
      x: state.thief.x, y: state.thief.y,
      hp: state.thief.hp, maxHp: state.thief.maxHp,
      loot: state.thief.loot, totalLoot: state.thief.totalLoot,
      picking: state.thief.picking, pickTimer: state.thief.pickTimer,
      spotted: state.thief.spotted, invulnTimer: state.thief.invulnTimer,
      action: state.thief.action,
    },
    drone: {
      x: state.drone.x, y: state.drone.y,
      battery: state.drone.battery, maxBattery: state.drone.maxBattery,
      hacks: state.drone.hacks, charging: state.drone.charging,
      chargeTimer: state.drone.chargeTimer,
    },
    guards: guardsBroadcast,
    doors: state.doors,
    loot: state.loot,
    cameras: state.cameras,
    chargingPads: state.chargingPads,
    alarmPanels: state.alarmPanels,
    exitPos: state.exitPos,
    alarmActive: state.alarmActive,
    alarmTimer: state.alarmTimer,
    primaryLootTotal: state.primaryLootTotal,
    primaryLootCollected: state.primaryLootCollected,
    bonusLootCollected: state.bonusLootCollected,
    exitOpen: state.exitOpen,
    gameOver: state.gameOver,
    gameWon: state.gameWon,
    timer: state.timer,
    score: state.score,
    alertTriggered: state.alertTriggered,
    sounds: state.sounds.slice(),
    paused: room.paused,
  };

  // Clear sounds after broadcasting
  state.sounds = [];

  const msg = JSON.stringify(payload);
  for (const p of Object.values(room.players)) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(msg); } catch(e) {}
    }
  }
}

// ============================================================
// WEBSOCKET HANDLING
// ============================================================
wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    switch(msg.type) {
      case 'host': {
        roomCode = generateRoomCode();
        playerId = generatePlayerId();
        role = 'thief';
        const room = {
          code: roomCode,
          players: {
            thief: { ws, id: playerId, connected: true },
          },
          gameState: null,
          interval: null,
          paused: false,
          level: 1,
          totalScore: 0,
        };
        rooms.set(roomCode, room);
        ws.send(JSON.stringify({ type: 'hosted', code: roomCode, role: 'thief', playerId }));
        console.log(`Room ${roomCode} created by ${playerId}`);
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.players.drone && room.players.drone.connected) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        roomCode = code;
        playerId = generatePlayerId();
        role = 'drone';

        if (room.players.drone) {
          // Reconnecting drone slot
          room.players.drone.ws = ws;
          room.players.drone.id = playerId;
          room.players.drone.connected = true;
        } else {
          room.players.drone = { ws, id: playerId, connected: true };
        }

        ws.send(JSON.stringify({ type: 'joined', code: roomCode, role: 'drone', playerId }));

        // Notify host
        if (room.players.thief && room.players.thief.ws && room.players.thief.ws.readyState === 1) {
          room.players.thief.ws.send(JSON.stringify({ type: 'partnerJoined' }));
        }

        // Start the game
        if (!room.gameState) {
          room.gameState = createGameState(room.level);
          room.interval = setInterval(() => {
            tickRoom(room, 100);
            broadcastState(room);
          }, 100);
        } else {
          // Unpause on reconnect
          room.paused = false;
          if (room.players.thief && room.players.thief.ws && room.players.thief.ws.readyState === 1) {
            room.players.thief.ws.send(JSON.stringify({ type: 'partnerReconnected' }));
          }
        }

        console.log(`Player ${playerId} joined room ${roomCode} as drone`);
        break;
      }

      case 'reconnect': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        const rRole = msg.role;
        if (!rRole || !room.players[rRole]) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid reconnect' }));
          return;
        }
        roomCode = code;
        playerId = generatePlayerId();
        role = rRole;
        room.players[rRole].ws = ws;
        room.players[rRole].id = playerId;
        room.players[rRole].connected = true;
        room.paused = false;

        ws.send(JSON.stringify({ type: 'reconnected', code: roomCode, role, playerId }));

        // Notify partner
        const partnerRole = rRole === 'thief' ? 'drone' : 'thief';
        if (room.players[partnerRole] && room.players[partnerRole].ws && room.players[partnerRole].ws.readyState === 1) {
          room.players[partnerRole].ws.send(JSON.stringify({ type: 'partnerReconnected' }));
        }
        console.log(`Player reconnected to room ${roomCode} as ${rRole}`);
        break;
      }

      case 'input': {
        if (!roomCode || !role) return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || room.paused) return;
        const state = room.gameState;

        if (role === 'thief') {
          switch(msg.action) {
            case 'move': moveThief(state, msg.dx, msg.dy); break;
            case 'pickStart': startPickLock(state); break;
            case 'pickStop': stopPickLock(state); break;
          }
        } else if (role === 'drone') {
          switch(msg.action) {
            case 'move': {
              const nx = state.drone.x + msg.dx;
              const ny = state.drone.y + msg.dy;
              if (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight) {
                state.drone.x = nx;
                state.drone.y = ny;
              }
              break;
            }
            case 'hack': droneHack(state); break;
          }
        }
        break;
      }

      case 'chat': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        const chatMsg = {
          type: 'chat',
          from: role === 'thief' ? 'THIEF' : 'DRONE',
          text: (msg.text || '').slice(0, 200),
        };
        const chatStr = JSON.stringify(chatMsg);
        for (const p of Object.values(room.players)) {
          if (p && p.ws && p.ws.readyState === 1) {
            try { p.ws.send(chatStr); } catch(e) {}
          }
        }
        break;
      }

      case 'nextLevel': {
        if (!roomCode || role !== 'thief') return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || !room.gameState.gameWon) return;
        room.totalScore += room.gameState.score;
        room.level++;
        if (room.level > 3) {
          // Game fully complete — broadcast final win
          for (const p of Object.values(room.players)) {
            if (p && p.ws && p.ws.readyState === 1) {
              try { p.ws.send(JSON.stringify({ type: 'gameComplete', totalScore: room.totalScore })); } catch(e) {}
            }
          }
          // Clean up
          if (room.interval) clearInterval(room.interval);
          rooms.delete(roomCode);
          return;
        }
        room.gameState = createGameState(room.level);
        break;
      }

      case 'retry': {
        if (!roomCode || role !== 'thief') return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || !room.gameState.gameOver) return;
        room.level = 1;
        room.totalScore = 0;
        room.gameState = createGameState(room.level);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.players[role] && room.players[role].id === playerId) {
      room.players[role].connected = false;
      room.paused = true;
      console.log(`Player ${playerId} disconnected from room ${roomCode} (${role})`);

      // Notify partner
      const partnerRole = role === 'thief' ? 'drone' : 'thief';
      if (room.players[partnerRole] && room.players[partnerRole].ws && room.players[partnerRole].ws.readyState === 1) {
        room.players[partnerRole].ws.send(JSON.stringify({ type: 'partnerDisconnected', disconnectedRole: role }));
      }

      // Clean up room after 2 minutes of no one connected
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r) return;
        const anyConnected = Object.values(r.players).some(p => p && p.connected);
        if (!anyConnected) {
          if (r.interval) clearInterval(r.interval);
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} cleaned up (all disconnected)`);
        }
      }, 120000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`HEIST server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

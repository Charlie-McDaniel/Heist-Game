// ============================================================
// HEIST — Multiplayer Server (Node.js + Express + ws)
// v2.0 — Massive Feature Update
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
// BONUS OBJECTIVES
// ============================================================
const OBJECTIVE_TEMPLATES = [
  { id: 'speed_demon', desc: 'Complete in under 90 seconds', check: (s) => s.timer < 90000 },
  { id: 'ghost', desc: 'Never trigger an alarm', check: (s) => !s.alertTriggered },
  { id: 'hacker', desc: 'Hack 3+ systems', check: (s) => s.drone.hacks >= 3 },
  { id: 'collector', desc: 'Collect all bonus loot', check: (s) => s.loot.filter(l => !l.primary).every(l => l.collected) },
  { id: 'efficient', desc: 'Use 50% or less battery', check: (s) => s.drone.battery >= 50 },
  { id: 'untouchable', desc: 'Take no damage', check: (s) => s.thief.hp === s.thief.maxHp },
  { id: 'locksmith', desc: 'Pick 2+ locks', check: (s) => s.thief.locksPicked >= 2 },
  { id: 'freeze_master', desc: 'Freeze 3+ guards', check: (s) => s.guardsHacked >= 3 },
];

function pickObjectives(count) {
  const shuffled = [...OBJECTIVE_TEMPLATES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(o => ({ ...o, completed: false }));
}

// ============================================================
// UPGRADE DEFINITIONS
// ============================================================
const THIEF_UPGRADES = [
  { id: 'hp_up', name: '+1 Max HP', desc: 'Increases max HP by 1', cost: 1000, apply: (s) => { s.thief.maxHp++; s.thief.hp = s.thief.maxHp; } },
  { id: 'vision_up', name: 'Extended Vision', desc: 'Vision radius +1', cost: 800, apply: (s) => { s.thief.visionRadius = (s.thief.visionRadius || 4) + 1; } },
  { id: 'fast_pick', name: 'Fast Lockpick', desc: 'Lock picking 1s faster', cost: 600, apply: (s) => { s.thief.pickSpeed = (s.thief.pickSpeed || 3000) - 1000; } },
  { id: 'extra_noise', name: '+1 Noise Maker', desc: 'Extra noise maker charge', cost: 500, apply: (s) => { s.thief.noiseCharges = (s.thief.noiseCharges || 2) + 1; } },
  { id: 'extra_smoke', name: '+1 Smoke Bomb', desc: 'Extra smoke bomb charge', cost: 700, apply: (s) => { s.thief.smokeCharges = (s.thief.smokeCharges || 1) + 1; } },
  { id: 'sprint_up', name: 'Sprint Duration', desc: 'Sprint lasts 1s longer', cost: 600, apply: (s) => { s.thief.sprintDuration = (s.thief.sprintDuration || 2000) + 1000; } },
];

const DRONE_UPGRADES = [
  { id: 'battery_up', name: '+25 Battery', desc: 'Increases max battery', cost: 800, apply: (s) => { s.drone.maxBattery += 25; s.drone.battery = s.drone.maxBattery; } },
  { id: 'fast_charge', name: 'Fast Charge', desc: 'Charging 1s faster', cost: 600, apply: (s) => { s.drone.chargeSpeed = (s.drone.chargeSpeed || 3000) - 500; } },
  { id: 'long_freeze', name: 'Long Freeze', desc: 'Guards frozen 3s longer', cost: 700, apply: (s) => { s.drone.freezeDuration = (s.drone.freezeDuration || 5000) + 3000; } },
  { id: 'cheap_hack', name: 'Efficient Hacks', desc: 'Hacks cost 5 less battery', cost: 900, apply: (s) => { s.drone.hackCost = Math.max(10, (s.drone.hackCost || 25) - 5); } },
  { id: 'extra_emp', name: '+1 EMP', desc: 'Extra EMP charge', cost: 800, apply: (s) => { s.drone.empCharges = (s.drone.empCharges || 1) + 1; } },
  { id: 'extra_decoy', name: '+1 Decoy', desc: 'Extra decoy charge', cost: 600, apply: (s) => { s.drone.decoyCharges = (s.drone.decoyCharges || 1) + 1; } },
];

// ============================================================
// MAP GENERATOR
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
  const maxRooms = 8 + level * 2;
  const targetRooms = minRooms + Math.floor(Math.random() * (maxRooms - minRooms + 1));

  for (let attempt = 0; attempt < 400 && rooms_.length < targetRooms; attempt++) {
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
    if (p) { map[p.y][p.x] = '$'; loot.push({ x: p.x, y: p.y, primary: false, collected: false }); }
  }

  // Charging pads
  const chargingPads = [];
  for (let i = 0; i < 2; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = '^'; chargingPads.push({ x: p.x, y: p.y }); }
  }

  // Alarm panels — more on higher levels
  const alarmPanels = [];
  const panelCount = 1 + Math.floor(level / 2);
  for (let i = 0; i < panelCount; i++) {
    const ap = pickAndRemove(floors);
    if (ap) { map[ap.y][ap.x] = 'A'; alarmPanels.push({ x: ap.x, y: ap.y }); }
  }

  // Cameras
  const cameras = [];
  const camCount = 2 + level;
  for (let i = 0; i < camCount; i++) {
    const p = pickAndRemove(floors);
    if (p) { map[p.y][p.x] = 'C'; cameras.push({ x: p.x, y: p.y, active: true, dir: Math.floor(Math.random() * 4) }); }
  }

  // Laser grids — appear from level 2+
  const lasers = [];
  if (level >= 2) {
    const laserCount = 1 + level;
    for (let i = 0; i < laserCount; i++) {
      const p = pickAndRemove(floors);
      if (p) {
        map[p.y][p.x] = 'Z';
        // Determine orientation: horizontal or vertical based on neighbors
        const horizontal = map[p.y][p.x - 1] === '#' || map[p.y][p.x + 1] === '#';
        lasers.push({
          x: p.x, y: p.y,
          active: true,
          period: 3000 + Math.floor(Math.random() * 2000), // 3-5 second cycle
          timer: Math.floor(Math.random() * 3000), // random start offset
          horizontal,
        });
      }
    }
  }

  // Tripwires — appear from level 2+
  const tripwires = [];
  if (level >= 2) {
    const tripCount = Math.min(level, 3);
    for (let i = 0; i < tripCount; i++) {
      const p = pickAndRemove(floors);
      if (p) {
        map[p.y][p.x] = 'T';
        tripwires.push({ x: p.x, y: p.y, triggered: false });
      }
    }
  }

  // Safes — appear from level 3+ (require both players to open)
  const safes = [];
  if (level >= 3) {
    const safeCount = Math.min(level - 1, 3);
    for (let i = 0; i < safeCount; i++) {
      const p = pickAndRemove(floors);
      if (p) {
        map[p.y][p.x] = 'S';
        safes.push({ x: p.x, y: p.y, open: false, lootValue: 1500 });
      }
    }
  }

  // Guards with alert levels
  const guards = [];
  const guardCount = 3 + Math.min(level, 3);
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
      speed: Math.max(250, 500 - level * 50), moveTimer: 0,
      alertLevel: 0, // 0=patrol, 1=suspicious, 2=alert
      alertTimer: 0,
      lastKnownThief: null,
      investigateTarget: null,
    });
  }

  return {
    width: W, height: H, map, rooms: rooms_, doors, loot, chargingPads, alarmPanels,
    cameras, guards, thiefStart: thiefPos, exitPos, lasers, tripwires, safes,
  };
}

// ============================================================
// GAME STATE FACTORY
// ============================================================
function createGameState(level, prevState) {
  const ld = generateLevel(level);
  const state = {
    level,
    map: ld.map,
    mapWidth: ld.width,
    mapHeight: ld.height,
    thief: {
      x: ld.thiefStart.x, y: ld.thiefStart.y,
      hp: prevState ? prevState.thief.maxHp : 3,
      maxHp: prevState ? prevState.thief.maxHp : 3,
      loot: 0, totalLoot: 0,
      picking: false, pickTimer: 0, pickTarget: null,
      pickSpeed: prevState ? (prevState.thief.pickSpeed || 3000) : 3000,
      spotted: false, invulnTimer: 0, action: 'Idle',
      visionRadius: prevState ? (prevState.thief.visionRadius || 4) : 4,
      // Abilities
      sprinting: false, sprintTimer: 0,
      sprintDuration: prevState ? (prevState.thief.sprintDuration || 2000) : 2000,
      sprintCooldown: 0, sprintCooldownMax: 10000,
      noiseCharges: prevState ? (prevState.thief.noiseCharges || 2) : 2,
      smokeCharges: prevState ? (prevState.thief.smokeCharges || 1) : 1,
      locksPicked: 0,
    },
    drone: {
      x: Math.floor(ld.width / 2), y: Math.floor(ld.height / 2),
      battery: prevState ? prevState.drone.maxBattery : 100,
      maxBattery: prevState ? prevState.drone.maxBattery : 100,
      hacks: 0,
      charging: false, chargeTimer: 0,
      chargeSpeed: prevState ? (prevState.drone.chargeSpeed || 3000) : 3000,
      freezeDuration: prevState ? (prevState.drone.freezeDuration || 5000) : 5000,
      hackCost: prevState ? (prevState.drone.hackCost || 25) : 25,
      // Abilities
      empCharges: prevState ? (prevState.drone.empCharges || 1) : 1,
      decoyCharges: prevState ? (prevState.drone.decoyCharges || 1) : 1,
      ping: null, // {x, y, timer}
    },
    guards: ld.guards,
    doors: ld.doors,
    loot: ld.loot,
    cameras: ld.cameras,
    chargingPads: ld.chargingPads,
    alarmPanels: ld.alarmPanels,
    lasers: ld.lasers,
    tripwires: ld.tripwires,
    safes: ld.safes,
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
    guardsHacked: 0,
    // Active effects
    noisemakers: [], // {x, y, timer}
    smokeClouds: [], // {x, y, timer}
    decoys: [], // {x, y, timer}
    // Bonus objectives
    objectives: pickObjectives(2),
    // Screen shake events
    shakeEvents: [],
    // Sound events queue
    sounds: [],
  };
  return state;
}

// ============================================================
// SERVER-SIDE GAME LOGIC
// ============================================================
function isWalkable(state, x, y) {
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return false;
  const tile = state.map[y][x];
  if (tile === '#') return false;
  if (tile === 'S') {
    const safe = state.safes.find(s => s.x === x && s.y === y);
    if (safe && !safe.open) return false;
  }
  if (tile === 'D' || tile === 'L') {
    const door = state.doors.find(d => d.x === x && d.y === y);
    if (door && !door.open) return false;
  }
  return true;
}

function isBlockedForVision(state, x, y) {
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return true;
  const tile = state.map[y][x];
  if (tile === '#') return true;
  if (tile === 'D' || tile === 'L') {
    const door = state.doors.find(d => d.x === x && d.y === y);
    if (door && !door.open) return true;
  }
  // Smoke blocks vision
  if (state.smokeClouds.some(s => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1)) return true;
  return false;
}

function moveThief(state, dx, dy) {
  if (state.gameOver || state.gameWon || state.thief.picking) return;
  const nx = state.thief.x + dx;
  const ny = state.thief.y + dy;
  if (!isWalkable(state, nx, ny)) return;

  // Laser grid check
  const laser = state.lasers.find(l => l.x === nx && l.y === ny && l.active);
  if (laser) {
    if (state.thief.invulnTimer <= 0) {
      state.thief.hp--;
      state.thief.invulnTimer = 1500;
      state.sounds.push('hit');
      state.shakeEvents.push({ intensity: 3, duration: 300 });
      if (state.thief.hp <= 0) {
        state.gameOver = true;
        state.sounds.push('gameOver');
        state.shakeEvents.push({ intensity: 8, duration: 500 });
        return;
      }
    }
  }

  state.thief.x = nx;
  state.thief.y = ny;
  state.sounds.push('move');

  // Tripwire check
  const tripwire = state.tripwires.find(t => t.x === nx && t.y === ny && !t.triggered);
  if (tripwire) {
    tripwire.triggered = true;
    state.map[ny][nx] = '.';
    if (!state.alarmActive) {
      state.alarmActive = true;
      state.alarmTimer = 10000;
      state.thief.spotted = true;
      state.thief.action = 'TRIPWIRE!';
      state.alertTriggered = true;
      state.sounds.push('alarm');
      state.shakeEvents.push({ intensity: 4, duration: 400 });
    }
  }

  // Loot pickup
  const lootItem = state.loot.find(l => l.x === nx && l.y === ny && !l.collected);
  if (lootItem) {
    lootItem.collected = true;
    state.thief.loot++;
    state.thief.totalLoot++;
    if (lootItem.primary) state.primaryLootCollected++;
    else state.bonusLootCollected++;
    state.map[ny][nx] = '.';
    state.sounds.push('loot');
    if (state.primaryLootCollected >= state.primaryLootTotal) {
      state.exitOpen = true;
      state.sounds.push('doorOpen');
    }
  }

  // Safe interaction (thief must be adjacent, drone cursor on safe)
  for (const safe of state.safes) {
    if (safe.open) continue;
    const adjacent = Math.abs(nx - safe.x) + Math.abs(ny - safe.y) === 1;
    const droneOn = state.drone.x === safe.x && state.drone.y === safe.y;
    if (adjacent && droneOn) {
      safe.open = true;
      state.map[safe.y][safe.x] = '.';
      state.score += safe.lootValue;
      state.sounds.push('loot');
      state.sounds.push('hack');
    }
  }

  // Exit check
  if (state.map[ny][nx] === '>' && state.exitOpen) {
    state.gameWon = true;
    state.score += state.primaryLootCollected * 1000;
    state.score += state.bonusLootCollected * 500;
    state.score += Math.max(0, 3000 - Math.floor(state.timer / 1000) * 10);
    if (!state.alertTriggered) state.score += 2000;
    // Bonus objectives
    for (const obj of state.objectives) {
      if (obj.check(state)) {
        obj.completed = true;
        state.score += 1000;
      }
    }
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
      state.thief.pickTimer = state.thief.pickSpeed;
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
      state.thief.locksPicked++;
    }
    state.thief.picking = false;
    state.thief.pickTarget = null;
    state.thief.action = 'Idle';
    state.sounds.push('doorOpen');
  }
}

// Thief abilities
function thiefSprint(state) {
  if (state.gameOver || state.gameWon) return;
  if (state.thief.sprinting || state.thief.sprintCooldown > 0) return;
  state.thief.sprinting = true;
  state.thief.sprintTimer = state.thief.sprintDuration;
  state.thief.action = 'SPRINTING';
  state.sounds.push('sprint');
}

function thiefThrowNoise(state, dx, dy) {
  if (state.gameOver || state.gameWon) return;
  if (state.thief.noiseCharges <= 0) return;
  // Throw noise maker 3-5 tiles in direction
  let nx = state.thief.x, ny = state.thief.y;
  for (let i = 0; i < 5; i++) {
    const tx = nx + dx, ty = ny + dy;
    if (tx < 0 || tx >= state.mapWidth || ty < 0 || ty >= state.mapHeight) break;
    if (state.map[ty][tx] === '#') break;
    nx = tx; ny = ty;
  }
  state.thief.noiseCharges--;
  state.noisemakers.push({ x: nx, y: ny, timer: 5000 });
  state.sounds.push('noise');
}

function thiefSmokeBomb(state) {
  if (state.gameOver || state.gameWon) return;
  if (state.thief.smokeCharges <= 0) return;
  state.thief.smokeCharges--;
  state.smokeClouds.push({ x: state.thief.x, y: state.thief.y, timer: 5000 });
  state.sounds.push('smoke');
  state.shakeEvents.push({ intensity: 2, duration: 200 });
}

// Drone abilities
function droneHack(state) {
  if (state.gameOver || state.gameWon || state.drone.battery <= 0) return;
  const dx = state.drone.x, dy = state.drone.y;
  const hackCost = state.drone.hackCost;

  const door = state.doors.find(d => d.x === dx && d.y === dy && d.type === 'electronic' && !d.open);
  if (door) {
    door.open = true;
    state.map[dy][dx] = '.';
    state.drone.battery = Math.max(0, state.drone.battery - hackCost);
    state.drone.hacks++;
    state.sounds.push('hack');
    state.sounds.push('doorOpen');
    return;
  }

  const cam = state.cameras.find(c => c.x === dx && c.y === dy && c.active);
  if (cam) {
    cam.active = false;
    state.map[dy][dx] = '.';
    state.drone.battery = Math.max(0, state.drone.battery - hackCost);
    state.drone.hacks++;
    state.sounds.push('hack');
    return;
  }

  const guard = state.guards.find(g => g.x === dx && g.y === dy && !g.frozen);
  if (guard) {
    guard.frozen = true;
    guard.frozenTimer = state.drone.freezeDuration;
    guard.alertLevel = 0;
    guard.alertTimer = 0;
    guard.lastKnownThief = null;
    guard.investigateTarget = null;
    state.drone.battery = Math.max(0, state.drone.battery - hackCost);
    state.drone.hacks++;
    state.guardsHacked++;
    state.sounds.push('hack');
    return;
  }

  if (state.alarmActive) {
    const panel = state.alarmPanels.find(a => a.x === dx && a.y === dy);
    if (panel) {
      state.alarmActive = false;
      state.alarmTimer = 0;
      state.thief.spotted = false;
      state.drone.battery = Math.max(0, state.drone.battery - hackCost);
      state.drone.hacks++;
      state.sounds.push('hack');
      return;
    }
  }
}

function droneEMP(state) {
  if (state.gameOver || state.gameWon) return;
  if (state.drone.empCharges <= 0) return;
  state.drone.empCharges--;
  const range = 5;
  let disabled = 0;
  for (const cam of state.cameras) {
    if (!cam.active) continue;
    const dist = Math.abs(cam.x - state.drone.x) + Math.abs(cam.y - state.drone.y);
    if (dist <= range) {
      cam.active = false;
      state.map[cam.y][cam.x] = '.';
      disabled++;
    }
  }
  // Also freeze nearby guards
  for (const guard of state.guards) {
    if (guard.frozen) continue;
    const dist = Math.abs(guard.x - state.drone.x) + Math.abs(guard.y - state.drone.y);
    if (dist <= 3) {
      guard.frozen = true;
      guard.frozenTimer = 3000;
      guard.alertLevel = 0;
    }
  }
  state.sounds.push('emp');
  state.shakeEvents.push({ intensity: 5, duration: 400 });
}

function droneDecoy(state) {
  if (state.gameOver || state.gameWon) return;
  if (state.drone.decoyCharges <= 0) return;
  state.drone.decoyCharges--;
  state.decoys.push({ x: state.drone.x, y: state.drone.y, timer: 6000 });
  state.sounds.push('decoy');
}

function dronePing(state, x, y) {
  if (state.gameOver || state.gameWon) return;
  state.drone.ping = { x, y, timer: 5000 };
  state.sounds.push('ping');
}

function updateDroneCharge(state, dt) {
  const pad = state.chargingPads.find(p => p.x === state.drone.x && p.y === state.drone.y);
  if (pad && state.drone.battery < state.drone.maxBattery) {
    state.drone.charging = true;
    state.drone.chargeTimer += dt;
    if (state.drone.chargeTimer >= state.drone.chargeSpeed) {
      state.drone.battery = Math.min(state.drone.maxBattery, state.drone.battery + 25);
      state.drone.chargeTimer = 0;
      state.sounds.push('charge');
    }
  } else {
    state.drone.charging = false;
    state.drone.chargeTimer = 0;
  }
}

function updateLasers(state, dt) {
  for (const laser of state.lasers) {
    laser.timer += dt;
    if (laser.timer >= laser.period) {
      laser.timer = 0;
      laser.active = !laser.active;
      if (laser.active) state.sounds.push('laser');
    }
    // Damage thief if standing on active laser
    if (laser.active && laser.x === state.thief.x && laser.y === state.thief.y && state.thief.invulnTimer <= 0) {
      state.thief.hp--;
      state.thief.invulnTimer = 1500;
      state.sounds.push('hit');
      state.shakeEvents.push({ intensity: 3, duration: 300 });
      if (state.thief.hp <= 0) {
        state.gameOver = true;
        state.sounds.push('gameOver');
        state.shakeEvents.push({ intensity: 8, duration: 500 });
      }
    }
  }
}

function updateEffects(state, dt) {
  // Noisemakers
  for (let i = state.noisemakers.length - 1; i >= 0; i--) {
    state.noisemakers[i].timer -= dt;
    if (state.noisemakers[i].timer <= 0) {
      state.noisemakers.splice(i, 1);
    }
  }

  // Smoke clouds
  for (let i = state.smokeClouds.length - 1; i >= 0; i--) {
    state.smokeClouds[i].timer -= dt;
    if (state.smokeClouds[i].timer <= 0) {
      state.smokeClouds.splice(i, 1);
    }
  }

  // Decoys
  for (let i = state.decoys.length - 1; i >= 0; i--) {
    state.decoys[i].timer -= dt;
    if (state.decoys[i].timer <= 0) {
      state.decoys.splice(i, 1);
    }
  }

  // Drone ping
  if (state.drone.ping) {
    state.drone.ping.timer -= dt;
    if (state.drone.ping.timer <= 0) state.drone.ping = null;
  }

  // Sprint
  if (state.thief.sprinting) {
    state.thief.sprintTimer -= dt;
    if (state.thief.sprintTimer <= 0) {
      state.thief.sprinting = false;
      state.thief.sprintCooldown = state.thief.sprintCooldownMax;
      state.thief.action = 'Idle';
    }
  }
  if (state.thief.sprintCooldown > 0) {
    state.thief.sprintCooldown -= dt;
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

    // Determine effective speed based on alert level
    let effectiveSpeed = guard.speed;
    if (guard.alertLevel === 1) effectiveSpeed = Math.max(200, guard.speed * 0.8); // suspicious - slightly faster
    if (guard.alertLevel === 2) effectiveSpeed = Math.max(150, guard.speed * 0.5); // alert - much faster

    if (guard.moveTimer < effectiveSpeed) continue;
    guard.moveTimer = 0;

    // Check for noisemakers — guards investigate noise
    let attracted = false;
    for (const noise of state.noisemakers) {
      const dist = Math.abs(noise.x - guard.x) + Math.abs(noise.y - guard.y);
      if (dist <= 8) {
        guard.investigateTarget = { x: noise.x, y: noise.y };
        guard.alertLevel = 1;
        guard.alertTimer = 8000;
        attracted = true;
        break;
      }
    }

    // Check for decoys — guards chase decoys like they're the thief
    if (!attracted) {
      for (const decoy of state.decoys) {
        const dist = Math.abs(decoy.x - guard.x) + Math.abs(decoy.y - guard.y);
        if (dist <= 6) {
          guard.investigateTarget = { x: decoy.x, y: decoy.y };
          guard.alertLevel = 2;
          guard.alertTimer = 6000;
          attracted = true;
          break;
        }
      }
    }

    let target;
    if (guard.alertLevel === 2 && guard.lastKnownThief) {
      // Alert: chase last known thief position
      target = guard.lastKnownThief;
    } else if (guard.investigateTarget) {
      target = guard.investigateTarget;
    } else {
      target = guard.route[guard.routeIdx];
    }

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

    // Patrol waypoint cycling
    if (guard.alertLevel === 0) {
      if (!moved || (guard.x === target.x && guard.y === target.y)) {
        guard.routeIdx = (guard.routeIdx + 1) % guard.route.length;
      }
    }

    // If investigating and reached target, calm down
    if (guard.investigateTarget && guard.x === guard.investigateTarget.x && guard.y === guard.investigateTarget.y) {
      guard.investigateTarget = null;
    }
    if (guard.alertLevel === 2 && guard.lastKnownThief && guard.x === guard.lastKnownThief.x && guard.y === guard.lastKnownThief.y) {
      guard.lastKnownThief = null;
    }

    // Alert timer decay
    if (guard.alertLevel > 0) {
      guard.alertTimer -= dt;
      if (guard.alertTimer <= 0) {
        guard.alertLevel = 0;
        guard.alertTimer = 0;
        guard.lastKnownThief = null;
        guard.investigateTarget = null;
      }
    }

    // Vision check
    if (!guard.frozen) {
      const dirVecs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
      const dv = dirVecs[guard.dir];
      const visionRange = guard.alertLevel >= 1 ? 5 : 3; // Alerted guards see further
      let canSeeThief = false;
      for (let i = 1; i <= visionRange; i++) {
        const vx = guard.x + dv.x * i, vy = guard.y + dv.y * i;
        if (isBlockedForVision(state, vx, vy)) break;
        if (vx === state.thief.x && vy === state.thief.y) { canSeeThief = true; break; }
      }
      // Side peripheral vision (1 tile to each side of facing, only 1 tile deep)
      if (!canSeeThief && guard.alertLevel >= 1) {
        const perps = dv.x === 0 ? [{x:1,y:0},{x:-1,y:0}] : [{x:0,y:1},{x:0,y:-1}];
        for (const p of perps) {
          const vx = guard.x + p.x, vy = guard.y + p.y;
          if (vx === state.thief.x && vy === state.thief.y && !isBlockedForVision(state, vx, vy)) {
            canSeeThief = true; break;
          }
        }
      }
      // Direct collision
      if (guard.x === state.thief.x && guard.y === state.thief.y) canSeeThief = true;

      // Nearby check for suspicious behavior (can "hear" thief within 2 tiles for suspicion)
      const thiefDist = Math.abs(guard.x - state.thief.x) + Math.abs(guard.y - state.thief.y);
      if (!canSeeThief && thiefDist <= 2 && guard.alertLevel === 0 && state.thief.sprinting) {
        // Sprinting is noisy — makes guards suspicious
        guard.alertLevel = 1;
        guard.alertTimer = 5000;
        guard.investigateTarget = { x: state.thief.x, y: state.thief.y };
      }

      if (canSeeThief) {
        guard.alertLevel = 2;
        guard.alertTimer = 10000;
        guard.lastKnownThief = { x: state.thief.x, y: state.thief.y };

        if (!state.alarmActive) {
          state.alarmActive = true;
          state.alarmTimer = 10000;
          state.thief.spotted = true;
          state.thief.action = 'SPOTTED!';
          state.alertTriggered = true;
          state.sounds.push('alarm');
          state.shakeEvents.push({ intensity: 4, duration: 400 });
        }
      }

      if (guard.x === state.thief.x && guard.y === state.thief.y && state.thief.invulnTimer <= 0) {
        state.thief.hp--;
        state.thief.invulnTimer = 1500;
        state.sounds.push('hit');
        state.shakeEvents.push({ intensity: 5, duration: 300 });
        if (state.thief.hp <= 0) {
          state.gameOver = true;
          state.sounds.push('gameOver');
          state.shakeEvents.push({ intensity: 8, duration: 500 });
        }
      }
    }
  }

  // Camera checks — cameras rotate
  for (const cam of state.cameras) {
    if (!cam.active) continue;
    // Cameras slowly rotate
    cam.rotTimer = (cam.rotTimer || 0) + dt;
    if (cam.rotTimer >= 4000) {
      cam.rotTimer = 0;
      cam.dir = (cam.dir + 1) % 4;
    }
    // Camera vision cone (3 tiles in facing direction, 1 tile wide expanding)
    const dirVecs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
    const dv = dirVecs[cam.dir];
    let detected = false;
    for (let i = 1; i <= 3; i++) {
      const vx = cam.x + dv.x * i, vy = cam.y + dv.y * i;
      if (isBlockedForVision(state, vx, vy)) break;
      if (vx === state.thief.x && vy === state.thief.y) { detected = true; break; }
    }
    if (detected && !state.alarmActive) {
      state.alarmActive = true;
      state.alarmTimer = 10000;
      state.thief.spotted = true;
      state.thief.action = 'SPOTTED!';
      state.alertTriggered = true;
      state.sounds.push('alarm');
      state.shakeEvents.push({ intensity: 4, duration: 400 });
    }
  }
}

function updateAlarm(state, dt) {
  if (!state.alarmActive) {
    if (state.thief.spotted) { state.thief.spotted = false; state.thief.action = state.thief.sprinting ? 'SPRINTING' : 'Idle'; }
    return;
  }
  state.alarmTimer -= dt;
  if (state.alarmTimer <= 0) {
    state.thief.hp--;
    state.sounds.push('hit');
    state.shakeEvents.push({ intensity: 5, duration: 300 });
    state.alarmActive = false;
    state.alarmTimer = 0;
    if (state.thief.hp <= 0) {
      state.gameOver = true;
      state.sounds.push('gameOver');
      state.shakeEvents.push({ intensity: 8, duration: 500 });
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
  updateLasers(state, dt);
  updateEffects(state, dt);

  // Periodic alarm sound
  if (state.alarmActive && Math.floor(state.timer / 500) % 2 === 0 && Math.floor((state.timer - dt) / 500) % 2 !== 0) {
    state.sounds.push('alarm');
  }
}

function broadcastState(room) {
  const state = room.gameState;
  if (!state) return;

  const guardsBroadcast = state.guards.map(g => ({
    x: g.x, y: g.y, dir: g.dir, frozen: g.frozen, frozenTimer: g.frozenTimer,
    alertLevel: g.alertLevel,
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
      pickSpeed: state.thief.pickSpeed,
      spotted: state.thief.spotted, invulnTimer: state.thief.invulnTimer,
      action: state.thief.action,
      visionRadius: state.thief.visionRadius,
      sprinting: state.thief.sprinting, sprintTimer: state.thief.sprintTimer,
      sprintCooldown: state.thief.sprintCooldown, sprintCooldownMax: state.thief.sprintCooldownMax,
      sprintDuration: state.thief.sprintDuration,
      noiseCharges: state.thief.noiseCharges,
      smokeCharges: state.thief.smokeCharges,
    },
    drone: {
      x: state.drone.x, y: state.drone.y,
      battery: state.drone.battery, maxBattery: state.drone.maxBattery,
      hacks: state.drone.hacks, charging: state.drone.charging,
      chargeTimer: state.drone.chargeTimer, chargeSpeed: state.drone.chargeSpeed,
      hackCost: state.drone.hackCost,
      empCharges: state.drone.empCharges,
      decoyCharges: state.drone.decoyCharges,
      ping: state.drone.ping,
    },
    guards: guardsBroadcast,
    doors: state.doors,
    loot: state.loot,
    cameras: state.cameras.map(c => ({ x: c.x, y: c.y, active: c.active, dir: c.dir })),
    chargingPads: state.chargingPads,
    alarmPanels: state.alarmPanels,
    lasers: state.lasers.map(l => ({ x: l.x, y: l.y, active: l.active, period: l.period, timer: l.timer })),
    tripwires: state.tripwires,
    safes: state.safes,
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
    noisemakers: state.noisemakers,
    smokeClouds: state.smokeClouds,
    decoys: state.decoys,
    objectives: state.objectives.map(o => ({ id: o.id, desc: o.desc, completed: o.completed })),
    shakeEvents: state.shakeEvents.slice(),
    sounds: state.sounds.slice(),
    paused: room.paused,
    totalScore: room.totalScore,
    maxLevels: 5,
  };

  // Clear one-shot events
  state.sounds = [];
  state.shakeEvents = [];

  const msg = JSON.stringify(payload);
  for (const p of Object.values(room.players)) {
    if (p && p.ws && p.ws.readyState === 1) {
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
          purchasedUpgrades: { thief: [], drone: [] },
        };
        rooms.set(roomCode, room);
        ws.send(JSON.stringify({ type: 'hosted', code: roomCode, role: 'thief', playerId }));
        console.log(`Room ${roomCode} created by ${playerId}`);
        break;
      }

      case 'hostLocal': {
        // Local co-op: one connection controls both roles
        roomCode = generateRoomCode();
        playerId = generatePlayerId();
        role = 'local';
        const localRoom = {
          code: roomCode,
          players: {
            thief: { ws, id: playerId, connected: true },
            drone: { ws, id: playerId, connected: true },
          },
          gameState: null,
          interval: null,
          paused: false,
          level: 1,
          totalScore: 0,
          purchasedUpgrades: { thief: [], drone: [] },
          isLocal: true,
        };
        rooms.set(roomCode, localRoom);
        localRoom.gameState = createGameState(localRoom.level, null);
        localRoom.interval = setInterval(() => {
          tickRoom(localRoom, 100);
          broadcastState(localRoom);
        }, 100);
        ws.send(JSON.stringify({ type: 'localStarted', code: roomCode, playerId }));
        console.log(`Local co-op room ${roomCode} created`);
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
          room.players.drone.ws = ws;
          room.players.drone.id = playerId;
          room.players.drone.connected = true;
        } else {
          room.players.drone = { ws, id: playerId, connected: true };
        }

        ws.send(JSON.stringify({ type: 'joined', code: roomCode, role: 'drone', playerId }));

        if (room.players.thief && room.players.thief.ws && room.players.thief.ws.readyState === 1) {
          room.players.thief.ws.send(JSON.stringify({ type: 'partnerJoined' }));
        }

        if (!room.gameState) {
          room.gameState = createGameState(room.level, null);
          room.interval = setInterval(() => {
            tickRoom(room, 100);
            broadcastState(room);
          }, 100);
        } else {
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

        // Local co-op: msg.role specifies which role the input is for
        const inputRole = (role === 'local') ? (msg.role || 'thief') : role;

        if (inputRole === 'thief') {
          switch(msg.action) {
            case 'move': moveThief(state, msg.dx, msg.dy); break;
            case 'pickStart': startPickLock(state); break;
            case 'pickStop': stopPickLock(state); break;
            case 'sprint': thiefSprint(state); break;
            case 'throwNoise': thiefThrowNoise(state, msg.dx || 0, msg.dy || -1); break;
            case 'smoke': thiefSmokeBomb(state); break;
          }
        } else if (inputRole === 'drone') {
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
            case 'emp': droneEMP(state); break;
            case 'decoy': droneDecoy(state); break;
            case 'ping': dronePing(state, state.drone.x, state.drone.y); break;
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
          from: (role === 'thief' || role === 'local') ? 'THIEF' : 'DRONE',
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

      case 'upgrade': {
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || !room.gameState.gameWon) return;
        const upgradeId = msg.upgradeId;
        const upgradeRole = msg.upgradeRole;
        if (!upgradeId || !upgradeRole) return;

        // Check if already purchased this upgrade
        if (room.purchasedUpgrades[upgradeRole].includes(upgradeId)) return;

        const upgList = upgradeRole === 'thief' ? THIEF_UPGRADES : DRONE_UPGRADES;
        const upgrade = upgList.find(u => u.id === upgradeId);
        if (!upgrade) return;

        // Check if can afford
        if (room.totalScore + room.gameState.score < upgrade.cost) return;

        room.totalScore -= upgrade.cost; // Deduct from banked score
        if (room.totalScore < 0) {
          // Need to take from current level score
          room.gameState.score += room.totalScore;
          room.totalScore = 0;
        }
        room.purchasedUpgrades[upgradeRole].push(upgradeId);
        upgrade.apply(room.gameState);

        // Broadcast available upgrades
        sendUpgradeState(room);
        break;
      }

      case 'nextLevel': {
        if (!roomCode || (role !== 'thief' && role !== 'local')) return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || !room.gameState.gameWon) return;
        room.totalScore += room.gameState.score;
        room.level++;
        if (room.level > 5) {
          for (const p of Object.values(room.players)) {
            if (p && p.ws && p.ws.readyState === 1) {
              try { p.ws.send(JSON.stringify({ type: 'gameComplete', totalScore: room.totalScore })); } catch(e) {}
            }
          }
          if (room.interval) clearInterval(room.interval);
          rooms.delete(roomCode);
          return;
        }
        room.gameState = createGameState(room.level, room.gameState);
        break;
      }

      case 'retry': {
        if (!roomCode || (role !== 'thief' && role !== 'local')) return;
        const room = rooms.get(roomCode);
        if (!room || !room.gameState || !room.gameState.gameOver) return;
        room.level = 1;
        room.totalScore = 0;
        room.purchasedUpgrades = { thief: [], drone: [] };
        room.gameState = createGameState(room.level, null);
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

      const partnerRole = role === 'thief' ? 'drone' : 'thief';
      if (room.players[partnerRole] && room.players[partnerRole].ws && room.players[partnerRole].ws.readyState === 1) {
        room.players[partnerRole].ws.send(JSON.stringify({ type: 'partnerDisconnected', disconnectedRole: role }));
      }

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

function sendUpgradeState(room) {
  const availScore = room.totalScore + (room.gameState ? room.gameState.score : 0);
  const msg = JSON.stringify({
    type: 'upgrades',
    score: availScore,
    thiefUpgrades: THIEF_UPGRADES.map(u => ({
      ...u, apply: undefined,
      purchased: room.purchasedUpgrades.thief.includes(u.id),
      affordable: availScore >= u.cost,
    })),
    droneUpgrades: DRONE_UPGRADES.map(u => ({
      ...u, apply: undefined,
      purchased: room.purchasedUpgrades.drone.includes(u.id),
      affordable: availScore >= u.cost,
    })),
  });
  for (const p of Object.values(room.players)) {
    if (p && p.ws && p.ws.readyState === 1) {
      try { p.ws.send(msg); } catch(e) {}
    }
  }
}

server.listen(PORT, () => {
  console.log(`HEIST server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

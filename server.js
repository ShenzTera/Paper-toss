'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

// ─────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const RACE_DURATION_MS = Number(process.env.RACE_DURATION_MS) || 60_000;
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS) || 3_000;
const HAZARD_INTERVAL_MS = Number(process.env.HAZARD_INTERVAL_MS) || 15_000;
const COOLDOWN_MS = 320;
const MAX_PLAYERS = 8;
const TICK = 1 / 60;

const GRAVITY = -9.8;
const WIND_ACCEL = 0.44;
const SPIN_ACCEL = 1.15;
const RELEASE = { y: 0.25, z: 0.5 };
const BIN = { z: 6.05, rimY: 0.64, inner: 0.34, outer: 0.5 };
const COLORS = ['#f5c86b', '#6ee7cf', '#ff8a9e', '#9db7ff', '#c5a3ff', '#ffad6b', '#98e57c', '#f38bd1'];

const HAZARD_DURATIONS = {
  cat: 6_500,
  roomba: 9_000,
  ac: 6_800,
};

const HAZARDS = {
  cat: {
    label: 'Cat on the desk',
    description: 'Mochi is strolling past the bin. Wait for a gap — or thread it.',
  },
  roomba: {
    label: 'Roomba bin',
    description: 'The dustbin has gained sentience and a motor. Lead your shots.',
  },
  ac: {
    label: 'AC turbo mode',
    description: 'Arctic crosswinds. Aim hard into the gust.',
  },
};

// ─────────────────────────────────────────────────────────────
// App / server setup
// ─────────────────────────────────────────────────────────────
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: false, methods: ['GET', 'POST'] },
});
const rooms = new Map();
let nextShotId = 1;

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const randomInt = (min, max) => crypto.randomInt(min, max);
const nowMs = () => Date.now();

function sanitizeNickname(value) {
  return String(value ?? '')
    .replace(/[<>&\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16) || 'Guest';
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += alphabet[randomInt(0, alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
}

function getPlayer(room, id) {
  return room?.players.get(id) || null;
}

function playerIsReady(room, player) {
  return (
    !player.activeShotId &&
    nowMs() >= player.readyAt &&
    (room.status === 'playing' || room.status === 'lobby')
  );
}

function scoreboard(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score || b.bestStreak - a.bestStreak || a.joinedAt - b.joinedAt)
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      score: p.score,
      streak: p.streak,
      bestStreak: p.bestStreak,
      hits: p.hits,
      throws: p.throws,
      host: p.id === room.hostId,
    }));
}

// ─────────────────────────────────────────────────────────────
// Wind & hazards
// ─────────────────────────────────────────────────────────────
function getWind(room, now = nowMs()) {
  const t = Math.max(0, (now - room.windEpoch) / 1000);
  const seed = room.windSeed;
  const raw = clamp(
    Math.sin(t * 0.57 + seed) * 0.52 +
      Math.sin(t * 0.21 + seed * 2.17) * 0.3 +
      Math.sin(t * 1.13 + seed * 0.71) * 0.12,
    -1,
    1
  );
  const turbo = Boolean(room.hazard && room.hazard.type === 'ac' && now < room.hazard.endsAt);
  const effective = turbo ? raw * 3 : raw;
  return {
    raw: Number(raw.toFixed(3)),
    effective: Number(effective.toFixed(3)),
    turbo,
    direction: effective >= 0 ? 'right' : 'left',
    kph: Number((Math.abs(effective) * 8.6).toFixed(1)),
  };
}

function updateHazardPosition(room, now, dt) {
  if (room.hazard?.type === 'roomba') {
    const t = (now - room.hazard.startsAt) / 1000;
    room.binX = Math.sin(t * 1.18) * 0.82;
  } else {
    room.binX += (0 - room.binX) * Math.min(1, dt * 3.2);
  }

  if (room.hazard?.type === 'cat') {
    const progress = clamp((now - room.hazard.startsAt) / (room.hazard.endsAt - room.hazard.startsAt), 0, 1);
    room.catX = -2.25 + progress * 4.5;
  }
}

function catBlocksBin(room, now) {
  return Boolean(
    room.hazard &&
      room.hazard.type === 'cat' &&
      now < room.hazard.endsAt &&
      Math.abs(room.catX - room.binX) < 0.62
  );
}

function hazardPayload(room, now) {
  if (!room.hazard) return null;
  return {
    type: room.hazard.type,
    label: room.hazard.label,
    description: room.hazard.description,
    startsAt: room.hazard.startsAt,
    endsAt: room.hazard.endsAt,
    catX: room.catX,
    serverNow: now,
  };
}

function triggerHazard(room, now) {
  const choices = ['cat', 'roomba', 'ac'];
  let type = choices[randomInt(0, choices.length)];
  if (room.lastHazardType && choices.length > 1) {
    while (type === room.lastHazardType) type = choices[randomInt(0, choices.length)];
  }
  const meta = HAZARDS[type];
  room.lastHazardType = type;
  room.hazard = {
    type,
    label: meta.label,
    description: meta.description,
    startsAt: now,
    endsAt: now + HAZARD_DURATIONS[type],
  };
  if (type === 'cat') room.catX = -2.25;
  io.to(room.code).emit('hazard_start', {
    hazard: hazardPayload(room, now),
    wind: getWind(room, now),
    binX: room.binX,
    serverNow: now,
  });
}

function stepHazards(room, now, dt) {
  if (room.status !== 'playing' && room.status !== 'settling') return;

  if (room.hazard && now >= room.hazard.endsAt) {
    const endedType = room.hazard.type;
    room.hazard = null;
    io.to(room.code).emit('hazard_end', { type: endedType, serverNow: now });
  }

  updateHazardPosition(room, now, dt);

  if (
    room.status === 'playing' &&
    !room.hazard &&
    now >= room.nextHazardAt &&
    now + 2_500 < room.endsAt
  ) {
    triggerHazard(room, now);
    room.nextHazardAt = Math.max(room.nextHazardAt + HAZARD_INTERVAL_MS, now + HAZARD_INTERVAL_MS);
  }
}

// ─────────────────────────────────────────────────────────────
// Room lifecycle
// ─────────────────────────────────────────────────────────────
function createRoom({ id, nickname, mode = 'race' }) {
  const room = {
    code: makeRoomCode(),
    mode,
    status: mode === 'practice' ? 'playing' : 'lobby',
    hostId: id,
    players: new Map(),
    shots: new Map(),
    createdAt: nowMs(),
    startAt: mode === 'practice' ? nowMs() : null,
    endsAt: mode === 'practice' ? Infinity : null,
    durationMs: RACE_DURATION_MS,
    nextHazardAt: mode === 'practice' ? nowMs() + HAZARD_INTERVAL_MS : null,
    hazard: null,
    lastHazardType: null,
    binX: 0,
    catX: -6,
    windSeed: Math.random() * Math.PI * 2,
    windEpoch: nowMs(),
    lastRimSound: 0,
  };
  addPlayer(room, id, nickname);
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, id, nickname) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
  room.players.set(id, {
    id,
    nickname,
    color,
    score: 0,
    streak: 0,
    bestStreak: 0,
    hits: 0,
    throws: 0,
    activeShotId: null,
    readyAt: 0,
    joinedAt: nowMs(),
  });
}

function resetPlayersForRace(room) {
  for (const p of room.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
    p.hits = 0;
    p.throws = 0;
    p.activeShotId = null;
    p.readyAt = 0;
  }
}

function serializeRoom(room) {
  const now = nowMs();
  return {
    code: room.mode === 'practice' ? null : room.code,
    mode: room.mode,
    status: room.status,
    hostId: room.hostId,
    serverNow: now,
    startAt: room.startAt,
    endsAt: Number.isFinite(room.endsAt) ? room.endsAt : null,
    durationMs: room.durationMs,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      score: p.score,
      streak: p.streak,
      bestStreak: p.bestStreak,
      hits: p.hits,
      throws: p.throws,
      host: p.id === room.hostId,
      ready: playerIsReady(room, p),
    })),
    wind: getWind(room, now),
    hazard: hazardPayload(room, now),
    binX: room.binX,
    catX: room.catX,
  };
}

function emitRoomState(room) {
  io.to(room.code).emit('room_state', serializeRoom(room));
}

function removePlayer(socket, announce = true) {
  const code = socket.data.roomCode;
  const room = code ? rooms.get(code) : null;
  socket.data.roomCode = null;
  if (!room) return;

  for (const [shotId, shot] of room.shots) {
    if (shot.playerId === socket.id) room.shots.delete(shotId);
  }
  const wasHost = room.hostId === socket.id;
  room.players.delete(socket.id);
  socket.leave(room.code);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (wasHost) room.hostId = room.players.keys().next().value;
  if (announce) emitRoomState(room);
}

function detachCurrentRoom(socket) {
  if (socket.data.roomCode) removePlayer(socket, true);
}

function enterSocketRoom(socket, room) {
  detachCurrentRoom(socket);
  socket.join(room.code);
  socket.data.roomCode = room.code;
}

function fail(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
}

// ─────────────────────────────────────────────────────────────
// Projectiles
// ─────────────────────────────────────────────────────────────
function emitShotStart(room, shot, player) {
  io.to(room.code).emit('shot_start', {
    shotId: shot.id,
    playerId: player.id,
    nickname: player.nickname,
    color: player.color,
    serverNow: nowMs(),
    position: { x: shot.x, y: shot.y, z: shot.z },
    velocity: { x: shot.vx, y: shot.vy, z: shot.vz },
    spin: shot.spin,
    streak: player.streak,
    binX: room.binX,
    wind: getWind(room, shot.launchedAt),
  });
}

function finishShot(room, shot, kind, meta = {}) {
  if (shot.resolved) return;
  shot.resolved = true;
  const player = getPlayer(room, shot.playerId);
  if (!player) {
    room.shots.delete(shot.id);
    return;
  }

  const now = nowMs();
  const hit = kind === 'swish' || kind === 'rimIn';
  let points = 0;
  let multiplier = 1;

  if (hit) {
    player.streak += 1;
    player.hits += 1;
    multiplier = Math.min(5, 1 + (player.streak - 1) * 0.25);
    const base = kind === 'swish' ? 120 : 90;
    points = Math.round(base * multiplier);
    player.score += points;
  } else {
    player.streak = 0;
  }

  player.bestStreak = Math.max(player.bestStreak, player.streak);
  player.activeShotId = null;
  player.readyAt = now + COOLDOWN_MS;
  room.shots.delete(shot.id);

  io.to(room.code).emit('shot_result', {
    shotId: shot.id,
    playerId: player.id,
    nickname: player.nickname,
    kind,
    hit,
    clean: kind === 'swish',
    reason: meta.reason || null,
    points,
    multiplier,
    streak: player.streak,
    score: player.score,
    bestStreak: player.bestStreak,
    position: {
      x: Number(shot.x.toFixed(3)),
      y: Number(shot.y.toFixed(3)),
      z: Number(shot.z.toFixed(3)),
    },
    binX: room.binX,
    readyAt: player.readyAt,
    serverNow: now,
    leaderboard: scoreboard(room),
  });
}

function emitRimHit(room, shot) {
  const now = nowMs();
  if (now - room.lastRimSound < 120) return;
  room.lastRimSound = now;
  io.to(room.code).emit('rim_hit', {
    shotId: shot.id,
    playerId: shot.playerId,
    x: shot.x,
    y: shot.y,
    z: shot.z,
    serverNow: now,
  });
}

function updateShots(room, dt, now) {
  for (const shot of room.shots.values()) {
    if (shot.resolved) continue;
    shot.age += dt;
    const wind = getWind(room, now);

    shot.vx += (wind.effective * WIND_ACCEL + shot.spin * SPIN_ACCEL) * dt;
    shot.vy += GRAVITY * dt;
    const previousY = shot.y;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.z += shot.vz * dt;

    const descending = shot.vy < 0;
    const crossedRim = previousY > BIN.rimY && shot.y <= BIN.rimY && descending;

    if (crossedRim) {
      const dx = shot.x - room.binX;
      const dz = shot.z - BIN.z;
      const radial = Math.hypot(dx, dz);

      if (catBlocksBin(room, now) && radial < BIN.outer + 0.08) {
        finishShot(room, shot, 'blocked', { reason: 'cat' });
        continue;
      }

      if (radial < BIN.inner) {
        const clean = radial < 0.225;
        finishShot(room, shot, clean ? 'swish' : 'rimIn');
        continue;
      }

      if (radial < BIN.outer) {
        emitRimHit(room, shot);
        // Circular rim bounce: push the ball away from the rim centre.
        const nx = dx / Math.max(radial, 0.0001);
        const nz = dz / Math.max(radial, 0.0001);
        const outward = shot.vx * nx + shot.vz * nz;
        if (outward > 0) {
          shot.vx -= 1.5 * outward * nx;
          shot.vz -= 1.5 * outward * nz;
        }
        shot.vy = Math.max(1.15, Math.abs(shot.vy) * 0.28);
        shot.vx *= 0.82;
        shot.vz *= 0.82;
      }
    }

    const outOfBounds = shot.y < -0.55 || shot.z > 9.3 || shot.z < 0.2 || shot.age > 3.2;
    if (outOfBounds) finishShot(room, shot, 'miss');
  }
}

function launchShot(room, player, raw) {
  const power = clamp(raw.power, 0.06, 1);
  const aim = clamp(raw.aim, -1, 1);
  const spin = clamp(raw.spin, -1, 1);
  const now = nowMs();

  // A fixed-timestep 3D projectile. Power controls launch loft,
  // aim is the initial lateral push, spin adds lateral curvature.
  const vy = 4.1 + power * 2.2;
  const vz = 4.7 + power * 1.9;
  const vx = aim * 1.35;

  const shot = {
    id: nextShotId++,
    playerId: player.id,
    x: 0,
    y: RELEASE.y,
    z: RELEASE.z,
    vx,
    vy,
    vz,
    spin,
    age: 0,
    launchedAt: now,
    resolved: false,
  };

  room.shots.set(shot.id, shot);
  player.activeShotId = shot.id;
  player.throws += 1;
  emitShotStart(room, shot, player);
  return shot;
}

// ─────────────────────────────────────────────────────────────
// Phase simulation & broadcast
// ─────────────────────────────────────────────────────────────
function beginCountdown(room) {
  resetPlayersForRace(room);
  room.shots.clear();
  room.hazard = null;
  room.lastHazardType = null;
  room.catX = -6;
  room.binX = 0;
  room.windSeed = Math.random() * Math.PI * 2;
  room.windEpoch = nowMs();
  room.status = 'countdown';
  room.startAt = nowMs() + COUNTDOWN_MS;
  room.endsAt = room.startAt + room.durationMs;
  room.nextHazardAt = room.startAt + HAZARD_INTERVAL_MS;

  emitRoomState(room);
  io.to(room.code).emit('race_countdown', {
    serverNow: nowMs(),
    startAt: room.startAt,
    endsAt: room.endsAt,
  });
}

function finishRace(room) {
  if (room.status === 'finished') return;
  room.status = 'finished';
  room.shots.clear();
  room.hazard = null;
  for (const p of room.players.values()) p.activeShotId = null;
  const board = scoreboard(room);
  const top = board.length ? board[0].score : 0;
  const winners = top > 0 ? board.filter((p) => p.score === top) : [];
  const now = nowMs();
  io.to(room.code).emit('race_end', {
    serverNow: now,
    leaderboard: board,
    winners,
    winnerId: winners.length === 1 ? winners[0].id : null,
    topStreak: Math.max(0, ...board.map((p) => p.bestStreak)),
    durationMs: RACE_DURATION_MS,
  });
  emitRoomState(room);
}

function stepRoom(room, dt, now) {
  if (room.status === 'countdown' && now >= room.startAt) {
    room.status = 'playing';
    room.nextHazardAt = room.startAt + HAZARD_INTERVAL_MS;
    io.to(room.code).emit('race_started', {
      serverNow: now,
      startAt: room.startAt,
      endsAt: room.endsAt,
    });
  }

  if (room.status === 'playing' && now >= room.endsAt) {
    if (room.shots.size > 0) {
      room.status = 'settling';
      io.to(room.code).emit('race_settling', { serverNow: now, endsAt: room.endsAt });
    } else {
      finishRace(room);
      return;
    }
  }

  if (room.status === 'settling') {
    updateShots(room, dt, now);
    if (room.shots.size === 0 || now >= room.endsAt + 2_000) {
      finishRace(room);
      return;
    }
  } else if (room.status === 'playing') {
    stepHazards(room, now, dt);
    updateShots(room, dt, now);
  }
}

function framePayload(room, now) {
  const shots = [];
  for (const s of room.shots.values()) {
    if (!s.resolved) {
      shots.push({
        i: s.id,
        p: s.playerId,
        x: Number(s.x.toFixed(4)),
        y: Number(s.y.toFixed(4)),
        z: Number(s.z.toFixed(4)),
      });
    }
  }
  return {
    serverNow: now,
    shots,
    binX: Number(room.binX.toFixed(4)),
    catX: Number(room.catX.toFixed(4)),
  };
}

function environmentPayload(room, now) {
  return {
    serverNow: now,
    status: room.status,
    startAt: room.startAt,
    endsAt: Number.isFinite(room.endsAt) ? room.endsAt : null,
    wind: getWind(room, now),
    hazard: hazardPayload(room, now),
    binX: room.binX,
    catX: room.catX,
  };
}

let accumulator = 0;
let lastPhysics = performance.now();
let lastFrame = 0;
let lastEnv = 0;

function gameLoop() {
  const wallNow = performance.now();
  let delta = wallNow - lastPhysics;
  lastPhysics = wallNow;
  if (delta > 250) delta = 250;
  accumulator += delta;

  let steps = 0;
  while (accumulator >= TICK * 1000 && steps < 6) {
    const simNow = nowMs();
    for (const room of rooms.values()) {
      try {
        stepRoom(room, TICK, simNow);
      } catch (error) {
        console.error(`[room ${room.code}] tick error`, error);
      }
    }
    accumulator -= TICK * 1000;
    steps += 1;
  }

  const now = nowMs();
  if (now - lastFrame >= 32) {
    for (const room of rooms.values()) {
      if (room.status === 'playing' || room.status === 'settling') {
        io.to(room.code).emit('frame', framePayload(room, now));
      }
    }
    lastFrame = now;
  }
  if (now - lastEnv >= 160) {
    for (const room of rooms.values()) {
      io.to(room.code).emit('environment', environmentPayload(room, now));
    }
    lastEnv = now;
  }
}

setInterval(gameLoop, 1000 / 60);

// ─────────────────────────────────────────────────────────────
// Socket events
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('create_room', (payload = {}, ack) => {
    const nickname = sanitizeNickname(payload.nickname);
    if (payload.nickname && String(payload.nickname).trim().length === 0) {
      return fail(ack, 'Pick a nickname first.');
    }
    if (socket.data.roomCode) {
      const existing = rooms.get(socket.data.roomCode);
      if (existing && existing.status === 'countdown') return fail(ack, 'Your room is starting.');
    }
    const room = createRoom({ id: socket.id, nickname, mode: 'race' });
    enterSocketRoom(socket, room);
    if (typeof ack === 'function') ack({ ok: true, playerId: socket.id, room: serializeRoom(room) });
  });

  socket.on('join_room', (payload = {}, ack) => {
    const rawCode = String(payload.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (rawCode.length !== 4) return fail(ack, 'Enter a 4-letter room code.');
    const room = rooms.get(rawCode);
    if (!room) return fail(ack, 'That room has left the building.');
    if (room.status !== 'lobby') return fail(ack, 'That race is already underway.');
    if (room.players.size >= MAX_PLAYERS) return fail(ack, 'This desk is full (8 players max).');
    if (socket.data.roomCode === room.code) return fail(ack, 'You are already in this room.');

    const nickname = sanitizeNickname(payload.nickname);
    addPlayer(room, socket.id, nickname);
    enterSocketRoom(socket, room);
    if (typeof ack === 'function') ack({ ok: true, playerId: socket.id, room: serializeRoom(room) });
    emitRoomState(room);
  });

  socket.on('solo_practice', (payload = {}, ack) => {
    const nickname = sanitizeNickname(payload.nickname);
    const room = createRoom({ id: socket.id, nickname, mode: 'practice' });
    enterSocketRoom(socket, room);
    if (typeof ack === 'function') ack({ ok: true, playerId: socket.id, room: serializeRoom(room) });
    io.to(room.code).emit('practice_started', { serverNow: nowMs() });
  });

  socket.on('start_race', (_payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return fail(ack, 'You are not in a room.');
    if (room.mode === 'practice') return fail(ack, 'Practice mode is already live.');
    if (room.hostId !== socket.id) return fail(ack, 'Only the host can start the race.');
    if (!['lobby', 'finished'].includes(room.status)) return fail(ack, 'The race is already starting.');
    beginCountdown(room);
    if (typeof ack === 'function') ack({ ok: true, room: serializeRoom(room) });
  });

  socket.on('throw_ball', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return fail(ack, 'You are not in a room.');
    if (room.status !== 'playing') return fail(ack, 'Tosses are closed right now.');
    const player = getPlayer(room, socket.id);
    if (!player) return fail(ack, 'Player not found.');
    if (player.activeShotId) return fail(ack, 'Your last toss is still in the air.');
    const now = nowMs();
    if (now < player.readyAt) return fail(ack, 'Crumpling the next ball...');

    const power = Number(payload.power);
    const aim = Number(payload.aim);
    const spin = Number(payload.spin);
    if (![power, aim, spin].every(Number.isFinite)) {
      return fail(ack, 'Invalid toss data.');
    }
    if (power < 0.03 || power > 1.01 || aim < -1.01 || aim > 1.01 || spin < -1.01 || spin > 1.01) {
      return fail(ack, 'Invalid toss range.');
    }

    const shot = launchShot(room, player, { power, aim, spin });
    if (typeof ack === 'function') ack({ ok: true, shotId: shot.id });
  });

  socket.on('leave_room', (_payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: true });
      return;
    }
    removePlayer(socket, true);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    removePlayer(socket, true);
  });
});

// ─────────────────────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  Paper Toss · Desk League`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Race ${RACE_DURATION_MS / 1000}s · hazards every ${HAZARD_INTERVAL_MS / 1000}s\n`);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

/* ─────────────────────────────────────────────────────────────
   Paper Toss · Desk League — client
   Scene, throwing, audio, networking, and a little desk chaos.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const MONO = '"SFMono-Regular", "Cascadia Code", "Roboto Mono", ui-monospace, monospace';

  const dom = {
    homeScreen: $('homeScreen'),
    gameScreen: $('gameScreen'),
    nickname: $('nickname'),
    roomCodeInput: $('roomCodeInput'),
    createBtn: $('createBtn'),
    joinBtn: $('joinBtn'),
    soloBtn: $('soloBtn'),
    lobbyError: $('lobbyError'),
    connectionPill: $('connectionPill'),
    connectionText: $('connectionText'),
    gameBrand: $('gameBrand'),
    roomChip: $('roomChip'),
    roomCodeLabel: $('roomCodeLabel'),
    practiceChip: $('practiceChip'),
    soundBtn: $('soundBtn'),
    soundOnIcon: document.querySelector('.sound-on-icon'),
    soundOffIcon: document.querySelector('.sound-off-icon'),
    leaveBtn: $('leaveBtn'),
    stage: $('stage'),
    arena: $('arena'),
    hud: $('hud'),
    timerCard: $('timerCard'),
    timerLabel: $('timerLabel'),
    timerPlayers: $('timerPlayers'),
    timerValue: $('timerValue'),
    timerBar: $('timerBar'),
    windCard: $('windCard'),
    windKph: $('windKph'),
    windNeedle: $('windNeedle'),
    windDir: $('windDir'),
    windLevel: $('windLevel'),
    leaderboardCard: $('leaderboardCard'),
    scoreList: $('scoreList'),
    streakCard: $('streakCard'),
    streakValue: $('streakValue'),
    streakLabel: $('streakLabel'),
    hazardBanner: $('hazardBanner'),
    hazardIcon: $('hazardIcon'),
    hazardTitle: $('hazardTitle'),
    hazardDesc: $('hazardDesc'),
    hazardTime: $('hazardTime'),
    tossHint: $('tossHint'),
    tossHintText: $('tossHintText'),
    toastStack: $('toastStack'),
    lobbyOverlay: $('lobbyOverlay'),
    lobbyCodeBtn: $('lobbyCodeBtn'),
    lobbyCode: $('lobbyCode'),
    readyCount: $('readyCount'),
    lobbyPlayers: $('lobbyPlayers'),
    startRaceBtn: $('startRaceBtn'),
    hostWait: $('hostWait'),
    roomLobbyFoot: $('roomLobbyFoot'),
    countdownOverlay: $('countdownOverlay'),
    countdownNumber: $('countdownNumber'),
    countdownTip: $('countdownTip'),
    countdownRoster: $('countdownRoster'),
    resultsOverlay: $('resultsOverlay'),
    resultsEyebrow: $('resultsEyebrow'),
    resultsTitle: $('resultsTitle'),
    resultsSub: $('resultsSub'),
    podium: $('podium'),
    rematchBtn: $('rematchBtn'),
    resultsLeaveBtn: $('resultsLeaveBtn'),
    rematchWait: $('rematchWait'),
    connectionOverlay: $('connectionOverlay'),
    connectionMessage: $('connectionMessage'),
    connectionHomeBtn: $('connectionHomeBtn'),
    rotateHint: $('rotateHint'),
  };

  const state = {
    socket: null,
    connected: false,
    everConnected: false,
    playerId: null,
    room: null,
    me: null,
    phase: 'home',
    serverOffset: 0,
    clockSynced: false,
    lastStatus: null,
    practice: false,
    ownActive: false,
    ownReadyAt: 0,
    throwPending: false,
    wind: { raw: 0, effective: 0, turbo: false, direction: 'right', kph: 0 },
    windTarget: { raw: 0, effective: 0, turbo: false, direction: 'right', kph: 0 },
    binX: 0,
    binTarget: 0,
    catX: -6,
    catTarget: -6,
    hazard: null,
    results: null,
    shots: new Map(),
    drag: null,
    dragMax: 220,
    lastFrame: 0,
    lastCountdownNumber: null,
    connectedOnce: false,
    lostDuringRoom: false,
    intentionalLeave: false,
    countdownBeeped: new Set(),
    lastHazardTick: null,
    lastUiUpdate: 0,
    lastHintText: '',
    inputLocked: false,
    soundMuted: localStorage.getItem('pt-muted') === '1',
  };

  const scene = {
    canvas: dom.arena,
    ctx: dom.arena.getContext('2d'),
    w: 0,
    h: 0,
    dpr: 1,
    running: false,
    raf: 0,
    time: 0,
    lastTime: 0,
    lastResizeCheck: 0,
    shake: 0,
    particles: [],
    floaters: [],
    motes: [],
    streaks: [],
    restCrumple: 0,
    restPop: 1,
    hoverBall: false,
    catBlink: 0,
    keys: {},
    trailsDirty: true,
  };

  // ───────────────────────── formatting helpers ─────────────────────────
  function initials(name) {
    return String(name || '??')
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '??';
  }

  function comboForStreak(streak) {
    return Math.min(5, 1 + Math.max(0, streak - 1) * 0.25);
  }

  function formatMultiplier(streak) {
    return `x${comboForStreak(streak).toFixed(streak % 4 === 1 ? 2 : 2).replace(/0$/, '')}`;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function nowEstimate() {
    return Date.now() + state.serverOffset;
  }

  function syncClock(serverNow) {
    if (!Number.isFinite(serverNow)) return;
    const sample = serverNow - Date.now();
    if (!state.clockSynced) {
      state.serverOffset = sample;
      state.clockSynced = true;
    } else if (Math.abs(sample - state.serverOffset) > 220) {
      state.serverOffset = sample;
    } else {
      state.serverOffset = lerp(state.serverOffset, sample, 0.2);
    }
  }

  function getScorePlayers() {
    if (!state.room?.players) return [];
    return state.room.players
      .slice()
      .sort(
        (a, b) =>
          (b.score || 0) - (a.score || 0) ||
          (b.bestStreak || 0) - (a.bestStreak || 0) ||
          String(a.nickname).localeCompare(String(b.nickname))
      );
  }

  function getMe() {
    return state.room?.players?.find((p) => p.id === state.playerId) || null;
  }

  function setLobbyMessage(message) {
    dom.lobbyError.textContent = message || '';
  }

  function showToast(message, tone = '') {
    if (!message) return;
    const toast = document.createElement('div');
    toast.className = `toast${tone ? ` is-${tone}` : ''}`;
    toast.textContent = message;
    dom.toastStack.appendChild(toast);
    while (dom.toastStack.children.length > 3) dom.toastStack.firstElementChild.remove();
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(8px)';
      window.setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  function setConnectedUI(connected, label) {
    state.connected = connected;
    dom.connectionPill.classList.toggle('is-online', connected);
    dom.connectionPill.classList.toggle('is-offline', !connected);
    dom.connectionText.textContent = label || (connected ? 'Desk online' : 'Offline');
  }

  function setHudIdle(idle) {
    dom.hud.classList.toggle('is-idle', idle);
  }

  function setScreen(screen) {
    dom.homeScreen.hidden = screen !== 'home';
    dom.gameScreen.hidden = screen !== 'game';
    document.body.classList.toggle('in-game', screen === 'game');
  }

  // ───────────────────────── lobby actions ─────────────────────────
  function getNickname() {
    const raw = dom.nickname.value.trim().replace(/\s+/g, ' ');
    if (!raw) {
      setLobbyMessage('Give your desk a name first.');
      dom.nickname.focus();
      return null;
    }
    return raw.slice(0, 16);
  }

  function setHomeBusy(busy, activeButton = null) {
    state.homeBusy = busy;
    for (const button of [dom.createBtn, dom.joinBtn, dom.soloBtn]) {
      button.disabled = busy;
    }
    if (activeButton) {
      activeButton.dataset.original = activeButton.innerHTML;
      if (busy) activeButton.innerHTML = '<span>Opening the desk…</span>';
      else if (activeButton.dataset.original) activeButton.innerHTML = activeButton.dataset.original;
    }
  }

  function emitAck(event, payload, timeout = 5000) {
    return new Promise((resolve) => {
      if (!state.socket || !state.socket.connected) {
        resolve({ ok: false, error: 'No connection to the desk. Try again in a moment.' });
        return;
      }
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        resolve({ ok: false, error: 'The desk did not answer. Try again.' });
      }, timeout);
      state.socket.emit(event, payload, (response) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        resolve(response || { ok: false, error: 'Unexpected response from the server.' });
      });
    });
  }

  async function createRoom() {
    if (state.homeBusy) return;
    ensureAudio();
    const nickname = getNickname();
    if (!nickname) return;
    setLobbyMessage('');
    localStorage.setItem('pt-nickname', nickname);
    setHomeBusy(true, dom.createBtn);
    const result = await emitAck('create_room', { nickname });
    setHomeBusy(false, dom.createBtn);
    if (!result.ok) {
      setLobbyMessage(result.error || 'Could not create the room.');
      return;
    }
    enterGame(result);
  }

  async function joinRoom() {
    if (state.homeBusy) return;
    ensureAudio();
    const nickname = getNickname();
    if (!nickname) return;
    const code = dom.roomCodeInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) {
      setLobbyMessage('Room codes are exactly four letters.');
      dom.roomCodeInput.focus();
      return;
    }
    setLobbyMessage('');
    localStorage.setItem('pt-nickname', nickname);
    setHomeBusy(true, dom.joinBtn);
    const result = await emitAck('join_room', { nickname, code });
    setHomeBusy(false, dom.joinBtn);
    if (!result.ok) {
      setLobbyMessage(result.error || 'Could not join that room.');
      return;
    }
    enterGame(result);
  }

  async function soloPractice() {
    if (state.homeBusy) return;
    ensureAudio();
    const nickname = getNickname();
    if (!nickname) return;
    setLobbyMessage('');
    localStorage.setItem('pt-nickname', nickname);
    setHomeBusy(true, dom.soloBtn);
    const result = await emitAck('solo_practice', { nickname });
    setHomeBusy(false, dom.soloBtn);
    if (!result.ok) {
      setLobbyMessage(result.error || 'Could not open practice mode.');
      return;
    }
    enterGame(result);
  }

  function enterGame(payload) {
    state.playerId = payload.playerId;
    state.results = null;
    state.ownActive = false;
    state.ownReadyAt = 0;
    state.throwPending = false;
    state.hazard = null;
    state.shots.clear();
    scene.particles.length = 0;
    scene.floaters.length = 0;
    scene.clockSynced = false;
    applyRoom(payload.room, true);
    setScreen('game');
    setOverlay(dom.connectionOverlay, false);
    state.everConnected = true;
    startRender();
    window.setTimeout(() => resizeCanvas(), 30);
    audioEngine.startFan();
    audioEngine.ensure();
    updateSoundButton();
  }

  function setOverlay(element, visible) {
    if (!element) return;
    element.hidden = !visible;
  }

  function updateTopbar() {
    const room = state.room;
    if (!room) return;
    const isPractice = room.mode === 'practice';
    dom.roomChip.hidden = isPractice;
    dom.practiceChip.hidden = !isPractice;
    dom.roomCodeLabel.textContent = room.code || '----';
    dom.timerPlayers.textContent = `${room.players?.length || 1} PLAYER${room.players?.length === 1 ? '' : 'S'}`;
    dom.timerLabel.textContent = isPractice ? 'PRACTICE' : 'RACE';
    dom.timerCard.classList.toggle('is-practice', isPractice);
    dom.practiceChip.textContent = 'PRACTICE DESK';
  }

  function applyRoom(room, initial = false) {
    if (!room) return;
    const previousStatus = state.room?.status;
    state.room = room;
    state.practice = room.mode === 'practice';
    state.me = getMe();
    syncClock(room.serverNow);

    if (room.wind) {
      state.windTarget = room.wind;
      if (initial || !state.clockSynced) state.wind = { ...room.wind };
    }
    if (Number.isFinite(room.binX)) {
      state.binTarget = room.binX;
      if (initial) state.binX = room.binX;
    }
    if (Number.isFinite(room.catX)) {
      state.catTarget = room.catX;
      if (initial) state.catX = room.catX;
    }

    if (room.status === 'countdown') {
      state.phase = 'countdown';
    } else if (room.status === 'lobby') {
      state.phase = 'lobby';
    } else if (room.status === 'playing') {
      state.phase = 'playing';
    } else if (room.status === 'settling') {
      state.phase = 'settling';
    } else if (room.status === 'finished') {
      state.phase = 'finished';
    }

    if (initial) {
      state.ownActive = false;
      state.ownReadyAt = 0;
    }

    renderRoomUi(initial);

    if (room.status === 'lobby') {
      setOverlay(dom.lobbyOverlay, true);
      setOverlay(dom.countdownOverlay, false);
      setOverlay(dom.resultsOverlay, false);
      setHudIdle(true);
    } else if (room.status === 'countdown') {
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.countdownOverlay, true);
      setOverlay(dom.resultsOverlay, false);
      setHudIdle(true);
      renderCountdownRoster(room.players || []);
    } else if (room.status === 'playing' || room.status === 'settling') {
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.countdownOverlay, false);
      setOverlay(dom.resultsOverlay, false);
      setHudIdle(false);
    } else if (room.status === 'finished') {
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.countdownOverlay, false);
      setOverlay(dom.resultsOverlay, Boolean(state.results));
      setHudIdle(true);
    }

    if (previousStatus !== room.status) {
      state.countdownBeeped.clear();
      state.lastCountdownNumber = null;
    }

    if (initial && room.mode === 'practice') {
      state.phase = 'playing';
      setHudIdle(false);
      showToast('Practice desk ready. Drag up from the ball.', 'good');
    }

    if (room.status === 'playing' && previousStatus !== 'playing' && !initial) {
      startPlayableRound();
    }

    if (room.status === 'finished' && previousStatus !== 'finished' && state.results) {
      setOverlay(dom.resultsOverlay, true);
    }
  }

  function startPlayableRound() {
    state.ownActive = false;
    state.ownReadyAt = 0;
    state.throwPending = false;
    state.shots.clear();
    state.hazard = null;
    setHudIdle(false);
    dom.hazardBanner.hidden = true;
    dom.tossHintText.textContent = 'Drag up to toss · curve your swipe for spin';
    dom.tossHint.classList.remove('is-faded');
  }

  function renderRoomUi(initial = false) {
    const room = state.room;
    if (!room) return;
    updateTopbar();
    renderLeaderboard(getScorePlayers());
    renderLobby(room);
    updateMeUi();
    updateHazardBanner(true);

    if (room.mode === 'race') {
      dom.lobbyCode.textContent = room.code;
    } else {
      dom.lobbyCode.textContent = 'SOLO';
    }

    const host = room.hostId === state.playerId;
    dom.startRaceBtn.hidden = !host;
    dom.hostWait.hidden = host;
    dom.rematchBtn.hidden = !host;
    dom.rematchWait.hidden = host;

    if (room.status === 'finished' && state.results) {
      dom.rematchBtn.hidden = !host;
      dom.rematchWait.hidden = host;
    }

    if (initial) {
      state.lastStatus = room.status;
    }
  }

  function renderLobby(room) {
    const players = room.players || [];
    dom.readyCount.textContent = `${players.length} / 8`;
    dom.lobbyPlayers.replaceChildren();
    const slots = Math.max(4, Math.min(8, players.length + (players.length < 4 ? 4 - players.length : 0)));
    for (let i = 0; i < slots; i += 1) {
      const player = players[i];
      const el = document.createElement('div');
      if (player) {
        el.className = 'lobby-player';
        el.innerHTML = `
          <span class="lobby-avatar" style="--player-color:${player.color}">${initials(player.nickname)}</span>
          <span class="lobby-player-copy">
            <strong></strong>
            <span>${player.id === state.playerId ? 'YOU' : 'AT THE DESK'}</span>
          </span>
          ${player.host ? '<span class="host-mark" aria-label="Host">★</span>' : ''}
        `;
        el.querySelector('strong').textContent = player.nickname;
      } else {
        el.className = 'lobby-player is-empty';
        el.innerHTML = '<span class="lobby-avatar">·</span><span class="lobby-player-copy"><strong>Empty seat</strong><span>WAITING</span></span>';
      }
      dom.lobbyPlayers.appendChild(el);
    }

    const host = room.hostId === state.playerId;
    if (room.status === 'lobby') {
      dom.startRaceBtn.hidden = !host;
      dom.hostWait.hidden = host;
      dom.roomLobbyFoot.textContent = host
        ? 'Start when everyone is ready. The race is 60 seconds.'
        : 'The host starts the race. Stretch those fingers.';
    }
  }

  function renderLeaderboard(players) {
    dom.scoreList.replaceChildren();
    if (!players?.length) return;
    for (const player of players) {
      const li = document.createElement('li');
      li.className = `score-row${player.id === state.playerId ? ' is-me' : ''}`;
      const streak = player.streak || 0;
      li.innerHTML = `
        <span class="score-avatar" style="--player-color:${player.color}">${initials(player.nickname)}</span>
        <span class="score-name"><span class="score-name-text"></span>${player.host ? '<span class="host-star" aria-label="Host">★</span>' : ''}</span>
        <span class="score-points">${(player.score || 0).toLocaleString()}</span>
        <span class="score-streak${streak >= 2 ? ' is-hot' : ''}">${streak ? `x${comboForStreak(streak).toFixed(1)}` : '—'}</span>
      `;
      li.querySelector('.score-name-text').textContent = player.nickname;
      dom.scoreList.appendChild(li);
    }
  }

  function updateMeUi() {
    const me = getMe() || state.me;
    if (!me) {
      dom.streakValue.textContent = 'x1.0';
      dom.streakLabel.textContent = 'warm up';
      dom.streakCard.classList.remove('is-hot');
      return;
    }
    const streak = me.streak || 0;
    dom.streakValue.textContent = formatMultiplier(streak);
    dom.streakLabel.textContent = streak === 0 ? 'warm up' : streak === 1 ? 'one in' : `${streak} swishes`;
    dom.streakCard.classList.toggle('is-hot', streak >= 2);
  }

  function applyLeaderboard(board) {
    if (!state.room || !Array.isArray(board)) return;
    const byId = new Map(board.map((p) => [p.id, p]));
    for (const player of state.room.players || []) {
      const update = byId.get(player.id);
      if (!update) continue;
      player.score = update.score;
      player.streak = update.streak;
      player.bestStreak = update.bestStreak;
      player.hits = update.hits;
      player.throws = update.throws;
    }
    state.me = getMe();
    renderLeaderboard(getScorePlayers());
    updateMeUi();
  }

  function showHazard(hazard) {
    if (!hazard) {
      dom.hazardBanner.hidden = true;
      dom.hazardBanner.className = 'hazard-banner';
      state.hazard = null;
      return;
    }
    state.hazard = hazard;
    dom.hazardBanner.classList.toggle('is-cat', hazard.type === 'cat');
    dom.hazardBanner.classList.toggle('is-ac', hazard.type === 'ac');
    dom.hazardBanner.classList.toggle('is-roomba', hazard.type === 'roomba');
    dom.hazardIcon.textContent = hazard.type === 'cat' ? '猫' : hazard.type === 'ac' ? '❄' : '⌁';
    dom.hazardTitle.textContent = hazard.label;
    dom.hazardDesc.textContent = hazard.description;
    dom.hazardBanner.hidden = false;
  }

  function updateHazardBanner(force = false) {
    if (!state.hazard) {
      dom.hazardBanner.hidden = true;
      return;
    }
    const remaining = state.hazard.endsAt - nowEstimate();
    if (remaining <= 0) {
      if (state.room?.status === 'playing') {
        state.hazard = null;
        dom.hazardBanner.hidden = true;
      }
      return;
    }
    if (force || dom.hazardBanner.hidden) dom.hazardBanner.hidden = false;
    dom.hazardTime.textContent = `${Math.max(1, Math.ceil(remaining / 1000))}s`;
  }

  function renderCountdownRoster(players) {
    dom.countdownRoster.replaceChildren();
    for (const p of players.slice(0, 8)) {
      const span = document.createElement('span');
      span.className = 'countdown-player';
      span.innerHTML = `<i style="--player-color:${p.color}"></i>`;
      span.append(document.createTextNode(p.nickname));
      dom.countdownRoster.appendChild(span);
    }
  }

  function showResults(payload) {
    state.results = payload;
    state.phase = 'finished';
    state.hazard = null;
    dom.hazardBanner.hidden = true;
    const me = payload.leaderboard.find((p) => p.id === state.playerId);
    const winners = payload.winners || [];
    const iWon = winners.some((p) => p.id === state.playerId);

    if (winners.length === 0) {
      dom.resultsEyebrow.textContent = 'FINAL WHISTLE';
      dom.resultsTitle.textContent = 'The bin survived.';
      dom.resultsSub.textContent = 'Not a single swish. The desk fan is disappointed, but respectful.';
    } else if (winners.length > 1) {
      dom.resultsEyebrow.textContent = 'DEAD HEAT';
      dom.resultsTitle.textContent = 'Shared glory.';
      dom.resultsSub.textContent = `${winners.map((w) => w.nickname).join(' & ')} finish level at the top.`;
    } else if (iWon) {
      dom.resultsEyebrow.textContent = 'DESK CHAMPION';
      dom.resultsTitle.textContent = 'You own this desk.';
      dom.resultsSub.textContent = `${winners[0].nickname} takes the room with ${winners[0].score.toLocaleString()} points. Flawless office behavior.`;
    } else {
      dom.resultsEyebrow.textContent = 'FINAL RESULTS';
      dom.resultsTitle.textContent = 'The desk has spoken.';
      dom.resultsSub.textContent = `${winners[0].nickname} rules the desk with ${winners[0].score.toLocaleString()} points.`;
    }

    dom.podium.replaceChildren();
    payload.leaderboard.forEach((player, index) => {
      const row = document.createElement('div');
      row.className = `podium-row${index === 0 && player.score > 0 ? ' is-first' : ''}`;
      row.innerHTML = `
        <span class="podium-rank">${index + 1}</span>
        <span class="podium-avatar" style="--player-color:${player.color}">${initials(player.nickname)}</span>
        <span class="podium-name"></span>
        <span class="podium-score">${(player.score || 0).toLocaleString()}</span>
      `;
      row.querySelector('.podium-name').append(document.createTextNode(player.nickname));
      if (player.bestStreak >= 2) {
        const small = document.createElement('small');
        small.textContent = `best x${comboForStreak(player.bestStreak).toFixed(1)}`;
        row.querySelector('.podium-name').appendChild(small);
      }
      dom.podium.appendChild(row);
    });

    const host = state.room?.hostId === state.playerId;
    dom.rematchBtn.hidden = !host;
    dom.rematchWait.hidden = host;

    setOverlay(dom.countdownOverlay, false);
    setOverlay(dom.lobbyOverlay, false);
    setOverlay(dom.resultsOverlay, true);
    setHudIdle(true);
    dom.hazardBanner.hidden = true;
    state.ownActive = false;
    if (me) {
      state.me = me;
    }
    audioEngine.raceEnd(iWon);
  }

  function renderCountdown() {
    if (state.phase !== 'countdown' || !state.room) return;
    const remaining = Math.max(0, state.room.startAt - nowEstimate());
    const count = Math.ceil(remaining / 1000);
    const display = count > 0 ? String(count) : 'GO';
    if (display !== dom.countdownNumber.textContent) {
      dom.countdownNumber.textContent = display;
      dom.countdownNumber.classList.remove('is-pop');
      // Restart the pop animation.
      void dom.countdownNumber.offsetWidth;
      dom.countdownNumber.classList.add('is-pop');
      if (!state.countdownBeeped.has(display)) {
        state.countdownBeeped.add(display);
        audioEngine.countdown(display === 'GO');
      }
    }
    if (count > 0) {
      dom.countdownTip.textContent =
        count === 3 ? 'Aim for the wire bin. Mind the fan.' : count === 2 ? 'Longer drag, more loft. Curves add spin.' : 'One last breath.';
    } else {
      dom.countdownTip.textContent = 'Tosses are live.';
    }
  }

  function updateTimerUi() {
    const room = state.room;
    if (!room) return;
    if (room.mode === 'practice') {
      dom.timerValue.textContent = '∞';
      dom.timerBar.style.transform = 'scaleX(1)';
      dom.timerBar.style.background = '';
      dom.timerCard.classList.remove('is-low');
      return;
    }
    if (room.status === 'lobby') {
      dom.timerValue.textContent = '--:--';
      dom.timerBar.style.transform = 'scaleX(1)';
      return;
    }
    const remaining = Math.max(0, (room.endsAt || 0) - nowEstimate());
    dom.timerValue.textContent = room.status === 'countdown' ? formatClock(room.endsAt - room.startAt) : formatClock(remaining);
    dom.timerValue.textContent = formatClock(remaining);
    const ratio = room.endsAt && room.startAt ? clamp(remaining / (room.endsAt - room.startAt), 0, 1) : 0;
    dom.timerBar.style.transform = `scaleX(${ratio})`;
    dom.timerCard.classList.toggle('is-low', remaining <= 10_000 && room.status === 'playing');
  }

  function canThrowNow() {
    if (!state.room || state.phase !== 'playing') return false;
    if (!state.socket?.connected || state.lostDuringRoom) return false;
    if (state.ownActive || state.throwPending) return false;
    if (nowEstimate() < state.ownReadyAt + 30) return false;
    return true;
  }

  function updateHint() {
    let text = 'Drag up to toss · curve your swipe for spin';
    if (state.phase === 'settling') text = 'Time. Letting the last tosses land…';
    else if (!state.room) text = '';
    else if (state.room.status === 'finished') text = 'Race complete.';
    else if (state.phase === 'playing' && (state.ownActive || state.throwPending)) text = 'Tissue ball in flight…';
    else if (state.phase === 'playing' && nowEstimate() < state.ownReadyAt) text = 'Crumpling the next ball…';
    else if (state.drag) {
      const pct = Math.round((state.drag.power || 0) * 100);
      const curve = Math.abs(state.drag.spin || 0) > 0.12 ? ` · curve ${Math.round(Math.abs(state.drag.spin) * 100)}%` : '';
      text = `POWER ${pct}% · ${state.drag.aim < -0.08 ? 'AIM LEFT' : state.drag.aim > 0.08 ? 'AIM RIGHT' : 'STRAIGHT ON'}${curve}`;
    }
    if (text !== state.lastHintText) {
      dom.tossHintText.textContent = text;
      state.lastHintText = text;
    }
    const idle = !state.drag && state.ownActive;
    dom.tossHint.classList.toggle('is-faded', Boolean(idle));
  }

  function updateWindUi() {
    const wind = state.wind;
    state.windTarget = state.windTarget || wind;
    const raw = clamp(state.wind.effective / 3, -1, 1);
    const percentage = 50 + raw * 46;
    dom.windNeedle.style.left = `${percentage}%`;
    dom.windKph.textContent = `${state.wind.kph.toFixed(1)} m/s`;
    dom.windDir.textContent = state.wind.direction === 'right' ? 'blowing right' : 'blowing left';
    const abs = Math.abs(state.wind.effective);
    const level = state.wind.turbo ? 'TURBO' : abs < 0.16 ? 'CALM' : abs < 0.45 ? 'BREEZE' : abs < 0.75 ? 'GUSTY' : 'WILD';
    dom.windLevel.textContent = level;
    dom.windCard.classList.toggle('is-turbo', Boolean(state.wind.turbo));
    dom.windLevel.style.color = state.wind.turbo ? 'var(--coral)' : '';
    audioEngine.setFanIntensity(abs, state.wind.turbo);
  }

  // ───────────────────────── networking ─────────────────────────
  function setupSocket() {
    if (typeof io !== 'function') {
      setLobbyMessage('The Socket.IO client failed to load. Check the server terminal.');
      setConnectedUI(false, 'Socket missing');
      return;
    }

    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;

    socket.on('connect', () => {
      setConnectedUI(true, 'Desk online');
      const wasLost = state.lostDuringRoom;
      if (wasLost && state.room) {
        dom.connectionMessage.textContent =
          'The connection is back, but your old seat was released when the link dropped. Head back to the lobby to start fresh.';
        dom.connectionHomeBtn.textContent = 'Back to lobby';
        setOverlay(dom.connectionOverlay, true);
      }
      state.connectedOnce = true;
    });

    socket.on('disconnect', (reason) => {
      setConnectedUI(false, reason === 'io client disconnect' ? 'Desk left' : 'Reconnecting…');
      if (state.room && !state.intentionalLeave) {
        state.lostDuringRoom = true;
        dom.connectionMessage.textContent =
          'The link to the desk dropped. We are trying to reconnect — your seat may be released while you are away.';
        dom.connectionHomeBtn.textContent = 'Leave to lobby';
        setOverlay(dom.connectionOverlay, true);
      }
    });

    socket.on('connect_error', () => {
      setConnectedUI(false, 'Can’t reach desk');
    });

    socket.on('room_state', (room) => {
      if (state.room && room.code !== state.room.code && room.mode !== 'practice') return;
      applyRoom(room);
    });

    socket.on('race_countdown', (payload) => {
      if (!state.room) return;
      syncClock(payload.serverNow);
      state.room.status = 'countdown';
      state.room.startAt = payload.startAt;
      state.room.endsAt = payload.endsAt;
      state.phase = 'countdown';
      state.results = null;
      state.ownActive = false;
      state.shots.clear();
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.resultsOverlay, false);
      setOverlay(dom.countdownOverlay, true);
      setHudIdle(true);
      renderCountdownRoster(state.room.players || []);
      state.countdownBeeped.clear();
      state.lastCountdownNumber = null;
    });

    socket.on('race_started', (payload) => {
      if (!state.room) return;
      syncClock(payload.serverNow);
      state.room.status = payload.status || 'playing';
      state.room.startAt = payload.startAt;
      state.room.endsAt = payload.endsAt;
      state.phase = 'playing';
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.resultsOverlay, false);
      setOverlay(dom.countdownOverlay, false);
      setHudIdle(false);
      startPlayableRound();
      audioEngine.startGun();
      showToast('Tosses are live. Drag up!', 'good');
    });

    socket.on('race_settling', (payload) => {
      if (!state.room) return;
      syncClock(payload.serverNow);
      state.room.status = 'settling';
      state.phase = 'settling';
      state.ownActive = false;
      dom.tossHint.classList.remove('is-faded');
      showToast('Time! Letting the last tosses land.', 'good');
      audioEngine.timeUp();
      updateHint();
    });

    socket.on('practice_started', () => {
      if (!state.room) return;
      state.phase = 'playing';
      state.room.status = 'playing';
      setOverlay(dom.lobbyOverlay, false);
      setHudIdle(false);
    });

    socket.on('environment', (payload) => {
      if (!state.room) return;
      syncClock(payload.serverNow);
      if (payload.wind) state.windTarget = payload.wind;
      if (Number.isFinite(payload.binX)) state.binTarget = payload.binX;
      if (Number.isFinite(payload.catX)) state.catTarget = payload.catX;
      if (payload.hazard) {
        state.hazard = payload.hazard;
        if (dom.hazardBanner.hidden) showHazard(payload.hazard);
      } else if (state.hazard) {
        state.hazard = null;
        dom.hazardBanner.hidden = true;
      }
    });

    socket.on('hazard_start', (payload) => {
      if (!state.room) return;
      const hazard = payload.hazard;
      if (!hazard) return;
      state.hazard = hazard;
      showHazard(hazard);
      const remaining = Math.max(0, hazard.endsAt - nowEstimate());
      showToast(`${hazard.label}: ${hazard.description}`, 'error');
      audioEngine.hazard(hazard.type, remaining / 1000);
      if (hazard.type === 'cat') {
        scene.flash = { color: '197, 163, 255', life: 1 };
      } else if (hazard.type === 'ac') {
        scene.flash = { color: '151, 211, 255', life: 1 };
      } else {
        scene.flash = { color: '245, 200, 107', life: 1 };
      }
    });

    socket.on('hazard_end', (payload) => {
      state.hazard = null;
      dom.hazardBanner.hidden = true;
      if (payload?.type) showToast(`${payload.type === 'cat' ? 'The cat' : payload.type === 'roomba' ? 'The roomba' : 'The AC'} has moved on.`, '');
    });

    socket.on('shot_start', (shot) => {
      if (!state.room) return;
      const isMine = shot.playerId === state.playerId;
      const entry = {
        id: shot.shotId,
        playerId: shot.playerId,
        nickname: shot.nickname,
        color: shot.color,
        x: shot.position.x,
        y: shot.position.y,
        z: shot.position.z,
        targetX: shot.position.x,
        targetY: shot.position.y,
        targetZ: shot.position.z,
        vx: shot.velocity?.x || 0,
        vy: shot.velocity?.y || 0,
        vz: shot.velocity?.z || 0,
        spin: shot.spin || 0,
        streak: shot.streak || 0,
        launchedAt: performance.now(),
        lastSample: performance.now(),
        resolved: false,
        resolvedAt: 0,
        result: null,
        trail: [],
        lastTrailAt: 0,
      };
      state.shots.set(shot.shotId, entry);
      if (isMine) {
        state.ownActive = true;
        state.throwPending = false;
        state.ownReadyAt = Infinity;
        scene.trailsDirty = true;
      } else {
        audioEngine.remoteWhoosh(shot.position.x);
      }
    });

    socket.on('frame', (payload) => {
      if (!state.room) return;
      if (Number.isFinite(payload.binX)) state.binTarget = payload.binX;
      if (Number.isFinite(payload.catX)) state.catTarget = payload.catX;
      const now = performance.now();
      for (const snapshot of payload.shots || []) {
        const shot = state.shots.get(snapshot.i);
        if (!shot || shot.resolved) continue;
        shot.targetX = snapshot.x;
        shot.targetY = snapshot.y;
        shot.targetZ = snapshot.z;
        shot.lastSample = now;
      }
    });

    socket.on('rim_hit', (payload) => {
      const p = project(payload.x, payload.y, payload.z);
      spawnSparks(p.x, p.y, '#ffd694', 12);
      scene.shake = Math.max(scene.shake, 4.2);
      audioEngine.clank();
    });

    socket.on('shot_result', (payload) => {
      if (!state.room) return;
      const shot = state.shots.get(payload.shotId);
      if (shot) {
        shot.resolved = true;
        shot.resolvedAt = performance.now();
        shot.result = payload;
        shot.targetX = payload.position.x;
        shot.targetY = payload.position.y;
        shot.targetZ = payload.position.z;
        shot.trail = shot.trail.slice(-42);
      }
      applyLeaderboard(payload.leaderboard || []);
      const isMine = payload.playerId === state.playerId;
      const p = project(payload.position.x, payload.position.y, payload.position.z);
      const bin = project(payload.binX || 0, 0.64, 6.05);
      const hit = payload.kind === 'swish' || payload.kind === 'rimIn';

      if (payload.kind === 'swish') {
        spawnConfetti(bin.x, bin.y, payload.points, payload.clean);
        addFloater(p.x, Math.min(p.y, bin.y) - 18, `+${payload.points}`, '#ffe0a1', isMine ? 20 : 14);
        if (payload.streak >= 2) addFloater(p.x, Math.min(p.y, bin.y) - 44, `${payload.streak} SWISH STREAK`, '#ff9d4d', isMine ? 12 : 9);
        if (isMine) {
          audioEngine.swish(payload.streak);
          scene.shake = Math.max(scene.shake, 5.5);
        } else {
          audioEngine.remoteSwish();
        }
      } else if (payload.kind === 'rimIn') {
        spawnConfetti(bin.x, bin.y, payload.points, false);
        addFloater(p.x, Math.min(p.y, bin.y) - 18, `RIM +${payload.points}`, '#b7f5e4', isMine ? 16 : 11);
        if (isMine) audioEngine.rimIn();
      } else if (payload.kind === 'blocked') {
        spawnPuff(p.x, p.y, '#c5a3ff', 16);
        addFloater(p.x, p.y - 16, 'CAT BLOCKED IT!', '#d8c1ff', isMine ? 15 : 11);
        if (isMine) audioEngine.blocked();
      } else if (isMine) {
        addFloater(p.x, p.y - 12, 'miss', '#7f8791', 12);
        audioEngine.miss();
      }

      if (isMine) {
        state.ownActive = false;
        state.throwPending = false;
        state.ownReadyAt = payload.readyAt || Date.now() - state.serverOffset + 400;
        state.me = getMe();
        updateMeUi();
      }

      if (hit && isMine) {
        dom.tossHint.classList.remove('is-faded');
      }
    });

    socket.on('race_end', (payload) => {
      if (!state.room) return;
      syncClock(payload.serverNow);
      state.ownActive = false;
      state.hazard = null;
      state.phase = 'finished';
      state.room.status = 'finished';
      dom.hazardBanner.hidden = true;
      showResults(payload);
      if (state.room?.players) {
        state.room.players = payload.leaderboard;
      }
      renderLeaderboard(payload.leaderboard);
    });

    socket.on('connect_error', () => {});
  }

  async function startRace() {
    ensureAudio();
    const result = await emitAck('start_race', {}, 5000);
    if (!result.ok) {
      showToast(result.error || 'Could not start the race.', 'error');
      return;
    }
    if (result.room) {
      applyRoom(result.room);
      state.room.status = 'countdown';
      state.phase = 'countdown';
      setOverlay(dom.lobbyOverlay, false);
      setOverlay(dom.resultsOverlay, false);
      setOverlay(dom.countdownOverlay, true);
      setHudIdle(true);
      renderCountdownRoster(result.room.players || []);
    }
  }

  async function rematch() {
    ensureAudio();
    const result = await emitAck('start_race', {}, 5000);
    if (!result.ok) {
      showToast(result.error || 'Could not start the rematch.', 'error');
      return;
    }
    state.results = null;
    setOverlay(dom.resultsOverlay, false);
    if (result.room) {
      applyRoom({ ...result.room, status: 'countdown' });
      state.phase = 'countdown';
      setOverlay(dom.countdownOverlay, true);
      setHudIdle(true);
    }
  }

  function leaveDesk() {
    state.intentionalLeave = true;
    if (state.socket?.connected) state.socket.emit('leave_room', {});
    backToHome('You left the desk.');
  }

  function backToHome(message = '') {
    audioEngine.stopFan();
    state.room = null;
    state.me = null;
    state.playerId = null;
    state.phase = 'home';
    state.ownActive = false;
    state.throwPending = false;
    state.results = null;
    state.hazard = null;
    state.shots.clear();
    state.drag = null;
    state.lostDuringRoom = false;
    state.intentionalLeave = false;
    state.serverOffset = 0;
    state.clockSynced = false;
    scene.running = false;
    if (scene.raf) cancelAnimationFrame(scene.raf);
    scene.raf = 0;
    setOverlay(dom.connectionOverlay, false);
    setOverlay(dom.lobbyOverlay, false);
    setOverlay(dom.countdownOverlay, false);
    setOverlay(dom.resultsOverlay, false);
    setHudIdle(false);
    dom.hazardBanner.hidden = true;
    dom.lobbyOverlay.hidden = true;
    setScreen('home');
    state.lastHintText = '';
    if (message) {
      setLobbyMessage(message);
      window.setTimeout(() => setLobbyMessage(''), 3600);
    }
  }

  async function copyRoomCode() {
    const code = state.room?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      dom.lobbyCodeBtn.querySelector('small').textContent = 'copied!';
      showToast(`Room ${code} copied. Bring a friend.`, 'good');
      window.setTimeout(() => {
        const small = dom.lobbyCodeBtn.querySelector('small');
        if (small) small.textContent = 'click to copy';
      }, 1800);
    } catch {
      showToast(`Room code: ${code}`, 'good');
    }
  }

  function updateSoundButton() {
    dom.soundBtn.classList.toggle('is-muted', state.soundMuted);
    dom.soundOnIcon.hidden = state.soundMuted;
    dom.soundOffIcon.hidden = !state.soundMuted;
    dom.soundBtn.setAttribute('aria-label', state.soundMuted ? 'Unmute sound' : 'Mute sound');
    dom.soundBtn.title = state.soundMuted ? 'Unmute sound' : 'Mute sound';
  }

  // ───────────────────────── canvas constants ─────────────────────────
  const RELEASE = { y: 0.25, z: 0.5 };
  const BIN = { z: 6.05, rimY: 0.64, inner: 0.34, outer: 0.5 };

  function project(x, y, z) {
    const w = scene.w;
    const h = scene.h;
    const persp = 1 / (1 + z * 0.12);
    const depth = clamp(z / BIN.z, 0, 1.4);
    const unit = Math.min(h * 0.5, Math.max(w * 0.24, 200));
    return {
      x: w / 2 + x * unit * persp,
      y: h * (0.97 - 0.345 * depth) - y * h * 0.36 * persp,
      scale: persp,
    };
  }

  function hexToRgba(hex, alpha = 1) {
    const clean = String(hex || '#ffffff').replace('#', '');
    const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const int = Number.parseInt(value, 16);
    if (!Number.isFinite(int)) return `rgba(255, 255, 255, ${alpha})`;
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function roundPath(ctx, x, y, width, height, radius) {
    const r = typeof radius === 'number' ? radius : Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function resizeCanvas() {
    const rect = dom.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (scene.canvas.width !== Math.round(width * dpr) || scene.canvas.height !== Math.round(height * dpr)) {
      scene.canvas.width = Math.round(width * dpr);
      scene.canvas.height = Math.round(height * dpr);
      scene.dpr = dpr;
      scene.w = width;
      scene.h = height;
      seedAmbient();
    } else {
      scene.w = width;
      scene.h = height;
      scene.dpr = dpr;
    }
  }

  function seedAmbient() {
    const w = scene.w || 1;
    const h = scene.h || 1;
    const fract = (n) => n - Math.floor(n);
    scene.motes = Array.from({ length: 26 }, (_, i) => ({
      x: fract(Math.sin(i * 12.9898) * 43758.5453),
      y: fract(Math.sin(i * 78.233) * 12515.873),
      speed: 0.002 + ((i * 7) % 10) / 3000,
      size: 0.6 + (i % 4) * 0.45,
      phase: i * 1.71,
      alpha: 0.05 + (i % 5) * 0.018,
    }));
    scene.streaks = Array.from({ length: 14 }, (_, i) => ({
      x: ((i * 0.083 + 0.19) % 1) * w,
      y: (0.19 + ((i * 0.137) % 1) * 0.52) * h,
      len: 20 + (i % 5) * 15,
      speed: 24 + (i % 4) * 19,
      phase: i * 1.37,
      alpha: 0.035 + (i % 4) * 0.014,
    }));
  }

  function startRender() {
    resizeCanvas();
    if (!scene.running) {
      scene.running = true;
      scene.lastTime = performance.now();
      scene.raf = requestAnimationFrame(renderLoop);
    }
  }

  function renderLoop(timestamp) {
    if (!scene.running || !state.room) {
      scene.running = false;
      return;
    }
    const dt = clamp((timestamp - scene.lastTime) / 1000, 0, 0.05);
    scene.lastTime = timestamp;
    scene.time += dt;

    if (timestamp - scene.lastResizeCheck > 400) {
      scene.lastResizeCheck = timestamp;
      const rect = dom.stage.getBoundingClientRect();
      if (Math.round(rect.width) !== scene.w || Math.round(rect.height) !== scene.h) resizeCanvas();
    }

    updateScene(dt);
    drawScene(timestamp);
    if (timestamp - state.lastUiUpdate > 45) {
      state.lastUiUpdate = timestamp;
      updateLiveUi();
    }
    scene.raf = requestAnimationFrame(renderLoop);
  }

  function updateScene(dt) {
    const windEase = 1 - Math.exp(-dt * 3.3);
    state.wind.raw = lerp(state.wind.raw, state.windTarget.raw ?? state.wind.raw, windEase);
    state.wind.effective = lerp(state.wind.effective, state.windTarget.effective ?? state.wind.effective, windEase);
    state.wind.kph = lerp(state.wind.kph, state.windTarget.kph ?? state.wind.kph, windEase);
    state.wind.turbo = Boolean(state.windTarget.turbo);
    state.wind.direction = state.wind.effective >= 0 ? 'right' : 'left';

    state.binX = lerp(state.binX, state.binTarget, 1 - Math.exp(-dt * 10));
    state.catX = lerp(state.catX, state.catTarget, 1 - Math.exp(-dt * 9));

    const now = performance.now();
    for (const [id, shot] of state.shots) {
      const ease = 1 - Math.exp(-dt * (shot.resolved ? 13 : 22));
      shot.x = lerp(shot.x, shot.targetX, ease);
      shot.y = lerp(shot.y, shot.targetY, ease);
      shot.z = lerp(shot.z, shot.targetZ, ease);

      if (!shot.resolved && now - shot.lastTrailAt > 22) {
        const last = shot.trail[shot.trail.length - 1];
        if (!last || Math.hypot(shot.x - last.x, shot.y - last.y, shot.z - last.z) > 0.006) {
          shot.trail.push({ x: shot.x, y: shot.y, z: shot.z, t: now });
          if (shot.trail.length > 100) shot.trail.shift();
        }
        shot.lastTrailAt = now;
      }

      if (shot.resolved && now - shot.resolvedAt > 900) {
        state.shots.delete(id);
      }
    }

    updateParticles(dt);
    scene.shake *= Math.exp(-dt * 9);
    if (scene.shake < 0.08) scene.shake = 0;
    if (scene.flash) {
      scene.flash.life -= dt * 2.1;
      if (scene.flash.life <= 0) scene.flash = null;
    }

    for (const mote of scene.motes) {
      mote.y -= mote.speed * (0.35 + Math.abs(state.wind.effective) * 0.2) * dt * 60;
      mote.x += Math.sin(scene.time * 0.35 + mote.phase) * 0.00004;
      if (mote.y < -0.05) mote.y = 1.05;
    }
    for (const streak of scene.streaks) {
      const dir = state.wind.effective >= 0 ? 1 : -1;
      streak.x += dir * (streak.speed + Math.abs(state.wind.effective) * 75) * dt * (0.25 + Math.abs(state.wind.effective));
      if (streak.x > scene.w + 80) streak.x = -80;
      if (streak.x < -80) streak.x = scene.w + 80;
    }

    if (!scene.running) return;
    if (state.drag) updateDragMeters();
  }

  function updateLiveUi() {
    updateTimerUi();
    updateWindUi();
    updateHazardBanner();
    updateHint();
    renderCountdown();
    updateSoundButtonIfNeeded();
    updateArenaLock();
    maybeCrumpleOnReady();
  }

  function updateSoundButtonIfNeeded() {
    const muted = state.soundMuted;
    if (state.soundMutedLast !== muted) {
      state.soundMutedLast = muted;
      updateSoundButton();
    }
  }

  // ───────────────────────── scene painting ─────────────────────────
  function drawScene(timestamp) {
    const ctx = scene.ctx;
    const w = scene.w;
    const h = scene.h;
    ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shakeX = scene.shake ? (Math.random() - 0.5) * scene.shake : 0;
    const shakeY = scene.shake ? (Math.random() - 0.5) * scene.shake * 0.7 : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawBackdrop(ctx, w, h);
    drawDesk(ctx, w, h);
    drawBackProps(ctx, w, h);
    drawBin(ctx);
    drawCat(ctx);
    drawFan(ctx, w, h);
    drawForegroundProps(ctx, w, h);
    drawWindMotes(ctx, w, h);
    drawShots(ctx, timestamp);
    drawRestBall(ctx);
    drawThrowGuide(ctx);
    drawParticles(ctx);
    if (scene.flash) {
      const alpha = Math.max(0, scene.flash.life) * 0.16;
      ctx.fillStyle = `rgba(${scene.flash.color}, ${alpha})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (state.hazard?.type === 'ac') {
      const pulse = 0.018 + Math.sin(scene.time * 1.7) * 0.009;
      ctx.fillStyle = `rgba(150, 205, 255, ${pulse})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  function drawBackdrop(ctx, w, h) {
    const wall = ctx.createLinearGradient(0, 0, 0, h * 0.66);
    wall.addColorStop(0, '#090e15');
    wall.addColorStop(0.48, '#101923');
    wall.addColorStop(1, '#19201f');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    const halo = ctx.createRadialGradient(w * 0.47, h * 0.42, 20, w * 0.47, h * 0.44, w * 0.38);
    halo.addColorStop(0, 'rgba(213, 174, 113, 0.11)');
    halo.addColorStop(0.52, 'rgba(150, 127, 92, 0.045)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // Vertical wall panels.
    const panelGap = Math.max(92, w / 10);
    ctx.lineWidth = 1;
    for (let x = panelGap * 0.45; x < w; x += panelGap) {
      const grad = ctx.createLinearGradient(x, h * 0.04, x, h * 0.62);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.035)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.04);
      ctx.lineTo(x, h * 0.6);
      ctx.stroke();
    }

    drawWindow(ctx, w, h);
    drawCorkboard(ctx, w, h);

    // Wall seam where the wall meets the desk.
    const seam = ctx.createLinearGradient(0, h * 0.56, 0, h * 0.63);
    seam.addColorStop(0, 'rgba(0, 0, 0, 0)');
    seam.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = seam;
    ctx.fillRect(0, h * 0.56, w, h * 0.08);

    drawPendant(ctx, w, h);
  }

  function drawWindow(ctx, w, h) {
    const wx = w * 0.055;
    const wy = h * 0.1;
    const ww = Math.min(w * 0.3, h * 0.45);
    const wh = h * 0.37;
    ctx.save();
    roundPath(ctx, wx, wy, ww, wh, 8);
    ctx.clip();

    const sky = ctx.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
    sky.addColorStop(0, '#07101a');
    sky.addColorStop(0.52, '#0e2030');
    sky.addColorStop(1, '#1b2831');
    ctx.fillStyle = sky;
    ctx.fillRect(wx, wy, ww, wh);

    // A foggy late-night moon.
    const moonX = wx + ww * 0.68;
    const moonY = wy + wh * 0.22;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, ww * 0.27);
    moonGlow.addColorStop(0, 'rgba(221, 228, 218, 0.25)');
    moonGlow.addColorStop(0.2, 'rgba(201, 214, 205, 0.1)');
    moonGlow.addColorStop(1, 'rgba(201, 214, 205, 0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(222, 226, 211, 0.62)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, Math.max(9, ww * 0.045), 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(207, 214, 204, 0.16)';
    ctx.beginPath();
    ctx.arc(moonX - ww * 0.012, moonY - ww * 0.01, ww * 0.032, 0, TAU);
    ctx.fill();

    // Stars.
    for (let i = 0; i < 24; i += 1) {
      const sx = wx + ((Math.sin(i * 24.17) * 43758.5453) % 1 + 1) % 1 * ww;
      const sy = wy + ((Math.sin(i * 81.31) * 1374.51) % 1 + 1) % 1 * wh * 0.55;
      const twinkle = 0.35 + Math.sin(scene.time * 0.8 + i) * 0.15;
      ctx.fillStyle = `rgba(220, 234, 235, ${twinkle * 0.36})`;
      ctx.fillRect(sx, sy, 1.2, 1.2);
    }

    // City skyline.
    const base = wy + wh;
    for (let i = 0; i < 22; i += 1) {
      const bw = ww * (0.035 + ((i * 13) % 5) * 0.008);
      const bh = wh * (0.08 + ((i * 7) % 9) * 0.027);
      const bx = wx + (i / 22) * ww;
      ctx.fillStyle = i % 3 === 0 ? '#121d24' : '#0b161e';
      ctx.fillRect(bx, base - bh, bw, bh);
      for (let j = 0; j < 4; j += 1) {
        if ((i + j * 3) % 4 !== 0) continue;
        ctx.fillStyle = `rgba(224, 187, 119, ${0.1 + ((i + j) % 3) * 0.055})`;
        ctx.fillRect(bx + bw * 0.25, base - bh + 6 + j * 9, Math.max(1, bw * 0.14), 2);
      }
    }

    // Rain drifting down the glass.
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i += 1) {
      const rx = wx + (((i * 37 + scene.time * 3) % ww) + ww) % ww;
      const ry = wy + (((i * 71 + scene.time * 24 + i * i) % wh) + wh) % wh;
      ctx.strokeStyle = `rgba(167, 200, 212, ${0.04 + (i % 3) * 0.018})`;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 1.2, ry + 9 + (i % 4) * 4);
      ctx.stroke();
    }

    const glassGlow = ctx.createLinearGradient(wx, wy, wx + ww, wy);
    glassGlow.addColorStop(0, 'rgba(126, 167, 181, 0.04)');
    glassGlow.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
    glassGlow.addColorStop(1, 'rgba(255, 214, 157, 0.045)');
    ctx.fillStyle = glassGlow;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.restore();

    // Frame.
    ctx.lineWidth = Math.max(5, ww * 0.018);
    ctx.strokeStyle = '#0a0e12';
    roundPath(ctx, wx, wy, ww, wh, 9);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(197, 185, 160, 0.17)';
    roundPath(ctx, wx + 3, wy + 3, ww - 6, wh - 6, 7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.5, wy);
    ctx.lineTo(wx + ww * 0.5, wy + wh);
    ctx.moveTo(wx, wy + wh * 0.62);
    ctx.lineTo(wx + ww, wy + wh * 0.62);
    ctx.stroke();

    // Sill.
    ctx.fillStyle = 'rgba(18, 23, 25, 0.9)';
    ctx.fillRect(wx - 7, wy + wh, ww + 14, 8);

    // Window light spill on the wall.
    const spill = ctx.createLinearGradient(wx + ww * 0.2, wy + wh, wx + ww * 0.6, h * 0.61);
    spill.addColorStop(0, 'rgba(129, 168, 181, 0.05)');
    spill.addColorStop(1, 'rgba(129, 168, 181, 0)');
    ctx.fillStyle = spill;
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh);
    ctx.lineTo(wx + ww, wy + wh);
    ctx.lineTo(wx + ww * 0.78, h * 0.63);
    ctx.lineTo(wx + ww * 0.05, h * 0.63);
    ctx.closePath();
    ctx.fill();
  }

  function drawCorkboard(ctx, w, h) {
    if (w < 640) return;
    const bx = w * 0.67;
    const by = h * 0.13;
    const bw = Math.min(w * 0.29, 340);
    const bh = h * 0.235;
    const board = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    board.addColorStop(0, '#32281f');
    board.addColorStop(1, '#211a15');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    roundPath(ctx, bx + 5, by + 6, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = board;
    roundPath(ctx, bx, by, bw, bh, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(202, 170, 122, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const notes = [
      { x: 0.08, y: 0.16, w: 0.25, h: 0.3, c: '#d8c395', rot: -0.055 },
      { x: 0.4, y: 0.1, w: 0.23, h: 0.25, c: '#9db8ab', rot: 0.045 },
      { x: 0.68, y: 0.22, w: 0.26, h: 0.35, c: '#b9a6a0', rot: -0.02 },
      { x: 0.26, y: 0.57, w: 0.3, h: 0.26, c: '#c1a06d', rot: 0.02 },
    ];
    for (const [index, note] of notes.entries()) {
      ctx.save();
      ctx.translate(bx + note.x * bw + note.w * bw * 0.5, by + note.y * bh + note.h * bh * 0.5);
      ctx.rotate(note.rot);
      ctx.fillStyle = `rgba(7, 8, 9, 0.3)`;
      ctx.fillRect(-note.w * bw * 0.5 + 2, -note.h * bh * 0.5 + 3, note.w * bw, note.h * bh);
      ctx.fillStyle = note.c;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(-note.w * bw * 0.5, -note.h * bh * 0.5, note.w * bw, note.h * bh);
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = '#3c352c';
      ctx.lineWidth = 0.7;
      for (let line = 0; line < 3; line += 1) {
        ctx.beginPath();
        ctx.moveTo(-note.w * bw * 0.32, -note.h * bh * 0.12 + line * note.h * bh * 0.15);
        ctx.lineTo(note.w * bw * 0.3, -note.h * bh * 0.12 + line * note.h * bh * 0.15 + (index === 2 ? 3 : 0));
        ctx.stroke();
      }
      if (index === 1) {
        // A very serious cat photo.
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#20251f';
        ctx.beginPath();
        ctx.arc(0, 3, note.h * bh * 0.22, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-note.h * bh * 0.2, -note.h * bh * 0.05);
        ctx.lineTo(-note.h * bh * 0.28, -note.h * bh * 0.24);
        ctx.lineTo(-note.h * bh * 0.04, -note.h * bh * 0.13);
        ctx.moveTo(note.h * bh * 0.2, -note.h * bh * 0.05);
        ctx.lineTo(note.h * bh * 0.28, -note.h * bh * 0.24);
        ctx.lineTo(note.h * bh * 0.04, -note.h * bh * 0.13);
        ctx.fill();
        ctx.fillStyle = '#d9b568';
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(-note.h * bh * 0.07, 1, 1.1, 0, TAU);
        ctx.arc(note.h * bh * 0.07, 1, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(30, 22, 20, 0.9)';
      ctx.beginPath();
      ctx.arc(0, -note.h * bh * 0.43, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPendant(ctx, w, h) {
    const x = w * 0.42;
    ctx.save();
    const cord = ctx.createLinearGradient(x, 0, x, h * 0.09);
    cord.addColorStop(0, 'rgba(10, 10, 10, 0)');
    cord.addColorStop(1, 'rgba(31, 30, 27, 0.8)');
    ctx.strokeStyle = cord;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h * 0.085);
    ctx.stroke();
    ctx.fillStyle = '#2a2721';
    ctx.beginPath();
    ctx.moveTo(x - 23, h * 0.115);
    ctx.quadraticCurveTo(x, h * 0.065, x + 23, h * 0.115);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(224, 192, 128, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 23, h * 0.115);
    ctx.quadraticCurveTo(x, h * 0.065, x + 23, h * 0.115);
    ctx.stroke();
    const glow = ctx.createRadialGradient(x, h * 0.14, 2, x, h * 0.14, h * 0.24);
    glow.addColorStop(0, 'rgba(255, 203, 123, 0.17)');
    glow.addColorStop(0.3, 'rgba(255, 203, 123, 0.06)');
    glow.addColorStop(1, 'rgba(255, 203, 123, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, h * 0.14, h * 0.24, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawDesk(ctx, w, h) {
    const backY = h * 0.56;
    const table = ctx.createLinearGradient(0, backY, 0, h);
    table.addColorStop(0, '#27211b');
    table.addColorStop(0.26, '#1d1915');
    table.addColorStop(0.8, '#151311');
    table.addColorStop(1, '#0e0e0d');
    ctx.fillStyle = table;
    ctx.beginPath();
    ctx.moveTo(-w * 0.03, backY);
    ctx.lineTo(w * 1.03, backY);
    ctx.lineTo(w * 1.08, h * 1.02);
    ctx.lineTo(-w * 0.08, h * 1.02);
    ctx.closePath();
    ctx.fill();

    // Back lip of the desk.
    ctx.fillStyle = '#0b0e0e';
    ctx.fillRect(0, backY - 9, w, 10);
    const lip = ctx.createLinearGradient(0, backY - 10, 0, backY + 11);
    lip.addColorStop(0, 'rgba(255, 224, 171, 0.16)');
    lip.addColorStop(1, 'rgba(255, 224, 171, 0)');
    ctx.fillStyle = lip;
    ctx.fillRect(0, backY - 10, w, 22);

    // Warm pool of light across the grain.
    const light = ctx.createRadialGradient(w * 0.42, h * 0.66, 10, w * 0.48, h * 0.72, w * 0.46);
    light.addColorStop(0, 'rgba(202, 151, 83, 0.08)');
    light.addColorStop(0.55, 'rgba(184, 132, 71, 0.025)');
    light.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, backY, w, h - backY);

    // Perspective wood grain.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-w * 0.03, backY);
    ctx.lineTo(w * 1.03, backY);
    ctx.lineTo(w * 1.08, h);
    ctx.lineTo(-w * 0.08, h);
    ctx.closePath();
    ctx.clip();
    ctx.lineWidth = 1;
    for (let i = 0; i < 15; i += 1) {
      const y = backY + h * 0.02 + i * h * 0.029;
      ctx.strokeStyle = `rgba(238, 194, 135, ${0.018 + (i % 4) * 0.006})`;
      ctx.beginPath();
      for (let x = -w * 0.05; x <= w * 1.05; x += 22) {
        const yy = y + Math.sin(x * 0.008 + i * 1.7) * (3 + i * 0.4) + Math.sin(x * 0.021 + i) * 1.4;
        if (x === -w * 0.05) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Crumbs and tiny imperfections on the desk.
    for (let i = 0; i < 24; i += 1) {
      const x = ((Math.sin(i * 43.71) * 783.21) % 1 + 1) % 1 * w;
      const y = h * 0.63 + ((Math.sin(i * 12.13) * 3.17) % 1 + 1) % 1 * h * 0.28;
      ctx.fillStyle = `rgba(231, 204, 157, ${0.04 + (i % 3) * 0.015})`;
      ctx.fillRect(x, y, 1 + (i % 3), 0.8);
    }
  }

  function drawBackProps(ctx, w, h) {
    // A sleepy little plant on the far-left back edge.
    const potX = w * 0.075;
    const potY = h * 0.54;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.ellipse(potX, potY + 7, 20, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b2620';
    ctx.beginPath();
    ctx.moveTo(potX - 15, potY - 12);
    ctx.lineTo(potX + 15, potY - 12);
    ctx.lineTo(potX + 11, potY + 5);
    ctx.lineTo(potX - 11, potY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(122, 140, 96, 0.36)';
    ctx.lineWidth = 1.3;
    const stems = [
      [-0.9, -30, -24], [-0.4, -42, -8], [0.2, -36, 12], [0.7, -28, 28], [1, -18, 36],
    ];
    for (const [lean, tipY, tipX] of stems) {
      ctx.beginPath();
      ctx.moveTo(potX, potY - 12);
      ctx.quadraticCurveTo(potX + tipX * 0.28, potY + tipY * 0.5, potX + tipX + lean * 4, potY + tipY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(116, 136, 91, 0.28)';
      ctx.beginPath();
      ctx.ellipse(potX + tipX + lean * 4, potY + tipY, 4.5, 2.4, lean * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Stack of folders, back-left.
    ctx.save();
    const stackX = w * 0.14;
    const stackY = h * 0.57;
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = ['#473d31', '#38322b', '#4f4638', '#342e28'][i];
      ctx.fillRect(stackX - i * 2, stackY - i * 6, 71, 7);
      ctx.fillStyle = 'rgba(230, 210, 171, 0.08)';
      ctx.fillRect(stackX - i * 2 + 5, stackY - i * 6, 48, 1);
    }
    ctx.fillStyle = '#181715';
    ctx.fillRect(stackX - 7, stackY - 28, 88, 3);
    ctx.restore();

    // The fancy stapler nobody uses.
    if (w > 700) {
      const sx = w * 0.83;
      const sy = h * 0.595;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-0.08);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 23, 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#353a3b';
      roundPath(ctx, -21, -8, 42, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#454b4c';
      roundPath(ctx, -17, -13, 31, 6, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-13, -10);
      ctx.lineTo(11, -10);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFan(ctx, w, h) {
    const wind = state.wind.effective;
    const baseGround = project(0, 0, 2.4).y;
    const cageR = clamp(h * 0.102, 43, 88);
    const baseX = w - clamp(w * 0.115, 57, 150);
    const centerY = baseGround - h * 0.225;
    const centerX = baseX + Math.sin(scene.time * 0.22) * 2 + wind * 2.2;
    const swing = Math.sin(scene.time * 0.19) * 0.05 + wind * 0.035;

    // Shadow under the stand.
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(baseX, baseGround + 1, cageR * 0.82, cageR * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Base and neck.
    ctx.save();
    ctx.fillStyle = '#181d1f';
    roundPath(ctx, baseX - cageR * 0.62, baseGround - cageR * 0.18, cageR * 1.24, cageR * 0.22, cageR * 0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(229, 201, 151, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#2a3234';
    roundPath(ctx, baseX - cageR * 0.12, baseGround - cageR * 1.24, cageR * 0.24, cageR * 1.1, cageR * 0.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(165, 187, 186, 0.16)';
    roundPath(ctx, baseX - cageR * 0.05, baseGround - cageR * 1.18, cageR * 0.05, cageR * 0.85, 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(centerX, centerY - cageR * 0.42);
    ctx.rotate(swing);

    // Back cage.
    const cageBack = ctx.createRadialGradient(-cageR * 0.22, -cageR * 0.26, 4, 0, 0, cageR);
    cageBack.addColorStop(0, 'rgba(51, 63, 66, 0.55)');
    cageBack.addColorStop(0.7, 'rgba(21, 29, 32, 0.72)');
    cageBack.addColorStop(1, 'rgba(7, 11, 13, 0.88)');
    ctx.fillStyle = cageBack;
    ctx.beginPath();
    ctx.arc(0, 0, cageR, 0, TAU);
    ctx.fill();

    // Blades.
    const spin = scene.time * (5.2 + Math.abs(wind) * 13 + (state.wind.turbo ? 12 : 0));
    ctx.save();
    ctx.rotate(spin);
    for (let i = 0; i < 5; i += 1) {
      ctx.save();
      ctx.rotate((i / 5) * TAU);
      const blade = ctx.createLinearGradient(0, 0, cageR * 0.8, 0);
      blade.addColorStop(0, 'rgba(169, 185, 180, 0.34)');
      blade.addColorStop(0.5, 'rgba(83, 101, 103, 0.19)');
      blade.addColorStop(1, 'rgba(163, 179, 174, 0.11)');
      ctx.fillStyle = blade;
      ctx.beginPath();
      ctx.ellipse(cageR * 0.42, 0, cageR * 0.43, cageR * 0.22, -0.44, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(208, 221, 214, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Blade hub.
    const hub = ctx.createRadialGradient(-3, -4, 1, 0, 0, cageR * 0.17);
    hub.addColorStop(0, '#7e8c89');
    hub.addColorStop(0.45, '#364143');
    hub.addColorStop(1, '#12191b');
    ctx.fillStyle = hub;
    ctx.beginPath();
    ctx.arc(0, 0, cageR * 0.17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 245, 216, 0.18)';
    ctx.stroke();

    // Front cage spokes.
    const rim = ctx.createLinearGradient(-cageR, -cageR, cageR, cageR);
    rim.addColorStop(0, 'rgba(166, 181, 173, 0.4)');
    rim.addColorStop(0.48, 'rgba(83, 99, 97, 0.5)');
    rim.addColorStop(1, 'rgba(214, 205, 178, 0.24)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(1, cageR * 0.014);
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * TAU + 0.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * cageR * 0.2, Math.sin(angle) * cageR * 0.2);
      ctx.lineTo(Math.cos(angle) * cageR * 0.98, Math.sin(angle) * cageR * 0.98);
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(2, cageR * 0.035);
    ctx.beginPath();
    ctx.arc(0, 0, cageR, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, cageR * 0.012);
    ctx.strokeStyle = 'rgba(189, 199, 188, 0.22)';
    ctx.beginPath();
    ctx.arc(0, 0, cageR * 0.78, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, cageR * 0.46, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232, 202, 149, 0.22)';
    ctx.beginPath();
    ctx.arc(0, 0, cageR * 0.99, Math.PI * 1.04, Math.PI * 1.62);
    ctx.stroke();

    // Taped paper flutter strips on the cage.
    const anchorX = -cageR * 0.92;
    const anchorY = cageR * 0.24;
    for (let i = 0; i < 3; i += 1) {
      const flutter = Math.sin(scene.time * (5.3 + i * 0.6) + i * 1.9 + wind * 2.2) * (3.5 + Math.abs(wind) * 8);
      const dir = wind >= 0 ? 1 : -1;
      const length = cageR * (0.24 + i * 0.04);
      ctx.save();
      ctx.translate(anchorX + i * 7, anchorY - i * 6);
      ctx.fillStyle = `rgba(225, 216, 192, ${0.25 + i * 0.06})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(dir * 4 + flutter * 0.55, length * 0.4, dir * 3 + flutter, length);
      ctx.lineTo(dir * 3 + flutter + 8, length + 2);
      ctx.quadraticCurveTo(dir * 8 + flutter * 0.6, length * 0.4, 8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(45, 43, 37, 0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }

    // Brand plate.
    ctx.fillStyle = 'rgba(225, 228, 214, 0.2)';
    ctx.font = `500 ${Math.max(6, cageR * 0.1)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('BREEZE·CO', 0, cageR * 0.4);
    ctx.restore();

    // Air curls leaving the fan.
    const gust = Math.abs(wind);
    if (gust > 0.15) {
      ctx.save();
      ctx.strokeStyle = `rgba(196, 217, 214, ${0.035 + gust * 0.035})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        const offset = Math.sin(scene.time * 1.9 + i * 2.3) * cageR * 0.25;
        const startX = centerX - cageR * (0.6 + i * 0.15);
        const y = centerY + offset;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.bezierCurveTo(startX - 50, y - 8, startX - 110, y + 15, startX - 180, y - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawBin(ctx) {
    const base = project(state.binX, 0, BIN.z);
    const rim = project(state.binX, BIN.rimY, BIN.z);
    const rx = Math.abs(project(state.binX + 0.34, BIN.rimY, BIN.z).x - rim.x);
    const ry = Math.max(5, rx * 0.3);
    const bottomRx = rx * 0.76;
    const baseY = base.y;
    const isRoomba = state.hazard?.type === 'roomba';

    // Floor shadow.
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(base.x, baseY + 5, rx * 1.18, ry * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (isRoomba) {
      drawRoombaBase(ctx, base.x, baseY, rx, base.y - rim.y);
    }

    const bodyTop = rim.y + ry * 0.15;
    const bodyBottom = baseY - 3;

    // Dark metal body, slightly tapered.
    ctx.save();
    const body = ctx.createLinearGradient(rim.x - rx, rim.y, rim.x + rx, baseY);
    body.addColorStop(0, '#1a2021');
    body.addColorStop(0.3, '#333b3a');
    body.addColorStop(0.58, '#171c1e');
    body.addColorStop(1, '#0d1113');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(rim.x - rx, bodyTop);
    ctx.quadraticCurveTo(rim.x - rx * 0.96, baseY - 10, rim.x - bottomRx, bodyBottom);
    ctx.quadraticCurveTo(rim.x, baseY + 7, rim.x + bottomRx, bodyBottom);
    ctx.quadraticCurveTo(rim.x + rx * 0.96, baseY - 10, rim.x + rx, bodyTop);
    ctx.closePath();
    ctx.fill();

    // Clip mesh to the body.
    ctx.clip();
    const meshGlow = ctx.createLinearGradient(0, rim.y, 0, baseY);
    meshGlow.addColorStop(0, 'rgba(219, 208, 179, 0.12)');
    meshGlow.addColorStop(0.4, 'rgba(0, 0, 0, 0)');
    meshGlow.addColorStop(1, 'rgba(130, 151, 146, 0.05)');
    ctx.fillStyle = meshGlow;
    ctx.fillRect(rim.x - rx, rim.y, rx * 2, baseY - rim.y + 8);

    ctx.strokeStyle = 'rgba(163, 178, 169, 0.27)';
    ctx.lineWidth = 1;
    for (let i = -7; i <= 7; i += 1) {
      const t = i / 7;
      const topX = rim.x + t * rx * 0.97;
      const topY = rim.y + ry * 0.35;
      const botX = rim.x + t * bottomRx;
      const botY = bodyBottom + Math.sqrt(Math.max(0, 1 - t * t)) * 2;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(rim.x + t * bottomRx * 1.05, (topY + botY) * 0.5, botX, botY);
      ctx.stroke();
    }
    for (let row = 0; row < 5; row += 1) {
      const t = row / 5;
      const y = lerp(bodyTop + 3, bodyBottom - 1, t);
      const rowRx = lerp(rx * 0.97, bottomRx, t);
      ctx.beginPath();
      ctx.ellipse(rim.x, y, rowRx, ry * (0.3 - t * 0.11), 0, 0, Math.PI);
      ctx.stroke();
    }
    // Diagonal lattice accents.
    ctx.strokeStyle = 'rgba(167, 180, 171, 0.12)';
    ctx.lineWidth = 0.7;
    for (let i = -5; i <= 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(rim.x + i * rx * 0.2 - rx * 0.1, rim.y + 7);
      ctx.lineTo(rim.x + i * rx * 0.17 + rx * 0.12, baseY - 4);
      ctx.stroke();
    }
    ctx.restore();

    // Interior opening.
    ctx.fillStyle = '#050809';
    ctx.beginPath();
    ctx.ellipse(rim.x, rim.y, rx * 0.94, ry * 0.84, 0, 0, TAU);
    ctx.fill();
    const interior = ctx.createRadialGradient(rim.x, rim.y + 2, 1, rim.x, rim.y + 2, rx);
    interior.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    interior.addColorStop(0.72, 'rgba(15, 19, 19, 0.55)');
    interior.addColorStop(1, 'rgba(108, 113, 100, 0.13)');
    ctx.fillStyle = interior;
    ctx.beginPath();
    ctx.ellipse(rim.x, rim.y, rx * 0.88, ry * 0.72, 0, 0, TAU);
    ctx.fill();
    // The lonely paper already inside.
    ctx.fillStyle = 'rgba(208, 198, 178, 0.24)';
    ctx.beginPath();
    ctx.ellipse(rim.x - rx * 0.17, rim.y + ry * 0.18, rx * 0.21, ry * 0.2, -0.4, 0, TAU);
    ctx.fill();

    // Metal rim.
    const rimGrad = ctx.createLinearGradient(rim.x - rx, rim.y - ry, rim.x + rx, rim.y + ry);
    rimGrad.addColorStop(0, 'rgba(218, 198, 155, 0.65)');
    rimGrad.addColorStop(0.25, 'rgba(112, 123, 120, 0.8)');
    rimGrad.addColorStop(0.6, 'rgba(216, 201, 170, 0.45)');
    rimGrad.addColorStop(1, 'rgba(74, 82, 79, 0.7)');
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = Math.max(2.2, rx * 0.055);
    ctx.beginPath();
    ctx.ellipse(rim.x, rim.y, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 241, 203, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(rim.x, rim.y - 1.5, rx * 0.98, ry * 0.88, 0, Math.PI * 1.02, Math.PI * 1.82);
    ctx.stroke();

    // Feet.
    ctx.strokeStyle = 'rgba(164, 168, 155, 0.28)';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(rim.x + side * bottomRx * 0.63, baseY - 2);
      ctx.lineTo(rim.x + side * bottomRx * 0.76, baseY + 5);
      ctx.stroke();
    }

    // Tiny reflective label.
    ctx.save();
    ctx.translate(rim.x + rx * 0.32, baseY - (baseY - rim.y) * 0.36);
    ctx.rotate(-0.035);
    ctx.fillStyle = 'rgba(9, 12, 13, 0.62)';
    roundPath(ctx, -14, -6, 28, 12, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(191, 185, 156, 0.14)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = 'rgba(214, 204, 173, 0.27)';
    ctx.font = `500 5.5px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('PAPER', 0, -0.5);
    ctx.fillStyle = 'rgba(214, 204, 173, 0.15)';
    ctx.fillText('ONLY', 0, 4.5);
    ctx.restore();
  }

  function drawRoombaBase(ctx, x, y, rx, binHeight) {
    ctx.save();
    const bob = Math.sin(scene.time * 8) * 0.9;
    ctx.translate(x, y + 3 + bob);
    const discW = rx * 1.78;
    const discH = rx * 0.38;
    // Treads.
    ctx.fillStyle = '#0a0d0e';
    roundPath(ctx, -discW * 0.56, -discH * 0.7, discW * 1.12, discH * 1.36, discH * 0.38);
    ctx.fill();
    ctx.strokeStyle = 'rgba(171, 180, 163, 0.18)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * discW * 0.13, -discH * 0.62);
      ctx.lineTo(i * discW * 0.13, discH * 0.58);
      ctx.stroke();
    }
    // Body.
    const body = ctx.createLinearGradient(0, -discH, 0, discH);
    body.addColorStop(0, '#363f3f');
    body.addColorStop(0.5, '#171d1e');
    body.addColorStop(1, '#0a0e0f');
    ctx.fillStyle = body;
    roundPath(ctx, -discW * 0.5, -discH * 0.85, discW, discH, discH * 0.45);
    ctx.fill();
    ctx.strokeStyle = 'rgba(235, 211, 162, 0.16)';
    ctx.stroke();
    // Glowing sensor strip.
    const glow = 0.48 + Math.sin(scene.time * 6) * 0.2;
    ctx.fillStyle = `rgba(110, 231, 207, ${glow})`;
    ctx.fillRect(-discW * 0.2, -discH * 0.36, discW * 0.4, 1.5);
    ctx.fillStyle = 'rgba(255, 127, 116, 0.5)';
    ctx.beginPath();
    ctx.arc(discW * 0.33, -discH * 0.2, 1.5, 0, TAU);
    ctx.fill();
    // Little brushes.
    ctx.strokeStyle = 'rgba(165, 177, 161, 0.2)';
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * discW * 0.39, discH * 0.1);
      ctx.lineTo(side * discW * 0.57, discH * 0.4);
      ctx.stroke();
    }
    // Motion dashes.
    ctx.strokeStyle = 'rgba(207, 216, 198, 0.08)';
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-discW * 0.7 - i * 12, -discH * 0.1 + i * 4);
      ctx.lineTo(-discW * 0.6 - i * 12, -discH * 0.1 + i * 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCat(ctx) {
    if (!state.hazard || state.hazard.type !== 'cat') return;
    const ground = project(state.catX, 0, 5.55);
    const scale = clamp(scene.h / 650, 0.82, 1.45);
    const walk = scene.time * 7.2;
    const nearBin = Math.abs(state.catX - state.binX) < 0.9;
    ctx.save();
    ctx.translate(ground.x, ground.y);
    ctx.scale(scale, scale);

    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 61, 11, 0, 0, TAU);
    ctx.fill();

    const dark = '#17191b';
    const mid = '#25292b';
    const rimLight = 'rgba(226, 195, 143, 0.22)';

    // Tail.
    ctx.strokeStyle = dark;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-38, -49);
    ctx.bezierCurveTo(-68, -54, -71, -93, -51, -97);
    ctx.bezierCurveTo(-38, -99, -40, -83, -49, -82);
    ctx.stroke();
    ctx.strokeStyle = rimLight;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-39, -52);
    ctx.bezierCurveTo(-63, -58, -66, -90, -52, -93);
    ctx.stroke();

    // Back legs.
    for (const [baseX, phase] of [[-27, 0.2], [17, 2.3]]) {
      const swing = Math.sin(walk + phase) * 7;
      ctx.strokeStyle = '#141616';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(baseX, -35);
      ctx.quadraticCurveTo(baseX + swing * 0.2, -17, baseX + swing, -2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214, 189, 145, 0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(baseX + 1, -31);
      ctx.lineTo(baseX + swing, -4);
      ctx.stroke();
    }

    // Body.
    const bodyGrad = ctx.createLinearGradient(0, -84, 0, -25);
    bodyGrad.addColorStop(0, '#2c3031');
    bodyGrad.addColorStop(0.55, mid);
    bodyGrad.addColorStop(1, '#121415');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(-4, -58, 43, 29, -0.04, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rimLight;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(-4, -58, 42, 28, -0.04, Math.PI * 1.08, Math.PI * 1.85);
    ctx.stroke();

    // Front legs.
    for (const [baseX, phase] of [[21, 0.8], [-12, 2.7]]) {
      const swing = Math.sin(walk + phase) * 8;
      ctx.strokeStyle = '#141616';
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(baseX, -38);
      ctx.quadraticCurveTo(baseX + swing * 0.12, -20, baseX + swing, -2);
      ctx.stroke();
    }

    // Cream chest patch.
    ctx.fillStyle = 'rgba(208, 195, 169, 0.3)';
    ctx.beginPath();
    ctx.ellipse(20, -51, 14, 19, 0.35, 0, TAU);
    ctx.fill();

    // Head.
    const headX = 34;
    const headY = -77 + Math.sin(walk) * 1.3;
    ctx.fillStyle = '#282c2d';
    ctx.beginPath();
    ctx.arc(headX, headY, 21, 0, TAU);
    ctx.fill();
    // Ears.
    ctx.fillStyle = '#1b1e1f';
    ctx.beginPath();
    ctx.moveTo(headX - 17, headY - 10);
    ctx.lineTo(headX - 23, headY - 31);
    ctx.lineTo(headX - 4, headY - 19);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX + 12, headY - 16);
    ctx.lineTo(headX + 22, headY - 34);
    ctx.lineTo(headX + 24, headY - 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(203, 154, 157, 0.26)';
    ctx.beginPath();
    ctx.moveTo(headX - 15, headY - 14);
    ctx.lineTo(headX - 19, headY - 26);
    ctx.lineTo(headX - 7, headY - 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX + 16, headY - 18);
    ctx.lineTo(headX + 21, headY - 29);
    ctx.lineTo(headX + 21, headY - 14);
    ctx.closePath();
    ctx.fill();

    // Muzzle and nose.
    ctx.fillStyle = 'rgba(203, 189, 160, 0.34)';
    ctx.beginPath();
    ctx.ellipse(headX + 11, headY + 7, 10, 7, 0.16, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(231, 172, 168, 0.5)';
    ctx.beginPath();
    ctx.moveTo(headX + 14, headY + 3);
    ctx.lineTo(headX + 18, headY + 4);
    ctx.lineTo(headX + 16, headY + 7);
    ctx.closePath();
    ctx.fill();

    // Eyes, with just enough judgment.
    const blink = Math.sin(scene.time * 1.15) > 0.965 ? 0.15 : 1;
    ctx.fillStyle = 'rgba(224, 179, 91, 0.8)';
    ctx.beginPath();
    ctx.ellipse(headX + 5, headY - 4, 3.1, 3.1 * blink, 0.1, 0, TAU);
    ctx.ellipse(headX + 17, headY - 3, 2.7, 2.7 * blink, 0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0d1112';
    ctx.beginPath();
    ctx.ellipse(headX + 5.7, headY - 4, 1.1, 2.4 * blink, 0.1, 0, TAU);
    ctx.ellipse(headX + 17.5, headY - 3, 1, 2.1 * blink, 0.1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 213, 194, 0.35)';
    ctx.lineWidth = 0.7;
    for (const dy of [-1, 3]) {
      ctx.beginPath();
      ctx.moveTo(headX + 17, headY + 4 + dy * 0.5);
      ctx.lineTo(headX + 34, headY - 2 + dy);
      ctx.stroke();
    }
    // Rim highlight.
    ctx.strokeStyle = 'rgba(229, 196, 137, 0.17)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(headX, headY, 20, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();

    if (nearBin) {
      ctx.fillStyle = 'rgba(197, 163, 255, 0.78)';
      ctx.font = `600 7px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('BLOCKING', 2, -118);
    }
    ctx.restore();
  }

  function drawForegroundProps(ctx, w, h) {
    // A notebook at the bottom-left, forever open to an empty page.
    if (w > 520) {
      ctx.save();
      ctx.translate(w * 0.065, h * 0.88);
      ctx.rotate(-0.13);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      roundPath(ctx, -96, -34, 205, 135, 8);
      ctx.fill();
      const cover = ctx.createLinearGradient(-90, -30, 100, 100);
      cover.addColorStop(0, '#24292b');
      cover.addColorStop(1, '#101416');
      ctx.fillStyle = cover;
      roundPath(ctx, -103, -42, 205, 135, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(235, 223, 195, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#c7c1b3';
      roundPath(ctx, -92, -35, 187, 118, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(56, 54, 48, 0.1)';
      for (let i = 0; i < 8; i += 1) {
        ctx.fillRect(-77, -20 + i * 13, 155, 0.8);
      }
      ctx.strokeStyle = 'rgba(115, 75, 41, 0.35)';
      ctx.beginPath();
      ctx.moveTo(-78, -24);
      ctx.lineTo(-78, 72);
      ctx.stroke();
      // Pencil.
      ctx.save();
      ctx.translate(62, 10);
      ctx.rotate(0.44);
      ctx.fillStyle = '#ba9348';
      ctx.fillRect(-5, -12, 10, 120);
      ctx.fillStyle = '#ddc78f';
      ctx.fillRect(-5, -12, 4, 120);
      ctx.fillStyle = '#e7c9a0';
      ctx.beginPath();
      ctx.moveTo(-5, 108);
      ctx.lineTo(0, 124);
      ctx.lineTo(5, 108);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1b1b19';
      ctx.beginPath();
      ctx.moveTo(-2, 119);
      ctx.lineTo(0, 124);
      ctx.lineTo(2, 119);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b77f88';
      ctx.fillRect(-5, -21, 10, 10);
      ctx.restore();
      ctx.restore();
    }

    // Coffee. Cold. Forgotten.
    if (w > 380) {
      const mx = w * 0.825;
      const my = h * 0.73;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(mx, my + 26, 31, 7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#302e2b';
      roundPath(ctx, mx - 22, my - 5, 44, 36, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(225, 207, 174, 0.17)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#161a1b';
      ctx.beginPath();
      ctx.ellipse(mx, my - 5, 20, 6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(164, 136, 95, 0.4)';
      ctx.beginPath();
      ctx.ellipse(mx, my - 5, 16, 4, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#302e2b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(mx + 29, my + 10, 12, Math.PI * 0.65, Math.PI * 1.45);
      ctx.stroke();
      // Steam.
      ctx.strokeStyle = 'rgba(218, 212, 195, 0.09)';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(mx - 5 + i * 10, my - 15);
        ctx.bezierCurveTo(
          mx - 9 + i * 10 + Math.sin(scene.time * 0.8 + i) * 4,
          my - 29,
          mx - 4 + i * 10 + Math.cos(scene.time * 0.7 + i) * 6,
          my - 42,
          mx - 8 + i * 10,
          my - 54
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    // A few failed attempts on the desk corners.
    for (const [px, py, r, tilt, alpha] of [
      [w * 0.27, h * 0.9, 11, 0.4, 0.55],
      [w * 0.74, h * 0.92, 15, -0.7, 0.6],
      [w * 0.86, h * 0.82, 8, 0.2, 0.42],
    ]) {
      drawCrumpledShape(ctx, px, py, r, '#d8d1c0', alpha, tilt);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
      ctx.beginPath();
      ctx.ellipse(px + 4, py + r * 1.2, r * 1.2, r * 0.3, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawWindMotes(ctx, w, h) {
    // Dust in the lamp cone.
    ctx.save();
    for (const mote of scene.motes) {
      const x = (mote.x + 0.38) * w + Math.sin(scene.time * 0.4 + mote.phase) * 12;
      const y = mote.y * h;
      ctx.fillStyle = `rgba(229, 213, 176, ${mote.alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.size, 0, TAU);
      ctx.fill();
    }
    // Air streaks when the fan is doing its job.
    const gust = Math.abs(state.wind.effective);
    if (gust > 0.18) {
      ctx.lineWidth = 0.8;
      for (const streak of scene.streaks) {
        ctx.strokeStyle = `rgba(207, 221, 216, ${streak.alpha * (0.4 + gust * 0.8)})`;
        ctx.beginPath();
        ctx.moveTo(streak.x, streak.y);
        ctx.quadraticCurveTo(streak.x + 12, streak.y - 3.5, streak.x + streak.len, streak.y + 1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function updateTrailForShot(shot) {
    if (shot.resolved) return;
    const now = performance.now();
    if (now - shot.lastTrailAt < 22) return;
    const last = shot.trail[shot.trail.length - 1];
    if (!last || Math.hypot(shot.x - last.x, shot.y - last.y, shot.z - last.z) > 0.006) {
      shot.trail.push({ x: shot.x, y: shot.y, z: shot.z, t: now });
      if (shot.trail.length > 100) shot.trail.shift();
    }
    shot.lastTrailAt = now;
  }

  function drawShots(ctx, timestamp) {
    const shots = [...state.shots.values()].filter((shot) => shot.trail || !shot.resolved);
    if (!shots.length) return;
    shots.sort((a, b) => b.z - a.z);
    const now = performance.now();

    // Ghost arcs first, then balls.
    for (const shot of shots) {
      updateTrailForShot(shot);
      const isMine = shot.playerId === state.playerId;
      const fade = shot.resolved ? clamp(1 - (now - shot.resolvedAt) / 850, 0, 1) : 1;
      if (!shot.trail.length || fade <= 0) continue;
      const color = shot.color || '#f5c86b';
      const trailAlpha = (isMine ? 0.52 : 0.24) * fade;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const total = shot.trail.length;
      for (let i = 1; i < total; i += 1) {
        const a = shot.trail[i - 1];
        const b = shot.trail[i];
        const p1 = project(a.x, a.y, a.z);
        const p2 = project(b.x, b.y, b.z);
        const t = i / total;
        ctx.strokeStyle = hexToRgba(color, trailAlpha * (0.12 + t * 0.88));
        ctx.lineWidth = (isMine ? 2.1 : 1.35) * (0.35 + t * 0.65);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // A little heat on hot streaks.
      if (shot.streak >= 2) {
        ctx.globalCompositeOperation = 'lighter';
        const start = Math.max(1, total - 38);
        for (let i = start; i < total; i += 2) {
          const p = shot.trail[i];
          const pos = project(p.x, p.y, p.z);
          const age = (i - start) / Math.max(1, total - start);
          const wobble = Math.sin(scene.time * 12 + i * 1.8) * 3;
          const radius = (isMine ? 5.5 : 3) * (0.35 + age * 0.8);
          const grad = ctx.createRadialGradient(pos.x + wobble, pos.y - 2, 0, pos.x + wobble, pos.y - 2, radius * 2.8);
          grad.addColorStop(0, `rgba(255, 236, 165, ${trailAlpha * 0.22})`);
          grad.addColorStop(0.45, `rgba(255, 132, 44, ${trailAlpha * 0.17})`);
          grad.addColorStop(1, 'rgba(255, 72, 22, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pos.x + wobble, pos.y - 2, radius * 2.8, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }

    for (const shot of shots) {
      const isMine = shot.playerId === state.playerId;
      const fade = shot.resolved ? clamp(1 - (now - shot.resolvedAt) / 800, 0, 1) : 1;
      if (fade <= 0) continue;
      const pos = project(shot.x, shot.y, shot.z);
      const ground = project(shot.x, 0, shot.z);
      const ballRadius = clamp(Math.abs(project(shot.x + 0.11, shot.y, shot.z).x - pos.x), 7, 27);
      const shadowAlpha = 0.23 * clamp(1 - shot.y / 2.7, 0.06, 1) * fade;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y - 1, ballRadius * (1.1 + shot.y * 0.18), ballRadius * 0.27, 0, 0, TAU);
      ctx.fill();

      // Halo ring for every ball.
      ctx.globalAlpha = fade * (isMine ? 0.26 : 0.12);
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = isMine ? 1.4 : 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, ballRadius * 1.42, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = fade;

      drawCrumpledShape(ctx, pos.x, pos.y, ballRadius, '#ddd5c5', isMine ? 1 : 0.58, scene.time * 3 + shot.id, shot.color);

      if (!isMine) {
        const label = shot.nickname || 'guest';
        ctx.font = `500 ${Math.max(7, Math.round(ballRadius * 0.46))}px ${MONO}`;
        const labelWidth = ctx.measureText(label.toUpperCase()).width + 9;
        ctx.fillStyle = 'rgba(9, 13, 17, 0.66)';
        roundPath(ctx, pos.x - labelWidth / 2, pos.y - ballRadius - 16, labelWidth, 13, 6);
        ctx.fill();
        ctx.fillStyle = hexToRgba(shot.color, 0.75);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.toUpperCase(), pos.x, pos.y - ballRadius - 9.2);
      }
      ctx.restore();
    }
  }

  function drawCrumpledShape(ctx, x, y, radius, baseColor, alpha = 1, rotation = 0, accent = null) {
    if (radius < 0.2) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation);

    // Main irregular paper blob.
    const points = 11;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * TAU;
      const wobble = 0.86 + Math.sin(i * 7.3 + radius) * 0.07 + Math.cos(i * 2.4 + 1.2) * 0.045;
      const px = Math.cos(angle) * radius * wobble;
      const py = Math.sin(angle) * radius * wobble * 0.96;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const fill = ctx.createRadialGradient(-radius * 0.34, -radius * 0.42, radius * 0.08, 0, 0, radius * 1.16);
    fill.addColorStop(0, '#fffaf0');
    fill.addColorStop(0.4, baseColor);
    fill.addColorStop(0.78, '#afa695');
    fill.addColorStop(1, '#6f6b63');
    ctx.fillStyle = fill;
    ctx.fill();

    if (accent) {
      ctx.strokeStyle = hexToRgba(accent, 0.42);
      ctx.lineWidth = Math.max(0.8, radius * 0.07);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(54, 51, 45, 0.22)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i += 1) {
      const angle = i * 1.8 + radius * 0.1;
      ctx.lineWidth = Math.max(0.45, radius * 0.05);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.12, Math.sin(angle) * radius * 0.12);
      ctx.quadraticCurveTo(
        Math.cos(angle + 0.7) * radius * 0.42,
        Math.sin(angle + 0.7) * radius * 0.42,
        Math.cos(angle - 0.18) * radius * 0.69,
        Math.sin(angle - 0.18) * radius * 0.69
      );
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.27, -radius * 0.38, radius * 0.22, radius * 0.11, -0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRestBall(ctx) {
    if (!state.room) return;
    if (state.phase !== 'playing' && state.phase !== 'countdown') return;
    if (state.ownActive) return;
    if (state.room.status !== 'playing' && state.room.status !== 'countdown') return;

    const ready = canThrowNow();
    const pos = project(0, RELEASE.y + Math.sin(scene.time * 1.6) * 0.006, RELEASE.z);
    const radius = clamp(Math.abs(project(0.11, RELEASE.y, RELEASE.z).x - pos.x), 10, 26);
    const ground = project(0, 0, RELEASE.z);
    ctx.save();
    // Soft shadow on the desk below the ball.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.33)';
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, radius * 1.3, radius * 0.28, 0, 0, TAU);
    ctx.fill();

    // Ready halo.
    if (ready) {
      const pulse = 0.55 + Math.sin(scene.time * 2.5) * 0.18;
      ctx.strokeStyle = hexToRgba(getMe()?.color || '#f5c86b', 0.2 * pulse);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y - 1, radius * 1.85, radius * 0.45, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawCrumpledShape(ctx, pos.x, pos.y, radius, '#e4dccb', 1, scene.time * 0.16, getMe()?.color || '#f5c86b');
    if (ready) {
      ctx.strokeStyle = hexToRgba(getMe()?.color || '#f5c86b', 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 1.42, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawThrowGuide(ctx) {
    if (!state.drag || !canThrowNow()) return;
    const drag = state.drag;
    const preview = buildPreview(drag.power, drag.aim, drag.spin);
    const start = project(0, RELEASE.y, RELEASE.z);
    const color = getMe()?.color || '#f5c86b';
    ctx.save();
    ctx.lineCap = 'round';

    // Pull tether.
    ctx.strokeStyle = hexToRgba(color, 0.22);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(drag.x, drag.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(color, 0.45);
    ctx.beginPath();
    ctx.arc(drag.x, drag.y, 3, 0, TAU);
    ctx.fill();

    // A dotted arc showing where the toss is headed right now.
    if (preview.points.length > 2) {
      const grad = ctx.createLinearGradient(start.x, start.y, preview.points[preview.points.length - 1].x, preview.points[preview.points.length - 1].y);
      grad.addColorStop(0, hexToRgba(color, 0.12));
      grad.addColorStop(0.55, hexToRgba(color, 0.4));
      grad.addColorStop(1, hexToRgba(color, 0.06));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      preview.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Predicted landing ring.
    if (preview.crossing) {
      const target = project(preview.crossing.x, BIN.rimY, preview.crossing.z);
      const good = Math.abs(preview.crossing.z - BIN.z) < BIN.inner && Math.abs(preview.crossing.x - state.binX) < BIN.inner;
      const ringColor = good ? '#9ae58a' : color;
      ctx.strokeStyle = hexToRgba(ringColor, 0.6);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.ellipse(target.x, target.y, 18, 7, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexToRgba(ringColor, 0.65);
      ctx.beginPath();
      ctx.arc(target.x, target.y, 2, 0, TAU);
      ctx.fill();
    }

    // Power ring around the resting ball.
    const power = clamp(drag.power, 0, 1);
    ctx.strokeStyle = hexToRgba(color, 0.2);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 29, -Math.PI / 2, -Math.PI / 2 + TAU);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 29, -Math.PI / 2, -Math.PI / 2 + TAU * power);
    ctx.stroke();

    // Spin tick marks.
    if (Math.abs(drag.spin) > 0.08) {
      const direction = drag.spin > 0 ? 1 : -1;
      ctx.strokeStyle = hexToRgba('#c5a3ff', 0.48);
      ctx.lineWidth = 1.3;
      for (let i = 0; i < 3; i += 1) {
        const radius = 34 + i * 5;
        ctx.beginPath();
        ctx.arc(
          start.x + Math.sin(scene.time * 2 + i) * 2,
          start.y,
          radius,
          -Math.PI * 0.18,
          Math.PI * 0.18 + direction * 0.1
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function buildPreview(power, aim, spin) {
    let x = 0;
    let y = RELEASE.y;
    let z = RELEASE.z;
    let vx = aim * 1.35;
    let vy = 4.1 + clamp(power, 0.06, 1) * 2.2;
    let vz = 4.7 + clamp(power, 0.06, 1) * 1.9;
    const accel = (state.wind.effective || 0) * 0.44;
    const spinAccel = clamp(spin, -1, 1) * 1.15;
    const dt = 1 / 60;
    const points = [];
    let crossing = null;
    for (let i = 0; i < 180; i += 1) {
      vx += (accel + spinAccel) * dt;
      vy += -9.8 * dt;
      const previousY = y;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (i % 4 === 0) {
        const point = project(x, y, z);
        points.push(point);
      }
      if (!crossing && previousY > BIN.rimY && y <= BIN.rimY && vy < 0) {
        crossing = { x, z };
      }
      if (y < -0.2 || z > 8.8) break;
    }
    return { points, crossing };
  }

  // ───────────────────────── effects ─────────────────────────
  function spawnSparks(x, y, color, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 30 + Math.random() * 110;
      scene.particles.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 0.8 + Math.random() * 1.4,
        color,
        rotation: angle,
        spin: (Math.random() - 0.5) * 8,
        gravity: 220,
      });
    }
  }

  function spawnConfetti(x, y, points, clean) {
    const count = clamp(16 + Math.round(points / 12), 16, 46);
    const colors = clean ? ['#f5c86b', '#ffe6ae', '#6ee7cf', '#f4eee2'] : ['#b7f5e4', '#f5c86b', '#ddd6c8'];
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 2.4;
      const speed = 45 + Math.random() * 180;
      scene.particles.push({
        type: 'confetti',
        x: x + (Math.random() - 0.5) * 20,
        y: y - 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.7 + Math.random() * 0.8,
        maxLife: 1.5,
        size: 2 + Math.random() * 4,
        color: colors[i % colors.length],
        rotation: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 12,
        gravity: 230,
      });
    }
    // A pulse ring at the rim.
    scene.particles.push({
      type: 'ring',
      x,
      y,
      life: 0.7,
      maxLife: 0.7,
      size: 5,
      color: clean ? '#f5c86b' : '#b7f5e4',
    });
  }

  function spawnPuff(x, y, color, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      scene.particles.push({
        type: 'puff',
        x,
        y,
        vx: Math.cos(angle) * (12 + Math.random() * 25),
        vy: Math.sin(angle) * (8 + Math.random() * 20) - 10,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        size: 3 + Math.random() * 7,
        color,
        rotation: 0,
        spin: 0,
        gravity: -10,
      });
    }
  }

  function addFloater(x, y, text, color, size = 15) {
    scene.floaters.push({
      x,
      y,
      text,
      color,
      size,
      life: 1.25,
      maxLife: 1.25,
    });
    if (scene.floaters.length > 12) scene.floaters.shift();
  }

  function updateParticles(dt) {
    for (let i = scene.particles.length - 1; i >= 0; i -= 1) {
      const p = scene.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        scene.particles.splice(i, 1);
        continue;
      }
      if (p.type === 'confetti' || p.type === 'spark') {
        p.vy += (p.gravity || 200) * dt;
        p.vx *= 1 - dt * 1.8;
        p.vy *= 1 - dt * 0.25;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += (p.spin || 0) * dt;
      } else if (p.type === 'puff') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 2;
        p.vy *= 1 - dt * 2;
      }
    }
    for (let i = scene.floaters.length - 1; i >= 0; i -= 1) {
      const f = scene.floaters[i];
      f.life -= dt;
      f.y -= dt * 28;
      if (f.life <= 0) scene.floaters.splice(i, 1);
    }
  }

  function drawParticles(ctx) {
    for (const p of scene.particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      if (p.type === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.62);
      } else if (p.type === 'spark') {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(p.rotation) * p.size * 3, p.y - Math.sin(p.rotation) * p.size * 3);
        ctx.stroke();
      } else if (p.type === 'ring') {
        ctx.globalAlpha = t * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, (1 - t) * 48 + 6, (1 - t) * 17 + 3, 0, 0, TAU);
        ctx.stroke();
      } else if (p.type === 'puff') {
        ctx.globalAlpha = t * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.7 - t), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const f of scene.floaters) {
      const t = clamp(f.life / f.maxLife, 0, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.save();
      ctx.globalAlpha = ease;
      ctx.font = `600 ${f.size}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(5, 8, 10, 0.55)';
      ctx.fillText(f.text, f.x + 1.5, f.y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  // ───────────────────────── procedural audio ─────────────────────────
  const audioEngine = (() => {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let fan = null;
    let fanLevel = 0;
    let fanTurbo = false;

    function ensure() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      }
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      try {
        ctx = new AudioCtor();
        master = ctx.createGain();
        master.gain.value = state.soundMuted ? 0 : 0.78;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 22;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.2;
        master.connect(compressor).connect(ctx.destination);

        const length = Math.floor(ctx.sampleRate * 2);
        noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          last = last * 0.52 + white * 0.48;
          data[i] = last * 0.9 + white * 0.1;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      } catch {
        return null;
      }
    }

    function setMuted(muted) {
      state.soundMuted = muted;
      localStorage.setItem('pt-muted', muted ? '1' : '0');
      updateSoundButton();
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 0.78, ctx.currentTime, 0.035);
      }
      if (!muted) ensure();
    }

    function pannerNode(pan = 0) {
      if (!ctx) return null;
      if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        p.connect(master);
        return p;
      }
      return master;
    }

    function noiseSource(when, duration) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      src.start(when, Math.random() * 1.6);
      src.stop(when + duration + 0.06);
      return src;
    }

    function noiseHit(opts = {}) {
      if (!ctx || state.soundMuted) return;
      const {
        duration = 0.22,
        gain = 0.08,
        filter = 'bandpass',
        freq = 1100,
        freqEnd = null,
        q = 0.8,
        attack = 0.006,
        delay = 0,
        pan = 0,
      } = opts;
      const when = ctx.currentTime + delay;
      const src = noiseSource(when, duration);
      const biquad = ctx.createBiquadFilter();
      biquad.type = filter;
      biquad.frequency.setValueAtTime(freq, when);
      if (freqEnd) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), when + duration);
      biquad.Q.value = q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      const dest = pannerNode(pan);
      src.connect(biquad).connect(env).connect(dest || master);
    }

    function tone(opts = {}) {
      if (!ctx || state.soundMuted) return;
      const {
        freq = 440,
        freqEnd = null,
        type = 'sine',
        duration = 0.2,
        gain = 0.05,
        attack = 0.005,
        delay = 0,
        pan = 0,
        release = duration,
      } = opts;
      const when = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, when);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), when + release);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      const dest = pannerNode(pan);
      osc.connect(env).connect(dest || master);
      osc.start(when);
      osc.stop(when + duration + 0.03);
    }

    function crumple() {
      if (!ctx || state.soundMuted) return;
      for (let i = 0; i < 5; i += 1) {
        noiseHit({
          duration: 0.035 + Math.random() * 0.06,
          gain: 0.028 + Math.random() * 0.028,
          filter: 'bandpass',
          freq: 780 + Math.random() * 2200,
          q: 0.7 + Math.random() * 1.1,
          delay: i * (0.022 + Math.random() * 0.028),
          pan: (Math.random() - 0.5) * 0.2,
        });
      }
      tone({ freq: 150, freqEnd: 90, type: 'sine', duration: 0.09, gain: 0.018 });
    }

    function whoosh(power = 0.5, aim = 0) {
      if (!ctx) ensure();
      if (!ctx || state.soundMuted) return;
      noiseHit({
        duration: 0.24 + power * 0.12,
        gain: 0.055 + power * 0.04,
        filter: 'bandpass',
        freq: 320 + power * 320,
        freqEnd: 1500 + power * 900,
        q: 1.1,
        attack: 0.015,
        pan: clamp(aim * -0.55, -0.8, 0.8),
      });
      noiseHit({
        duration: 0.28,
        gain: 0.035,
        filter: 'highpass',
        freq: 2000,
        q: 0.5,
        attack: 0.025,
        delay: 0.025,
        pan: clamp(aim * -0.4, -0.6, 0.6),
      });
      tone({ freq: 130, freqEnd: 65, duration: 0.18, gain: 0.035, type: 'triangle' });
    }

    function remoteWhoosh(x = 0) {
      if (!ctx || state.soundMuted) return;
      const pan = clamp((x || 0) * 0.1, -0.4, 0.4);
      noiseHit({
        duration: 0.22,
        gain: 0.018,
        filter: 'bandpass',
        freq: 380,
        freqEnd: 1600,
        q: 1,
        attack: 0.02,
        pan,
      });
    }

    function clank() {
      if (!ctx || state.soundMuted) return;
      const now = ctx.currentTime;
      [1660, 2380, 3200, 4210].forEach((freq, i) => {
        tone({
          freq: freq * (0.98 + Math.random() * 0.04),
          freqEnd: freq * 0.94,
          type: 'triangle',
          duration: 0.13 + i * 0.022,
          gain: 0.014 / (i * 0.35 + 1),
          attack: 0.002,
          pan: -0.08 + i * 0.04,
        });
      });
      noiseHit({ duration: 0.06, gain: 0.028, filter: 'highpass', freq: 2400, attack: 0.001 });
      tone({ freq: 148, freqEnd: 88, type: 'sine', duration: 0.16, gain: 0.045, attack: 0.003 });
      // A tiny metal shimmer after the hit.
      tone({ freq: 5280, freqEnd: 4600, type: 'sine', duration: 0.2, gain: 0.008, delay: 0.015 });
    }

    function swish(streak = 1) {
      if (!ctx || state.soundMuted) return;
      for (let i = 0; i < 4; i += 1) {
        noiseHit({
          duration: 0.08 + Math.random() * 0.1,
          gain: 0.032 + Math.random() * 0.038,
          filter: 'bandpass',
          freq: 900 + Math.random() * 1700,
          q: 0.65,
          delay: i * 0.045,
          pan: (Math.random() - 0.5) * 0.25,
        });
      }
      // Quiet pitched sparkle under the paper.
      const base = 523.25 * Math.pow(2, Math.min(streak - 1, 5) * 2 / 12);
      tone({ freq: base, type: 'sine', duration: 0.32, gain: 0.025, attack: 0.008 });
      tone({ freq: base * 1.5, type: 'triangle', duration: 0.25, gain: 0.013, delay: 0.035 });
      tone({ freq: base * 2, type: 'sine', duration: 0.22, gain: 0.008, delay: 0.08 });
    }

    function remoteSwish() {
      if (!ctx || state.soundMuted) return;
      noiseHit({ duration: 0.22, gain: 0.018, filter: 'bandpass', freq: 1500, freqEnd: 2400, q: 0.8 });
    }

    function rimIn() {
      clank();
      window.setTimeout(() => swish(1), 70);
    }

    function miss() {
      if (!ctx || state.soundMuted) return;
      noiseHit({ duration: 0.14, gain: 0.018, filter: 'bandpass', freq: 700, freqEnd: 280, q: 0.6 });
      tone({ freq: 196, freqEnd: 146, type: 'sine', duration: 0.16, gain: 0.012 });
    }

    function blocked() {
      if (!ctx || state.soundMuted) return;
      // A deeply unserious cat noise.
      const when = ctx.currentTime;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(470, when);
      osc.frequency.linearRampToValueAtTime(720, when + 0.09);
      osc.frequency.linearRampToValueAtTime(530, when + 0.18);
      osc.frequency.linearRampToValueAtTime(350, when + 0.29);
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.04, when + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
      const dest = pannerNode(-0.15);
      osc.connect(env).connect(dest || master);
      osc.start(when);
      osc.stop(when + 0.35);
      noiseHit({ duration: 0.08, gain: 0.02, filter: 'lowpass', freq: 500 });
    }

    function hazard(type, seconds = 7) {
      if (!ctx || state.soundMuted) return;
      // Attention sting.
      [0, 0.12, 0.24].forEach((delay, i) => {
        tone({
          freq: i === 2 ? 660 : 330,
          type: 'triangle',
          duration: 0.14,
          gain: 0.034,
          delay,
        });
      });
      if (type === 'cat') {
        blocked();
      } else if (type === 'ac') {
        noiseHit({ duration: Math.min(1.5, seconds * 0.26), gain: 0.05, filter: 'lowpass', freq: 500, freqEnd: 1300, q: 0.7, attack: 0.18 });
        noiseHit({ duration: 1.1, gain: 0.03, filter: 'bandpass', freq: 1400, q: 0.8, attack: 0.25, delay: 0.05 });
      } else if (type === 'roomba') {
        tone({ freq: 96, freqEnd: 126, type: 'sawtooth', duration: 1.2, gain: 0.02, attack: 0.1 });
        tone({ freq: 510, type: 'sine', duration: 0.2, gain: 0.018, delay: 0.1 });
      }
    }

    function countdown(go = false) {
      if (!ctx || state.soundMuted) return;
      tone({
        freq: go ? 660 : 330,
        freqEnd: go ? 880 : null,
        type: 'sine',
        duration: go ? 0.18 : 0.09,
        gain: go ? 0.045 : 0.028,
      });
      if (go) {
        tone({ freq: 990, type: 'triangle', duration: 0.2, gain: 0.022, delay: 0.03 });
      }
    }

    function startGun() {
      if (!ctx || state.soundMuted) return;
      noiseHit({ duration: 0.14, gain: 0.035, filter: 'highpass', freq: 800, attack: 0.004 });
      tone({ freq: 440, freqEnd: 660, type: 'sine', duration: 0.28, gain: 0.035 });
    }

    function timeUp() {
      if (!ctx || state.soundMuted) return;
      tone({ freq: 294, type: 'triangle', duration: 0.18, gain: 0.035 });
      tone({ freq: 220, type: 'triangle', duration: 0.35, gain: 0.028, delay: 0.19 });
      noiseHit({ duration: 0.28, gain: 0.022, filter: 'highpass', freq: 1800, delay: 0.02 });
    }

    function raceEnd(iWon) {
      if (!ctx || state.soundMuted) return;
      const notes = iWon ? [523.25, 659.25, 783.99, 1046.5] : [392, 493.88, 587.33];
      notes.forEach((freq, i) => {
        tone({
          freq,
          type: 'triangle',
          duration: 0.45,
          gain: iWon ? 0.03 : 0.02,
          delay: i * 0.11,
          attack: 0.015,
        });
      });
      if (iWon) {
        noiseHit({ duration: 0.6, gain: 0.018, filter: 'highpass', freq: 2800, delay: 0.15 });
      }
    }

    function startFan() {
      if (!ensure() || fan) return;
      const bus = ctx.createGain();
      bus.gain.value = 0.0001;
      bus.connect(master);

      const air = ctx.createBufferSource();
      air.buffer = noiseBuffer;
      air.loop = true;
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.value = 210;
      airFilter.Q.value = 0.6;
      const airGain = ctx.createGain();
      airGain.gain.value = 0.05;
      air.connect(airFilter).connect(airGain).connect(bus);

      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 53;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.018;
      hum.connect(humGain).connect(bus);

      const whir = ctx.createOscillator();
      whir.type = 'triangle';
      whir.frequency.value = 106;
      const whirGain = ctx.createGain();
      whirGain.gain.value = 0.006;
      whir.connect(whirGain).connect(bus);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.34;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.009;
      lfo.connect(lfoGain).connect(airFilter.frequency);

      air.start();
      hum.start();
      whir.start();
      lfo.start();
      fan = { bus, air, airFilter, hum, whir, lfo, level: 0 };
      applyFanLevel();
    }

    function applyFanLevel() {
      if (!fan || !ctx) return;
      const target = state.soundMuted ? 0.0001 : 0.008 + fanLevel * 0.035 + (fanTurbo ? 0.012 : 0);
      fan.bus.gain.cancelScheduledValues(ctx.currentTime);
      fan.bus.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
      fan.airFilter.frequency.cancelScheduledValues(ctx.currentTime);
      fan.airFilter.frequency.setTargetAtTime(150 + fanLevel * 220 + (fanTurbo ? 170 : 0), ctx.currentTime, 0.3);
    }

    function setFanIntensity(level = 0, turbo = false) {
      fanLevel = clamp(level, 0, 3);
      fanTurbo = Boolean(turbo);
      if (fan && ctx) applyFanLevel();
    }

    function stopFan() {
      if (!fan || !ctx) {
        fan = null;
        return;
      }
      const old = fan;
      fan = null;
      try {
        old.bus.gain.cancelScheduledValues(ctx.currentTime);
        old.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
        window.setTimeout(() => {
          try {
            old.air.stop();
            old.hum.stop();
            old.whir.stop();
            old.lfo.stop();
          } catch {}
        }, 500);
      } catch {}
    }

    return {
      ensure,
      setMuted,
      crumple,
      whoosh,
      remoteWhoosh,
      clank,
      swish,
      remoteSwish,
      rimIn,
      miss,
      blocked,
      hazard,
      countdown,
      startGun,
      timeUp,
      raceEnd,
      startFan,
      setFanIntensity,
      stopFan,
    };
  })();

  function ensureAudio() {
    audioEngine.ensure();
  }

  function maybeCrumpleOnReady() {
    if (!state.room || state.phase !== 'playing' || state.ownActive || state.throwPending) return;
    if (nowEstimate() < state.ownReadyAt + 40) return;
    const signature = state.ownReadyAt || 1;
    if (state.lastCrumpleSignature === signature) return;
    state.lastCrumpleSignature = signature;
    audioEngine.crumple();
  }

  // ───────────────────────── swipe input ─────────────────────────
  function canvasPoint(event) {
    const rect = scene.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function dragMaxForViewport() {
    return clamp(Math.min(scene.w || window.innerWidth, scene.h || window.innerHeight) * 0.34, 150, 270);
  }

  function gestureSpin(points) {
    if (points.length < 4) return 0;
    let total = 0;
    for (let i = 2; i < points.length; i += 1) {
      const a = points[i - 2];
      const b = points[i - 1];
      const c = points[i];
      const ax = b.x - a.x;
      const ay = b.y - a.y;
      const bx = c.x - b.x;
      const by = c.y - b.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 4 || lb < 4) continue;
      const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      if (Math.abs(angle) > 1.15) continue;
      total += angle * (0.55 + (i / points.length) * 0.6);
    }
    if (Math.abs(total) < 0.1) return 0;
    return clamp(total / 1.35, -1, 1);
  }

  function updateDragMeters() {
    if (!state.drag) return;
    const drag = state.drag;
    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY;
    const distance = Math.hypot(dx, dy);
    const maxDrag = drag.maxDrag || dragMaxForViewport();
    drag.distance = distance;
    drag.power = clamp(distance / maxDrag, 0, 1);
    drag.aim = clamp((dx / maxDrag) * 1.35, -1, 1);
    drag.spin = gestureSpin(drag.points);
  }

  function beginDrag(event) {
    if (!state.room || state.phase !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!canThrowNow()) return;
    ensureAudio();
    const point = canvasPoint(event);
    const maxDrag = dragMaxForViewport();
    state.drag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      points: [{ x: point.x, y: point.y, t: performance.now() }],
      maxDrag,
      power: 0,
      aim: 0,
      spin: 0,
      distance: 0,
    };
    try {
      scene.canvas.setPointerCapture(event.pointerId);
    } catch {}
    scene.canvas.classList.add('is-dragging');
    scene.canvas.classList.remove('is-locked');
    event.preventDefault();
    audioEngine.crumple();
  }

  function moveDrag(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (state.phase !== 'playing') {
      cancelDrag();
      return;
    }
    const point = canvasPoint(event);
    state.drag.x = point.x;
    state.drag.y = point.y;
    const last = state.drag.points[state.drag.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= 4) {
      state.drag.points.push({ x: point.x, y: point.y, t: performance.now() });
      if (state.drag.points.length > 32) state.drag.points.shift();
    }
    updateDragMeters();
    event.preventDefault();
  }

  function endDrag(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const drag = state.drag;
    const point = canvasPoint(event);
    drag.x = point.x;
    drag.y = point.y;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) >= drag.maxDrag * 0.02) {
      drag.points.push({ x: point.x, y: point.y, t: performance.now() });
    }
    updateDragMeters();

    const dy = drag.y - drag.startY;
    const distance = Math.hypot(drag.x - drag.startX, dy);
    const upward = dy < -18;

    if (!canThrowNow()) {
      cancelDrag();
      return;
    }

    if (!upward || distance < 26 || drag.power < 0.08) {
      scene.canvas.classList.remove('is-dragging');
      state.drag = null;
      if (distance > 55 && !upward) showToast('Swipe upward to toss the paper.', 'error');
      event.preventDefault();
      return;
    }

    const throwData = { power: drag.power, aim: drag.aim, spin: drag.spin };
    state.drag = null;
    scene.canvas.classList.remove('is-dragging');
    state.ownActive = true;
    state.throwPending = true;
    state.ownReadyAt = Infinity;
    dom.tossHint.classList.add('is-faded');
    audioEngine.whoosh(throwData.power, throwData.aim);
    navigator.vibrate?.(12);
    sendThrow(throwData);
    event.preventDefault();
  }

  function cancelDrag() {
    if (!state.drag) return;
    const pointerId = state.drag.pointerId;
    state.drag = null;
    scene.canvas.classList.remove('is-dragging');
    try {
      scene.canvas.releasePointerCapture(pointerId);
    } catch {}
  }

  function sendThrow(data) {
    if (!state.socket?.connected) {
      state.ownActive = false;
      state.throwPending = false;
      state.ownReadyAt = Date.now() - state.serverOffset + 350;
      showToast('No connection. That toss stayed in your pocket.', 'error');
      return;
    }
    state.socket.emit('throw_ball', data, (response) => {
      if (!response?.ok) {
        state.ownActive = false;
        state.throwPending = false;
        state.ownReadyAt = Date.now() - state.serverOffset + 260;
        showToast(response?.error || 'The desk rejected that toss.', 'error');
      } else {
        state.throwPending = false;
      }
    });
    window.setTimeout(() => {
      if (state.throwPending) {
        state.throwPending = false;
        if (!state.ownActive) {
          state.ownReadyAt = Date.now() - state.serverOffset + 300;
        }
      }
    }, 2200);
  }

  function updateArenaLock() {
    const locked = !canThrowNow();
    scene.canvas.classList.toggle('is-locked', locked);
    if (state.drag && !canThrowNow() && !state.ownActive) cancelDrag();
  }

  // ───────────────────────── UI wiring ─────────────────────────
  function bindUi() {
    dom.createBtn.addEventListener('click', createRoom);
    dom.joinBtn.addEventListener('click', joinRoom);
    dom.soloBtn.addEventListener('click', soloPractice);
    dom.startRaceBtn.addEventListener('click', startRace);
    dom.rematchBtn.addEventListener('click', rematch);
    dom.copyRoomCode = copyRoomCode;

    dom.leaveBtn.addEventListener('click', leaveDesk);
    dom.resultsLeaveBtn.addEventListener('click', leaveDesk);
    dom.gameBrand.addEventListener('click', (event) => {
      event.preventDefault();
      leaveDesk();
    });

    dom.roomChip.addEventListener('click', copyRoomCode);
    dom.lobbyCodeBtn.addEventListener('click', copyRoomCode);

    dom.soundBtn.addEventListener('click', () => {
      ensureAudio();
      audioEngine.setMuted(!state.soundMuted);
    });

    dom.connectionHomeBtn.addEventListener('click', () => {
      if (state.socket?.connected) state.socket.emit('leave_room', {});
      backToHome('Back at the lobby. The desk will be ready when you are.');
    });

    dom.nickname.addEventListener('input', () => {
      if (dom.lobbyError.textContent) setLobbyMessage('');
    });
    dom.nickname.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createRoom();
      }
    });

    dom.roomCodeInput.addEventListener('input', () => {
      dom.roomCodeInput.value = dom.roomCodeInput.value
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 4);
      if (dom.lobbyError.textContent) setLobbyMessage('');
    });
    dom.roomCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinRoom();
      }
    });

    window.addEventListener('resize', () => {
      if (state.room) resizeCanvas();
    });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => {
        if (state.room) resizeCanvas();
      }, 220);
    });

    const canvas = scene.canvas;
    canvas.addEventListener('pointerdown', beginDrag, { passive: false });
    canvas.addEventListener('pointermove', moveDrag, { passive: false });
    canvas.addEventListener('pointerup', endDrag, { passive: false });
    canvas.addEventListener('pointercancel', (event) => {
      if (state.drag?.pointerId === event.pointerId) cancelDrag();
    });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (state.drag?.pointerId === event.pointerId) cancelDrag();
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelDrag();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.drag) cancelDrag();
    });

    // Any gesture on the page is a chance to unlock Web Audio.
    document.addEventListener('pointerdown', () => ensureAudio(), { capture: true });
  }

  function init() {
    const savedNickname = localStorage.getItem('pt-nickname');
    if (savedNickname) dom.nickname.value = savedNickname.slice(0, 16);
    updateSoundButton();
    bindUi();
    setupSocket();
    // Focus is nice on desktop, noisy on touch devices.
    if (window.matchMedia('(pointer: fine)').matches) {
      window.setTimeout(() => dom.nickname.focus(), 350);
    }
  }

  init();
})();

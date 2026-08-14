const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/host.html'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 15 * 1024 * 1024 }); // 15MB per message, enough for a compressed image/GIF or short video clip

// ---------- Helpers ----------
function genCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids confusion
  let c = '';
  for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

function getLanIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  Object.values(ifaces).forEach((list) => {
    (list || []).forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    });
  });
  return ips;
}

function sampleBoard() {
  const mk = (value, clue, answer) => ({ value, clue, answer, used: false, media: null, dd: false });
  return {
    categories: [
      { name: 'Science', clues: [
        mk(100, "This gas makes up about 78% of Earth's atmosphere.", 'What is nitrogen?'),
        mk(200, 'The powerhouse of the cell.', 'What is the mitochondria?'),
        mk(300, 'This force keeps planets in orbit around the sun.', 'What is gravity?'),
        mk(400, 'The chemical symbol Au represents this element.', 'What is gold?'),
        mk(500, 'This scientist developed the theory of general relativity.', 'Who is Albert Einstein?')
      ]},
      { name: 'World Capitals', clues: [
        mk(100, 'Capital of France.', 'What is Paris?'),
        mk(200, 'Capital of Japan.', 'What is Tokyo?'),
        mk(300, 'Capital of Egypt.', 'What is Cairo?'),
        mk(400, 'Capital of Australia (not Sydney).', 'What is Canberra?'),
        mk(500, 'Capital of Canada.', 'What is Ottawa?')
      ]},
      { name: 'Movies', clues: [
        mk(100, 'This 1997 film features a ship called the Titanic.', 'What is Titanic?'),
        mk(200, 'Pixar film about a rat who wants to cook.', 'What is Ratatouille?'),
        mk(300, 'This trilogy follows Frodo Baggins to Mordor.', 'What is The Lord of the Rings?'),
        mk(400, 'Director known for Jaws, E.T., and Jurassic Park.', 'Who is Steven Spielberg?'),
        mk(500, "This 1994 film's title character sits on a bench sharing his life story.", 'What is Forrest Gump?')
      ]},
      { name: 'Math', clues: [
        mk(100, 'The sum of the interior angles of a triangle, in degrees.', 'What is 180?'),
        mk(200, 'This number is approximately 3.14159.', 'What is pi?'),
        mk(300, 'A number that is only divisible by 1 and itself.', 'What is a prime number?'),
        mk(400, 'The square root of 144.', 'What is 12?'),
        mk(500, 'This theorem relates the sides of a right triangle.', 'What is the Pythagorean theorem?')
      ]},
      { name: 'Wordplay', clues: [
        mk(100, 'A word that reads the same backward and forward.', 'What is a palindrome?'),
        mk(200, 'Two words that sound alike but have different meanings.', 'What are homophones?'),
        mk(300, "A figure of speech comparing two things using 'like' or 'as.'", 'What is a simile?'),
        mk(400, 'A word formed by rearranging the letters of another word.', 'What is an anagram?'),
        mk(500, 'This literary device gives human traits to non-human things.', 'What is personification?')
      ]}
    ]
  };
}

// ---------- State ----------
// Individual play: no teams. Each player has their own score.
const state = {
  lobbyCode: genCode(),
  locked: false, // when true, no new players may join
  board: sampleBoard(),
  dailyDoubleCount: 1,
  activeDailyDoubles: [], // ["catIndex-clueIndex", ...]
  markingDailyDoubles: false,
  current: null
  // current: {catIndex, clueIndex, isDailyDouble, buzzingOpen, locked, winner, answerShown, excludedPlayerIds, ddWager}
};

const players = {}; // id -> {id, name, avatar, score, ws}
const hostSockets = new Set();

function findClue(ci, r) {
  const cat = state.board.categories[ci];
  if (!cat) return null;
  return cat.clues[r] || null;
}

function publicPlayers() {
  return Object.values(players).map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar || null, score: p.score, connected: !!p.ws
  }));
}

function boardSummaryForPlayers() {
  return state.board.categories.map((cat) => ({
    name: cat.name,
    clues: cat.clues.map((c) => ({ value: c.value, used: c.used }))
  }));
}

function hostStateSnapshot() {
  return {
    type: 'state',
    lobbyCode: state.lobbyCode,
    locked: state.locked,
    board: state.board,
    players: publicPlayers(),
    dailyDoubleCount: state.dailyDoubleCount,
    activeDailyDoubles: state.activeDailyDoubles,
    markingDailyDoubles: state.markingDailyDoubles,
    current: state.current
  };
}

function playerStateSnapshot(player) {
  let buzzEnabled = false;
  if (state.current && state.current.buzzingOpen && !state.current.locked) {
    const excluded = (state.current.excludedPlayerIds || []).includes(player.id);
    if (!excluded) buzzEnabled = true;
  }
  let currentPublic = null;
  if (state.current) {
    const clue = findClue(state.current.catIndex, state.current.clueIndex);
    currentPublic = {
      isDailyDouble: state.current.isDailyDouble,
      buzzingOpen: state.current.buzzingOpen,
      locked: state.current.locked,
      winner: state.current.winner,
      answerShown: state.current.answerShown,
      ddWager: state.current.ddWager || null,
      value: clue ? clue.value : null,
      catName: state.board.categories[state.current.catIndex] ? state.board.categories[state.current.catIndex].name : '',
      clueText: clue ? clue.clue : '',
      media: clue ? clue.media : null,
      excludedPlayerIds: state.current.excludedPlayerIds || []
    };
  }
  return {
    type: 'state',
    you: { id: player.id, name: player.name, avatar: player.avatar || null, score: player.score },
    locked: state.locked,
    players: publicPlayers(),
    lobbyCode: state.lobbyCode,
    board: boardSummaryForPlayers(),
    current: currentPublic,
    buzzEnabled
  };
}

function broadcastHost() {
  const msg = JSON.stringify(hostStateSnapshot());
  hostSockets.forEach((ws) => { if (ws.readyState === 1) ws.send(msg); });
}

function broadcastPlayers() {
  Object.values(players).forEach((p) => {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(playerStateSnapshot(p)));
  });
}

function broadcastAll() {
  broadcastHost();
  broadcastPlayers();
}

// ---------- WebSocket protocol ----------
wss.on('connection', (ws) => {
  ws.role = null;
  ws.playerId = null;

  ws.on('error', (err) => {
    console.error('WebSocket error (connection dropped, server still running):', err.message);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // --- connection handshakes ---
    if (msg.type === 'host_hello') {
      ws.role = 'host';
      hostSockets.add(ws);
      ws.send(JSON.stringify(hostStateSnapshot()));
      return;
    }

    if (msg.type === 'player_join') {
      if ((msg.lobbyCode || '').toUpperCase() !== state.lobbyCode) {
        ws.send(JSON.stringify({ type: 'join_error', message: 'Lobby code not found.' }));
        return;
      }
      if (state.locked) {
        ws.send(JSON.stringify({ type: 'join_error', message: 'This lobby is locked and not accepting new players.' }));
        return;
      }
      const name = (msg.name || '').trim().slice(0, 24) || 'Player';
      const id = crypto.randomUUID();
      players[id] = { id, name, avatar: null, score: 0, ws };
      ws.role = 'player';
      ws.playerId = id;
      ws.send(JSON.stringify({ type: 'joined', playerId: id }));
      broadcastAll();
      return;
    }

    if (msg.type === 'player_reconnect') {
      const p = players[msg.playerId];
      if (p) {
        p.ws = ws;
        ws.role = 'player';
        ws.playerId = p.id;
        ws.send(JSON.stringify({ type: 'joined', playerId: p.id }));
        broadcastAll();
      } else {
        ws.send(JSON.stringify({ type: 'join_error', message: 'Session expired — please rejoin.' }));
      }
      return;
    }

    // --- player actions ---
    if (msg.type === 'set_avatar') {
      const p = players[ws.playerId];
      if (!p) return;
      if (typeof msg.dataUrl === 'string' && msg.dataUrl.length < 400000) {
        p.avatar = msg.dataUrl;
        broadcastAll();
      }
      return;
    }

    if (msg.type === 'player_buzz') {
      const p = players[ws.playerId];
      if (!p || !state.current) return;
      if (!state.current.buzzingOpen || state.current.locked) return;
      if ((state.current.excludedPlayerIds || []).includes(p.id)) return;
      state.current.locked = true;
      state.current.buzzingOpen = false;
      state.current.winner = { playerId: p.id, playerName: p.name, avatar: p.avatar || null };
      broadcastAll();
      return;
    }

    // --- everything below is host-only ---
    if (ws.role !== 'host') return;

    if (msg.type === 'new_lobby_code') {
      state.lobbyCode = genCode();
      broadcastAll();
      return;
    }
    if (msg.type === 'set_lock') {
      state.locked = !!msg.locked;
      broadcastAll();
      return;
    }
    if (msg.type === 'adjust_score') {
      const p = players[msg.playerId];
      if (p) p.score += msg.delta;
      broadcastAll();
      return;
    }
    if (msg.type === 'reset_scores') {
      Object.values(players).forEach((p) => { p.score = 0; });
      broadcastAll();
      return;
    }
    if (msg.type === 'kick_player') {
      const p = players[msg.playerId];
      if (p) {
        if (p.ws) p.ws.send(JSON.stringify({ type: 'kicked' }));
        delete players[msg.playerId];
      }
      broadcastAll();
      return;
    }

    // board editing
    if (msg.type === 'edit_category') {
      const cat = state.board.categories[msg.catIndex];
      if (cat) cat.name = msg.name;
      broadcastAll();
      return;
    }
    if (msg.type === 'remove_category') {
      state.board.categories.splice(msg.catIndex, 1);
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }
    if (msg.type === 'add_category') {
      const rowCount = Math.max(...state.board.categories.map((c) => c.clues.length), 5);
      const clues = [];
      for (let i = 0; i < rowCount; i++) clues.push({ value: (i + 1) * 100, clue: 'New question', answer: 'What is the answer?', used: false, media: null, dd: false });
      state.board.categories.push({ name: 'New Category', clues });
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }
    if (msg.type === 'add_row') {
      const rowCount = Math.max(...state.board.categories.map((c) => c.clues.length), 0);
      const nextValue = (rowCount + 1) * 100;
      state.board.categories.forEach((cat) => cat.clues.push({ value: nextValue, clue: 'New question', answer: 'What is the answer?', used: false, media: null, dd: false }));
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }
    if (msg.type === 'edit_clue') {
      const clue = findClue(msg.catIndex, msg.clueIndex);
      if (clue) {
        if (msg.value !== undefined) clue.value = Number(msg.value) || 0;
        if (msg.clue !== undefined) clue.clue = msg.clue;
        if (msg.answer !== undefined) clue.answer = msg.answer;
        if (msg.media !== undefined) clue.media = msg.media;
      }
      broadcastAll();
      return;
    }
    if (msg.type === 'delete_clue') {
      const cat = state.board.categories[msg.catIndex];
      if (cat) cat.clues.splice(msg.clueIndex, 1);
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }
    if (msg.type === 'toggle_dd_mark') {
      const clue = findClue(msg.catIndex, msg.clueIndex);
      if (clue) clue.dd = !clue.dd;
      broadcastAll();
      return;
    }
    if (msg.type === 'set_dd_marking') {
      state.markingDailyDoubles = !!msg.on;
      broadcastAll();
      return;
    }
    if (msg.type === 'set_dd_count') {
      state.dailyDoubleCount = Math.max(1, Number(msg.count) || 1);
      broadcastAll();
      return;
    }
    if (msg.type === 'shuffle_dd') {
      const eligible = [];
      state.board.categories.forEach((cat, ci) => cat.clues.forEach((c, r) => { if (c.dd && !c.used) eligible.push(ci + '-' + r); }));
      const count = Math.min(state.dailyDoubleCount, eligible.length);
      const pool = [...eligible];
      const picked = [];
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
      state.activeDailyDoubles = picked;
      broadcastAll();
      return;
    }
    if (msg.type === 'reset_used') {
      state.board.categories.forEach((cat) => cat.clues.forEach((c) => { c.used = false; }));
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }
    if (msg.type === 'import_board') {
      if (msg.board && msg.board.categories) {
        msg.board.categories.forEach((cat) => cat.clues.forEach((c) => {
          if (c.media === undefined) c.media = null;
          if (c.dd === undefined) c.dd = false;
          if (c.used === undefined) c.used = false;
        }));
        state.board = msg.board;
      }
      state.activeDailyDoubles = [];
      broadcastAll();
      return;
    }

    // gameplay
    if (msg.type === 'open_clue') {
      const clue = findClue(msg.catIndex, msg.clueIndex);
      if (!clue || clue.used) return;
      const key = msg.catIndex + '-' + msg.clueIndex;
      const isDD = state.activeDailyDoubles.includes(key);
      state.current = {
        catIndex: msg.catIndex,
        clueIndex: msg.clueIndex,
        isDailyDouble: isDD,
        buzzingOpen: false,
        locked: false,
        winner: null,
        answerShown: false,
        excludedPlayerIds: [],
        ddWager: null
      };
      broadcastAll();
      return;
    }
    if (msg.type === 'set_dd_wager') {
      if (state.current && state.current.isDailyDouble) {
        state.current.ddWager = { playerId: msg.playerId, wager: Number(msg.wager) || 0 };
      }
      broadcastAll();
      return;
    }
    if (msg.type === 'start_buzzing') {
      if (state.current) {
        state.current.buzzingOpen = true;
        state.current.locked = false;
        state.current.winner = null;
      }
      broadcastAll();
      return;
    }
    if (msg.type === 'reopen_buzzing') {
      if (state.current) {
        state.current.buzzingOpen = true;
        state.current.locked = false;
        state.current.winner = null;
      }
      broadcastAll();
      return;
    }
    if (msg.type === 'reveal_answer') {
      if (state.current) state.current.answerShown = true;
      broadcastAll();
      return;
    }
    if (msg.type === 'judge') {
      if (!state.current) return;
      const clue = findClue(state.current.catIndex, state.current.clueIndex);
      if (!clue) return;
      const isDD = state.current.isDailyDouble;
      let player = null;
      let amount = 0;
      if (isDD) {
        if (state.current.ddWager) {
          player = players[state.current.ddWager.playerId];
          amount = state.current.ddWager.wager;
        }
      } else if (state.current.winner) {
        player = players[state.current.winner.playerId];
        amount = clue.value;
      }

      if (msg.result === 'correct') {
        if (player) player.score += amount;
        clue.used = true;
        state.current = null;
      } else if (msg.result === 'wrong') {
        if (player) player.score -= amount;
        if (isDD) {
          clue.used = true;
          state.current = null;
        } else {
          if (player) state.current.excludedPlayerIds.push(player.id);
          state.current.locked = false;
          state.current.winner = null;
          state.current.buzzingOpen = false;
        }
      } else if (msg.result === 'skip') {
        clue.used = true;
        state.current = null;
      }
      broadcastAll();
      return;
    }
    if (msg.type === 'close_clue') {
      state.current = null;
      broadcastAll();
      return;
    }
  });

  ws.on('close', () => {
    hostSockets.delete(ws);
    if (ws.role === 'player' && ws.playerId && players[ws.playerId]) {
      players[ws.playerId].ws = null; // keep the player record so they can reconnect
      broadcastAll();
    }
  });
});

server.listen(PORT, () => {
  const ips = getLanIps();
  console.log('');
  console.log('Jeopardy party server is running on port ' + PORT + '.');
  console.log('  Host screen:  open /host.html at whatever URL this server is reachable at.');
  if (ips.length) {
    console.log('  If running on your own WiFi, players can join at:');
    ips.forEach((ip) => console.log('    http://' + ip + ':' + PORT + '/player.html'));
  }
  console.log('  Lobby code:   ' + state.lobbyCode);
  console.log('');
});

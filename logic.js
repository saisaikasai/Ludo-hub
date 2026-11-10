/**
 * Game Hub – shared game logic (runs in the browser AND in Node).
 * Every game is a pure state machine:  apply(state, action, seat, rng) -> { events } | { error }
 * The server uses it for online rooms, the browser uses it for offline play.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const rint = (rng, n) => Math.floor(rng() * n);
  const pick = (rng, arr) => arr[rint(rng, arr.length)];

  /* ------------------------------------------------------------------ */
  /*  Truth & Dare decks. Categories: love, oneside, funny, deep         */
  /*  (shared by the Truth-or-Dare game and Ludo captures)               */
  /* ------------------------------------------------------------------ */
  const CATS = [
    { id: 'mix', label: '🎲 Mix' }, { id: 'love', label: '💕 Love' }, { id: 'oneside', label: '💔 One-sided' },
    { id: 'funny', label: '😂 Funny' }, { id: 'deep', label: '🧠 Serious' }
  ];
  const CAT_NAME = { love: '💕 Love', oneside: '💔 One-sided love', funny: '😂 Funny', deep: '🧠 Serious', mix: '🎲 Mix' };
  const Q = (c, t) => ({ c, t });
  const TRUTH_CARDS = [
    /* ---- love ---- */
    Q('love', "If someone truly loves you, will you accept them or not? Why?"),
    Q('love', "Do you know someone who loves you every day but can't tell you?"),
    Q('love', "What does \"love\" mean in your own words?"),
    Q('love', "Someone you were once close to calls and asks, \"Do you still love me or not?\" What do you say?"),
    Q('love', "Who do you share all your problems and gossip with?"),
    Q('love', "You know someone loves you, but you see them only as a friend. When they come to meet you, how will you introduce them to your friends?"),
    Q('love', "What's the first thing you notice about a person you like?"),
    Q('love', "What's your idea of a perfect first date?"),
    Q('love', "What's more important in love: looks, nature or money? Why?"),
    Q('love', "Do you believe in love at first sight?"),
    Q('love', "What's the sweetest thing anyone has ever done for you?"),
    Q('love', "What qualities do you want in your life partner?"),
    Q('love', "What's the most embarrassing thing you've done to impress a crush?"),
    Q('love', "What was your worst date or hang-out ever?"),
    /* ---- one-sided love ---- */
    Q('oneside', "Have you ever loved someone who didn't love you back? How did you handle it?"),
    Q('oneside', "If your one-sided crush suddenly said \"I love you\" today, what would be your first reaction?"),
    Q('oneside', "Would you confess your feelings even if you knew the answer might be no? Why?"),
    Q('oneside', "Have you ever stayed silent about your feelings to protect a friendship?"),
    Q('oneside', "What advice would you give someone who is going through one-sided love?"),
    Q('oneside', "Have you ever acted like \"just a friend\" while secretly liking someone?"),
    Q('oneside', "How long would you wait for someone who doesn't feel the same way?"),
    Q('oneside', "What's the hardest part of loving someone who doesn't know?"),
    Q('oneside', "Has someone ever loved you when you didn't love them back? How did you tell them kindly?"),
    Q('oneside', "Is one-sided love a sign of true love, or just a habit? What do you think?"),
    Q('oneside', "Which is harder: loving someone who doesn't love you, or being loved by someone you don't love?"),
    /* ---- funny ---- */
    Q('funny', "What's the weirdest habit you have when you're completely alone?"),
    Q('funny', "If you had to swap lives with one person in this room, who and why?"),
    Q('funny', "Have you ever secretly cheated at a board game?"),
    Q('funny', "What's the most childish thing you still do?"),
    Q('funny', "What's the pettiest reason you've ever stopped talking to someone?"),
    Q('funny', "What's the last lie you told?"),
    Q('funny', "What's your most embarrassing nickname?"),
    Q('funny', "What's the silliest thing you're afraid of?"),
    Q('funny', "Which song do you secretly love but never admit to?"),
    Q('funny', "What's the worst gift you've ever given or received?"),
    Q('funny', "Who in this room would survive longest in a zombie apocalypse?"),
    Q('funny', "What's the most trouble you ever got in at school?"),
    Q('funny', "What's one app on your phone you'd be embarrassed to show us?"),
    Q('funny', "What's the most embarrassing thing in your search history (keep it clean!)?"),
    Q('funny', "Have you ever pretended to be sick to skip something? What was it?"),
    Q('funny', "What's the worst haircut you ever had?"),
    Q('funny', "Which friend in this room do you text the most?"),
    Q('funny', "What would you do with a million dollars in the first 24 hours?"),
    Q('funny', "What's the funniest excuse you've ever used to avoid replying to a message?"),
    Q('funny', "If your life were a movie, what would its title be?"),
    Q('funny', "What would your honest dating-profile bio say?"),
    Q('funny', "What's the strangest compliment you've ever received?"),
    Q('funny', "What's the most cringe thing you did in school?"),
    /* ---- serious ---- */
    Q('deep', "What's the biggest dream you haven't told anyone?"),
    Q('deep', "What's something you're proud of but rarely talk about?"),
    Q('deep', "If you could delete one memory, what would it be?"),
    Q('deep', "What's your biggest fear about the future?"),
    Q('deep', "What do you want to be remembered for?"),
    Q('deep', "What's the best advice anyone has ever given you?"),
    Q('deep', "What's one mistake that taught you a big lesson?"),
    Q('deep', "Who is the one person who always understands you?"),
    Q('deep', "Is there someone you owe an apology to? Who, and why?"),
    Q('deep', "What does trust mean to you? Can you trust again after it's broken?"),
    Q('deep', "If you could talk to yourself five years ago, what would you say?"),
    Q('deep', "Which do you value more in a relationship: freedom or security?")
  ];
  const DARE_CARDS = [
    /* ---- love ---- */
    Q('love', "Call your mom, dad or best friend and say \"I love you\" – then tell us how they reacted!"),
    Q('love', "Act out a dramatic filmy love-proposal scene right now!"),
    Q('love', "Say your best romantic movie dialogue in full hero/heroine style!"),
    Q('love', "Sing one line of your favourite romantic song with full emotion!"),
    Q('love', "Make up a funny 2-line poem about love and recite it!"),
    Q('love', "Describe your dream partner in 3 sentences – no names!"),
    Q('love', "Send a sweet \"thinking of you\" message to your best friend and read the reply out loud!"),
    /* ---- one-sided love ---- */
    Q('oneside', "Act out a dramatic one-sided-love scene: gazing at your crush from far away (no names!)."),
    Q('oneside', "Give a short pep talk to a friend who has just been \"friend-zoned\"!"),
    Q('oneside', "Do a confession scene with a twist ending: \"I just wanted to say… you're a great friend!\""),
    Q('oneside', "Make your saddest filmy face for 10 seconds, like the background song is playing!"),
    Q('oneside', "Write a funny status line about one-sided love and read it aloud!"),
    Q('oneside', "Tell the group the best advice you'd give your younger self about crushes!"),
    /* ---- funny ---- */
    Q('funny', "Sing the chorus of your favourite song in an opera voice!"),
    Q('funny', "Talk in a funny accent for the next 2 rounds!"),
    Q('funny', "Do 10 push-ups or 15 jumping jacks while counting out loud!"),
    Q('funny', "Tell a joke. If nobody laughs, you owe another dare!"),
    Q('funny', "Narrate everything you do like a sports commentator for 1 round!"),
    Q('funny', "Balance something on your head until your next turn!"),
    Q('funny', "Make up a 30-second rap about the person on your left!"),
    Q('funny', "Do your best impression of another player in the room!"),
    Q('funny', "Dance with no music for 20 seconds!"),
    Q('funny', "Speak only in questions until your next turn!"),
    Q('funny', "Act like a chicken for 15 seconds!"),
    Q('funny', "Say the alphabet backwards as fast as you can!"),
    Q('funny', "Pretend to be a news reporter and report on this game!"),
    Q('funny', "Let the group give you a silly nickname for the rest of the game!"),
    Q('funny', "Try to lick your elbow. Everyone watches!"),
    Q('funny', "Hold a plank for 20 seconds!"),
    Q('funny', "Make the funniest face you can and hold it for 10 seconds!"),
    Q('funny', "Speak in a whisper for the next 2 rounds!"),
    Q('funny', "Tell us your most dramatic life story in exactly 3 sentences!"),
    Q('funny', "Do a 15-second catwalk across the room!"),
    Q('funny', "Act out a movie scene until someone guesses it!"),
    Q('funny', "Pretend you're a robot until your next turn!"),
    Q('funny', "Draw something on paper with your eyes closed and show everyone!"),
    Q('funny', "Propose to a pillow, chair or fruit with a full filmy dialogue!"),
    Q('funny', "Do your best evil villain laugh!"),
    Q('funny', "Speak like a filmy hero for the next 2 rounds!"),
    /* ---- serious ---- */
    Q('deep', "Say something nice about every player in the room!"),
    Q('deep', "Thank one person in this room for something specific they did for you!"),
    Q('deep', "Tell the group one thing you're grateful for today and why!"),
    Q('deep', "Say one honest good thing about yourself – no joking!"),
    Q('deep', "Share one goal you'll start this week and ask the group to keep you accountable!"),
    Q('deep', "Message someone you haven't spoken to for a long time, just to say you're thinking of them!")
  ];
  const TRUTHS = TRUTH_CARDS.map(c => c.t);
  const DARES = DARE_CARDS.map(c => c.t);
  const catOk = (cat) => CATS.some(c => c.id === cat);

  /** Draw a card that hasn't been used yet (per deck + category); reshuffles when a category runs out. */
  function newCard(rng, kind, used, cat) {
    const list = kind === 'dare' ? DARE_CARDS : TRUTH_CARDS;
    cat = catOk(cat) ? cat : 'mix';
    used = used || {};
    const u = used[kind] || (used[kind] = []);
    const inCat = (c) => cat === 'mix' || c.c === cat;
    let pool = [];
    list.forEach((c, i) => { if (inCat(c) && !u.includes(i)) pool.push(i); });
    if (!pool.length) {
      list.forEach((c, i) => { if (inCat(c)) { const k = u.indexOf(i); if (k !== -1) u.splice(k, 1); } });
      list.forEach((c, i) => { if (inCat(c)) pool.push(i); });
    }
    if (!pool.length) pool = list.map((_, i) => i);
    const i = pool[rint(rng, pool.length)];
    u.push(i);
    return { kind, prompt: list[i].t, cat: list[i].c };
  }

  /* ------------------------------------------------------------------ */
  /*  LUDO                                                              */
  /* ------------------------------------------------------------------ */
  const L_COLORS = ['red', 'green', 'yellow', 'blue'];
  const L_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
  const L_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
  const L_SEATS = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: ['red', 'green', 'yellow', 'blue'] };

  const ludoGlobal = (color, step) => (step >= 0 && step <= 50) ? (L_OFFSET[color] + step) % 52 : null;

  function ludoValid(state, color, dice) {
    const out = [];
    state.tokens[color].forEach((pos, i) => {
      if (pos === 56) return;
      if (pos === -1) { if (dice === 6) out.push(i); }
      else if (pos + dice <= 56) out.push(i);
    });
    return out;
  }

  function ludoNextTurn(s) {
    s.turn = (s.turn + 1) % s.colors.length;
    s.rolled = false; s.valid = []; s.sixes = 0;
  }

  function ludoInit(n, opts) {
    const colors = L_SEATS[Math.max(2, Math.min(4, n))];
    const tokens = {};
    colors.forEach(c => { tokens[c] = [-1, -1, -1, -1]; });
    return {
      game: 'ludo', n: colors.length, colors, tokens, turn: 0, dice: null, rolled: false,
      valid: [], sixes: 0, last: null, party: !(opts && opts.party === false),
      td: null, tdUsed: {}, tdId: 0, winner: null, over: false, moves: 0
    };
  }

  function ludoApply(s, a, seat, rng) {
    if (s.over) return { error: 'Game is over.' };

    if (a.type === 'td-resolve') {
      if (!s.td) return { error: 'No challenge active.' };
      if (seat !== s.td.judge) return { error: 'Only the player who captured can judge.' };
      const td = s.td; s.td = null;
      const ev = [{ type: 'td-resolved', completed: !!a.completed, target: td.target }];
      if (!a.completed) {
        const color = s.colors[td.target];
        let best = -1;
        s.tokens[color].forEach((p, i) => { if (p > 2 && p < 56 && (best === -1 || p > s.tokens[color][best])) best = i; });
        if (best !== -1) { s.tokens[color][best] -= 2; ev[0].penalty = { color, token: best }; }
      }
      return { events: ev };
    }

    if (s.td) return { error: 'Resolve the Truth or Dare challenge first.' };
    if (seat !== s.turn) return { error: "It's not your turn." };
    const color = s.colors[s.turn];

    if (a.type === 'roll') {
      if (s.rolled) return { error: 'You already rolled – move a token.' };
      const dice = rint(rng, 6) + 1;
      s.dice = dice; s.rolled = true;
      s.sixes = dice === 6 ? s.sixes + 1 : 0;
      s.last = { seat, color, dice };
      const ev = [{ type: 'roll', seat, color, dice }];
      if (s.sixes >= 3) {
        ev.push({ type: 'triple-six', seat }); ludoNextTurn(s); return { events: ev };
      }
      s.valid = ludoValid(s, color, dice);
      if (!s.valid.length) { ev.push({ type: 'no-move', seat }); ludoNextTurn(s); }
      return { events: ev };
    }

    if (a.type === 'move') {
      if (!s.rolled) return { error: 'Roll the dice first.' };
      const t = a.token | 0;
      if (!s.valid.includes(t)) return { error: "That token can't move." };
      const from = s.tokens[color][t];
      const to = from === -1 ? 0 : from + s.dice;
      s.tokens[color][t] = to; s.moves++;
      const ev = [{ type: 'move', seat, color, token: t, from, to }];
      const captured = [];
      const g = ludoGlobal(color, to);
      if (g !== null && !L_SAFE.includes(g)) {
        s.colors.forEach((oc, oseat) => {
          if (oc === color) return;
          s.tokens[oc].forEach((p, i) => {
            if (ludoGlobal(oc, p) === g) { s.tokens[oc][i] = -1; captured.push({ seat: oseat, color: oc, token: i }); }
          });
        });
      }
      captured.forEach(c => ev.push(Object.assign({ type: 'capture', by: seat }, c)));
      if (to === 56) ev.push({ type: 'home', seat, color });
      if (s.tokens[color].every(p => p === 56)) {
        s.over = true; s.winner = seat; s.rolled = false; s.valid = [];
        ev.push({ type: 'win', seat, color });
        return { events: ev };
      }
      if (captured.length && s.party) {
        const kind = rng() < 0.5 ? 'truth' : 'dare';
        const card = newCard(rng, kind, s.tdUsed);
        s.td = { id: ++s.tdId, target: captured[0].seat, judge: seat, kind, prompt: card.prompt };
        ev.push({ type: 'td', target: s.td.target, judge: seat, kind });
      }
      const bonus = s.dice === 6 || captured.length > 0 || to === 56;
      s.rolled = false; s.valid = [];
      if (bonus) ev.push({ type: 'bonus', seat }); else ludoNextTurn(s);
      return { events: ev };
    }
    return { error: 'Unknown action.' };
  }

  function ludoBot(s, seat, rng) {
    if (s.over || seat !== s.turn) return null;
    if (!s.rolled) return { type: 'roll' };
    const color = s.colors[seat];
    let bestScore = -1e9, best = s.valid[0];
    s.valid.forEach(t => {
      const from = s.tokens[color][t];
      const to = from === -1 ? 0 : from + s.dice;
      let sc = to + rng();
      if (to === 56) sc += 100;
      if (from === -1) sc += 45;
      const g = ludoGlobal(color, to);
      if (g !== null) {
        if (L_SAFE.includes(g)) sc += 18;
        else {
          s.colors.forEach((oc, os) => {
            if (os === seat) return;
            s.tokens[oc].forEach(p => { if (ludoGlobal(oc, p) === g) sc += 70 + to; });
          });
        }
      }
      if (to > 50 && to < 56) sc += 12;
      if (sc > bestScore) { bestScore = sc; best = t; }
    });
    return { type: 'move', token: best };
  }

  /* ------------------------------------------------------------------ */
  /*  TIC-TAC-TOE                                                       */
  /* ------------------------------------------------------------------ */
  const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  function tttInit() {
    return { game: 'ttt', n: 2, board: Array(9).fill(null), turn: 0, starter: 0, scores: [0, 0, 0],
             round: 1, line: null, winner: null, draw: false, over: false };
  }
  function tttResult(b) {
    for (const l of TTT_LINES) if (b[l[0]] !== null && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { w: b[l[0]], line: l };
    return b.every(x => x !== null) ? { draw: true } : null;
  }
  function tttApply(s, a, seat) {
    if (a.type === 'rematch') {
      if (!s.over) return { error: 'Round still running.' };
      const sc = s.scores, round = s.round + 1, starter = 1 - s.starter;
      Object.assign(s, tttInit(), { scores: sc, round, starter, turn: starter });
      return { events: [{ type: 'new-round' }] };
    }
    if (s.over) return { error: 'Round is over.' };
    if (seat !== s.turn) return { error: "It's not your turn." };
    if (a.type !== 'place') return { error: 'Unknown action.' };
    const c = a.cell | 0;
    if (c < 0 || c > 8 || s.board[c] !== null) return { error: 'Cell is taken.' };
    s.board[c] = seat;
    const ev = [{ type: 'place', seat, cell: c }];
    const r = tttResult(s.board);
    if (r && r.w !== undefined) { s.over = true; s.winner = r.w; s.line = r.line; s.scores[r.w]++; ev.push({ type: 'win', seat: r.w }); }
    else if (r && r.draw) { s.over = true; s.draw = true; s.scores[2]++; ev.push({ type: 'draw' }); }
    else s.turn = 1 - s.turn;
    return { events: ev };
  }
  function tttMinimax(b, turn, me) {
    const r = tttResult(b);
    if (r) return r.draw ? 0 : (r.w === me ? 10 : -10);
    let best = turn === me ? -99 : 99;
    for (let i = 0; i < 9; i++) {
      if (b[i] !== null) continue;
      b[i] = turn;
      const v = tttMinimax(b, 1 - turn, me);
      b[i] = null;
      best = turn === me ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  }
  function tttBot(s, seat, rng) {
    if (s.over) return null;
    if (seat !== s.turn) return null;
    const free = []; s.board.forEach((v, i) => { if (v === null) free.push(i); });
    if (rng() < 0.2) return { type: 'place', cell: pick(rng, free) };   // a little human error
    let best = -1e9, cell = free[0];
    free.forEach(i => {
      s.board[i] = seat;
      const v = tttMinimax(s.board, 1 - seat, seat) + rng() * 0.001;
      s.board[i] = null;
      if (v > best) { best = v; cell = i; }
    });
    return { type: 'place', cell };
  }

  /* ------------------------------------------------------------------ */
  /*  CONNECT FOUR  (7 columns x 6 rows, row 0 = top)                   */
  /* ------------------------------------------------------------------ */
  const C4_W = 7, C4_H = 6;
  function c4Init() {
    return { game: 'c4', n: 2, board: Array(C4_W * C4_H).fill(null), turn: 0, starter: 0, scores: [0, 0, 0],
             round: 1, line: null, winner: null, draw: false, over: false, lastCell: null };
  }
  function c4Find(b) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < C4_H; r++) for (let c = 0; c < C4_W; c++) {
      const p = b[r * C4_W + c]; if (p === null) continue;
      for (const [dr, dc] of dirs) {
        const cells = [r * C4_W + c]; let ok = true;
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= C4_H || cc < 0 || cc >= C4_W || b[rr * C4_W + cc] !== p) { ok = false; break; }
          cells.push(rr * C4_W + cc);
        }
        if (ok) return { w: p, line: cells };
      }
    }
    return b.every(x => x !== null) ? { draw: true } : null;
  }
  function c4Drop(b, col, p) {
    for (let r = C4_H - 1; r >= 0; r--) if (b[r * C4_W + col] === null) { b[r * C4_W + col] = p; return r * C4_W + col; }
    return -1;
  }
  function c4Apply(s, a, seat) {
    if (a.type === 'rematch') {
      if (!s.over) return { error: 'Round still running.' };
      const sc = s.scores, round = s.round + 1, starter = 1 - s.starter;
      Object.assign(s, c4Init(), { scores: sc, round, starter, turn: starter });
      return { events: [{ type: 'new-round' }] };
    }
    if (s.over) return { error: 'Round is over.' };
    if (seat !== s.turn) return { error: "It's not your turn." };
    if (a.type !== 'drop') return { error: 'Unknown action.' };
    const col = a.col | 0;
    if (col < 0 || col >= C4_W) return { error: 'Bad column.' };
    const cell = c4Drop(s.board, col, seat);
    if (cell < 0) return { error: 'Column is full.' };
    s.lastCell = cell;
    const ev = [{ type: 'drop', seat, cell }];
    const r = c4Find(s.board);
    if (r && r.w !== undefined) { s.over = true; s.winner = r.w; s.line = r.line; s.scores[r.w]++; ev.push({ type: 'win', seat: r.w }); }
    else if (r && r.draw) { s.over = true; s.draw = true; s.scores[2]++; ev.push({ type: 'draw' }); }
    else s.turn = 1 - s.turn;
    return { events: ev };
  }
  function c4Score(b, me) {
    let sc = 0;
    for (let r = 0; r < C4_H; r++) sc += (b[r * C4_W + 3] === me ? 3 : b[r * C4_W + 3] === null ? 0 : -3);
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < C4_H; r++) for (let c = 0; c < C4_W; c++) for (const [dr, dc] of dirs) {
      let mine = 0, theirs = 0, ok = true;
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= C4_H || cc < 0 || cc >= C4_W) { ok = false; break; }
        const v = b[rr * C4_W + cc];
        if (v === me) mine++; else if (v !== null) theirs++;
      }
      if (!ok) continue;
      if (mine && !theirs) sc += [0, 1, 4, 20][mine] || 0;
      if (theirs && !mine) sc -= [0, 1, 4, 22][theirs] || 0;
    }
    return sc;
  }
  function c4Search(b, depth, alpha, beta, turn, me) {
    const r = c4Find(b);
    if (r) return r.draw ? 0 : (r.w === me ? 100000 + depth : -100000 - depth);
    if (depth === 0) return c4Score(b, me);
    const order = [3, 2, 4, 1, 5, 0, 6];
    let best = turn === me ? -1e9 : 1e9;
    for (const col of order) {
      const cell = c4Drop(b, col, turn);
      if (cell < 0) continue;
      const v = c4Search(b, depth - 1, alpha, beta, 1 - turn, me);
      b[cell] = null;
      if (turn === me) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
      else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (alpha >= beta) break;
    }
    return best;
  }
  function c4Bot(s, seat, rng) {
    if (s.over || seat !== s.turn) return null;
    const cols = []; for (let c = 0; c < C4_W; c++) if (s.board[c] === null) cols.push(c);
    if (rng() < 0.12) return { type: 'drop', col: pick(rng, cols) };
    let best = -1e9, bc = cols[0];
    const b = s.board.slice();
    cols.forEach(col => {
      const cell = c4Drop(b, col, seat);
      const v = c4Search(b, 4, -1e9, 1e9, 1 - seat, seat) + rng();
      b[cell] = null;
      if (v > best) { best = v; bc = col; }
    });
    return { type: 'drop', col: bc };
  }

  /* ------------------------------------------------------------------ */
  /*  ROCK · PAPER · SCISSORS (first to 3)                              */
  /* ------------------------------------------------------------------ */
  const RPS = ['rock', 'paper', 'scissors'];
  function rpsInit() {
    return { game: 'rps', n: 2, choices: [null, null], scores: [0, 0], round: 1, target: 3,
             last: null, winner: null, over: false };
  }
  function rpsApply(s, a, seat) {
    if (a.type === 'rematch') {
      if (!s.over) return { error: 'Match still running.' };
      Object.assign(s, rpsInit()); return { events: [{ type: 'new-round' }] };
    }
    if (s.over) return { error: 'Match is over.' };
    if (a.type !== 'pick' || !RPS.includes(a.choice)) return { error: 'Pick rock, paper or scissors.' };
    if (s.choices[seat] !== null) return { error: 'You already picked.' };
    s.choices[seat] = a.choice;
    const ev = [{ type: 'picked', seat }];
    if (s.choices[0] && s.choices[1]) {
      const [x, y] = s.choices.map(c => RPS.indexOf(c));
      const res = x === y ? 'draw' : ((x - y + 3) % 3 === 1 ? 0 : 1);
      s.last = { choices: s.choices.slice(), result: res, round: s.round };
      if (res !== 'draw') s.scores[res]++;
      s.choices = [null, null]; s.round++;
      ev.push({ type: 'reveal', result: res });
      const w = s.scores.findIndex(v => v >= s.target);
      if (w !== -1) { s.over = true; s.winner = w; ev.push({ type: 'win', seat: w }); }
    }
    return { events: ev };
  }
  function rpsView(s, seat) {
    const v = JSON.parse(JSON.stringify(s));
    v.picked = s.choices.map(c => c !== null);
    v.choices = s.choices.map((c, i) => (i === seat ? c : null));
    return v;
  }
  function rpsBot(s, seat, rng) {
    if (s.over || s.choices[seat] !== null) return null;
    return { type: 'pick', choice: pick(rng, RPS) };
  }

  /* ------------------------------------------------------------------ */
  /*  TRUTH OR DARE (party game, 2-8 friends, no bots)                  */
  /* ------------------------------------------------------------------ */
  function todInit(n) {
    return { game: 'tod', n, turn: 0, phase: 'choose', card: null, scores: Array(n).fill(0),
             used: {}, cat: 'mix', round: 1, history: [], over: false };
  }
  function todApply(s, a, seat, rng) {
    if (s.phase === 'choose') {
      if (seat !== s.turn) return { error: "It's not your turn." };
      let kind = a.kind;
      if (a.type !== 'choose' || !['truth', 'dare', 'random'].includes(kind)) return { error: 'Choose truth or dare.' };
      if (kind === 'random') kind = rng() < 0.5 ? 'truth' : 'dare';
      s.cat = catOk(a.cat) ? a.cat : 'mix';
      const c = newCard(rng, kind, s.used, s.cat);
      s.card = c; s.phase = 'card';
      return { events: [{ type: 'card', seat, kind }] };
    }
    if (s.phase === 'card') {
      if (a.type === 'swap') {
        if (seat !== s.turn) return { error: 'Only the player on the spot can swap.' };
        if (s.card.swapped) return { error: 'You can swap only once.' };
        const c = newCard(rng, s.card.kind, s.used, s.cat); c.swapped = true; s.card = c;
        return { events: [{ type: 'card', seat, kind: c.kind }] };
      }
      if (a.type === 'judge') {
        if (seat === s.turn) return { error: 'Another player must judge your challenge.' };
        const done = !!a.done;
        if (done) s.scores[s.turn]++;
        s.history.unshift({ seat: s.turn, kind: s.card.kind, prompt: s.card.prompt, done });
        s.history.length = Math.min(s.history.length, 12);
        s.turn = (s.turn + 1) % s.n; s.phase = 'choose'; s.card = null;
        if (s.turn === 0) s.round++;
        return { events: [{ type: 'judged', done }] };
      }
    }
    return { error: 'Not allowed right now.' };
  }
  function todAuto(s, seat) {
    if (s.phase === 'choose' && seat === s.turn) return { type: 'choose', kind: 'random', cat: 'mix' };
    if (s.phase === 'card' && seat !== s.turn) return { type: 'judge', done: true };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Registry                                                          */
  /* ------------------------------------------------------------------ */
  const META = {
    ludo: { id: 'ludo', name: 'Ludo', emoji: '🎲', min: 2, max: 4, bots: true,
            desc: 'Classic race home. Captures trigger Truth or Dare!' },
    ttt:  { id: 'ttt', name: 'Tic-Tac-Toe', emoji: '❌', min: 2, max: 2, bots: true,
            desc: 'Three in a row wins. Rematches swap who starts.' },
    c4:   { id: 'c4', name: 'Connect Four', emoji: '🔴', min: 2, max: 2, bots: true,
            desc: 'Drop discs and line up four.' },
    rps:  { id: 'rps', name: 'Rock Paper Scissors', emoji: '✂️', min: 2, max: 2, bots: true,
            desc: 'First to 3 wins. Picks stay secret until both lock in.' },
    tod:  { id: 'tod', name: 'Truth or Dare', emoji: '🎭', min: 2, max: 8, bots: false,
            desc: 'Party game for friends. Take turns, friends judge.' }
  };

  const ENGINES = {
    ludo: { init: ludoInit, apply: ludoApply, bot: ludoBot },
    ttt:  { init: tttInit,  apply: tttApply,  bot: tttBot },
    c4:   { init: c4Init,   apply: c4Apply,   bot: c4Bot },
    rps:  { init: rpsInit,  apply: rpsApply,  bot: rpsBot, view: rpsView },
    tod:  { init: todInit,  apply: todApply,  bot: todAuto }
  };

  function create(game, n, opts) {
    const e = ENGINES[game]; if (!e) throw new Error('Unknown game');
    return e.init(n, opts);
  }
  function apply(state, action, seat, rng) {
    if (!action || typeof action !== 'object') return { error: 'Bad action.' };
    const e = ENGINES[state.game];
    return e.apply(state, action, seat, rng || Math.random);
  }
  function view(state, seat) {
    const e = ENGINES[state.game];
    return e.view ? e.view(state, seat) : state;
  }
  /** Which seats may act right now? (used for auto-play of bots / disconnected players) */
  function actors(state) {
    switch (state.game) {
      case 'ludo': {
        if (state.over) return [];
        if (state.td) return [state.td.judge];
        return [state.turn];
      }
      case 'ttt': case 'c4': return state.over ? [] : [state.turn];
      case 'rps': return state.over ? [] : [0, 1].filter(i => state.choices[i] === null);
      case 'tod': {
        if (state.phase === 'choose') return [state.turn];
        const out = []; for (let i = 0; i < state.n; i++) if (i !== state.turn) out.push(i); return out;
      }
    }
    return [];
  }
  /** Suggested action for a bot / absent player (null if none). */
  function auto(state, seat, rng) {
    rng = rng || Math.random;
    if (state.game === 'ludo' && state.td && state.td.judge === seat) return { type: 'td-resolve', completed: true };
    return ENGINES[state.game].bot(state, seat, rng);
  }

  return { META, TRUTHS, DARES, CATS, CAT_NAME, TRUTH_CARDS, DARE_CARDS, L_COLORS, L_SAFE, L_OFFSET, create, apply, view, actors, auto, newCard };
});

/* Game Hub UI: offline (vs computer / pass-and-play) and online (private rooms, chat, voice). */
(function () {
  'use strict';
  const GL = window.GameLogic, META = GL.META, Net = window.Net, Voice = window.Voice;
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------- tiny DOM helper ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'disabled' || k === 'checked') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    (function add(list) { list.forEach(c => { if (c == null || c === false) return; if (Array.isArray(c)) add(c); else el.append(c.nodeType ? c : document.createTextNode(String(c))); }); })(kids);
    return el;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gamehub.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('gamehub.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---------- sound ---------- */
  let actx = null, soundOn = store.get('sound', true);
  function beep(f, d, type, vol, delay) {
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = actx || new AC(); if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(vol || .06, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + .02);
    } catch (e) { /* ignore */ }
  }
  const SFX = {
    roll() { [300, 380, 460, 540].forEach((f, i) => beep(f, .06, 'square', .04, i * .06)); },
    move() { beep(520, .08, 'triangle', .07); },
    capture() { beep(240, .14, 'sawtooth', .06); beep(150, .22, 'sawtooth', .06, .1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => beep(f, .22, 'triangle', .08, i * .14)); },
    chat() { beep(900, .05, 'sine', .05); },
    tick() { beep(660, .04, 'sine', .04); },
    pop() { beep(780, .05, 'triangle', .05); beep(1040, .06, 'triangle', .04, .04); }
  };
  function askConfirm(msg, onYes) {
    const ov = $('#overlay');
    ov.hidden = false;
    ov.replaceChildren(h('div', { class: 'box' },
      h('h3', { text: msg }),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
        h('button', { class: 'btn sm sec', text: 'Cancel', on: { click: () => { ov.hidden = true; if (App.view === 'game') renderGame(); } } }),
        h('button', { class: 'btn sm bad', text: 'Yes, leave', on: { click: () => { ov.hidden = true; onYes(); } } }))));
  }
  function toast(msg, kind) {
    const t = h('div', { class: 'toast ' + (kind || ''), text: msg });
    $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  }

  /* ---------- emoji reactions ---------- */
  const EMOJIS = ['😂', '😮', '👏', '🔥', '😭', '😈', '😍', '🤯', '🎉', '👍', '😡', '🥳', '😎', '🙈', '💀', '❤️'];
  function floatEmoji(emoji, name) {
    const box = $('#reactions'); if (!box) return;
    const el = h('div', { class: 'react' }, h('span', { class: 're', text: emoji }), name && h('span', { class: 'rn', text: name }));
    el.style.left = (6 + Math.random() * 78) + '%';
    box.append(el); setTimeout(() => el.remove(), 2700);
    while (box.children.length > 30) box.firstChild.remove();
  }
  let lastEmoji = 0;
  function sendEmoji(emoji) {
    const now = Date.now(); if (now - lastEmoji < 220) return; lastEmoji = now;
    SFX.pop();
    if (App.room && Net.socket) Net.send('emoji:send', { emoji });       // everyone in the room sees it
    else floatEmoji(emoji, App.name || 'You');   // offline: just for fun
  }
  function buildEmojiBar() {
    const bar = $('#emoji-bar');
    bar.replaceChildren(...EMOJIS.map(e => h('button', { text: e, 'aria-label': 'React ' + e, on: { click: () => sendEmoji(e) } })));
  }

  /* ---------- app state ---------- */
  const App = {
    view: 'home', session: null, room: null, chat: [], unread: 0, socialBuilt: false,
    name: store.get('name', ''), anim: { roll: false, moved: null },
    off: { game: 'ludo', mode: 'cpu', party: true, seats: [] },
    pickGame: store.get('lastGame', 'ludo'), todCat: 'mix'
  };
  const stage = () => $('#stage');
  const setStage = (...kids) => { $('#emoji-bar').hidden = !(App.view === 'game' || (App.view === 'lobby' && App.room)); const s = stage(); s.replaceChildren(...kids.flat().filter(Boolean)); window.scrollTo(0, 0); };

  /* ===================================================================
     SESSIONS
     =================================================================== */
  class LocalSession {
    constructor(game, seats, opts) {
      this.online = false; this.game = game; this.seats = seats; this.opts = opts || {};
      this.state = GL.create(game, seats.length, { party: this.opts.party });
      this.curtain = null; this.timer = null; this.dead = false;
    }
    get names() { return this.seats.map(s => s.name); }
    isBot(seat) { return !!(this.seats[seat] && this.seats[seat].bot); }
    start() { events(this, [{ type: 'start' }]); this.pump(); }
    stop() { this.dead = true; clearTimeout(this.timer); }
    /** the seat this device may act as right now (null = waiting for a computer / hand-over) */
    actSeat() {
      const s = this.state;
      if (this.curtain !== null) return null;
      const human = (i) => !this.isBot(i);
      switch (s.game) {
        case 'ludo': {
          if (s.over) return 0;
          if (s.td) return (human(s.td.judge) || human(s.td.target)) ? s.td.judge : null;
          return human(s.turn) ? s.turn : null;
        }
        case 'ttt': case 'c4': return human(s.turn) && !s.over ? s.turn : (s.over ? 0 : null);
        case 'rps': { if (s.over) return 0; const i = [0, 1].find(k => s.choices[k] === null && human(k)); return i === undefined ? null : i; }
        case 'tod': return s.turn;
      }
      return null;
    }
    send(action, seat) {
      if (this.dead) return;
      if (seat === undefined) seat = this.actSeat();
      if (seat === null || seat === undefined) return;
      const r = GL.apply(this.state, action, seat);
      if (r.error) return toast(r.error, 'err');
      // pass-and-play Rock Paper Scissors: hide the first pick behind a hand-over screen
      if (this.state.game === 'rps' && action.type === 'pick' && !this.isBot(0) && !this.isBot(1) && this.state.choices.some(c => c === null) && this.state.choices.some(c => c !== null)) {
        this.curtain = this.state.choices.findIndex(c => c === null);
      } else this.curtain = null;
      events(this, r.events); this.pump();
    }
    pump() {
      clearTimeout(this.timer);
      const s = this.state; if (this.dead) return;
      if (s.game === 'ludo' && s.td && !s.over) {
        if (this.isBot(s.td.target)) {
          const id = s.td.id;
          this.timer = setTimeout(() => { if (this.state.td && this.state.td.id === id) this.send({ type: 'td-resolve', completed: true }, s.td.judge); }, 3500);
        }
        return;
      }
      let seats = GL.actors(s).filter(i => this.isBot(i));
      if (s.game === 'ludo') seats = seats.filter(i => i === s.turn);
      if (!seats.length) return;
      const seat = seats[0];
      const delay = s.game === 'ludo' ? (s.rolled ? 750 : 900) : s.game === 'rps' ? 500 : 700;
      this.timer = setTimeout(() => {
        if (this.dead || this.state !== s) return;
        const a = GL.auto(this.state, seat);
        if (a) this.send(a, seat); else this.pump();
      }, delay);
    }
    restart() { this.stop(); const n = new LocalSession(this.game, this.seats, this.opts); App.session = n; n.start(); renderGame(); }
  }

  class OnlineSession {
    constructor(seat, state) { this.online = true; this.seat = seat; this.state = state; }
    get names() { return (App.room ? App.room.players : []).map(p => p.name); }
    isBot() { return false; }
    actSeat() { return this.seat; }
    send(action) { Net.send('game:action', { action }); }
    stop() {}
  }

  /* ===================================================================
     EVENTS (sounds / toasts)
     =================================================================== */
  function botReact(name, list) { if (!name) return; setTimeout(() => floatEmoji(list[Math.floor(Math.random() * list.length)], name), 500); }
  function events(S, evs) {
    const nm = (i) => S.names[i] || 'Player';
    (evs || []).forEach(e => {
      switch (e.type) {
        case 'roll': SFX.roll(); App.anim.roll = true; break;
        case 'move': SFX.move(); App.anim.moved = { color: e.color, token: e.token }; break;
        case 'capture': SFX.capture(); toast(nm(e.by) + ' captured ' + nm(e.seat) + "'s token! 💥");
          if (!S.online) { if (S.isBot(e.by)) botReact(nm(e.by), ['😈', '😎', '🔥']); else if (S.isBot(e.seat)) botReact(nm(e.seat), ['😭', '😡', '💀']); } break;
        case 'home': toast(nm(e.seat) + ' got a token home! 🏠', 'good'); break;
        case 'triple-six': toast(nm(e.seat) + ' rolled three 6s in a row – turn lost!'); break;
        case 'no-move': toast(nm(e.seat) + ' has no moves'); break;
        case 'td': toast(nm(e.target) + ': ' + (e.kind === 'dare' ? 'DARE! 😈' : 'TRUTH! 🤔')); break;
        case 'td-resolved': toast(e.completed ? nm(e.target) + ' did it! 👏' : nm(e.target) + ' skipped – token back 2 steps', e.completed ? 'good' : ''); break;
        case 'place': case 'drop': SFX.move(); break;
        case 'picked': SFX.tick(); break;
        case 'reveal': SFX.roll(); break;
        case 'card': SFX.tick(); break;
        case 'win': SFX.win(); toast('🏆 ' + nm(e.seat) + ' wins!', 'good');
          if (!S.online) botReact(S.isBot(e.seat) ? nm(e.seat) : S.names.find((n, i) => S.isBot(i)), S.isBot(e.seat) ? ['😎', '🥳', '🎉'] : ['😭', '👏', '🙈']); break;
        case 'draw': toast("It's a draw!"); break;
      }
    });
    if (App.view === 'game') renderGame();
  }

  /* ===================================================================
     HOME
     =================================================================== */
  function viewHome() {
    App.view = 'home';
    const offline = !navigator.onLine;
    setStage(
      h('div', { class: 'hero' }, h('h1', { text: '🎲 Game Hub' }),
        h('p', { class: 'mute', text: 'Ludo and party games. Play on your own, or with friends in a private room.' })),
      offline && h('div', { class: 'note', style: 'margin-bottom:14px', text: "📴 You're offline – offline games work without internet." }),
      h('div', { class: 'mode-grid' },
        h('button', { class: 'mode', on: { click: viewOfflineSetup } }, h('span', { class: 'big', text: '📴' }),
          h('b', { text: 'Play Offline' }), h('span', { class: 'mute small', text: 'vs Computer or pass-and-play. No internet needed.' })),
        h('button', { class: 'mode', on: { click: () => viewOnlineEntry() } }, h('span', { class: 'big', text: '🌐' }),
          h('b', { text: 'Play with Friends Online' }), h('span', { class: 'mute small', text: 'Private room code · text chat · voice chat' }))),
      h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', { text: 'Games' }),
        h('div', { class: 'game-grid' }, Object.values(META).map(m =>
          h('div', { class: 'gtile' }, h('span', { class: 'e', text: m.emoji }), h('b', { text: m.name }), h('span', { class: 'mute small', text: m.desc }))))));
  }

  /* ===================================================================
     OFFLINE SETUP
     =================================================================== */
  function defaultSeats(game, mode, n) {
    const m = META[game];
    if (game === 'tod') return Array.from({ length: Math.max(2, n || 3) }, (_, i) => ({ name: 'Player ' + (i + 1), bot: false }));
    if (game === 'ludo') return Array.from({ length: n || 2 }, (_, i) => ({ name: i === 0 ? 'You' : 'Computer ' + i, bot: i !== 0 }));
    void m;
    return mode === 'cpu' ? [{ name: 'You', bot: false }, { name: 'Computer', bot: true }] : [{ name: 'Player 1', bot: false }, { name: 'Player 2', bot: false }];
  }
  function viewOfflineSetup() {
    App.view = 'offline';
    const o = App.off;
    if (!META[o.game]) o.game = 'ludo';
    if (!o.seats.length) o.seats = defaultSeats(o.game, o.mode, 2);
    const body = h('div');
    const draw = () => {
      body.replaceChildren();
      const m = META[o.game];
      if (o.game === 'ludo') {
        body.append(h('h3', { text: 'Players' }),
          h('div', { class: 'seg' }, [2, 3, 4].map(n => h('button', { class: o.seats.length === n ? 'on' : '', text: n + ' players', on: { click: () => { o.seats = defaultSeats('ludo', 'cpu', n); draw(); } } }))));
        const colors = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: ['red', 'green', 'yellow', 'blue'] }[o.seats.length];
        o.seats.forEach((s, i) => body.append(h('div', { class: 'seat-row' }, h('span', { class: 'dot c-' + colors[i] }),
          h('input', { value: s.name, maxlength: 16, 'aria-label': 'Player ' + (i + 1) + ' name', on: { input: (e) => { s.name = e.target.value.slice(0, 16); } } }),
          h('button', { class: 'btn sm ' + (s.bot ? 'sec' : ''), text: s.bot ? '🤖 Computer' : '🧑 Human', on: { click: () => { s.bot = !s.bot; if (s.bot && /^Player|^You/.test(s.name)) s.name = 'Computer ' + (i + 1); if (!s.bot && /^Computer/.test(s.name)) s.name = 'Player ' + (i + 1); draw(); } } }))));
        body.append(h('label', { class: 'row', style: 'margin-top:8px' }, h('input', { type: 'checkbox', checked: o.party, style: 'width:auto', on: { change: (e) => { o.party = e.target.checked; } } }),
          h('span', { text: 'Truth or Dare when a token is captured' })));
      } else if (o.game === 'tod') {
        body.append(h('h3', { text: 'Friends playing on this device' }));
        o.seats.forEach((s, i) => body.append(h('div', { class: 'seat-row' },
          h('input', { value: s.name, maxlength: 16, on: { input: (e) => { s.name = e.target.value.slice(0, 16); } } }),
          o.seats.length > 2 && h('button', { class: 'btn sm sec', text: '✕', 'aria-label': 'Remove', on: { click: () => { o.seats.splice(i, 1); draw(); } } }))));
        if (o.seats.length < 8) body.append(h('button', { class: 'btn sm sec', text: '+ Add player', on: { click: () => { o.seats.push({ name: 'Player ' + (o.seats.length + 1), bot: false }); draw(); } } }));
      } else {
        body.append(h('div', { class: 'seg' },
          h('button', { class: o.mode === 'cpu' ? 'on' : '', text: '🤖 vs Computer', on: { click: () => { o.mode = 'cpu'; o.seats = defaultSeats(o.game, 'cpu'); draw(); } } }),
          h('button', { class: o.mode === 'pvp' ? 'on' : '', text: '👥 2 Players', on: { click: () => { o.mode = 'pvp'; o.seats = defaultSeats(o.game, 'pvp'); draw(); } } })));
        o.seats.forEach((s, i) => body.append(h('div', { class: 'seat-row' }, h('input', { value: s.name, maxlength: 16, disabled: s.bot, on: { input: (e) => { s.name = e.target.value.slice(0, 16); } } }))));
      }
      body.append(h('button', { class: 'btn block', style: 'margin-top:14px', text: '▶ Start ' + m.name, on: { click: startLocal } }));
    };
    const grid = h('div', { class: 'game-grid' });
    const drawGrid = () => grid.replaceChildren(...Object.values(META).map(m => h('button', { class: 'gtile' + (o.game === m.id ? ' sel' : ''), on: { click: () => { o.game = m.id; o.seats = defaultSeats(m.id, o.mode, 2); if (m.id !== 'ludo' && m.id !== 'tod' && !o.mode) o.mode = 'cpu'; drawGrid(); draw(); } } },
      h('span', { class: 'e', text: m.emoji }), h('b', { text: m.name }), h('span', { class: 'mute small', text: m.desc }))));
    drawGrid(); draw();
    setStage(h('h2', { text: '📴 Play Offline' }), h('div', { class: 'card' }, grid), h('div', { class: 'card' }, body),
      h('button', { class: 'btn sec', text: '← Back', on: { click: viewHome } }));
  }
  function startLocal() {
    const o = App.off;
    const seats = o.seats.map((s, i) => ({ name: (s.name || '').trim() || (s.bot ? 'Computer' : 'Player ' + (i + 1)), bot: !!s.bot }));
    if (META[o.game].min === 2 && seats.every(s => s.bot)) seats[0].bot = false;
    const S = new LocalSession(o.game, seats, { party: o.party });
    App.session = S; App.view = 'game'; renderGame(); S.start();
  }

  /* ===================================================================
     ONLINE: entry, lobby
     =================================================================== */
  function viewOnlineEntry(prefill) {
    App.view = 'online';
    const nameIn = h('input', { value: App.name, maxlength: 16, placeholder: 'Your name', 'aria-label': 'Your name' });
    const codeIn = h('input', { value: prefill || '', maxlength: 5, placeholder: 'ROOM CODE', style: 'text-transform:uppercase;letter-spacing:.2em;text-align:center', 'aria-label': 'Room code' });
    const gameSel = h('select', { 'aria-label': 'Game' }, Object.values(META).map(m => h('option', { value: m.id, text: m.emoji + ' ' + m.name, selected: m.id === App.pickGame })));
    const err = h('div', { class: 'small', style: 'color:#fca5a5;min-height:1.2em' });
    const getName = () => { const n = nameIn.value.trim().slice(0, 16); if (!n) { err.textContent = 'Please enter your name first.'; nameIn.focus(); return null; } App.name = n; store.set('name', n); return n; };
    const guard = async (fn, btn) => {
      err.textContent = ''; btn.disabled = true;
      Voice.prepare();                       // voice is on by default: ask for the mic during this tap
      let ok = false;
      try { const r = await fn(); if (!r.ok) err.textContent = r.error || 'Something went wrong.'; else { ok = true; enterRoom(r); } }
      catch (e) { err.textContent = e.message || 'Could not connect.'; }
      if (!ok) Voice.cancelPrepare();
      btn.disabled = false;
    };
    const bCreate = h('button', { class: 'btn block', text: '➕ Create private room', on: { click: () => { const n = getName(); if (!n) return; App.pickGame = gameSel.value; store.set('lastGame', gameSel.value); guard(() => Net.create(n, gameSel.value), bCreate); } } });
    const bJoin = h('button', { class: 'btn block good', text: '🔑 Join room', on: { click: () => { const n = getName(); if (!n) return; const c = codeIn.value.trim().toUpperCase(); if (c.length < 4) { err.textContent = 'Enter the 5-letter room code.'; return; } guard(() => Net.join(n, c), bJoin); } } });
    const saved = Net.saved();
    const rejoin = saved && h('div', { class: 'card' }, h('b', { text: 'You were in room ' + saved.code }),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', text: 'Rejoin', on: { click: (e) => guard(() => Net.join(saved.name || App.name || 'Player', saved.code, saved.key), e.target) } }),
        h('button', { class: 'btn sm sec', text: 'Forget', on: { click: () => { Net.save(null); viewOnlineEntry(); } } })));
    setStage(h('h2', { text: '🌐 Play with Friends' }),
      !navigator.onLine && h('div', { class: 'note', style: 'margin-bottom:12px', text: '📴 You seem to be offline. Online rooms need internet – offline games still work.' }),
      rejoin,
      h('div', { class: 'card' }, h('h3', { text: 'Your name' }), nameIn),
      h('div', { class: 'card' }, h('h3', { text: 'Create a room' }), h('p', { class: 'mute small', text: 'Pick a game, then share the room code with your friends.' }), gameSel, h('div', { style: 'height:10px' }), bCreate),
      h('div', { class: 'card' }, h('h3', { text: 'Join a friend' }), codeIn, h('div', { style: 'height:10px' }), bJoin),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('h3', { style: 'margin:0', text: '🎙️ Microphone & Voice Check' }),
          h('span', { id: 'mic-test-status', class: 'mute small', text: Voice.active ? (Voice.muted ? 'Muted' : 'Mic active') : 'Tap below to test' })),
        h('div', { class: 'mic-meter' }, h('div', { id: 'mic-test-bar', class: 'mic-meter-fill', style: 'width:' + (Voice.level || 0) + '%' })),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn sm ' + (Voice.active ? 'good' : 'sec'), text: Voice.active ? (Voice.muted ? '🔇 Unmute Mic' : '🎤 Mic Working') : '🎤 Test My Mic', on: { click: async () => {
            try {
              if (!Voice.active) { await Voice.join(); toast('Microphone active! Speak to see the level bar move.', 'good'); }
              else Voice.setMuted(!Voice.muted);
              Voice.onChange = () => { updateVoiceUI(); updateSpeaking(); };
              viewOnlineEntry(codeIn.value);
            } catch (e) { toast(e.message || 'Microphone blocked or unavailable.', 'err'); }
          } } }),
          h('button', { class: 'btn sm ' + (Voice.loopback ? 'good' : 'sec'), text: Voice.loopback ? '🔊 Hearing Yourself (On)' : '🎧 Hear Myself (Loopback)', on: { click: async () => {
            try {
              Voice.onChange = () => { updateVoiceUI(); updateSpeaking(); };
              await Voice.toggleLoopback();
              viewOnlineEntry(codeIn.value);
            } catch (e) { toast(e.message || 'Microphone blocked or unavailable.', 'err'); }
          } } }),
          Voice.active && h('button', { class: 'btn sm sec', text: 'Stop Test', on: { click: () => { Voice.leave(); viewOnlineEntry(codeIn.value); } } }))),
      err, h('button', { class: 'btn sec', text: '← Back', on: { click: viewHome } }));
  }

  function enterRoom(r) {
    App.room = r.room; App.chat = []; App.unread = 0; App.session = null;
    $('#net-badge').hidden = false;
    buildSocial(); onRoomUpdate();
    autoVoice();
  }
  async function autoVoice() {
    try { await Voice.join(); toast('🎤 Voice is on – tap the mic button to mute', 'good'); }
    catch (err) { toast(err && err.name === 'NotAllowedError' ? 'Microphone blocked – allow it in your browser to talk. You can still chat.' : 'Voice unavailable: ' + ((err && err.message) || 'no microphone'), 'err'); }
    updateVoiceUI();
  }
  function onRoomUpdate() {
    if (!App.room) return;
    if (App.room.started && App.session && App.session.online) { if (App.view === 'game') renderGame(); else { App.view = 'game'; renderGame(); } }
    else if (!App.room.started) { App.session = null; viewLobby(); }
    updateVoiceUI(); updateSocialHead();
  }
  function viewLobby() {
    App.view = 'lobby';
    const r = App.room, isHost = r.host === Net.pid, m = META[r.game];
    const link = location.origin + location.pathname + '?room=' + r.code;
    const sel = h('select', { disabled: !isHost, 'aria-label': 'Game', on: { change: (e) => Net.send('room:set-game', { game: e.target.value }) } },
      Object.values(META).map(g => h('option', { value: g.id, text: g.emoji + ' ' + g.name, selected: g.id === r.game })));
    const startBtn = h('button', { class: 'btn good block', text: '▶ Start game', disabled: !isHost, on: { click: async () => { const res = await Net.request('room:start'); if (!res.ok) toast(res.error || 'Cannot start', 'err'); } } });
    setStage(h('h2', { text: 'Private room' }),
      h('div', { class: 'card' }, h('div', { class: 'mute small center', text: 'Share this code with friends' }), h('div', { class: 'code-box', text: r.code }),
        h('div', { class: 'row', style: 'margin-top:10px;justify-content:center' },
          h('button', { class: 'btn sm sec', text: '📋 Copy code', on: { click: () => copy(r.code) } }),
          h('button', { class: 'btn sm', text: '🔗 Share invite', on: { click: () => share(r.code, link) } }))),
      h('div', { class: 'note', style: 'margin-bottom:14px', text: '🎤 Voice chat turns on automatically when you join. Use the mic button to mute.' }),
      h('div', { class: 'card' }, h('h3', { text: 'Players (' + r.players.length + ')' }),
        r.players.map(p => h('div', { class: 'seat-row', 'data-pid': p.pid }, h('span', { text: p.pid === r.host ? '👑' : '🙂' }), h('b', { text: p.name }), p.pid === Net.pid && h('span', { class: 'mute small', text: '(you)' }), p.voice && h('span', { text: p.muted ? '🔇' : '🎤' })))),
      h('div', { class: 'card' }, h('h3', { text: 'Game' }), sel, h('p', { class: 'mute small', text: m.desc + ' · ' + (m.min === m.max ? m.min : m.min + '–' + m.max) + ' players' }),
        isHost ? startBtn : h('div', { class: 'note', text: 'Waiting for the host to start…' })),
      h('button', { class: 'btn sec', text: '← Leave room', on: { click: leaveRoom } }));
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied!', 'good'); }
    catch (e) {
      try {
        const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
        document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
        toast('Copied!', 'good');
      } catch (e2) { toast(text); }
    }
  }
  async function share(code, link) {
    const text = 'Join my Game Hub room! Code: ' + code;
    if (navigator.share) { try { await navigator.share({ title: 'Game Hub', text, url: link }); return; } catch (e) { /* cancelled */ } }
    copy(text + ' ' + link);
  }
  function leaveRoom() {
    Net.leave(); App.room = null; App.session = null; App.chat = [];
    $('#social').hidden = true; $('#social').classList.remove('open'); $('#social-fab').hidden = true; $('#mic-fab').hidden = true; $('#net-badge').hidden = true; App.socialBuilt = false;
    viewHome();
  }

  /* ===================================================================
     SOCIAL PANEL (chat + voice)
     =================================================================== */
  const SOC = {};
  function buildSocial() {
    const el = $('#social'); el.hidden = false; $('#social-fab').hidden = false; App.socialBuilt = true;
    SOC.head = h('h3', { text: 'Room' });
    SOC.voice = h('div', { class: 'voice-row' });
    SOC.log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    SOC.input = h('input', { placeholder: 'Message…', maxlength: 300, 'aria-label': 'Chat message', on: { keydown: (e) => { if (e.key === 'Enter') sendChat(); } } });
    const emojis = ['😂', '😮', '👏', '🔥', '😭', '😈', 'GG', 'Nice!'].map(x => h('button', { text: x, on: { click: () => Net.send('chat:send', { text: x }) } }));
    el.replaceChildren(h('div', { class: 'panel' },
      h('div', { class: 'sheet-head' }, SOC.head, h('button', { class: 'btn sm sec', text: '✕', 'aria-label': 'Close chat', on: { click: () => toggleSocial(false) } })),
      SOC.voice, SOC.log, h('div', { class: 'emojis' }, emojis),
      h('div', { class: 'chat-in' }, SOC.input, h('button', { class: 'btn', text: 'Send', on: { click: sendChat } }))));
    Voice.onChange = () => { updateVoiceUI(); updateSpeaking(); };
    updateVoiceUI(); updateSocialHead();
    App.chat.forEach(addMsg);
  }
  function updateSocialHead() { if (SOC.head && App.room) SOC.head.textContent = 'Room ' + App.room.code + ' · ' + App.room.players.length + ' online'; }
  function sendChat() { const t = SOC.input.value.trim(); if (!t) return; Net.send('chat:send', { text: t }); SOC.input.value = ''; }
  function addMsg(m) {
    if (!SOC.log) return;
    const near = SOC.log.scrollHeight - SOC.log.scrollTop - SOC.log.clientHeight < 60;
    SOC.log.append(m.system ? h('div', { class: 'msg sys', text: m.text }) : h('div', { class: 'msg' + (m.pid === Net.pid ? ' me' : '') }, m.pid !== Net.pid && h('span', { class: 'who', text: m.name }), m.text));
    while (SOC.log.children.length > 150) SOC.log.firstChild.remove();
    if (near || m.pid === Net.pid) SOC.log.scrollTop = SOC.log.scrollHeight;
  }
  function toggleSocial(open) {
    const el = $('#social'); const o = open === undefined ? !el.classList.contains('open') : open;
    el.classList.toggle('open', o);
    if (o) { App.unread = 0; updateUnread(); setTimeout(() => { if (SOC.log) SOC.log.scrollTop = SOC.log.scrollHeight; }, 260); }
  }
  function updateUnread() { const u = $('#unread'); u.textContent = App.unread > 9 ? '9+' : App.unread; u.hidden = !App.unread; }
  function updateVoiceUI() {
    const mf = $('#mic-fab');
    if (mf) { mf.hidden = !(Voice.active && App.room); mf.textContent = Voice.muted ? '🔇' : '🎤'; mf.classList.toggle('muted', Voice.muted); mf.setAttribute('aria-label', Voice.muted ? 'Unmute microphone' : 'Mute microphone'); }
    const tb = $('#mic-test-bar'); if (tb) tb.style.width = (Voice.active && !Voice.muted ? Voice.level : 0) + '%';
    const ts = $('#mic-test-status'); if (ts) ts.textContent = Voice.active ? (Voice.muted ? '🔇 Muted' : (Voice.level > 12 ? '🎙️ Speaking (' + Voice.level + '%)' : '🎤 Listening…')) : 'Tap below to test';
    if (!SOC.voice) return;
    if (!Voice.active) {
      SOC.voice.replaceChildren(h('button', { class: 'btn sm good', text: '🎤 Turn on voice', on: { click: async (e) => { e.target.disabled = true; try { await Voice.join(); toast('Voice connected – friends in voice can hear you', 'good'); } catch (err) { toast(err.name === 'NotAllowedError' ? 'Microphone permission was blocked.' : (err.message || 'Could not start voice'), 'err'); e.target.disabled = false; } } } }),
        h('span', { class: 'mute small', text: 'Voice is off – tap to talk with friends' }));
    } else {
      SOC.voice.replaceChildren(
        h('button', { class: 'btn sm ' + (Voice.muted ? 'bad' : 'sec'), text: Voice.muted ? '🔇 Muted – tap to unmute' : '🎤 Mic on – tap to mute', on: { click: () => Voice.setMuted(!Voice.muted) } }),
        h('button', { class: 'btn sm ' + (Voice.deaf ? 'bad' : 'sec'), text: Voice.deaf ? '🔇 Deafened' : '🎧 Listening', on: { click: () => Voice.setDeaf(!Voice.deaf) } }),
        h('button', { class: 'btn sm sec', text: 'Leave voice', on: { click: () => Voice.leave() } }),
        h('div', { class: 'mic-meter' }, h('div', { class: 'mic-meter-fill', style: 'width:' + (Voice.muted ? 0 : Voice.level) + '%' })));
    }
  }
  function updateSpeaking() {
    document.querySelectorAll('.pchip[data-pid], .seat-row[data-pid]').forEach(c => c.classList.toggle('speaking', Voice.speaking.has(c.getAttribute('data-pid'))));
  }

  /* ===================================================================
     GAME VIEW
     =================================================================== */
  function renderGame() {
    const S = App.session; if (!S) return;
    App.view = 'game';
    const s = S.state, m = META[s.game];
    const isHost = S.online && App.room && App.room.host === Net.pid;
    const top = h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' },
      h('h2', { style: 'margin:0', text: m.emoji + ' ' + m.name }),
      S.online ? h('div', { class: 'row' }, isHost && h('button', { class: 'btn sm sec', text: 'Back to lobby', on: { click: () => { if (s.over) Net.send('room:lobby'); else askConfirm('End the game for everyone?', () => Net.send('room:lobby')); } } }),
                  h('button', { class: 'btn sm sec', text: 'Leave', on: { click: () => { askConfirm('Leave this game?', () => leaveRoom()); } } }))
               : h('button', { class: 'btn sm sec', text: '☰ Menu', on: { click: () => { const go = () => { S.stop(); App.session = null; viewHome(); }; if (s.over) go(); else askConfirm('Leave this game?', go); } } }));
    const body = h('div');
    R[s.game](S, body);
    setStage(top, body);
    updateSpeaking();
    // pass-and-play hand-over screen (Rock Paper Scissors)
    if (!S.online && S.curtain !== null) {
      const next = S.names[S.curtain];
      $('#overlay').hidden = false;
      $('#overlay').replaceChildren(h('div', { class: 'box' }, h('div', { class: 'big', text: '🙈' }), h('h2', { text: 'Pass the device to ' + next }), h('p', { class: 'mute', text: 'Your friend picked in secret. Now it is your turn – no peeking!' }),
        h('button', { class: 'btn block', text: "I'm " + next + ' – ready', on: { click: () => { S.curtain = null; $('#overlay').hidden = true; renderGame(); } } })));
    } else $('#overlay').hidden = true;
  }

  function pbar(S, items) {
    return h('div', { class: 'pbar' }, items.map(it => {
      const p = S.online && App.room ? App.room.players[it.seat] : null;
      return h('div', { class: 'pchip' + (it.turn ? ' turn' : '') + (S.online && S.seat === it.seat ? ' me' : '') + (p && !p.connected ? ' off' : ''), 'data-pid': p ? p.pid : null },
        it.dot && h('span', { class: 'dot c-' + it.dot }), it.mark && h('b', { text: it.mark }),
        h('span', { text: (S.names[it.seat] || 'Player') + (S.isBot(it.seat) ? ' 🤖' : '') + (p && !p.connected ? ' (bot)' : '') }),
        it.extra != null && h('span', { class: 'score', text: it.extra }), p && p.voice && h('span', { text: p.muted ? '🔇' : '🎤' }));
    }));
  }
  /* DOM append that skips null/false (native append would print the words "null"/"false") */
  const add = (el, ...kids) => el.append(...kids.flat().filter(k => k != null && k !== false));
  const nameOf = (S, i) => S.names[i] || 'Player';
  function rematchBtn(S, label) {
    return h('button', { class: 'btn block', style: 'margin-top:12px', text: label || '🔁 Play again', on: { click: () => S.send({ type: 'rematch' }, S.online ? undefined : 0) } });
  }

  /* ---------------------------- LUDO ---------------------------- */
  const TRACK = (() => {
    const t = [];
    for (let c = 1; c <= 5; c++) t.push([6, c]);
    for (let r = 5; r >= 0; r--) t.push([r, 6]);
    t.push([0, 7]);
    for (let r = 0; r <= 5; r++) t.push([r, 8]);
    for (let c = 9; c <= 14; c++) t.push([6, c]);
    t.push([7, 14]);
    for (let c = 14; c >= 9; c--) t.push([8, c]);
    for (let r = 9; r <= 14; r++) t.push([r, 8]);
    t.push([14, 7]);
    for (let r = 14; r >= 9; r--) t.push([r, 6]);
    for (let c = 5; c >= 0; c--) t.push([8, c]);
    t.push([7, 0]); t.push([6, 0]);
    return t;
  })();
  const HOMECOL = {
    red: [1, 2, 3, 4, 5].map(c => [7, c]), green: [1, 2, 3, 4, 5].map(r => [r, 7]),
    yellow: [13, 12, 11, 10, 9].map(c => [7, c]), blue: [13, 12, 11, 10, 9].map(r => [r, 7])
  };
  const BASES = { red: [1, 1], green: [1, 10], yellow: [10, 10], blue: [10, 1] };
  const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function ludoBoard(S, act) {
    const s = S.state, board = h('div', { class: 'ludo', role: 'img', 'aria-label': 'Ludo board' });
    const cells = new Map(), pockets = {};
    const mk = (r, c, cls) => { const el = h('div', { class: 'lc ' + (cls || ''), style: 'grid-row:' + (r + 1) + ';grid-column:' + (c + 1) }); cells.set(r + ',' + c, el); board.append(el); return el; };
    GL.L_COLORS.forEach(color => {
      const [r, c] = BASES[color];
      const inner = h('div', { class: 'base-in' });
      pockets[color] = [0, 1, 2, 3].map(() => { const p = h('div', { class: 'pocket' }); inner.append(p); return p; });
      board.append(h('div', { class: 'base ' + color, style: 'grid-area:' + r + '/' + c + '/' + (r + 6) + '/' + (c + 6) }, inner));
    });
    TRACK.forEach((rc, i) => {
      const startColor = GL.L_COLORS.find(c => GL.L_OFFSET[c] === i);
      mk(rc[0], rc[1], (startColor ? 'start-' + startColor + ' ' : '') + (GL.L_SAFE.includes(i) ? 'safe' : ''));
    });
    GL.L_COLORS.forEach(color => HOMECOL[color].forEach(rc => mk(rc[0], rc[1], 'home-' + color)));
    const center = h('div', { class: 'center-home' }); board.append(center);

    const groups = new Map();
    const put = (el, token) => { if (!groups.has(el)) groups.set(el, []); groups.get(el).push(token); };
    const turnColor = s.colors[s.turn];
    s.colors.forEach(color => s.tokens[color].forEach((pos, i) => {
      let target;
      if (pos === -1) target = pockets[color][i];
      else if (pos === 56) target = center;
      else if (pos <= 50) { const rc = TRACK[(GL.L_OFFSET[color] + pos) % 52]; target = cells.get(rc[0] + ',' + rc[1]); }
      else { const rc = HOMECOL[color][pos - 51]; target = cells.get(rc[0] + ',' + rc[1]); }
      put(target, { color, i, pos });
    }));
    groups.forEach((list, el) => {
      list.forEach(t => {
        const movable = !s.over && s.rolled && act === s.turn && t.color === turnColor && s.valid.includes(t.i);
        const moved = App.anim.moved && App.anim.moved.color === t.color && App.anim.moved.token === t.i;
        const cls = 'tk ' + t.color + (el === center ? ' mini' : list.length > 1 ? (list.length === 2 ? ' s2' : list.length === 3 ? ' s3' : ' s4') : '') + (movable ? ' movable' : '') + (moved ? ' moved' : '');
        el.append(h('div', { class: cls, role: movable ? 'button' : null, tabindex: movable ? '0' : null, 'aria-label': movable ? 'Move ' + t.color + ' token ' + (t.i + 1) : null,
          on: movable ? { click: () => S.send({ type: 'move', token: t.i }, act), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.send({ type: 'move', token: t.i }, act); } } } : null }));
      });
    });
    App.anim.moved = null;
    return board;
  }

  function renderLudo(S, root) {
    const s = S.state, act = S.actSeat();
    const canRoll = !s.over && !s.td && act === s.turn && !s.rolled;
    const die = h('div', { class: 'die' + (canRoll ? ' ready' : '') + (App.anim.roll ? ' rolling' : ''), role: 'button', tabindex: canRoll ? '0' : '-1', 'aria-label': canRoll ? 'Roll the dice' : 'Dice',
      text: s.last ? FACES[s.last.dice - 1] : '🎲', on: { click: () => canRoll && S.send({ type: 'roll' }, act), keydown: (e) => { if (canRoll && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); S.send({ type: 'roll' }, act); } } } });
    App.anim.roll = false;
    let status;
    if (s.over) status = '🏆 ' + nameOf(S, s.winner) + ' wins!';
    else if (s.td) status = '🎭 Truth or Dare challenge for ' + nameOf(S, s.td.target) + '!';
    else if (act === s.turn) status = s.rolled ? 'Tap a glowing token to move' : (S.online ? "It's your turn – roll!" : nameOf(S, s.turn) + ' – tap the dice!');
    else status = nameOf(S, s.turn) + (S.isBot(s.turn) ? ' is thinking…' : "'s turn…");
    const items = s.colors.map((c, i) => ({ seat: i, dot: c, turn: !s.over && i === s.turn, extra: '🏁 ' + s.tokens[c].filter(p => p === 56).length + '/4' }));
    add(root, pbar(S, items), h('div', { class: 'board-wrap' }, ludoBoard(S, act)),
      h('div', { class: 'dice-row' }, die),
      h('div', { class: 'status', text: status }),
      s.last && !s.over && h('div', { class: 'mute small center', text: nameOf(S, s.last.seat) + ' rolled a ' + s.last.dice + (s.last.dice === 6 ? ' – roll again after moving!' : '') }));
    if (s.td) {
      const td = s.td, mine = S.online ? S.seat === td.judge : (!S.isBot(td.target) || !S.isBot(td.judge));
      add(root, h('div', { class: 'td-card ' + td.kind }, h('div', { class: 'kind', text: td.kind === 'dare' ? '😈 DARE' : '🤔 TRUTH' }),
        h('div', { class: 'mute small', text: nameOf(S, td.target) + ' was captured by ' + nameOf(S, td.judge) }), h('p', { text: td.prompt }),
        mine ? h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn good sm', text: '✅ Completed', on: { click: () => S.send({ type: 'td-resolve', completed: true }, td.judge) } }),
          h('button', { class: 'btn bad sm', text: '❌ Skipped (−2 steps)', on: { click: () => S.send({ type: 'td-resolve', completed: false }, td.judge) } }))
          : h('div', { class: 'mute small', text: S.online ? nameOf(S, td.judge) + ' decides if it was done.' : 'The computer will move on shortly.' })));
    }
    if (s.over) add(root, S.online ? h('div', { class: 'note center', text: 'Host can go back to the lobby to play again.' }) : h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn grow', text: '🔁 Play again', on: { click: () => S.restart() } })));
  }

  /* ---------------------- TIC-TAC-TOE ---------------------- */
  function scoreItems(S, s) {
    return [0, 1].map(i => ({ seat: i, mark: s.game === 'ttt' ? (i === 0 ? '❌' : '⭕') : (i === 0 ? '🔴' : '🟡'), turn: !s.over && i === s.turn, extra: s.scores[i] }));
  }
  function turnText(S, s, act) {
    if (s.over) return s.draw ? "It's a draw!" : '🏆 ' + nameOf(S, s.winner) + ' wins this round!';
    if (act === s.turn) return S.online ? 'Your turn!' : nameOf(S, s.turn) + ', your turn!';
    return nameOf(S, s.turn) + (S.isBot(s.turn) ? ' is thinking…' : "'s turn…");
  }
  function renderTTT(S, root) {
    const s = S.state, act = S.actSeat();
    const grid = h('div', { class: 'ttt' }, s.board.map((v, i) => h('button', { class: 'tcell ' + (v === 0 ? 'x' : v === 1 ? 'o' : '') + (s.line && s.line.includes(i) ? ' win' : ''), text: v === 0 ? '✕' : v === 1 ? '○' : '',
      'aria-label': 'Cell ' + (i + 1), disabled: s.over || v !== null || act !== s.turn, on: { click: () => S.send({ type: 'place', cell: i }, act) } })));
    add(root, pbar(S, scoreItems(S, s)), h('div', { class: 'status', text: turnText(S, s, act) }), grid,
      h('div', { class: 'mute small center', text: 'Round ' + s.round + ' · Draws: ' + s.scores[2] }), s.over && rematchBtn(S, '🔁 Next round'));
  }

  /* ---------------------- CONNECT FOUR ---------------------- */
  function renderC4(S, root) {
    const s = S.state, act = S.actSeat();
    const colsFull = (c) => s.board[c] !== null;
    const heads = h('div', { class: 'c4cols' }, [0, 1, 2, 3, 4, 5, 6].map(c => h('button', { text: '⬇', 'aria-label': 'Drop in column ' + (c + 1), disabled: s.over || act !== s.turn || colsFull(c), on: { click: () => S.send({ type: 'drop', col: c }, act) } })));
    const grid = h('div', { class: 'c4' }, s.board.map((v, i) => h('div', { class: 'c4cell' + (v !== null ? ' p' + v : '') + (s.line && s.line.includes(i) ? ' win' : '') + (s.lastCell === i ? ' last' : '') })));
    add(root, pbar(S, scoreItems(S, s)), h('div', { class: 'status', text: turnText(S, s, act) }), heads, grid,
      h('div', { class: 'mute small center', text: 'Round ' + s.round + ' · Draws: ' + s.scores[2] }), s.over && rematchBtn(S, '🔁 Next round'));
  }

  /* ---------------------- ROCK PAPER SCISSORS ---------------------- */
  const RPS_E = { rock: '🪨', paper: '📄', scissors: '✂️' };
  function renderRPS(S, root) {
    const s = S.state, act = S.actSeat();
    const picked = s.picked || s.choices.map(c => c !== null);
    const items = [0, 1].map(i => ({ seat: i, turn: !s.over && !picked[i], extra: s.scores[i], mark: picked[i] && !s.over ? '✅' : null }));
    add(root, pbar(S, items), h('div', { class: 'mute small center', text: 'First to ' + s.target + ' wins · Round ' + Math.min(s.round, 99) }));
    if (s.last) {
      const res = s.last.result;
      add(root, h('div', { class: 'reveal' }, h('span', { text: RPS_E[s.last.choices[0]] }), h('span', { class: 'small mute', text: 'vs' }), h('span', { text: RPS_E[s.last.choices[1]] })),
        h('div', { class: 'status', text: res === 'draw' ? 'Draw!' : nameOf(S, res) + ' wins the round' }));
    } else add(root, h('div', { class: 'status', text: 'Pick your move!' }));
    if (s.over) add(root, h('div', { class: 'status', text: '🏆 ' + nameOf(S, s.winner) + ' wins the match!' }), rematchBtn(S, '🔁 New match'));
    else if (act !== null && s.choices[act] === null && !(picked[act] && S.online)) {
      add(root, h('div', { class: 'status', style: 'margin-top:10px', text: S.online ? 'Choose:' : nameOf(S, act) + ', choose:' }),
        h('div', { class: 'rps-row' }, Object.keys(RPS_E).map(k => h('button', { class: 'rps-btn', text: RPS_E[k], 'aria-label': k, on: { click: () => S.send({ type: 'pick', choice: k }, act) } }))));
    } else add(root, h('div', { class: 'status mute', text: 'Locked in ✅ – waiting for the other player…' }));
  }

  /* ---------------------- TRUTH OR DARE ---------------------- */
  function renderTOD(S, root) {
    const s = S.state, act = S.actSeat(), local = !S.online;
    const items = s.scores.map((v, i) => ({ seat: i, turn: i === s.turn, extra: v }));
    add(root, pbar(S, items), h('div', { class: 'mute small center', text: 'Round ' + s.round + ' · each completed challenge scores a point' }));
    const you = (local || act === s.turn);
    if (s.phase === 'choose') {
      add(root, h('div', { class: 'status', text: you ? (local ? nameOf(S, s.turn) + ', truth or dare?' : 'Your turn – truth or dare?') : nameOf(S, s.turn) + ' is choosing…' }));
      if (you) {
        const pick = (kind) => S.send({ type: 'choose', kind, cat: App.todCat }, s.turn);
        add(root, h('div', { class: 'cats', role: 'group', 'aria-label': 'Question type' }, GL.CATS.map(c => h('button', { class: 'cat' + (App.todCat === c.id ? ' on' : ''), text: c.label, on: { click: () => { App.todCat = c.id; renderGame(); } } }))),
          h('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
            h('button', { class: 'btn', style: 'background:#0369a1', text: '🤔 Truth', on: { click: () => pick('truth') } }),
            h('button', { class: 'btn', style: 'background:#be123c', text: '😈 Dare', on: { click: () => pick('dare') } }),
            h('button', { class: 'btn sec', text: '🎲 Random', on: { click: () => pick('random') } })),
          h('div', { class: 'mute small center', style: 'margin-top:8px', text: 'You can swap a question once. Be kind – nobody is forced to share more than they want.' }));
      }
    } else {
      const c = s.card, judgeSeat = local ? (s.turn + 1) % s.n : act;
      const canJudge = local || (act !== null && act !== s.turn);
      add(root, h('div', { class: 'td-card ' + c.kind }, h('div', { class: 'kind', text: (c.kind === 'dare' ? '😈 DARE' : '🤔 TRUTH') + ' for ' + nameOf(S, s.turn) }), c.cat && h('div', { class: 'mute small', text: GL.CAT_NAME[c.cat] }), h('p', { text: c.prompt }),
        you && !c.swapped && h('button', { class: 'btn sm sec', text: '🔄 Swap (once)', on: { click: () => S.send({ type: 'swap' }, s.turn) } })),
        canJudge ? h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn good', text: '✅ Done', on: { click: () => S.send({ type: 'judge', done: true }, judgeSeat) } }),
          h('button', { class: 'btn bad', text: '❌ Skipped', on: { click: () => S.send({ type: 'judge', done: false }, judgeSeat) } }))
          : h('div', { class: 'status mute', text: 'Do it! Your friends will judge.' }));
      if (canJudge) add(root, h('div', { class: 'mute small center', style: 'margin-top:6px', text: local ? 'Everyone else decides whether ' + nameOf(S, s.turn) + ' did it.' : 'Did ' + nameOf(S, s.turn) + ' do it?' }));
    }
    if (s.history.length) add(root, h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', { text: 'Recent' }),
      h('ul', { class: 'hist' }, s.history.map(x => h('li', {}, (x.done ? '✅ ' : '❌ ') + nameOf(S, x.seat) + ' – ' + (x.kind === 'dare' ? 'Dare: ' : 'Truth: ') + x.prompt)))));
  }
  const R = { ludo: renderLudo, ttt: renderTTT, c4: renderC4, rps: renderRPS, tod: renderTOD };

  /* ===================================================================
     NETWORK HOOKS
     =================================================================== */
  Net.on('room:update', (room) => { App.room = room; onRoomUpdate(); });
  Net.on('game:state', ({ state, events: evs, seat }) => {
    if (!App.room) return;
    if (!App.session || !App.session.online) { App.session = new OnlineSession(seat, state); }
    App.session.state = state; App.session.seat = seat;
    App.view = 'game';
    events(App.session, evs); renderGame();
  });
  Net.on('game:end', () => { App.session = null; toast('Back to the lobby'); });
  Net.on('game:error', (msg) => toast(msg, 'err'));
  Net.on('chat:msg', (m) => {
    App.chat.push(m); if (App.chat.length > 150) App.chat.shift();
    addMsg(m);
    if (!m.system && m.pid !== Net.pid) { SFX.chat(); if (!$('#social').classList.contains('open') && window.innerWidth <= 860) { App.unread++; updateUnread(); } }
  });
  Net.on('emoji:show', (m) => { floatEmoji(m.emoji, m.pid === Net.pid ? 'You' : m.name); if (m.pid !== Net.pid) SFX.pop(); });
  Net.on('kicked', (msg) => { toast(msg, 'err'); leaveRoom(); });
  Net.on('rejoined', (r) => { App.room = r.room; toast('Reconnected', 'good'); onRoomUpdate(); Voice.rejoin(); });
  const badge = $('#net-badge');
  Net.on('status', (st) => {
    badge.className = 'badge ' + (st === 'online' ? 'on' : st === 'connecting' ? 'mid' : 'off');
    badge.textContent = st === 'online' ? '● Online' : st === 'connecting' ? '● Reconnecting…' : '● Disconnected';
    badge.hidden = !App.room;
  });
  Net.on('browser-offline', () => { toast("You're offline – offline games still work 📴"); if (App.view === 'home') viewHome(); });
  Net.on('browser-online', () => { toast('Back online 🌐', 'good'); if (App.view === 'home') viewHome(); });

  /* ===================================================================
     BOOT
     =================================================================== */
  $('#btn-sound').textContent = soundOn ? '🔊' : '🔇';
  $('#btn-sound').addEventListener('click', () => { soundOn = !soundOn; store.set('sound', soundOn); $('#btn-sound').textContent = soundOn ? '🔊' : '🔇'; if (soundOn) SFX.tick(); });
  $('#btn-home').addEventListener('click', () => {
    const goHome = () => {
      if (App.session && !App.session.online) App.session.stop();
      if (App.room) { leaveRoom(); return; }
      App.session = null; viewHome();
    };
    if (App.session && !App.session.state.over) { askConfirm('Leave the current game?', goHome); return; }
    if (App.room) { askConfirm('Leave the room?', goHome); return; }
    goHome();
  });
  buildEmojiBar();
  $('#social-fab').addEventListener('click', () => toggleSocial());
  $('#mic-fab').addEventListener('click', () => Voice.setMuted(!Voice.muted));
  // mobile browsers sometimes pause remote audio until the next tap: resume it
  document.addEventListener('click', () => { document.querySelectorAll('#audio-sink audio').forEach(a => { if (a.paused && a.srcObject) a.play().catch(() => {}); }); if (Voice.ctx && Voice.ctx.state === 'suspended') Voice.ctx.resume(); });

  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) viewOnlineEntry(roomParam.toUpperCase().slice(0, 5)); else viewHome();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  window.__hub = { App, GL };   // handy for debugging in the console
})();

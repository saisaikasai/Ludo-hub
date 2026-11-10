/* Online layer: socket.io connection + WebRTC voice chat. */
(function () {
  'use strict';
  const SKEY = 'gamehub.session';
  const base = () => (window.GAMEHUB_SERVER || '').replace(/\/$/, '');

  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  const Net = {
    socket: null, ice: DEFAULT_ICE, handlers: {},
    pid: null, code: null,
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
    fire(ev, a, b) { (this.handlers[ev] || []).forEach(fn => { try { fn(a, b); } catch (e) { console.error(e); } }); },
    saved() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } },
    save(s) { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) { /* private mode */ } },

    loadClient() {
      return new Promise((resolve, reject) => {
        if (window.io) return resolve();
        const s = document.createElement('script');
        s.src = base() + '/socket.io/socket.io.js';
        const timer = setTimeout(() => reject(new Error('The game server did not answer.')), 12000);
        s.onload = () => { clearTimeout(timer); window.io ? resolve() : reject(new Error('Server client missing.')); };
        s.onerror = () => { clearTimeout(timer); reject(new Error('Cannot reach the game server. Offline games still work!')); };
        document.head.appendChild(s);
      });
    },

    async connect() {
      if (this.socket) return;
      if (!navigator.onLine) throw new Error('You are offline. Offline games still work!');
      await this.loadClient();
      const socket = this.socket = window.io(base() || undefined, { reconnection: true, reconnectionDelay: 800, timeout: 10000 });
      let first = true;
      socket.on('connect', () => {
        Net.fire('status', 'online');
        if (!first && Net.code) {            // automatic rejoin after a network blip
          const s = Net.saved();
          if (s && s.code === Net.code) {
            socket.emit('room:join', { code: s.code, key: s.key, name: s.name }, (r) => {
              if (r && r.ok) { Net.ice = r.ice || Net.ice; Net.fire('rejoined', r); } else Net.fire('kicked', (r && r.error) || 'Could not rejoin the room.');
            });
          }
        }
        first = false;
      });
      socket.on('disconnect', () => Net.fire('status', 'offline'));
      socket.io.on('reconnect_attempt', () => Net.fire('status', 'connecting'));
      ['room:update', 'room:kicked', 'game:state', 'game:end', 'game:error', 'chat:msg', 'emoji:show'].forEach(ev => socket.on(ev, (d) => Net.fire(ev === 'room:kicked' ? 'kicked' : ev, d)));
      socket.on('voice:peers', (l) => Voice.onPeers(l));
      socket.on('voice:signal', (m) => Voice.onSignal(m));
      socket.on('voice:left', (pid) => Voice.drop(pid));
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Connection timed out.')), 12000);
        socket.once('connect', () => { clearTimeout(t); resolve(); });
        socket.once('connect_error', () => { clearTimeout(t); reject(new Error('Cannot reach the game server.')); });
      });
    },

    request(ev, data) {
      return new Promise((resolve) => {
        if (!this.socket) return resolve({ ok: false, error: 'Not connected.' });
        this.socket.timeout(8000).emit(ev, data, (err, res) => resolve(err ? { ok: false, error: 'Server did not respond.' } : res));
      });
    },
    async create(name, game) {
      await this.connect();
      const r = await this.request('room:create', { name, game });
      if (r.ok) this.joined(r, name);
      return r;
    },
    async join(name, code, key) {
      await this.connect();
      const r = await this.request('room:join', { name, code, key });
      if (r.ok) this.joined(r, name);
      return r;
    },
    joined(r, name) { this.pid = r.pid; this.code = r.code; this.ice = r.ice || this.ice; this.save({ code: r.code, key: r.key, name }); },
    leave() {
      Voice.leave();
      if (this.socket) this.socket.emit('room:leave');
      this.pid = null; this.code = null; this.save(null);
    },
    send(ev, data) { if (this.socket) this.socket.emit(ev, data); }
  };

  /* ------------------------------ Voice chat ------------------------------ */
  const Voice = {
    active: false, muted: false, deaf: false, loopback: false, level: 0,
    stream: null, peers: new Map(), pending: new Map(), makingOffer: new Set(), retryTimers: new Map(),
    ctx: null, analysers: new Map(), speaking: new Set(), timer: null, onChange: null,

    /** Ask for the microphone right away (call it inside a tap/click so the browser allows it). */
    prepare() {
      if (this.stream || this.preparing || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      this.preparing = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        .then(s => { this.stream = s; return s; }).catch(e => { this.prepError = e; return null; })
        .then(s => { this.preparing = null; return s; });
    },
    cancelPrepare() {
      const go = () => { if (!this.active && this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } };
      if (this.preparing) this.preparing.then(go); else go();
    },
    /** Join voice using the prepared microphone (or ask now). Throws if the mic is unavailable. */
    async join() {
      if (this.active) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Voice needs a modern browser over HTTPS or localhost.');
      if (this.preparing) await this.preparing;
      if (!this.stream || this.stream.getAudioTracks().every(t => t.readyState === 'ended')) {
        if (this.prepError) { const e = this.prepError; this.prepError = null; throw e; }
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      }
      this.active = true; this.muted = false;
      this.stream.getAudioTracks().forEach(t => { t.enabled = true; });
      this.watch('me', this.stream);
      if (Net.socket && Net.code) Net.send('voice:join');
      this.changed();
    },
    /** Toggle local mic test (hear yourself + see live mic meter even offline) */
    async toggleLoopback() {
      if (!this.active) await this.join();
      this.loopback = !this.loopback;
      let a = document.getElementById('audio-loopback');
      if (this.loopback && this.stream) {
        if (!a) {
          a = document.createElement('audio');
          a.id = 'audio-loopback';
          a.autoplay = true;
          a.playsInline = true;
          document.getElementById('audio-sink').appendChild(a);
        }
        a.srcObject = this.stream;
        a.muted = false;
        const p = a.play(); if (p && p.catch) p.catch(() => {});
      } else if (a) {
        a.srcObject = null;
        a.remove();
      }
      this.changed();
    },
    /** After a network blip the server forgot us: announce again and reconnect to everyone. */
    rejoin() {
      if (!this.active) return;
      [...this.peers.keys()].forEach(p => this.drop(p));
      if (Net.socket && Net.code) {
        Net.send('voice:join');
        if (this.muted) Net.send('voice:mute', { muted: true });
      }
    },
    onPeers(list) { if (this.active && Array.isArray(list)) list.forEach(pid => this.connectTo(pid)); },

    makePeer(pid) {
      this.drop(pid, true);
      const pc = new RTCPeerConnection({ iceServers: Net.ice });
      if (this.stream) this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
      pc.onicecandidate = (e) => { if (e.candidate) Net.send('voice:signal', { to: pid, data: { candidate: e.candidate } }); };
      pc.ontrack = (e) => {
        const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        let a = document.getElementById('audio-' + pid);
        if (!a) { a = document.createElement('audio'); a.id = 'audio-' + pid; a.autoplay = true; a.playsInline = true; document.getElementById('audio-sink').appendChild(a); }
        a.srcObject = stream; a.muted = this.deaf;
        const p = a.play(); if (p && p.catch) p.catch(() => {});
        this.watch(pid, stream);
        this.changed();
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          clearTimeout(this.retryTimers.get(pid));
          this.retryTimers.delete(pid);
          this.changed();
        } else if (st === 'failed' || st === 'disconnected') {
          clearTimeout(this.retryTimers.get(pid));
          const t = setTimeout(() => {
            if (!this.active || !AppRoomHas(pid)) { this.drop(pid); return; }
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
              this.connectTo(pid, true);
            }
          }, st === 'failed' ? 800 : 3500);
          this.retryTimers.set(pid, t);
          this.changed();
        }
      };
      this.peers.set(pid, pc);
      return pc;
    },
    async connectTo(pid, iceRestart) {
      if (!this.active || !pid || pid === Net.pid) return;
      try {
        this.makingOffer.add(pid);
        const pc = (iceRestart && this.peers.get(pid)) || this.makePeer(pid);
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        Net.send('voice:signal', { to: pid, data: { sdp: pc.localDescription } });
      } catch (e) { console.warn('voice connectTo failed', e); }
      finally { this.makingOffer.delete(pid); }
    },
    async onSignal({ from, data }) {
      if (!this.active || !data || !from) return;
      try {
        if (data.sdp && data.sdp.type === 'offer') {
          let pc = this.peers.get(from);
          const collision = pc && (this.makingOffer.has(from) || pc.signalingState !== 'stable');
          const polite = String(Net.pid || '') < String(from);
          if (collision) {
            if (!polite) return; // impolite peer ignores colliding offer
            await pc.setLocalDescription({ type: 'rollback' }).catch(() => { pc = this.makePeer(from); });
          }
          if (!pc) pc = this.makePeer(from);
          await pc.setRemoteDescription(data.sdp);
          await this.flush(from, pc);
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          Net.send('voice:signal', { to: from, data: { sdp: pc.localDescription } });
        } else if (data.sdp && data.sdp.type === 'answer') {
          const pc = this.peers.get(from);
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(data.sdp);
            await this.flush(from, pc);
          }
        } else if (data.candidate) {
          const pc = this.peers.get(from);
          if (pc && pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(data.candidate).catch(() => {});
          else { const q = this.pending.get(from) || []; q.push(data.candidate); this.pending.set(from, q); }
        }
      } catch (e) { console.warn('voice signal failed', e); }
    },
    async flush(pid, pc) {
      const q = this.pending.get(pid) || []; this.pending.delete(pid);
      for (const c of q) await pc.addIceCandidate(c).catch(() => {});
    },
    drop(pid, keepAudio) {
      clearTimeout(this.retryTimers.get(pid));
      this.retryTimers.delete(pid);
      const pc = this.peers.get(pid);
      if (pc) { pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); this.peers.delete(pid); }
      if (!keepAudio) {
        const a = document.getElementById('audio-' + pid); if (a) { a.srcObject = null; a.remove(); }
        this.analysers.delete(pid); this.speaking.delete(pid);
      }
      this.changed();
    },
    leave() {
      if (!this.active && !this.loopback) return;
      this.active = false; this.loopback = false; this.level = 0;
      const lb = document.getElementById('audio-loopback'); if (lb) { lb.srcObject = null; lb.remove(); }
      [...this.peers.keys()].forEach(p => this.drop(p));
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null; this.analysers.clear(); this.speaking.clear();
      clearInterval(this.timer); this.timer = null;
      if (Net.socket && Net.code) Net.send('voice:leave');
      this.changed();
    },
    setMuted(m) {
      this.muted = m;
      if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = !m; });
      if (Net.socket && Net.code) Net.send('voice:mute', { muted: m });
      this.changed();
    },
    setDeaf(d) {
      this.deaf = d;
      document.querySelectorAll('#audio-sink audio').forEach(a => { if (a.id !== 'audio-loopback') a.muted = d; });
      this.changed();
    },
    /* speaking indicator + live mic level */
    watch(id, stream) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ctx = this.ctx || new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const an = this.ctx.createAnalyser(); an.fftSize = 256;
        this.ctx.createMediaStreamSource(stream).connect(an);
        this.analysers.set(id, an);
        if (!this.timer) this.timer = setInterval(() => this.tick(), 120);
      } catch (e) { /* not critical */ }
    },
    tick() {
      const next = new Set(); const buf = new Uint8Array(128);
      let myLevel = 0;
      this.analysers.forEach((an, id) => {
        if (id === 'me' && this.muted) return;
        an.getByteFrequencyData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i];
        const avg = s / buf.length;
        if (id === 'me') myLevel = Math.min(100, Math.round((avg / 64) * 100));
        if (avg > 12) next.add(id === 'me' ? (Net.pid || 'me') : id);
      });
      const a = [...next].sort().join(), b = [...this.speaking].sort().join();
      const levelChanged = Math.abs(myLevel - this.level) >= 4 || (myLevel === 0 && this.level !== 0);
      this.level = myLevel;
      this.speaking = next;
      if (a !== b || levelChanged) this.changed();
    },
    changed() { if (this.onChange) this.onChange(); }
  };

  function AppRoomHas(pid) {
    try { return !!(window.__hub && window.__hub.App && window.__hub.App.room && window.__hub.App.room.players.some(p => p.pid === pid && p.connected)); }
    catch (e) { return false; }
  }

  window.Net = Net; window.Voice = Voice;
  window.addEventListener('online', () => Net.fire('browser-online'));
  window.addEventListener('offline', () => Net.fire('browser-offline'));
})();

# 🎲 Game Hub

Ludo plus four more games, playable **offline** or **online with friends in a private room** (text chat + voice chat).

| Game | Offline | Online |
|---|---|---|
| Ludo (2–4 players, Truth-or-Dare on captures) | vs computer or pass-and-play | ✅ |
| Tic-Tac-Toe | vs computer or 2 players | ✅ |
| Connect Four | vs computer or 2 players | ✅ |
| Rock Paper Scissors (first to 3, secret picks) | vs computer or 2 players | ✅ |
| Truth or Dare (2–8 friends): 60 truths + 45 dares in 💕 Love, 💔 One-sided love, 😂 Funny and 🧠 Serious categories | pass-and-play | ✅ |

## Run it
```bash
npm install
npm start        # http://localhost:3000
```
Open the page on two devices (same Wi-Fi: `http://<your-pc-ip>:3000`), tap **Play with Friends Online → Create private room**, and send the 5-letter code (or the Share button) to your friends.

## Offline play
Everything under **Play Offline** runs entirely in the browser – no server, no internet. The app is also a PWA: after the first visit it is cached by a service worker, so it opens and plays with no connection, and you can "Add to Home Screen" / "Install app".

## Online rooms
- Private rooms only: nobody can find a room without its code.
- Text chat, quick reactions, and **voice chat that turns on automatically** when you join a room (WebRTC, peer-to-peer; tap the mic button to mute, or "Leave voice" in the chat panel). The browser asks for mic permission once. Mic needs HTTPS (or localhost).
- **Emoji reactions:** a bar at the bottom of every game and lobby. Tap an emoji and it floats up on everyone's screen with your name. (Offline, the computer players react to captures and wins.)
- If a player's connection drops, a bot plays for them and they can rejoin automatically.
- Voice uses free Google STUN servers. If friends on strict mobile/corporate networks can't hear each other, add a TURN server via env vars `TURN_URL`, `TURN_USER`, `TURN_PASS`.

## Deploying
The server needs WebSockets, so use a Node host (Render, Railway, Fly.io…): build `npm install`, start `npm start`. It serves the website and the multiplayer server together – nothing else to configure.

**Vercel (static hosting only):** Vercel can host the website (`public/`, see `vercel.json`) but not the WebSocket server. Deploy the server to Render/Railway, then set `window.GAMEHUB_SERVER = 'https://your-server.onrender.com'` in `public/config.js`, and set `ALLOWED_ORIGIN=https://your-site.vercel.app` on the server. Offline games work on Vercel with no server at all.

## Project layout
```
server/server.js      rooms, game actions, chat, voice signalling
public/js/logic.js    all game rules + bots (shared by server and browser)
public/js/net.js      socket.io client + WebRTC voice
public/js/app.js      UI
public/sw.js          offline cache
test/logic.test.js    npm test
```

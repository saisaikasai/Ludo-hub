// Plays full bot-vs-bot games of every kind and checks nothing gets stuck or makes an illegal move.
const G = require('../public/js/logic.js');
let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function play(game, n) {
  const s = G.create(game, n); let steps = 0;
  while (steps++ < 20000) {
    const acts = G.actors(s); if (!acts.length) break;
    let moved = false;
    for (const seat of acts) {
      const a = G.auto(s, seat, rng); if (!a) continue;
      const r = G.apply(s, a, seat, rng);
      if (r.error) throw new Error(game + ' illegal auto move ' + JSON.stringify(a) + ': ' + r.error);
      moved = true; break;
    }
    if (!moved) throw new Error(game + ' got stuck');
    if (game === 'tod' && s.round > 3) return;
  }
  if (!s.over) throw new Error(game + ' never finished');
}
for (const [g, n] of [['ludo', 2], ['ludo', 3], ['ludo', 4], ['ttt', 2], ['c4', 2], ['rps', 2], ['tod', 4]]) { play(g, n); console.log('ok', g, n); }
console.log('All logic tests passed');

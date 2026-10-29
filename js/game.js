'use strict';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SPEED = params.has('fast') ? 0 : 1;   // ?fast  -> nessuna animazione (test)
const AUTO = params.has('auto');            // ?auto  -> CPU contro CPU (test)
const TURN_LIMIT = 30;
const HAND_LIMIT = 10;
const BENCH_SIZE = 3;
const WIN_POINTS = 3;
const ABORT = Symbol('abort');

let game = null;
let UID = 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wait(ms) {
  const g = game;
  if (ms * SPEED > 0) await sleep(ms * SPEED); else await Promise.resolve();
  if (g !== game) throw ABORT;
}
const rnd = n => Math.floor(Math.random() * n);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ======================= HELPERS DI STATO =======================
const opponent = p => game.players[1 - p.idx];
const cur = () => game.players[game.current];
const allInPlay = p => [p.active, ...p.bench].filter(Boolean);
const benchList = p => p.bench.filter(Boolean);
const pname = poke => poke.card.def.name;
const isBasic = c => c.def.kind === 'pokemon' && c.def.stage === 0;
const freeBench = p => p.bench.indexOf(null);
const hpLeft = poke => poke.card.def.hp - poke.damage;
const randomEnergy = p => p.deckDef.energy[rnd(p.deckDef.energy.length)];
const STATUS = {
  asleep:    { name: 'Addormentato', icon: '💤' },
  paralyzed: { name: 'Paralizzato',  icon: '⚡' },
  poisoned:  { name: 'Avvelenato',   icon: '☠️' },
  burned:    { name: 'Bruciato',     icon: '♨️' },
};

function log(msg) {
  game.log.push({ t: game.turn, msg });
  if (game.log.length > 300) game.log.shift();
  if ($('#logp.show')) renderLog();
}
function fx(poke, text, kind) { game.fx.push({ uid: poke.uid, text, kind }); }

function newPlayer(idx, name, deckDef, isAI) {
  const deck = [];
  for (const [id, n] of deckDef.list) for (let i = 0; i < n; i++) deck.push({ uid: UID++, def: CARDS[id] });
  return {
    idx, name, isAI, deckDef, deck: shuffle(deck), hand: [], discard: [],
    active: null, bench: Array(BENCH_SIZE).fill(null), points: 0,
    energyCur: null, energyNext: randomEnergy({ deckDef }), energyAttached: false,
    supporterUsed: false, retreated: false, turnsTaken: 0, giovanni: 0, xspeed: 0,
  };
}

function makeInPlay(card) {
  return { uid: UID++, card, stack: [], damage: 0, energies: [], status: {}, playedTurn: game.turn, abilityTurn: -1, cantAttackTurn: -1 };
}

function drawCards(p, n) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) { log(`${p.name}: il mazzo è vuoto.`); break; }
    if (p.hand.length >= HAND_LIMIT) { log(`${p.name}: mano piena (max ${HAND_LIMIT}).`); break; }
    p.hand.push(p.deck.shift());
  }
}

function canPay(energies, cost) {
  const pool = [...energies];
  let colorless = 0;
  for (const c of cost) {
    if (c === 'colorless') { colorless++; continue; }
    const i = pool.indexOf(c);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= colorless;
}

function discardEnergy(poke, type, n) {
  for (let i = 0; i < n; i++) {
    const j = poke.energies.lastIndexOf(type);
    if (j < 0) break;
    poke.energies.splice(j, 1);
  }
}

function dealDamage(owner, poke, n) {
  if (n <= 0) return;
  poke.damage += n;
  fx(poke, `-${n}`, 'dmg');
  log(`${pname(poke)} subisce ${n} danni.`);
}

function heal(poke, n) {
  const h = Math.min(n, poke.damage);
  if (h <= 0) return;
  poke.damage -= h;
  fx(poke, `+${h}`, 'heal');
  log(`${pname(poke)} viene curato di ${h} danni.`);
}

function setStatus(poke, s) {
  if (s === 'asleep' || s === 'paralyzed') { delete poke.status.asleep; delete poke.status.paralyzed; }
  poke.status[s] = true;
  fx(poke, STATUS[s].name, 'status');
  log(`${pname(poke)} è ${STATUS[s].name.toLowerCase()}!`);
}

function switchActive(p, i) {
  const b = p.bench[i];
  p.bench[i] = p.active;
  p.active = b;
  if (p.bench[i]) p.bench[i].status = {};
  log(`${p.name}: ${pname(b)} diventa il Pokémon attivo.`);
}

// ======================= AZIONI =======================
function playBasic(p, card, slot) {
  p.hand.splice(p.hand.indexOf(card), 1);
  const poke = makeInPlay(card);
  if (slot === 'a') p.active = poke; else p.bench[slot] = poke;
  if (game.phase === 'play') log(`${p.name} gioca ${card.def.name}${slot === 'a' ? '' : ' in panchina'}.`);
  return poke;
}

function evoTargets(p, card) {
  if (game.phase !== 'play' || p.turnsTaken < 2 || card.def.kind !== 'pokemon' || !card.def.stage) return [];
  return allInPlay(p).filter(x => x.card.def.name === card.def.evolvesFrom && x.playedTurn < game.turn);
}

function evolve(p, card, target) {
  p.hand.splice(p.hand.indexOf(card), 1);
  const from = pname(target);
  target.stack.push(target.card);
  target.card = card;
  target.playedTurn = game.turn;
  target.status = {};
  fx(target, 'Evoluzione!', 'evo');
  log(`${p.name}: ${from} si evolve in ${card.def.name}!`);
}

function canPlayTrainer(p, card) {
  const d = card.def;
  return game.phase === 'play' && cur() === p && (d.kind === 'item' || (d.kind === 'supporter' && !p.supporterUsed)) && d.canPlay(p);
}

async function playTrainer(p, card) {
  p.hand.splice(p.hand.indexOf(card), 1);
  p.discard.push(card);
  if (card.def.kind === 'supporter') p.supporterUsed = true;
  log(`${p.name} gioca ${card.def.name}.`);
  await showPlayed(card.def, p);
  await card.def.play(p);
  render();
}

function attachEnergy(p, target) {
  const t = p.energyCur;
  target.energies.push(t);
  p.energyAttached = true;
  p.energyCur = null;
  fx(target, `+${TYPES[t].icon}`, 'heal');
  log(`${p.name} assegna Energia ${TYPES[t].name} a ${pname(target)}.`);
}

const retreatCost = p => Math.max(0, p.active.card.def.retreat - p.xspeed);
function canRetreat(p) {
  const a = p.active;
  return game.phase === 'play' && cur() === p && a && benchList(p).length > 0 && !p.retreated &&
    !a.status.asleep && !a.status.paralyzed && a.energies.length >= retreatCost(p);
}
function retreatBlock(p) {
  const a = p.active;
  if (p.retreated) return 'Hai già effettuato la ritirata';
  if (!benchList(p).length) return 'Nessun Pokémon in panchina';
  if (a.status.asleep || a.status.paralyzed) return `${STATUS[a.status.asleep ? 'asleep' : 'paralyzed'].name}`;
  if (a.energies.length < retreatCost(p)) return 'Energia insufficiente';
  return '';
}

async function retreat(p, target) {
  const a = p.active;
  const cost = retreatCost(p);
  // scarta prima le energie che non servono al proprio tipo
  for (let i = 0; i < cost; i++) {
    let j = a.energies.findIndex(e => e !== a.card.def.type);
    if (j < 0) j = a.energies.length - 1;
    a.energies.splice(j, 1);
  }
  p.retreated = true;
  log(`${p.name} ritira ${pname(a)}${cost ? ` scartando ${cost} Energia` : ''}.`);
  switchActive(p, p.bench.indexOf(target));
}

function canUseAbility(p, poke) {
  const ab = poke.card.def.ability;
  return !!ab && game.phase === 'play' && cur() === p && ab.canUse(p, poke);
}
async function useAbility(p, poke) {
  const ab = poke.card.def.ability;
  poke.abilityTurn = game.turn;
  log(`${pname(poke)} usa l'abilità ${ab.name}.`);
  await banner(`${pname(poke)}: ${ab.name}`, 'ability');
  await ab.use(p, poke);
  render();
}

function attackBlock(p, atk) {
  const a = p.active;
  if (game.phase !== 'play' || cur() !== p || !a) return 'Non è il tuo turno';
  if (a.status.asleep) return 'Addormentato';
  if (a.status.paralyzed) return 'Paralizzato';
  if (a.cantAttackTurn === game.turn) return 'Non può attaccare in questo turno';
  if (!canPay(a.energies, atk.cost)) return 'Energia insufficiente';
  return '';
}
const canAttack = (p, atk) => !attackBlock(p, atk);

async function attack(p, i) {
  const att = p.active, atk = att.card.def.attacks[i], o = opponent(p);
  log(`${pname(att)} usa ${atk.name}!`);
  await banner(`${pname(att)}: ${atk.name}`, 'attack');
  const ctx = { me: p, opp: o, att, def: o.active, damage: atk.damage || 0, noWeakness: false };
  if (atk.before) await atk.before(ctx);
  if (ctx.damage > 0 && o.active) {
    let d = ctx.damage + p.giovanni;
    if (!ctx.noWeakness && o.active.card.def.weakness === att.card.def.type) { d += 20; log('Debolezza! +20 danni.'); fx(o.active, 'Debolezza!', 'status'); }
    dealDamage(o, o.active, d);
  } else if (!atk.after) {
    log('L\'attacco non ha effetto.');
  }
  if (atk.after) await atk.after(ctx);
  render();
  await wait(900);
  if (await checkKOs()) return;
  await endTurn();
}

function ko(p, poke) {
  const o = opponent(p);
  const pts = poke.card.def.ex ? 2 : 1;
  o.points += pts;
  p.discard.push(poke.card, ...poke.stack);
  if (p.active === poke) p.active = null; else p.bench[p.bench.indexOf(poke)] = null;
  log(`${pname(poke)} è esausto! ${o.name} ottiene ${pts} punt${pts > 1 ? 'i' : 'o'}.`);
  return `${pname(poke)} è esausto! +${pts}`;
}

async function checkKOs() {
  const msgs = [];
  for (const p of game.players)
    for (const poke of allInPlay(p))
      if (poke.damage >= poke.card.def.hp) msgs.push(ko(p, poke));
  if (msgs.length) { render(); await banner(msgs.join(' · '), 'ko'); }
  const won = game.players.map(p => p.points >= WIN_POINTS || allInPlay(opponent(p)).length === 0);
  if (won[0] || won[1]) { endGame(won[0] && won[1] ? null : (won[0] ? 0 : 1)); return true; }
  for (const p of game.players) {
    if (p.active) continue;
    const t = await choose(p, benchList(p), 'Scegli il tuo nuovo Pokémon attivo', { ai: aiPromote });
    p.bench[p.bench.indexOf(t)] = null;
    p.active = t;
    log(`${p.name} manda in campo ${pname(t)}.`);
    render();
    await wait(400);
  }
  return false;
}

async function checkup() {
  let did = false;
  for (const p of game.players) {
    const a = p.active;
    if (!a) continue;
    const s = a.status;
    if (s.poisoned) { did = true; log(`${pname(a)} soffre per il veleno.`); dealDamage(p, a, 10); }
    if (s.burned) {
      did = true; log(`${pname(a)} soffre per la bruciatura.`); dealDamage(p, a, 20);
      render();
      if (await flip(`Bruciatura · ${pname(a)}`)) { delete s.burned; log(`${pname(a)} non è più bruciato.`); }
    }
    if (s.asleep) {
      did = true;
      if (await flip(`Sonno · ${pname(a)}`)) { delete s.asleep; log(`${pname(a)} si è svegliato.`); }
    }
  }
  if (did) { render(); await wait(700); }
}

async function startTurn() {
  if (game.over) return;
  const p = cur();
  game.turn++;
  p.turnsTaken++;
  Object.assign(p, { energyAttached: false, supporterUsed: false, retreated: false, giovanni: 0, xspeed: 0 });
  if (game.turn === 1) {
    p.energyCur = null;
    log(`${p.name} gioca per primo: nessuna Energia nel primo turno.`);
  } else {
    p.energyCur = p.energyNext;
    p.energyNext = randomEnergy(p);
  }
  drawCards(p, 1);
  render();
  await banner(p.isAI ? 'Turno dell\'avversario' : 'Il tuo turno', p.isAI ? 'opp' : 'me');
  if (p.isAI) await aiTurn(p);
}

async function endTurn() {
  if (game.over) return;
  const p = cur();
  game.pick = null;
  log(`— Fine del turno ${game.turn} (${p.name}) —`);
  if (p.active) delete p.active.status.paralyzed;
  await checkup();
  if (await checkKOs()) return;
  if (game.turn >= TURN_LIMIT) {
    const [a, b] = game.players.map(x => x.points);
    log(`Limite di ${TURN_LIMIT} turni raggiunto.`);
    endGame(a === b ? null : (a > b ? 0 : 1), true);
    return;
  }
  game.current = 1 - game.current;
  await startTurn();
}

function endGame(winner, timeout) {
  game.over = true;
  game.phase = 'over';
  game.pick = null;
  render();
  const me = game.players[0];
  const title = winner === null ? 'Pareggio' : winner === 0 ? 'Vittoria!' : 'Sconfitta';
  const cls = winner === null ? 'draw' : winner === 0 ? 'win' : 'lose';
  openModal(`
    <div class="result ${cls}">
      <div class="r-title">${title}</div>
      <div class="r-score">${me.points} – ${game.players[1].points}</div>
      <p>${timeout ? `Limite di ${TURN_LIMIT} turni raggiunto.` : winner === null ? 'Entrambi i giocatori hanno raggiunto la vittoria.' : winner === 0 ? 'Hai ottenuto i punti necessari. Ottimo lavoro, Allenatore!' : 'L\'avversario ha avuto la meglio. Ritenta!'}</p>
      <div class="m-actions">
        <button class="btn primary" data-act="again">Rivincita</button>
        <button class="btn" data-act="menu">Cambia mazzo</button>
      </div>
    </div>`, {
    again: () => newMatch(game.players[0].deckDef.id),
    menu: () => renderMenu(),
  }, false);
}

// ======================= SCELTE / MONETE =======================
function choose(p, cands, prompt, { ai, cancellable } = {}) {
  if (!cands.length) return Promise.resolve(null);
  if (p.isAI) return Promise.resolve((ai || (c => c[0]))(cands.slice()));
  return new Promise(resolve => { game.pick = { cands, prompt, cancellable, resolve }; render(); });
}
function resolvePick(v) {
  const pk = game.pick;
  if (!pk) return;
  game.pick = null;
  render();
  pk.resolve(v);
}

async function flipMany(n, label) {
  const res = Array.from({ length: n }, () => Math.random() < 0.5);
  const heads = res.filter(Boolean).length;
  log(`${label}: ${n} monete → ${heads} test${heads === 1 ? 'a' : 'e'}.`);
  if (SPEED) {
    const el = $('#coin');
    el.innerHTML = `<div class="coin-label">${label}</div>
      <div class="coins">${res.map((h, i) => `<div class="coin ${h ? 'heads' : 'tails'}" style="animation-delay:${i * 0.12}s"><div class="face front"></div><div class="face back"></div></div>`).join('')}</div>
      <div class="coin-res">${heads} TEST${heads === 1 ? 'A' : 'E'}</div>`;
    el.classList.add('show');
    await wait(1700);
    el.classList.remove('show');
  }
  return heads;
}
async function flip(label) {
  const heads = Math.random() < 0.5;
  log(`${label}: ${heads ? 'testa' : 'croce'}.`);
  if (SPEED) {
    const el = $('#coin');
    el.innerHTML = `<div class="coin-label">${label}</div>
      <div class="coins"><div class="coin ${heads ? 'heads' : 'tails'}"><div class="face front"></div><div class="face back"></div></div></div>
      <div class="coin-res">${heads ? 'TESTA' : 'CROCE'}</div>`;
    el.classList.add('show');
    await wait(1400);
    el.classList.remove('show');
  }
  return heads;
}

// ======================= IA =======================
function estDamage(p, poke, atk, oppActive) {
  let d = atk.est ? atk.est(p, poke) : (atk.damage || 0);
  if (d > 0 && oppActive) {
    d += p.giovanni;
    if (oppActive.card.def.weakness === poke.card.def.type) d += 20;
  }
  return d;
}
function bestAttackFor(p, poke, extraEnergy) {
  const en = extraEnergy ? [...poke.energies, extraEnergy] : poke.energies;
  const o = opponent(p);
  let best = null;
  poke.card.def.attacks.forEach((atk, i) => {
    if (!canPay(en, atk.cost)) return;
    const d = estDamage(p, poke, atk, o.active);
    if (!best || d >= best.d) best = { i, d };
  });
  return best;
}
function aiPokeScore(x) {
  const p = game.players.find(pl => allInPlay(pl).includes(x));
  const b = p ? bestAttackFor(p, x) : null;
  return hpLeft(x) + x.energies.length * 30 + (b ? b.d : 0);
}
const aiPromote = c => c.slice().sort((a, b) => aiPokeScore(b) - aiPokeScore(a))[0];
function aiBestTarget(dmg) {
  return c => {
    const kos = c.filter(x => hpLeft(x) <= dmg).sort((a, b) => (b.card.def.ex ? 2 : 1) - (a.card.def.ex ? 2 : 1));
    return kos[0] || c.slice().sort((a, b) => hpLeft(a) - hpLeft(b))[0];
  };
}
function hasEvolutionAvailable(p, x) {
  return [...p.hand, ...p.deck].some(c => c.def.evolvesFrom === x.card.def.name);
}
function aiEnergyTarget(p) {
  const type = p.energyCur;
  let best = null, bs = -Infinity;
  for (const x of allInPlay(p)) {
    const d = x.card.def;
    const evo = hasEvolutionAvailable(p, x);
    const maxCost = Math.max(...d.attacks.map(a => a.cost.length), evo ? 3 : 0);
    const need = maxCost - x.energies.length;
    let s = need > 0 ? 20 : -30;
    if (x === p.active) {
      s += 8;
      const now = bestAttackFor(p, x), next = bestAttackFor(p, x, type);
      if (next && (!now || next.d > now.d)) s += 15;
    }
    if (d.type === type) s += 6;
    if (d.ex) s += 5;
    if (evo) s += 4;
    s -= x.damage / 20;
    if (s > bs) { bs = s; best = x; }
  }
  return best;
}
function aiRetreatTarget(p) {
  const a = p.active;
  if (!a || !benchList(p).length || p.retreated || a.status.asleep || a.status.paralyzed) return null;
  const hasX = p.hand.some(c => c.def.id === 'xspeed') && p.xspeed === 0;
  const cost = Math.max(0, a.card.def.retreat - p.xspeed - (hasX ? 1 : 0));
  if (a.energies.length < cost) return null;
  const extra = !p.energyAttached && p.energyCur;
  const curBest = Math.max(bestAttackFor(p, a)?.d ?? -1, bestAttackFor(p, a, extra)?.d ?? -1);
  let best = null, bd = curBest + 20 + cost * 15;
  for (const b of benchList(p)) {
    const d = Math.max(bestAttackFor(p, b)?.d ?? -1, extra ? (bestAttackFor(p, b, extra)?.d ?? -1) : -1);
    if (d > bd) { bd = d; best = b; }
  }
  // ritira un Pokémon ex quasi esausto se c'è un sostituto
  if (!best && a.card.def.ex && hpLeft(a) <= 30) best = aiPromote(benchList(p));
  return best;
}
function aiWantsTrainer(p, c) {
  const o = opponent(p);
  switch (c.def.id) {
    case 'pokeball': return freeBench(p) >= 0 && p.deck.some(isBasic);
    case 'potion': return allInPlay(p).some(x => x.damage >= 20);
    case 'research': return p.hand.length <= HAND_LIMIT - 3;
    case 'misty': return allInPlay(p).some(x => x.card.def.type === 'water');
    case 'erika': return allInPlay(p).some(x => x.card.def.type === 'grass' && x.damage >= 30);
    default: return false;
  }
}
async function aiPause() { render(); await wait(650); }

async function aiTurn(p) {
  const o = opponent(p);
  await wait(500);
  for (let pass = 0; pass < 3; pass++) {
    let did = false;
    for (const c of p.hand.filter(isBasic)) {
      const s = freeBench(p);
      if (s < 0) break;
      playBasic(p, c, s); did = true; await aiPause();
    }
    for (const c of p.hand.filter(c => c.def.kind === 'pokemon' && c.def.stage > 0)) {
      const t = evoTargets(p, c);
      if (!t.length) continue;
      const target = t.includes(p.active) ? p.active : t.sort((a, b) => b.energies.length - a.energies.length)[0];
      evolve(p, c, target); did = true; await aiPause();
    }
    for (const c of p.hand.filter(c => c.def.kind !== 'pokemon')) {
      if (p.hand.includes(c) && canPlayTrainer(p, c) && aiWantsTrainer(p, c)) { await playTrainer(p, c); did = true; await aiPause(); }
    }
    if (!did) break;
  }
  for (const x of allInPlay(p)) if (canUseAbility(p, x)) { await useAbility(p, x); await aiPause(); }

  const rt = aiRetreatTarget(p);
  if (rt) {
    const xs = p.hand.find(c => c.def.id === 'xspeed');
    if (xs && retreatCost(p) > 0 && canPlayTrainer(p, xs)) { await playTrainer(p, xs); }
    if (canRetreat(p)) { await retreat(p, rt); await aiPause(); }
  }
  if (p.energyCur && !p.energyAttached) {
    const t = aiEnergyTarget(p);
    if (t) { attachEnergy(p, t); await aiPause(); }
  }
  for (const x of allInPlay(p)) if (canUseAbility(p, x)) { await useAbility(p, x); await aiPause(); }

  let best = bestAttackFor(p, p.active);
  if (best && !canAttack(p, p.active.card.def.attacks[best.i])) best = null;
  // Supporter tattici
  if (!p.supporterUsed && o.active && best) {
    const gio = p.hand.find(c => c.def.id === 'giovanni');
    const left = hpLeft(o.active);
    if (gio && best.d > 0 && best.d < left && best.d + 10 >= left) { await playTrainer(p, gio); await aiPause(); }
  }
  if (!p.supporterUsed && o.active && benchList(o).length) {
    const sab = p.hand.find(c => c.def.id === 'sabrina');
    const threat = o.active.energies.length >= 2 && (!best || best.d < hpLeft(o.active));
    if (sab && threat && Math.random() < 0.6) { await playTrainer(p, sab); await aiPause(); }
  }
  if (game.over) return;
  if (p.active) {
    // ricalcola dopo eventuali cambi
    const atks = p.active.card.def.attacks
      .map((atk, i) => ({ i, d: estDamage(p, p.active, atk, o.active), ok: canAttack(p, atk) }))
      .filter(x => x.ok);
    if (atks.length) {
      atks.sort((a, b) => b.d - a.d || b.i - a.i);
      await attack(p, atks[0].i);
      return;
    }
  }
  await endTurn();
}

function aiSetup(p) {
  const basics = p.hand.filter(isBasic).sort((a, b) => (a.def.ex ? 1 : 0) - (b.def.ex ? 1 : 0) || b.def.hp - a.def.hp);
  playBasic(p, basics[0], 'a');
  basics.slice(1, 1 + BENCH_SIZE).forEach((c, i) => playBasic(p, c, i));
}

// ======================= PARTITA =======================
function dealOpening(p) {
  do { shuffle(p.deck); } while (!p.deck.slice(0, 5).some(isBasic));
  p.hand = p.deck.splice(0, 5);
}

async function run(fn) {
  try { await fn(); }
  catch (e) { if (e !== ABORT) { console.error(e); } }
}

async function act(fn) {
  if (!game || game.busy || game.over) return;
  game.busy = true;
  render();
  try { await fn(); }
  catch (e) { if (e !== ABORT) console.error(e); }
  finally { if (game) { game.busy = false; render(); } }
}

function newMatch(deckId) {
  const mine = DECKS.find(d => d.id === deckId);
  const others = DECKS.filter(d => d.id !== deckId);
  const theirs = others[rnd(others.length)];
  closeModal();
  game = {
    players: [newPlayer(0, AUTO ? 'CPU 1' : 'Tu', mine, AUTO), newPlayer(1, 'CPU', theirs, true)],
    turn: 0, current: 0, phase: 'setup', log: [], fx: [], pick: null, busy: true, over: false,
  };
  const g = game;
  run(async () => {
    game.players.forEach(dealOpening);
    log(`Partita iniziata: ${mine.name} contro ${theirs.name}.`);
    aiSetup(game.players[1]);
    if (AUTO) aiSetup(game.players[0]);
    $('#app').className = 'in-game';
    game.busy = false;
    render();
    if (!AUTO) await new Promise(res => { game.ready = res; });
    game.busy = true;
    const heads = await flip('Testa: inizi tu · Croce: inizia l\'avversario');
    if (g !== game) return;
    game.current = heads ? 0 : 1;
    game.phase = 'play';
    log(`${game.players[game.current].name} inizia la partita.`);
    await startTurn();
    if (game === g) { game.busy = false; render(); }
  });
}

// ======================= RENDERING =======================
function orb(t, cls = '') {
  const T = TYPES[t];
  return `<span class="orb ${cls}" style="--c:${T.color};--d:${T.dark}" title="${T.name}">${T.icon}</span>`;
}
function nameHTML(def) {
  return def.ex ? `${def.name.replace(/ ex$/, '')}<i class="exl">ex</i>` : def.name;
}
function dmgLabel(a) { return a.label || (a.damage ? a.damage : ''); }

function cardHTML(def, mode = 'mini') {
  if (def.kind === 'pokemon') {
    const T = TYPES[def.type];
    const stage = ['Base', 'Fase 1', 'Fase 2'][def.stage];
    const body = mode !== 'full' ? '' : `
      <div class="c-body">
        ${def.stage ? `<div class="evo-from">Si evolve da ${def.evolvesFrom}</div>` : ''}
        ${def.ability ? `<div class="ab"><span class="ab-tag">Abilità</span><b>${def.ability.name}</b><p>${def.ability.text}</p></div>` : ''}
        ${def.attacks.map(a => `
          <div class="atk"><div class="atk-row"><span class="cost">${a.cost.map(c => orb(c)).join('')}</span><span class="an">${a.name}</span><span class="ad">${dmgLabel(a)}</span></div>
          ${a.text ? `<p>${a.text}</p>` : ''}</div>`).join('')}
      </div>
      <div class="c-foot"><span>Debolezza ${orb(def.weakness, 'xs')}+20</span><span>Ritirata ${def.retreat ? Array(def.retreat).fill(orb('colorless', 'xs')).join('') : '—'}</span></div>
      ${def.ex ? '<div class="exrule"><b>Regola dei Pokémon ex:</b> quando un tuo Pokémon ex viene messo KO, l\'avversario ottiene 2 punti.</div>' : ''}`;
    return `<div class="card pk ${def.ex ? 'ex' : ''} ${mode}" style="--c:${T.color};--d:${T.dark}">
      <div class="c-head"><span class="c-stage">${stage}</span><span class="c-name">${nameHTML(def)}</span><span class="c-hp"><small>PS</small>${def.hp}</span>${orb(def.type, 'xs')}</div>
      <div class="c-art"><span class="emoji s${def.stage}">${def.art}</span></div>
      ${body}
    </div>`;
  }
  const kindName = def.kind === 'item' ? 'Strumento' : 'Aiuto';
  return `<div class="card tr ${def.kind} ${mode}">
    <div class="c-head"><span class="c-stage">${kindName}</span><span class="c-name">${def.name}</span></div>
    <div class="c-art">${def.art === 'pokeball' ? '<span class="pball"></span>' : `<span class="emoji">${def.art}</span>`}</div>
    ${mode === 'full' ? `<div class="c-body"><p>${def.text}</p>${def.kind === 'supporter' ? '<p class="rule">Puoi giocare una sola carta Aiuto durante il tuo turno.</p>' : '<p class="rule">Puoi giocare un numero qualsiasi di carte Strumento durante il tuo turno.</p>'}</div>` : ''}
    <div class="tr-band">Allenatore</div>
  </div>`;
}

function slotHTML(p, poke, slot) {
  const key = `${p.idx}-${slot}`;
  const pk = game.pick;
  if (!poke) {
    return `<div class="slot empty" data-key="${key}">${slot === 'a' ? '<span>Attivo</span>' : ''}</div>`;
  }
  const pct = Math.max(0, hpLeft(poke) / poke.card.def.hp * 100);
  const sel = pk ? (pk.cands.includes(poke) ? 'pickable' : 'dim') : '';
  const statuses = Object.keys(poke.status).filter(s => poke.status[s]).map(s => `<span class="st st-${s}" title="${STATUS[s].name}">${STATUS[s].icon}</span>`).join('');
  return `<div class="slot ${sel} ${poke.damage ? 'damaged' : ''}" data-key="${key}" data-uid="${poke.uid}">
    ${cardHTML(poke.card.def, 'mini')}
    <div class="hpbar"><i class="${pct <= 25 ? 'low' : pct <= 50 ? 'mid' : ''}" style="width:${pct}%"></i><span>${Math.max(0, hpLeft(poke))}</span></div>
    <div class="energies">${poke.energies.map(e => orb(e, 'xs')).join('')}</div>
    ${statuses ? `<div class="statuses">${statuses}</div>` : ''}
  </div>`;
}

function pointsHTML(p) {
  return `<span class="points" title="Punti">${Array.from({ length: WIN_POINTS }, (_, i) => `<i class="${i < p.points ? 'on' : ''}"></i>`).join('')}</span>`;
}

function ezoneHTML(p, clickable) {
  const used = p.energyAttached;
  return `<div class="ezone ${clickable ? 'clickable' : ''} ${p.idx === 0 && game.pick && game.pick.energy ? 'armed' : ''}" data-ezone="${p.idx}" title="Zona Energia">
    <div class="e-cur">${p.energyCur ? orb(p.energyCur, 'big') : `<span class="orb big empty">${used ? '✓' : ''}</span>`}</div>
    <div class="e-next"><small>Prossima</small>${p.energyNext ? orb(p.energyNext, 'sm') : ''}</div>
  </div>`;
}

function playerBar(p, isMe) {
  const myTurn = game.phase === 'play' && cur() === p;
  const canEnergy = isMe && myTurn && !p.isAI && p.energyCur && !p.energyAttached && !game.busy;
  return `<div class="pbar ${isMe ? 'me' : 'opp'} ${myTurn ? 'turn' : ''}">
    <div class="who"><span class="avatar">${isMe ? '🧢' : '🤖'}</span><div><b>${p.name}</b>${pointsHTML(p)}</div></div>
    <div class="piles">
      <span class="pile" title="Mazzo"><i class="mini-back"></i>${p.deck.length}</span>
      ${isMe ? '' : `<span class="pile" title="Carte in mano">✋${p.hand.length}</span>`}
      <span class="pile" title="Pila degli scarti">🗑️${p.discard.length}</span>
    </div>
    ${ezoneHTML(p, canEnergy)}
    ${isMe ? `<button class="btn end ${myTurn && !p.isAI ? '' : 'hidden'}" data-act="end" ${game.busy ? 'disabled' : ''}>Fine<br>turno</button>` : ''}
  </div>`;
}

function handPlayable(p, c) {
  if (p.isAI) return false;
  if (game.phase === 'setup') return isBasic(c) && (!p.active || freeBench(p) >= 0);
  if (game.phase !== 'play' || cur() !== p || game.busy) return false;
  if (isBasic(c)) return freeBench(p) >= 0;
  if (c.def.kind === 'pokemon') return evoTargets(p, c).length > 0;
  return canPlayTrainer(p, c);
}

function midHTML() {
  const me = game.players[0];
  if (game.pick) {
    return `<div class="prompt pick">${game.pick.prompt}${game.pick.cancellable ? ' <button class="btn sm" data-act="cancel">Annulla</button>' : ''}</div>`;
  }
  if (game.phase === 'setup') {
    if (AUTO) return '<div class="prompt">Preparazione…</div>';
    return `<div class="prompt">${me.active ? 'Aggiungi Pokémon Base in panchina (facoltativo), poi premi Pronto.' : 'Tocca un Pokémon Base nella tua mano per sceglierlo come attivo.'}
      <button class="btn primary sm" data-act="ready" ${me.active ? '' : 'disabled'}>Pronto</button></div>`;
  }
  const p = cur();
  return `<div class="prompt info"><span class="turnno">Turno ${game.turn}/${TURN_LIMIT}</span>
    <span class="whose ${p.idx === 0 ? 'me' : 'opp'}">${p.idx === 0 && !AUTO ? 'Il tuo turno' : `Turno di ${p.name}`}</span>
    <button class="btn sm ghost" data-act="log">📜 Registro</button></div>`;
}

function render() {
  if (!game) return;
  const me = game.players[0], o = game.players[1];
  const app = $('#app');
  app.innerHTML = `
    <div class="board phase-${game.phase} ${game.pick ? 'picking' : ''}">
      <button class="menu-btn" data-act="quit" title="Menu">☰</button>
      <div class="opp-hand">${o.hand.map(() => '<i class="back"></i>').join('')}</div>
      ${playerBar(o, false)}
      <div class="mat">
        <div class="row bench opp">${o.bench.map((b, i) => slotHTML(o, b, i)).join('')}</div>
        <div class="row active opp">${slotHTML(o, o.active, 'a')}</div>
        <div class="mid">${midHTML()}</div>
        <div class="row active me">${slotHTML(me, me.active, 'a')}</div>
        <div class="row bench me">${me.bench.map((b, i) => slotHTML(me, b, i)).join('')}</div>
      </div>
      ${playerBar(me, true)}
      <div class="hand" style="--n:${me.hand.length}">${me.hand.map((c, i) => `<div class="hcard ${handPlayable(me, c) ? 'playable' : ''}" data-hand="${i}" style="--i:${i}">${cardHTML(c.def, 'mini')}</div>`).join('')}</div>
    </div>`;
  applyFx();
}

function applyFx() {
  for (const f of game.fx) {
    const el = document.querySelector(`.slot[data-uid="${f.uid}"]`);
    if (!el) continue;
    const d = document.createElement('div');
    d.className = `float ${f.kind}`;
    d.textContent = f.text;
    el.appendChild(d);
    if (f.kind === 'dmg') el.classList.add('hit');
    if (f.kind === 'evo') el.classList.add('evolving');
  }
  game.fx = [];
}

async function banner(text, kind = '') {
  if (!SPEED) return;
  const el = $('#banner');
  el.className = `show ${kind}`;
  el.innerHTML = `<span>${text}</span>`;
  await wait(kind === 'me' || kind === 'opp' ? 1000 : 1100);
  el.className = '';
}

async function showPlayed(def, p) {
  if (!SPEED) return;
  const el = $('#flash');
  el.innerHTML = `<div class="flash-who">${p.name} gioca</div>${cardHTML(def, 'full')}`;
  el.className = 'show';
  await wait(p.isAI ? 1500 : 900);
  el.className = '';
}

function renderLog() {
  const el = $('#logp');
  el.innerHTML = `<div class="log-head"><b>Registro partita</b><button class="btn sm" data-act="closelog">✕</button></div>
    <div class="log-list">${game.log.slice().reverse().map(l => `<div><span>T${l.t}</span>${l.msg}</div>`).join('')}</div>`;
}

// ======================= MODALI =======================
let modalActions = {};
function openModal(html, actions = {}, closable = true) {
  modalActions = actions;
  const m = $('#modal');
  m.innerHTML = `<div class="m-box">${closable ? '<button class="m-close" data-mact="__close">✕</button>' : ''}${html}</div>`;
  m.className = 'show';
  m.dataset.closable = closable ? '1' : '';
}
function closeModal() { $('#modal').className = ''; $('#modal').innerHTML = ''; modalActions = {}; }

function showCardDetail(def, buttons = [], extra = '') {
  const actions = {};
  const btns = buttons.map((b, i) => {
    actions['b' + i] = b.fn;
    return `<button class="btn ${b.primary ? 'primary' : ''} ${b.cls || ''}" data-mact="b${i}" ${b.disabled ? 'disabled' : ''}>${b.html}${b.note ? `<small>${b.note}</small>` : ''}</button>`;
  }).join('');
  openModal(`<div class="detail">${cardHTML(def, 'full')}${extra}<div class="m-actions col">${btns}</div></div>`, actions);
}

function pokeExtra(poke) {
  const st = Object.keys(poke.status).filter(s => poke.status[s]).map(s => `${STATUS[s].icon} ${STATUS[s].name}`).join(' · ');
  return `<div class="poke-state">
    <span>PS <b>${hpLeft(poke)}</b>/${poke.card.def.hp}</span>
    <span>Energie: ${poke.energies.length ? poke.energies.map(e => orb(e, 'xs')).join('') : 'nessuna'}</span>
    ${st ? `<span>${st}</span>` : ''}
  </div>`;
}

function onSlotClick(key) {
  const [pi, s] = key.split('-');
  const p = game.players[+pi];
  const poke = s === 'a' ? p.active : p.bench[+s];
  if (game.pick) {
    if (poke && game.pick.cands.includes(poke)) resolvePick(poke);
    return;
  }
  if (!poke) return;
  const me = game.players[0];
  // In preparazione: tocca per riportare in mano
  if (game.phase === 'setup' && p === me && !AUTO) {
    if (s === 'a') me.active = null; else me.bench[+s] = null;
    me.hand.push(poke.card);
    render();
    return;
  }
  const mine = p === me && !me.isAI;
  const myTurn = mine && game.phase === 'play' && cur() === me && !game.busy;
  const buttons = [];
  if (myTurn && s === 'a') {
    poke.card.def.attacks.forEach((atk, i) => {
      const block = attackBlock(me, atk);
      buttons.push({
        html: `<span class="cost">${atk.cost.map(c => orb(c, 'xs')).join('')}</span> ${atk.name} <b>${dmgLabel(atk)}</b>`,
        primary: !block, disabled: !!block, note: block, cls: 'atk-btn',
        fn: () => act(() => attack(me, i)),
      });
    });
    const rb = retreatBlock(me);
    buttons.push({
      html: `Ritirata ${retreatCost(me) ? Array(retreatCost(me)).fill(orb('colorless', 'xs')).join('') : '(gratis)'}`,
      disabled: !!rb, note: rb,
      fn: () => act(async () => {
        const t = await choose(me, benchList(me), 'Scegli il Pokémon in panchina che diventerà attivo', { cancellable: true });
        if (t) await retreat(me, t);
      }),
    });
  }
  if (myTurn && poke.card.def.ability) {
    const ok = canUseAbility(me, poke);
    buttons.push({ html: `Abilità: ${poke.card.def.ability.name}`, disabled: !ok, note: ok ? '' : 'Non utilizzabile ora', fn: () => act(() => useAbility(me, poke)) });
  }
  if (myTurn && me.energyCur && !me.energyAttached) {
    buttons.push({ html: `Assegna ${orb(me.energyCur, 'xs')} Energia`, fn: () => act(async () => attachEnergy(me, poke)) });
  }
  buttons.push({ html: 'Chiudi', fn: () => {} });
  showCardDetail(poke.card.def, buttons, pokeExtra(poke));
}

function onHandClick(i) {
  const me = game.players[0];
  const c = me.hand[i];
  if (!c || game.pick) return;
  if (game.phase === 'setup') {
    if (!isBasic(c)) { showCardDetail(c.def, [{ html: 'Chiudi', fn: () => {} }], '<div class="poke-state">In preparazione puoi giocare solo Pokémon Base.</div>'); return; }
    if (!me.active) playBasic(me, c, 'a');
    else if (freeBench(me) >= 0) playBasic(me, c, freeBench(me));
    render();
    return;
  }
  const myTurn = game.phase === 'play' && cur() === me && !game.busy;
  const buttons = [];
  if (myTurn) {
    const d = c.def;
    if (isBasic(c)) {
      const s = freeBench(me);
      buttons.push({ html: 'Metti in panchina', primary: true, disabled: s < 0, note: s < 0 ? 'Panchina piena' : '', fn: () => { playBasic(me, c, freeBench(me)); render(); } });
    } else if (d.kind === 'pokemon') {
      const t = evoTargets(me, c);
      const note = me.turnsTaken < 2 ? 'Non puoi evolvere nel tuo primo turno' : t.length ? '' : `Serve un ${d.evolvesFrom} in gioco da almeno un turno`;
      buttons.push({
        html: `Evolvi ${d.evolvesFrom}`, primary: true, disabled: !t.length, note,
        fn: () => act(async () => {
          const target = t.length === 1 ? t[0] : await choose(me, t, `Scegli quale ${d.evolvesFrom} evolvere`, { cancellable: true });
          if (target) evolve(me, c, target);
        }),
      });
    } else {
      const ok = canPlayTrainer(me, c);
      const note = ok ? '' : (d.kind === 'supporter' && me.supporterUsed ? 'Hai già giocato una carta Aiuto' : 'Non puoi giocarla ora');
      buttons.push({ html: 'Gioca', primary: true, disabled: !ok, note, fn: () => act(() => playTrainer(me, c)) });
    }
  }
  buttons.push({ html: 'Chiudi', fn: () => {} });
  showCardDetail(c.def, buttons);
}

function onEnergyClick() {
  const me = game.players[0];
  if (game.pick && game.pick.energy) { resolvePick(null); return; }
  if (game.phase !== 'play' || cur() !== me || me.isAI || game.busy || !me.energyCur || me.energyAttached) return;
  act(async () => {
    const p = choose(me, allInPlay(me), `Tocca un Pokémon per assegnare l'Energia ${TYPES[me.energyCur].name}`, { cancellable: true });
    game.pick.energy = true; render();
    const t = await p;
    if (t) attachEnergy(me, t);
  });
}

document.addEventListener('click', e => {
  const m = e.target.closest('[data-mact]');
  if (m) {
    const fn = modalActions[m.dataset.mact];
    closeModal();
    if (fn) fn();
    return;
  }
  if (e.target.id === 'modal' && $('#modal').dataset.closable) { closeModal(); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    const k = a.dataset.act;
    if (k === 'deck') return newMatch(a.dataset.deck);
    if (k === 'rules') return showRules();
    if (!game) return;
    if (k === 'ready' && game.ready && game.players[0].active) { const r = game.ready; game.ready = null; r(); return; }
    if (k === 'end') return act(endTurn);
    if (k === 'cancel') return resolvePick(null);
    if (k === 'log') { renderLog(); $('#logp').className = 'show'; return; }
    if (k === 'closelog') { $('#logp').className = ''; return; }
    if (k === 'quit') {
      return openModal(`<div class="result"><div class="r-title sm">Abbandonare la partita?</div>
        <div class="m-actions"><button class="btn primary" data-mact="y">Torna al menu</button><button class="btn" data-mact="n">Continua</button></div></div>`,
        { y: () => renderMenu(), n: () => {} });
    }
    return;
  }
  if (!game || $('#app').className !== 'in-game') return;
  const ez = e.target.closest('[data-ezone]');
  if (ez && ez.dataset.ezone === '0') return onEnergyClick();
  const s = e.target.closest('.slot');
  if (s) return onSlotClick(s.dataset.key);
  const h = e.target.closest('[data-hand]');
  if (h) return onHandClick(+h.dataset.hand);
});

// ======================= MENU =======================
function renderMenu() {
  closeModal();
  $('#logp').className = '';
  game = null;
  const app = $('#app');
  app.className = 'in-menu';
  app.innerHTML = `
    <div class="menu">
      <div class="logo"><span class="l1">Pokémon</span><span class="l2">TCG Pocket</span><span class="l3">Battaglia</span></div>
      <p class="sub">Scegli il tuo mazzo da 20 carte. L'avversario userà un mazzo casuale.</p>
      <div class="decks">
        ${DECKS.map(d => `
          <button class="deck" data-act="deck" data-deck="${d.id}" style="--c:${TYPES[d.type].color};--d:${TYPES[d.type].dark}">
            <div class="deck-card">${cardHTML(CARDS[d.hero], 'mini')}</div>
            <div class="deck-info"><b>${d.name}</b><span>${orb(d.type, 'xs')} Energia ${TYPES[d.type].name}</span><small>${d.desc}</small></div>
          </button>`).join('')}
      </div>
      <button class="btn ghost" data-act="rules">📖 Regolamento</button>
    </div>`;
}

function showRules() {
  openModal(`<div class="rules">
    <h2>Regolamento</h2>
    <ul>
      <li><b>Obiettivo:</b> il primo che ottiene <b>3 punti</b> vince. Mettere KO un Pokémon vale 1 punto, un <b>Pokémon ex</b> vale <b>2 punti</b>. Vinci anche se l'avversario resta senza Pokémon in gioco.</li>
      <li><b>Mazzo:</b> 20 carte, massimo 2 copie per carta. Non ci sono carte Energia nel mazzo.</li>
      <li><b>Inizio:</b> peschi 5 carte (sempre almeno un Pokémon Base). Scegli 1 Pokémon attivo e fino a 3 in panchina. Una moneta decide chi inizia.</li>
      <li><b>Zona Energia:</b> ogni turno genera automaticamente 1 Energia (vedi anche la prossima). Puoi assegnarla a uno qualsiasi dei tuoi Pokémon, una volta per turno. Chi inizia non riceve Energia al primo turno.</li>
      <li><b>Turno:</b> pesca 1 carta (max 10 in mano), poi in qualsiasi ordine: gioca Pokémon Base in panchina, evolvi, gioca Strumenti (illimitati) e 1 carta Aiuto, assegna l'Energia, usa abilità, ritira il Pokémon attivo (1 volta, scartando Energie pari al costo di ritirata). Attaccare termina il turno.</li>
      <li><b>Evoluzione:</b> non nel tuo primo turno e non su un Pokémon entrato in gioco o evoluto in questo turno.</li>
      <li><b>Debolezza:</b> +20 danni.</li>
      <li><b>Condizioni speciali:</b> Avvelenato (10 danni tra un turno e l'altro), Bruciato (20 danni, poi moneta: testa guarisce), Addormentato (moneta tra i turni: testa si sveglia), Paralizzato (non attacca né si ritira fino alla fine del tuo prossimo turno).</li>
      <li><b>Limite:</b> dopo ${TURN_LIMIT} turni vince chi ha più punti.</li>
    </ul>
    <div class="m-actions"><button class="btn primary" data-mact="__close">Ho capito</button></div>
  </div>`);
}

renderMenu();
if (AUTO) newMatch(params.get('deck') || DECKS[rnd(DECKS.length)].id);

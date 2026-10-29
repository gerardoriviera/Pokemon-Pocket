'use strict';

// Tipi di energia
const TYPES = {
  grass:     { name: 'Erba',     color: '#4caf50', dark: '#2e7d32', icon: '🍃' },
  fire:      { name: 'Fuoco',    color: '#f4511e', dark: '#bf360c', icon: '🔥' },
  water:     { name: 'Acqua',    color: '#1e88e5', dark: '#0d47a1', icon: '💧' },
  lightning: { name: 'Lampo',    color: '#fbc02d', dark: '#f57f17', icon: '⚡' },
  psychic:   { name: 'Psico',    color: '#8e44ad', dark: '#5b2c6f', icon: '🌀' },
  fighting:  { name: 'Lotta',    color: '#c0703a', dark: '#7a3f17', icon: '✊' },
  metal:     { name: 'Metallo',  color: '#90a4ae', dark: '#455a64', icon: '⚙️' },
  colorless: { name: 'Incolore', color: '#cfd8dc', dark: '#78909c', icon: '★' },
};

// Le funzioni degli effetti ricevono un contesto ctx:
// { me, opp, att (Pokémon attaccante), def (Pokémon attivo avversario), damage, noWeakness }
const CARDS = {
  // ---------------- FUOCO ----------------
  charmander: {
    name: 'Charmander', kind: 'pokemon', stage: 0, type: 'fire', hp: 60, weakness: 'water', retreat: 1, art: '🦎',
    attacks: [{ name: 'Braciere', cost: ['fire'], damage: 30, text: 'Scarta 1 Energia Fuoco da questo Pokémon.',
      after: ctx => discardEnergy(ctx.att, 'fire', 1) }],
  },
  charmeleon: {
    name: 'Charmeleon', kind: 'pokemon', stage: 1, evolvesFrom: 'Charmander', type: 'fire', hp: 90, weakness: 'water', retreat: 2, art: '🦖',
    attacks: [{ name: 'Artigli Fuoco', cost: ['fire', 'fire', 'colorless'], damage: 60 }],
  },
  charizard_ex: {
    name: 'Charizard ex', kind: 'pokemon', stage: 2, evolvesFrom: 'Charmeleon', type: 'fire', hp: 180, ex: true, weakness: 'water', retreat: 2, art: '🐉',
    attacks: [
      { name: 'Lacerazione', cost: ['fire', 'colorless', 'colorless'], damage: 60 },
      { name: 'Tempesta Cremisi', cost: ['fire', 'fire', 'colorless', 'colorless'], damage: 200, text: 'Scarta 2 Energie Fuoco da questo Pokémon.',
        after: ctx => discardEnergy(ctx.att, 'fire', 2) },
    ],
  },
  vulpix: {
    name: 'Vulpix', kind: 'pokemon', stage: 0, type: 'fire', hp: 50, weakness: 'water', retreat: 1, art: '🦊',
    attacks: [{ name: 'Colpodicoda', cost: ['colorless'], damage: 0, est: () => 10,
      text: 'Lancia una moneta. Se esce testa, durante il prossimo turno dell\'avversario il Pokémon difensore non può attaccare.',
      after: async ctx => { if (ctx.def && await flip('Colpodicoda')) { ctx.def.cantAttackTurn = game.turn + 1; log(`${pname(ctx.def)} non potrà attaccare!`); } } }],
  },
  ninetales: {
    name: 'Ninetales', kind: 'pokemon', stage: 1, evolvesFrom: 'Vulpix', type: 'fire', hp: 90, weakness: 'water', retreat: 1, art: '🦊',
    attacks: [{ name: 'Lanciafiamme', cost: ['fire', 'fire'], damage: 90, text: 'Scarta 1 Energia Fuoco da questo Pokémon.',
      after: ctx => discardEnergy(ctx.att, 'fire', 1) }],
  },
  moltres_ex: {
    name: 'Moltres ex', kind: 'pokemon', stage: 0, type: 'fire', hp: 140, ex: true, weakness: 'lightning', retreat: 2, art: '🦅',
    attacks: [
      { name: 'Danza Infernale', cost: ['fire'], damage: 0,
        est: p => p.bench.some(b => b && b.card.def.type === 'fire') ? 25 : 0,
        text: 'Lancia 3 monete. Prendi un\'Energia Fuoco dalla tua Zona Energia per ogni testa e assegnala ai tuoi Pokémon Fuoco in panchina.',
        after: async ctx => {
          const heads = await flipMany(3, 'Danza Infernale');
          for (let i = 0; i < heads; i++) {
            const cands = ctx.me.bench.filter(b => b && b.card.def.type === 'fire');
            if (!cands.length) { log('Nessun Pokémon Fuoco in panchina.'); break; }
            const t = await choose(ctx.me, cands, `Assegna Energia Fuoco (${i + 1}/${heads})`, { ai: c => c.slice().sort((a, b) => b.card.def.hp - a.card.def.hp)[0] });
            t.energies.push('fire'); fx(t, '+🔥', 'heal');
          }
        } },
      { name: 'Vampata', cost: ['fire', 'colorless', 'colorless'], damage: 70 },
    ],
  },

  // ---------------- ACQUA ----------------
  squirtle: {
    name: 'Squirtle', kind: 'pokemon', stage: 0, type: 'water', hp: 60, weakness: 'lightning', retreat: 1, art: '🐢',
    attacks: [{ name: 'Pistolacqua', cost: ['water'], damage: 20 }],
  },
  wartortle: {
    name: 'Wartortle', kind: 'pokemon', stage: 1, evolvesFrom: 'Squirtle', type: 'water', hp: 80, weakness: 'lightning', retreat: 1, art: '🐢',
    attacks: [{ name: 'Ondata', cost: ['water', 'colorless'], damage: 40 }],
  },
  blastoise_ex: {
    name: 'Blastoise ex', kind: 'pokemon', stage: 2, evolvesFrom: 'Wartortle', type: 'water', hp: 180, ex: true, weakness: 'lightning', retreat: 3, art: '🐢',
    attacks: [
      { name: 'Surf', cost: ['water', 'water'], damage: 40 },
      { name: 'Idrocannone', cost: ['water', 'water', 'colorless', 'colorless'], damage: 100, label: '100+',
        est: (p, x) => x.energies.filter(e => e === 'water').length >= 4 ? 160 : 100,
        text: 'Se questo Pokémon ha almeno 2 Energie Acqua in più rispetto al costo dell\'attacco, infligge 60 danni in più.',
        before: ctx => { if (ctx.att.energies.filter(e => e === 'water').length >= 4) ctx.damage += 60; } },
    ],
  },
  staryu: {
    name: 'Staryu', kind: 'pokemon', stage: 0, type: 'water', hp: 50, weakness: 'lightning', retreat: 1, art: '⭐',
    attacks: [{ name: 'Schiaffo', cost: ['water'], damage: 20 }],
  },
  starmie_ex: {
    name: 'Starmie ex', kind: 'pokemon', stage: 1, evolvesFrom: 'Staryu', type: 'water', hp: 130, ex: true, weakness: 'lightning', retreat: 0, art: '🌟',
    attacks: [{ name: 'Idrospruzzo', cost: ['water', 'water'], damage: 90 }],
  },
  articuno_ex: {
    name: 'Articuno ex', kind: 'pokemon', stage: 0, type: 'water', hp: 140, ex: true, weakness: 'metal', retreat: 2, art: '🕊️',
    attacks: [
      { name: 'Ala Gelo', cost: ['water', 'colorless'], damage: 40 },
      { name: 'Bufera', cost: ['water', 'water', 'water'], damage: 80, text: 'Infligge anche 10 danni a ciascun Pokémon in panchina dell\'avversario.',
        after: ctx => ctx.opp.bench.forEach(b => b && dealDamage(ctx.opp, b, 10)) },
    ],
  },

  // ---------------- LAMPO ----------------
  pikachu_ex: {
    name: 'Pikachu ex', kind: 'pokemon', stage: 0, type: 'lightning', hp: 120, ex: true, weakness: 'fighting', retreat: 1, art: '🐭',
    attacks: [{ name: 'Circuito Circolare', cost: ['lightning', 'lightning'], damage: 0, label: '30×',
      est: p => 30 * p.bench.filter(b => b && b.card.def.type === 'lightning').length,
      text: 'Infligge 30 danni per ogni tuo Pokémon Lampo in panchina.',
      before: ctx => { ctx.damage = 30 * ctx.me.bench.filter(b => b && b.card.def.type === 'lightning').length; } }],
  },
  zapdos_ex: {
    name: 'Zapdos ex', kind: 'pokemon', stage: 0, type: 'lightning', hp: 130, ex: true, weakness: 'lightning', retreat: 1, art: '🦅',
    attacks: [
      { name: 'Beccata', cost: ['colorless'], damage: 20 },
      { name: 'Uragano Tonante', cost: ['lightning', 'lightning', 'lightning', 'lightning'], damage: 0, label: '50×', est: () => 100,
        text: 'Lancia 4 monete. Questo attacco infligge 50 danni per ogni testa.',
        before: async ctx => { ctx.damage = 50 * await flipMany(4, 'Uragano Tonante'); } },
    ],
  },
  voltorb: {
    name: 'Voltorb', kind: 'pokemon', stage: 0, type: 'lightning', hp: 60, weakness: 'fighting', retreat: 1, art: '🔴',
    attacks: [{ name: 'Azione', cost: ['lightning'], damage: 20 }],
  },
  electrode: {
    name: 'Electrode', kind: 'pokemon', stage: 1, evolvesFrom: 'Voltorb', type: 'lightning', hp: 80, weakness: 'fighting', retreat: 1, art: '🟠',
    attacks: [{ name: 'Sferelettrica', cost: ['lightning', 'lightning'], damage: 70 }],
  },
  blitzle: {
    name: 'Blitzle', kind: 'pokemon', stage: 0, type: 'lightning', hp: 70, weakness: 'fighting', retreat: 1, art: '🐴',
    attacks: [{ name: 'Calcio Elettrico', cost: ['lightning', 'colorless'], damage: 30 }],
  },
  zebstrika: {
    name: 'Zebstrika', kind: 'pokemon', stage: 1, evolvesFrom: 'Blitzle', type: 'lightning', hp: 100, weakness: 'fighting', retreat: 1, art: '🦓',
    attacks: [{ name: 'Lancia Tuono', cost: ['lightning', 'lightning', 'colorless'], damage: 0, label: '60', est: () => 60,
      text: 'Questo attacco infligge 60 danni a uno dei Pokémon del tuo avversario (debolezza non applicata).',
      after: async ctx => {
        const cands = allInPlay(ctx.opp);
        if (!cands.length) return;
        const t = await choose(ctx.me, cands, 'Scegli il bersaglio di Lancia Tuono', { ai: aiBestTarget(60) });
        dealDamage(ctx.opp, t, 60);
      } }],
  },

  // ---------------- ERBA ----------------
  bulbasaur: {
    name: 'Bulbasaur', kind: 'pokemon', stage: 0, type: 'grass', hp: 70, weakness: 'fire', retreat: 1, art: '🐸',
    attacks: [{ name: 'Frustata', cost: ['grass', 'colorless'], damage: 40 }],
  },
  ivysaur: {
    name: 'Ivysaur', kind: 'pokemon', stage: 1, evolvesFrom: 'Bulbasaur', type: 'grass', hp: 90, weakness: 'fire', retreat: 2, art: '🌿',
    attacks: [{ name: 'Foglielama', cost: ['grass', 'colorless', 'colorless'], damage: 60 }],
  },
  venusaur_ex: {
    name: 'Venusaur ex', kind: 'pokemon', stage: 2, evolvesFrom: 'Ivysaur', type: 'grass', hp: 190, ex: true, weakness: 'fire', retreat: 3, art: '🌺',
    attacks: [
      { name: 'Foglielama', cost: ['grass', 'colorless', 'colorless'], damage: 60 },
      { name: 'Fioritura Gigante', cost: ['grass', 'grass', 'colorless', 'colorless'], damage: 100, text: 'Cura questo Pokémon da 30 danni.',
        after: ctx => heal(ctx.att, 30) },
    ],
  },
  caterpie: {
    name: 'Caterpie', kind: 'pokemon', stage: 0, type: 'grass', hp: 50, weakness: 'fire', retreat: 1, art: '🐛',
    attacks: [{ name: 'Cercamici', cost: ['colorless'], damage: 0, est: () => 5, text: 'Prendi a caso un Pokémon Erba dal tuo mazzo e aggiungilo alla tua mano.',
      after: ctx => {
        const c = ctx.me.deck.filter(x => x.def.kind === 'pokemon' && x.def.type === 'grass');
        if (!c.length) { log('Nessun Pokémon Erba nel mazzo.'); return; }
        const pick = c[rnd(c.length)];
        ctx.me.deck.splice(ctx.me.deck.indexOf(pick), 1); ctx.me.hand.push(pick); shuffle(ctx.me.deck);
        log(`${ctx.me.name} prende ${pick.def.name} dal mazzo.`);
      } }],
  },
  metapod: {
    name: 'Metapod', kind: 'pokemon', stage: 1, evolvesFrom: 'Caterpie', type: 'grass', hp: 80, weakness: 'fire', retreat: 2, art: '🫘',
    attacks: [{ name: 'Morso Insetto', cost: ['colorless', 'colorless'], damage: 30 }],
  },
  butterfree: {
    name: 'Butterfree', kind: 'pokemon', stage: 2, evolvesFrom: 'Metapod', type: 'grass', hp: 120, weakness: 'fire', retreat: 1, art: '🦋',
    ability: { name: 'Polvere Curativa', text: 'Una volta durante il tuo turno, puoi curare ciascuno dei tuoi Pokémon da 20 danni.',
      canUse: (p, poke) => poke.abilityTurn !== game.turn && allInPlay(p).some(x => x.damage > 0),
      use: (p, poke) => { allInPlay(p).forEach(x => heal(x, 20)); } },
    attacks: [{ name: 'Raffica', cost: ['grass', 'colorless', 'colorless'], damage: 60 }],
  },
  exeggcute: {
    name: 'Exeggcute', kind: 'pokemon', stage: 0, type: 'grass', hp: 50, weakness: 'fire', retreat: 1, art: '🥚',
    attacks: [{ name: 'Semebomba', cost: ['grass'], damage: 20 }],
  },
  exeggutor_ex: {
    name: 'Exeggutor ex', kind: 'pokemon', stage: 1, evolvesFrom: 'Exeggcute', type: 'grass', hp: 160, ex: true, weakness: 'fire', retreat: 2, art: '🌴',
    attacks: [{ name: 'Tropicaltalea', cost: ['grass'], damage: 40, label: '40+', est: () => 60, text: 'Lancia una moneta. Se esce testa, questo attacco infligge 40 danni in più.',
      before: async ctx => { if (await flip('Tropicaltalea')) ctx.damage += 40; } }],
  },

  // ---------------- PSICO ----------------
  ralts: {
    name: 'Ralts', kind: 'pokemon', stage: 0, type: 'psychic', hp: 60, weakness: 'metal', retreat: 1, art: '👶',
    attacks: [{ name: 'Ondata Psichica', cost: ['psychic'], damage: 20 }],
  },
  kirlia: {
    name: 'Kirlia', kind: 'pokemon', stage: 1, evolvesFrom: 'Ralts', type: 'psychic', hp: 80, weakness: 'metal', retreat: 1, art: '🩰',
    attacks: [{ name: 'Fendente Psico', cost: ['psychic', 'colorless'], damage: 30 }],
  },
  gardevoir: {
    name: 'Gardevoir', kind: 'pokemon', stage: 2, evolvesFrom: 'Kirlia', type: 'psychic', hp: 110, weakness: 'metal', retreat: 2, art: '💃',
    ability: { name: 'Psicoshift', text: 'Una volta durante il tuo turno, se questo Pokémon è in panchina, prendi un\'Energia Psico dalla Zona Energia e assegnala al tuo Pokémon attivo Psico.',
      canUse: (p, poke) => poke.abilityTurn !== game.turn && poke !== p.active && p.active && p.active.card.def.type === 'psychic',
      use: (p) => { p.active.energies.push('psychic'); fx(p.active, '+🌀', 'heal'); } },
    attacks: [{ name: 'Psicoraggio', cost: ['psychic', 'psychic', 'colorless'], damage: 60 }],
  },
  mewtwo_ex: {
    name: 'Mewtwo ex', kind: 'pokemon', stage: 0, type: 'psychic', hp: 150, ex: true, weakness: 'metal', retreat: 2, art: '🧬',
    attacks: [
      { name: 'Sfera Psichica', cost: ['psychic', 'colorless'], damage: 50 },
      { name: 'Psicodisgregazione', cost: ['psychic', 'psychic', 'colorless', 'colorless'], damage: 150, text: 'Scarta 2 Energie Psico da questo Pokémon.',
        after: ctx => discardEnergy(ctx.att, 'psychic', 2) },
    ],
  },
  jynx: {
    name: 'Jynx', kind: 'pokemon', stage: 0, type: 'psychic', hp: 70, weakness: 'metal', retreat: 1, art: '💋',
    attacks: [{ name: 'Canto', cost: ['psychic'], damage: 0, est: () => 15, text: 'Il Pokémon attivo dell\'avversario si addormenta.',
      after: ctx => { if (ctx.def) { setStatus(ctx.def, 'asleep'); } } }],
  },
  gastly: {
    name: 'Gastly', kind: 'pokemon', stage: 0, type: 'psychic', hp: 50, weakness: 'darkness', retreat: 1, art: '👻',
    attacks: [{ name: 'Leccata', cost: ['psychic'], damage: 10, text: 'Lancia una moneta. Se esce testa, il Pokémon attivo dell\'avversario viene paralizzato.',
      after: async ctx => { if (ctx.def && await flip('Leccata')) setStatus(ctx.def, 'paralyzed'); } }],
  },
  haunter: {
    name: 'Haunter', kind: 'pokemon', stage: 1, evolvesFrom: 'Gastly', type: 'psychic', hp: 80, weakness: 'darkness', retreat: 1, art: '😈',
    attacks: [{ name: 'Tossincubo', cost: ['psychic', 'colorless'], damage: 30, text: 'Il Pokémon attivo dell\'avversario viene avvelenato.',
      after: ctx => { if (ctx.def) setStatus(ctx.def, 'poisoned'); } }],
  },

  // ---------------- ALLENATORI ----------------
  pokeball: {
    name: 'Poké Ball', kind: 'item', art: 'pokeball', text: 'Prendi a caso un Pokémon Base dal tuo mazzo e aggiungilo alla tua mano.',
    canPlay: p => p.deck.length > 0,
    play: p => {
      const c = p.deck.filter(x => x.def.kind === 'pokemon' && x.def.stage === 0);
      if (!c.length) { log('Nessun Pokémon Base nel mazzo.'); return; }
      const pick = c[rnd(c.length)];
      p.deck.splice(p.deck.indexOf(pick), 1); p.hand.push(pick); shuffle(p.deck);
      log(`${p.name} prende ${pick.def.name} dal mazzo.`);
    },
  },
  potion: {
    name: 'Pozione', kind: 'item', art: '🧪', text: 'Cura uno dei tuoi Pokémon da 20 danni.',
    canPlay: p => allInPlay(p).some(x => x.damage > 0),
    play: async p => {
      const t = await choose(p, allInPlay(p).filter(x => x.damage > 0), 'Scegli un Pokémon da curare', { ai: c => c.sort((a, b) => b.damage - a.damage)[0] });
      heal(t, 20);
    },
  },
  xspeed: {
    name: 'Velocità X', kind: 'item', art: '👟', text: 'Durante questo turno, il costo di ritirata del tuo Pokémon attivo è ridotto di 1 Energia.',
    canPlay: p => !!p.active && p.xspeed === 0,
    play: p => { p.xspeed = 1; },
  },
  research: {
    name: 'Ricerca Accademica', kind: 'supporter', art: '📚', text: 'Pesca 2 carte.',
    canPlay: p => p.deck.length > 0,
    play: p => drawCards(p, 2),
  },
  giovanni: {
    name: 'Giovanni', kind: 'supporter', art: '🕴️', text: 'Durante questo turno, gli attacchi usati dai tuoi Pokémon infliggono 10 danni in più al Pokémon attivo dell\'avversario.',
    canPlay: () => true,
    play: p => { p.giovanni = 10; },
  },
  sabrina: {
    name: 'Sabrina', kind: 'supporter', art: '🔮', text: 'Il tuo avversario scambia il suo Pokémon attivo con uno dei suoi Pokémon in panchina. (Sceglie il tuo avversario.)',
    canPlay: p => benchList(opponent(p)).length > 0,
    play: async p => {
      const o = opponent(p);
      const t = await choose(o, benchList(o), 'Sabrina: scegli il nuovo Pokémon attivo', { ai: aiPromote });
      switchActive(o, o.bench.indexOf(t));
    },
  },
  misty: {
    name: 'Misty', kind: 'supporter', art: '🌊', text: 'Scegli 1 dei tuoi Pokémon Acqua e lancia una moneta finché non esce croce. Per ogni testa, prendi un\'Energia Acqua dalla Zona Energia e assegnala a quel Pokémon.',
    canPlay: p => allInPlay(p).some(x => x.card.def.type === 'water'),
    play: async p => {
      const t = await choose(p, allInPlay(p).filter(x => x.card.def.type === 'water'), 'Misty: scegli un Pokémon Acqua', { ai: c => c.includes(p.active) ? p.active : c[0] });
      let n = 0;
      while (await flip(`Misty (${n} teste)`)) { n++; t.energies.push('water'); fx(t, '+💧', 'heal'); render(); }
      log(`Misty assegna ${n} Energia Acqua a ${pname(t)}.`);
    },
  },
  erika: {
    name: 'Erika', kind: 'supporter', art: '🌸', text: 'Cura uno dei tuoi Pokémon Erba da 50 danni.',
    canPlay: p => allInPlay(p).some(x => x.card.def.type === 'grass' && x.damage > 0),
    play: async p => {
      const t = await choose(p, allInPlay(p).filter(x => x.card.def.type === 'grass' && x.damage > 0), 'Erika: scegli un Pokémon Erba', { ai: c => c.sort((a, b) => b.damage - a.damage)[0] });
      heal(t, 50);
    },
  },
};
for (const [id, c] of Object.entries(CARDS)) c.id = id;

const DECKS = [
  { id: 'fire', name: 'Charizard ex', type: 'fire', energy: ['fire'], hero: 'charizard_ex', desc: 'Potenza devastante: Moltres ex carica la panchina, Charizard ex chiude la partita.',
    list: [['charmander', 2], ['charmeleon', 2], ['charizard_ex', 2], ['vulpix', 2], ['ninetales', 2], ['moltres_ex', 2],
           ['pokeball', 2], ['potion', 1], ['xspeed', 1], ['research', 2], ['giovanni', 1], ['sabrina', 1]] },
  { id: 'water', name: 'Starmie ex', type: 'water', energy: ['water'], hero: 'starmie_ex', desc: 'Veloce e senza ritirata: Starmie ex e Misty per cariche esplosive.',
    list: [['squirtle', 2], ['wartortle', 2], ['blastoise_ex', 2], ['staryu', 2], ['starmie_ex', 2], ['articuno_ex', 1],
           ['pokeball', 2], ['potion', 2], ['research', 2], ['misty', 2], ['sabrina', 1]] },
  { id: 'lightning', name: 'Pikachu ex', type: 'lightning', energy: ['lightning'], hero: 'pikachu_ex', desc: 'Riempi la panchina di Pokémon Lampo e scatena Circuito Circolare.',
    list: [['pikachu_ex', 2], ['zapdos_ex', 1], ['voltorb', 2], ['electrode', 2], ['blitzle', 2], ['zebstrika', 2],
           ['pokeball', 2], ['potion', 2], ['xspeed', 1], ['research', 2], ['giovanni', 1], ['sabrina', 1]] },
  { id: 'grass', name: 'Venusaur ex', type: 'grass', energy: ['grass'], hero: 'venusaur_ex', desc: 'Resistenza e cure: Exeggutor ex, Butterfree ed Erika.',
    list: [['bulbasaur', 2], ['ivysaur', 1], ['venusaur_ex', 1], ['caterpie', 2], ['metapod', 1], ['butterfree', 1], ['exeggcute', 2], ['exeggutor_ex', 2],
           ['pokeball', 2], ['potion', 1], ['research', 2], ['erika', 2], ['sabrina', 1]] },
  { id: 'psychic', name: 'Mewtwo ex', type: 'psychic', energy: ['psychic'], hero: 'mewtwo_ex', desc: 'Gardevoir alimenta Mewtwo ex mentre Gastly e Jynx bloccano l\'avversario.',
    list: [['mewtwo_ex', 2], ['ralts', 2], ['kirlia', 2], ['gardevoir', 2], ['jynx', 1], ['gastly', 2], ['haunter', 1],
           ['pokeball', 2], ['potion', 1], ['xspeed', 1], ['research', 2], ['giovanni', 1], ['sabrina', 1]] },
];

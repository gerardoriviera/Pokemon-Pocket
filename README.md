# Pocket Battle

Gioco di carte in HTML ispirato alle regole e allo stile di **Pokémon TCG Pocket**. Si gioca contro la CPU direttamente nel browser.

## Come giocare
Apri `index.html` nel browser. Non servono installazioni né server.

## Regole principali
- Mazzi da 20 carte e nessuna carta Energia: ogni turno la **Zona Energia** genera 1 Energia da assegnare a un tuo Pokémon.
- Chi inizia non riceve Energia nel primo turno.
- 1 Pokémon attivo e fino a 3 in panchina.
- Mettere KO un Pokémon vale **1 punto**, un **Pokémon ex** vale **2 punti**. Vince chi arriva a **3 punti**, oppure chi lascia l'avversario senza Pokémon in gioco.
- Debolezza: +20 danni. Condizioni speciali: Avvelenato, Bruciato, Addormentato e Paralizzato.
- Gli Strumenti si possono giocare senza limiti, le carte Aiuto una sola volta per turno.
- Non si evolve nel proprio primo turno né un Pokémon entrato in gioco in quel turno.

## Mazzi
Charizard ex (Fuoco), Starmie ex (Acqua), Pikachu ex (Lampo), Venusaur ex (Erba) e Mewtwo ex (Psico).

## Comandi
- Tocca una carta in mano per vederla e giocarla.
- Tocca la sfera della Zona Energia, poi un tuo Pokémon, per assegnare l'Energia.
- Tocca il tuo Pokémon attivo per attaccare o ritirarlo.
- Il pulsante **Fine turno** passa il turno.

Per i test: `index.html?auto&fast` fa giocare la CPU contro se stessa senza animazioni.

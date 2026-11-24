# Meshboard

Lavagna collaborativa tra colleghi, **senza server e senza account**.
Forme, post-it, frecce e voti 👍/👎, in tempo reale. Si pubblica gratis su GitHub Pages.

## Come funziona

- Chi crea una lavagna ottiene un link del tipo `https://utente.github.io/meshboard/#<token>`.
  Chi riceve il link sceglie un nome ed entra.
- I browser si collegano **direttamente tra loro** (WebRTC). Per trovarsi usano dei relay
  pubblici [Nostr](https://nostr.com), tramite [Trystero](https://github.com/dmotz/trystero).
  I relay vedono solo un handshake cifrato con il segreto contenuto nel token, mai il
  contenuto della lavagna.
- Lo stato condiviso è un documento [Yjs](https://yjs.dev) (CRDT): le modifiche fatte in
  contemporanea si fondono senza conflitti.
- Ogni browser tiene una copia della lavagna in IndexedDB. Chi la riapre la ritrova e la
  risincronizza con chi è online.
- La parte del link dopo `#` non viene mai inviata a GitHub.

## Funzioni

- Canvas infinito con pan e zoom (rotella, Ctrl + rotella, pinch su touch)
- Post-it, rettangoli, ellissi, testi, frecce agganciate agli elementi
- Selezione multipla (Maiusc + clic o trascinando), spostamento, ridimensionamento, colori,
  primo piano / in fondo, duplica, elimina
- 👍 / 👎 sui post-it degli altri: un voto a testa, passando il mouse si vede chi ha votato
- Cursori e nomi dei colleghi in tempo reale
- Annulla / ripeti (solo le proprie modifiche)
- **Esporta / importa** in JSON: dal menu `⋯` della lavagna, oppure "Apri da un file
  esportato" nella schermata iniziale per creare una lavagna nuova da un backup

## Limiti da sapere

- **Il nome non è un vero login.** Chi ha il link può entrare e scegliere qualsiasi nome.
  Il link è la chiave: condividilo solo con chi deve entrare.
- **La lavagna vive nei browser di chi partecipa.** Se nessuno la tiene aperta, resta salvata
  solo nei browser di chi c'era. Per conservarla nel tempo usa **Esporta**.
- **Reti aziendali molto chiuse** possono bloccare le connessioni dirette. In quel caso serve
  un server TURN (ci sono piani gratuiti, per esempio Cloudflare o Metered): passalo come
  `turnConfig` a `connect()` in [`src/sync.js`](src/sync.js).
- Pensata per gruppi di lavoro, non per centinaia di persone sulla stessa lavagna.

## Pubblicarla su GitHub Pages

1. Crea un repository su GitHub e fai push di questa cartella sul branch `main`.
2. Nel repository apri **Settings → Pages** e imposta **Source: GitHub Actions**.
3. Al primo push il workflow [`deploy.yml`](.github/workflows/deploy.yml) compila e pubblica.
   L'indirizzo compare in **Actions** e in **Settings → Pages**.

## Sviluppo

Serve Node 22 o superiore.

```bash
npm install
npm run dev
```

Per provare con due "persone" sulla stessa macchina apri l'app sia su `http://localhost:5173`
sia su `http://127.0.0.1:5173`, oppure in una finestra in incognito: ognuna ha il suo nome e
il suo spazio di salvataggio.

```bash
npm test        # test del modello dati (voti, frecce, export/import)
npm run build   # versione di produzione in dist/
```

### Struttura

| File | Cosa fa |
| --- | --- |
| `src/store.js` | Modello dati Yjs: elementi, voti, titolo, export/import |
| `src/sync.js` | IndexedDB + Trystero: sincronizzazione e presenza |
| `src/board.js` | Canvas: rendering, strumenti, selezione, pan/zoom |
| `src/app.js` | Interfaccia della lavagna: barre, menu, condivisione |
| `src/home.js` | Schermata iniziale |
| `src/geometry.js` | Calcoli per frecce e selezione |

### Formato di export

```json
{
  "format": "meshboard",
  "version": 1,
  "title": "Retro sprint 42",
  "users": { "<id>": "Nome" },
  "items": [
    { "id": "…", "type": "note", "x": 0, "y": 0, "w": 200, "h": 200,
      "color": "yellow", "text": "…", "author": "<id>", "votes": { "<id>": 1 } }
  ]
}
```

I tipi sono `note`, `rect`, `ellipse`, `text` e `arrow`. Le frecce hanno `x1, y1, x2, y2`
e, se agganciate, `from` / `to`.

## Licenza

MIT

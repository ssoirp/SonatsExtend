# SonatsLite — Session Handoff

**Data última actualització**: 2026-06-08
**Fase actual**: ✅ App Next.js inicial + GitHub + Vercel linkage pending

## Estat actual

### Que s'ha fet
1. **Repo GitHub creat**: [ssoirp/SonatsLite](https://github.com/ssoirp/SonatsLite) — public
2. **App Next.js 16** scaffolded amb TypeScript + Tailwind + shadcn
3. **Spotify OAuth PKCE** implementat (`src/lib/spotify.ts`)
   - Client ID: `779cef7854a64fb0a82072f77c8c3117`
   - Redirect URI: `http://localhost:3000/callback` (local) + `https://sonats-lite.vercel.app/callback` (prod)
4. **Cançons + Cues**: 
   - 53 cançons del CSV PompeuFarra '26
   - 44 amb hot cues de la BD Mixxx (ho vam extraure de `mixxxdb.sqlite`)
   - JSON a `src/data/songs.json` — matching per artista/nom
5. **Pàgines implementades**:
   - `/` (home): botons "Començar", "Configurar", "Llistat"
   - `/callback`: OAuth handler
   - `/bingo`: reproductor automàtic amb polling de posició Spotify
   - `/config`: tria cue IN/OUT + defaults en segons (per cançons sense cues)
   - `/played`: llistat de cançons sonades
6. **State management**: localStorage per config i cançons sonades
7. **Build**: `npm run build` passa sense errors

### Pendent — CRÍTIC
- [ ] **`vercel link`** — projecte no està linkat a Vercel. Requereix input interactiu
- [ ] **Spotify Dashboard** — afegir redirect URIs:
  - `http://localhost:3000/callback`
  - `https://sonats-lite.vercel.app/callback` (URL que donarà Vercel)
- [ ] **`.env` a Vercel** — `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` ha de ser dinàmic per preview vs prod

### Estructura del projecte
```
/Users/ssoi/Documents/SonatsLite/
├── src/
│   ├── app/
│   │   ├── page.tsx              (home: 3 botons)
│   │   ├── bingo/page.tsx         (reproductor)
│   │   ├── config/page.tsx        (configuració cues)
│   │   ├── played/page.tsx        (històric)
│   │   └── callback/page.tsx      (OAuth)
│   ├── lib/
│   │   ├── spotify.ts            (API + PKCE)
│   │   └── state.ts              (localStorage helpers)
│   └── data/
│       └── songs.json            (53 cançons amb cues en ms)
├── .env.local                    (NEXT_PUBLIC_SPOTIFY_CLIENT_ID + REDIRECT_URI)
├── .env.example
└── next.config.ts
```

## Següent pas (sessió 2)

1. Obrir terminal a `/Users/ssoi/Documents/SonatsLite`
2. Executar `vercel link` (interactiu):
   - Scope: `ssoirp`
   - Nom: `SonatsLite`
   - Root: `.`
3. Afegir redirect URIs a [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):
   - Entra a l'app (client ID `779cef7854a64fb0a82072f77c8c3117`)
   - Settings → Redirect URIs → afegeix `http://localhost:3000/callback` i `https://sonats-lite.vercel.app/callback`
4. Executar `/deploy preview` per desplegar

## Notes tècniques
- Polling de posició Spotify: cada 1.5s via `getCurrentPosition()`
- Hot cues a BD Mixxx: samples a 88.200/s → convertits a ms
- Cançons sense cues: usen defaults (30s IN, 60s OUT, configurable)
- Estat de joc: localStorage `bingo_played` (array de URIs) i `bingo_config`

## Credencials
- Spotify Client ID: `779cef7854a64fb0a82072f77c8c3117` (ja al codi)
- GitHub: ssoirp (autenticat)
- Vercel: pendent linkage

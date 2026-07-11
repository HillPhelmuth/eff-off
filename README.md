# EFF-OFF

**Always-on NSFW insult comic** — a realtime speech-to-speech voice agent that roasts you no matter what you say.

Built with [OpenAI Voice Agents](https://developers.openai.com/api/docs/guides/voice-agents) on model **`gpt-realtime-2.1-mini`**, using the Agents SDK (`RealtimeAgent` + `RealtimeSession` over WebRTC) and the Realtime [prompting guide](https://developers.openai.com/api/docs/guides/realtime-models-prompting).

> Adults only. Consensual roast comedy. The system prompt forbids content involving minors and other hard safety lines, while staying maximally mean otherwise.

## Architecture

```
Browser (WebRTC + @openai/agents/realtime)
        │  POST /api/session  → ephemeral client secret (ek_…)
        ▼
Express server  ──Bearer OPENAI_API_KEY──►  POST /v1/realtime/client_secrets
        │
        └─ session.instructions = EFF-OFF insult-comic prompt
           session.model        = gpt-realtime-2.1-mini

Browser connects RealtimeSession with the ephemeral key directly to OpenAI WebRTC.
```

The long-lived API key **never leaves the server**. Browsers only receive a short-lived `ek_…` client secret.

## Local development

```bash
cp .env.example .env
# put OPENAI_API_KEY=sk-... in .env

npm install
npm run dev
# → http://localhost:3000
```

Check the gateboxes (18+ consent), hit **Step on stage**, allow mic access, get roasted.

## Production

```bash
npm run build
NODE_ENV=production OPENAI_API_KEY=sk-... npm start
```

Or Docker:

```bash
docker build -t eff-off .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... eff-off
```

## GitHub Actions publish

The workflow file ships as [`deploy/publish.yml`](deploy/publish.yml) so it can land in the repo without requiring the `workflow` OAuth scope on the bootstrap token. Enable publishing with:

```bash
mkdir -p .github/workflows
cp deploy/publish.yml .github/workflows/publish.yml
git add .github/workflows/publish.yml
git commit -m "ci: enable GHCR publish workflow"
git push
```

(Requires a token / SSO permission that can write GitHub Actions workflows.)

Once enabled, every push to `main`:

1. runs `npm ci` + `npm run build`
2. builds a multi-layer Docker image
3. pushes to **GitHub Container Registry**:
   - `ghcr.io/<owner>/eff-off:latest`
   - `ghcr.io/<owner>/eff-off:<sha>`
   - `ghcr.io/<owner>/eff-off:main`

Pull and run:

```bash
docker pull ghcr.io/<owner>/eff-off:latest
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... ghcr.io/<owner>/eff-off:latest
```

### Secrets / env for deploy hosts

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | Server only |
| `OPENAI_REALTIME_MODEL` | no | default `gpt-realtime-2.1-mini` |
| `OPENAI_REALTIME_VOICE` | no | default `ballad` (server default if UI does not pick) |
| `CLIENT_SECRET_TTL_SECONDS` | no | default `600` |
| `PORT` | no | default `3000` |

If you host on a PaaS (Railway / Fly / Render / Cloud Run), point it at the GHCR image and set `OPENAI_API_KEY` there. Actions already published the image.

## Project layout

```
server/
  index.js      Express API + Vite middleware / static
  prompt.js     Insult-comic system prompt + model defaults
client/src/
  App.jsx       Consent UI, voice picker, connect / hangup, transcripts
  agent.js      RealtimeAgent + RealtimeSession (WebRTC)
  styles.css
deploy/publish.yml   # copy → .github/workflows/publish.yml to enable CI
Dockerfile
```

## Voices

The stage UI has a **Voice** dropdown with the built-in Realtime voices:

`alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`

- List: `GET /api/voices` (also embedded on `GET /api/health`)
- Selection is sent on `POST /api/session` as `{ voice }` and stamped into `session.audio.output.voice` when the ephemeral key is minted
- Choice is remembered in `localStorage` (`effoff.voice`); switch requires hangup + reconnect
- Server default if unset/invalid: `OPENAI_REALTIME_VOICE` (default `ballad`)

## Notes

- Voice default: `ballad`. Prefer `marin` / `cedar` for highest quality; other IDs for character variety.
- Reasoning effort is set to `low` for snappy club timing.
- Input audio uses server VAD with barge-in so you can heckle mid-roast.

## License

MIT

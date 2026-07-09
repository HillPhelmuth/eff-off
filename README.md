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

On every push to `main`, [`.github/workflows/publish.yml`](.github/workflows/publish.yml):

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
| `OPENAI_REALTIME_VOICE` | no | default `ballad` |
| `CLIENT_SECRET_TTL_SECONDS` | no | default `600` |
| `PORT` | no | default `3000` |

If you host on a PaaS (Railway / Fly / Render / Cloud Run), point it at the GHCR image and set `OPENAI_API_KEY` there. Actions already published the image.

## Project layout

```
server/
  index.js      Express API + Vite middleware / static
  prompt.js     Insult-comic system prompt + model defaults
client/src/
  App.jsx       Consent UI, connect / hangup, transcripts
  agent.js      RealtimeAgent + RealtimeSession (WebRTC)
  styles.css
.github/workflows/publish.yml
Dockerfile
```

## Notes

- Voice default: `ballad` (gritty). Override with `OPENAI_REALTIME_VOICE` (`alloy`, `ash`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, …).
- Reasoning effort is set to `low` for snappy club timing.
- Input audio uses server VAD with barge-in so you can heckle mid-roast.

## License

MIT

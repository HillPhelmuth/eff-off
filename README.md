# EFF-OFF

**Always-on NSFW insult comic** — a realtime speech-to-speech voice agent that roasts you no matter what you say.

Built with [OpenAI GPT-Live](https://developers.openai.com/api/docs/guides/live) on **`gpt-live-1`**, using native browser WebRTC. Default voice: **`marin`**. This is a voice-only app with no reasoning backend or tools.

> Adults only. Consensual roast comedy. Consent is required before microphone capture.

## Architecture

The browser creates an SDP offer and sends `POST /api/session` with `{ sdp, safetyIdentifier, voice }`. Express exchanges it with `POST https://api.openai.com/v1/live/sessions`, adding the model, voice and prompt on the server. It returns `{ sessionId, sdp, model, voice }`. The project API key never leaves the server; audio flows directly between the browser and OpenAI.

The `oai-events` data channel carries Live events. Startup waits for `session.started`; an acknowledged `session.instructions.append` requests the opening roast. Input and output transcript fragments grow independently, including overlapping speech. Caption rows use a one-second grouping gap, not semantic turn boundaries. The microphone meter shares the call's capture stream.

Hangup immediately stops microphone capture and playback, then waits up to five seconds for `session.closed` before releasing WebRTC. Missing finalization is reported; connection startup times out after 30 seconds. Sessions are not stored and each new call starts fresh. Unexpected client delegation receives a fixed capability-unavailable result without invoking another model.

## Local development

Create `.env` with `OPENAI_API_KEY=your-project-key` (requires GPT-Live access). Optional settings are listed below.

```bash
npm install
npm run dev
# http://localhost:3000
```

Check both consent boxes, hit **Step on stage**, allow microphone access, and get roasted. Use HTTPS or localhost. You can cancel while connecting.

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
| `OPENAI_LIVE_MODEL` | no | default `gpt-live-1` |
| `OPENAI_LIVE_VOICE` | no | default `marin` |
| `PORT` | no | default `3000` |

If you host on a PaaS (Railway / Fly / Render / Cloud Run), point it at the GHCR image and set `OPENAI_API_KEY` there. Actions already published the image.

### Cloudflare Workers (optional parallel deployment)

Cloudflare support lives alongside the Node/Express deployment and does not change the Docker or Azure Container Apps path. Workers Builds deploys `cloudflare/worker.js` and the Vite output in `dist` as one Worker with static assets:

1. Connect this repository to a Cloudflare Worker using Workers Builds.
2. Set the build command to `npm run build`.
3. Set the deploy command to `npx wrangler deploy` or `npm run cloudflare:deploy`.
4. Add `OPENAI_API_KEY` under the Worker's runtime Variables & Secrets. Optionally add `OPENAI_LIVE_MODEL` and `OPENAI_LIVE_VOICE` there as well.

The Worker exposes `/api/voices`, `/api/health`, and `/api/session` and forwards all other requests to the `dist` asset binding. The committed `wrangler.jsonc` provides the required Worker entry point and static asset directory; it does not affect the existing Node or Docker commands.

For local Workers testing, install Wrangler and run `npx wrangler dev` after creating a local `.dev.vars` from `.dev.vars.example`.

## Project layout

```
server/
  index.js      Express + Vite middleware / static
  api.js        Live SDP exchange and health endpoint
  prompt.js     Insult-comic system prompt + model defaults
client/src/
  App.jsx       Consent UI, connect / hangup, transcripts
  agent.js      Native WebRTC and Live session lifecycle
  captions.js   Timestamped Live transcript grouping
  styles.css
cloudflare/
  api.js        Worker-compatible Live API handlers
  worker.js     Worker entry point and static-asset fallback
deploy/publish.yml   # copy → .github/workflows/publish.yml to enable CI
wrangler.jsonc       # Cloudflare Workers entry point + dist asset binding
Dockerfile
```

## Migration and validation

Replace old `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE` deployment settings with the Live variables above. Old variables and `CLIENT_SECRET_TTL_SECONDS` are no longer used. `GET /token` returns JSON status 410; `/api/session` now exchanges SDP rather than issuing tokens. No Realtime fallback is used. See the [migration guide](https://developers.openai.com/api/docs/guides/live-migration).

```bash
npm test
npm run build
```

Tests mock HTTP and WebRTC to verify startup sequencing, protocol payloads, failures, delegation fallback, caption grouping, cancellation and cleanup. For a real smoke test, verify greeting audio, two-way speech, captions, interruptions, denied microphone access, hangup and reconnect. Confirm microphone capture ends and browser traffic contains neither a project key nor Realtime requests. Live account access and spoken quality require this real test; a passing build alone does not verify them.
## Voices

Choose a voice from the stage dropdown before connecting. The selection is remembered in this browser and locked while connecting, live, or closing; hang up to choose another voice.

- `GET /api/voices` returns the available Live voices and server default.
- The picker includes `marin` and the additional voices documented in the [Live session guide](https://developers.openai.com/api/docs/guides/live-conversations): `quartz`, `ripple`, `vesper`, `willow`, `stone`, `gleam`, `meridian`, `bossa`, `tempo`, `beacon`, `delta`, and `cinder`.
- `POST /api/session` accepts `{ sdp, safetyIdentifier, voice }`. The server validates the selected voice and sets `session.audio.output.voice` during SDP exchange. Unknown selections receive HTTP 400.
- If omitted, the voice defaults to `OPENAI_LIVE_VOICE` (`marin`). A configured server default is also included in the dropdown. An obsolete saved selection falls back to the server default.

## License

MIT

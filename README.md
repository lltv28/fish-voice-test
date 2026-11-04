# fish-voice-test

Small local web app for testing [Fish Audio](https://docs.fish.audio/overview/capabilities):

1. **Clone**: record a voice sample in the browser (or upload a file) and create a private Fish Audio voice model.
2. **Call**: press Start and talk. It goes Fish speech-to-text → LLM → Fish streaming TTS in the cloned voice, one turn at a time until you hang up.
3. **Transcript**: shows the call with per-turn timings (ASR, LLM, first audio, total).

Optional: the AI can show up as a live talking face via [Anam](https://anam.ai/docs). Pick the mode in the Call section.

## Call modes

| Mode | Who does STT / LLM / voice | What Anam does |
| - | - | - |
| Audio only | Fish ASR, your LLM, Fish TTS (clone) | nothing |
| Avatar: passthrough (default) | same as audio only | only renders the face, lip-synced to our Fish audio ([audio passthrough](https://anam.ai/docs/javascript-sdk/examples/custom-tts)) |
| Avatar: Anam turnkey | Anam STT + Anam's default LLM, speaking with the Fish voice imported into Anam | everything, including mic and turn-taking |

Passthrough keeps the whole pipeline in our hands: the server streams Fish TTS as raw PCM (16-bit, 24 kHz, mono) and the browser forwards each chunk to Anam. Anam waits for 480 ms of audio before it starts animating, so expect that on top of Fish's first byte.

Turnkey needs the Fish voice imported into Anam first: select the voice and press **Import selected Fish voice** (can take about a minute). Anam can only import **public** Fish voices, so tick **public** when you clone, or the import fails. The system prompt box is passed to Anam; the LLM is Anam's default (`ANAM_LLM_ID` to override).

Avatar: the stock Anam avatar "Cara" is used by default. Put your own avatar id in the **Anam avatar id** box, or set `ANAM_AVATAR_ID` in `.env`.

Timings per turn:

- Audio only: ASR, LLM, TTS first audio, end of speech to audio.
- Passthrough: ASR, LLM, TTS first byte, avatar latency (first audio chunk sent to Anam until the avatar's lip-synced audio comes back), end of speech to avatar speaking.
- Turnkey: end of speech to avatar speaking (Anam does not split this into stages client-side).

The Anam SDK has no "first video frame of this reply" event, so avatar latency is measured on the avatar's own audio track, which Anam keeps in sync with the video.

## Requirements

- Node 22+ (no npm dependencies)
- ffmpeg on PATH

## Run

```sh
cp .env.example .env   # then fill in the keys
node server.mjs        # open http://localhost:8787
```

Keys in `.env` (never committed):

- `FISH_API_KEY`: Fish Audio API key (needed for everything)
- `LLM_API_KEY`: key for any OpenAI-compatible chat API (needed for audio-only and passthrough calls). Optional: `LLM_BASE_URL` (default OpenAI), `LLM_MODEL` (default `gpt-4o-mini`), `TTS_MODEL` (default `s2-pro`)
- `ANAM_API_KEY`: Anam API key from [lab.anam.ai](https://lab.anam.ai) → API Keys (needed for both avatar modes). Optional: `ANAM_AVATAR_ID`, `ANAM_LLM_ID`

All keys stay on the server. The browser only gets a short-lived Anam session token. The Anam JS SDK is loaded from esm.sh, so avatar modes need internet in the browser (they need it for Anam anyway).

## Status

Not tested against the live APIs yet. The server, UI and error handling work without keys. Clone, ASR, LLM and TTS calls follow the Fish docs, and the Anam session token, voice import and passthrough calls follow the Anam docs, but none have been run for real.

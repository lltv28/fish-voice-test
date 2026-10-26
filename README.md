# fish-voice-test

Small local web app for testing [Fish Audio](https://docs.fish.audio/overview/capabilities):

1. **Clone**: record a voice sample in the browser (or upload a file) and create a private Fish Audio voice model.
2. **Call**: press Start and talk. It goes Fish speech-to-text → LLM → Fish streaming TTS in the cloned voice, one turn at a time until you hang up.
3. **Transcript**: shows the call with per-turn timings (ASR, LLM, first audio, total).

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
- `LLM_API_KEY`: key for any OpenAI-compatible chat API (needed for calls). Optional: `LLM_BASE_URL` (default OpenAI), `LLM_MODEL` (default `gpt-4o-mini`), `TTS_MODEL` (default `s2-pro`)

## Status

Not tested against the live APIs yet. The server, UI and error handling work without keys. Clone, ASR, LLM and TTS calls follow the Fish docs but have not been run for real.

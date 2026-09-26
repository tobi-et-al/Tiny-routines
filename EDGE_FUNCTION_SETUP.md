# Evidence insights Edge Function

The Analysis page now builds a de-identified aggregate payload in the browser and sends it only after the parent presses **Generate summary**. The function rejects unknown fields, raw notes, names, IDs, exact dates and clock times.

## Configure

Link this repository to the existing Supabase project, then add these function secrets:

```text
AI_API_URL=https://your-provider.example/v1/chat/completions
AI_API_KEY=your-server-side-key
AI_MODEL=your-open-weight-model-id
```

`AI_API_URL` must be an OpenAI-compatible chat-completions endpoint. The key remains in the Edge Function environment and is never sent to the browser.

Deploy `evidence-insights` with JWT verification disabled, as set in `supabase/config.toml`. The function still restricts browser origins, caps payload size, applies a best-effort per-instance request limit and validates both input and model output. Because family authentication was intentionally skipped, provider-side spend limits and rate limits are required before enabling a paid model.

## Safety boundary

- The browser sends only aggregate counts, durations, volumes, coded observations, an age in days and relative day offsets.
- Free-text notes, names, date of birth, exact dates, exact times, medication details and clinician questions are never included.
- Urgent temperature guidance stays deterministic and on-device.
- Unsupported or malformed model output is hidden.
- This is data minimisation and de-identification, not a guarantee of anonymity.

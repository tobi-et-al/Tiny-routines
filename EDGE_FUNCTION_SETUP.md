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

### Free provider options

Groq is the simplest direct replacement and is recommended for this app:

```text
AI_API_URL=https://api.groq.com/openai/v1/chat/completions
AI_MODEL=openai/gpt-oss-20b
AI_API_KEY=your-groq-api-key
```

Groq publishes free-plan request and token limits for its open-weight models. Limits are account-level and may change, so check the Groq console before relying on them for wider use.

Other compatible choices:

- Cloudflare Workers AI includes a daily free allocation and an OpenAI-compatible endpoint. Its URL must include the Cloudflare account ID, for example `https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1/chat/completions`.
- OpenRouter offers free model routes through `https://openrouter.ai/api/v1/chat/completions`, but the no-credit tier is limited to 50 requests per day and free-model availability can change.

Use one provider at a time. Keep its key only in Supabase secrets, and run a synthetic test before enabling it in the app.

### Optional trusted-source search

Add this secret to check current sources before each generated summary:

```text
TAVILY_API_KEY=your-tavily-api-key
```

The function makes one basic Tavily search per generated summary. Tavily currently includes 1,000 free credits per month without a card; basic search uses one credit and pay-as-you-go is currently $0.008 per credit. If the key is missing, the allowance is exhausted or search fails, the app clearly falls back to its reviewed source library.

Search is deliberately constrained:

- Only `nhs.uk`, `homerton.nhs.uk` and `evidencebasedbirth.com` results are requested and accepted.
- Tavily receives one fixed generic newborn/postnatal guidance query. No family counts, categories, dates, names, notes or medication details are included.
- Returned snippets are treated as untrusted reference text. Instructions inside them are ignored.
- Every accepted AI finding must cite a server-validated source ID and URL.

Deploy `evidence-insights` with JWT verification disabled, as set in `supabase/config.toml`. The function still restricts browser origins, caps payload size, applies a best-effort per-instance request limit and validates both input and model output. Because family authentication was intentionally skipped, provider-side spend limits and rate limits are required before enabling a paid model.

## Safety boundary

- The browser sends only aggregate counts, durations, volumes, coded observations, an age in days and relative day offsets.
- Free-text notes, names, date of birth, exact dates, exact times, medication details and clinician questions are never included.
- Urgent temperature guidance stays deterministic and on-device.
- Unsupported or malformed model output is hidden.
- This is data minimisation and de-identification, not a guarantee of anonymity.

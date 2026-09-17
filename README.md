# Secure Voice Production Studio

Current development checkpoint: **v2.0.0-alpha.1 — Integrated Suite Foundation**

This is the real API-powered demo. It translates an English training script into German, generates an OpenAI MP3, transcribes the result, compares the spoken output with the approved German script, and provides an AI-assisted naturalness review.

## Suite foundation now included

- Supabase email/password sign-in and projects dashboard
- Project workspace with clip status and progress
- Server-side CSV validation, import preview, and database-backed project creation
- Automatic permanent numbering (`Clip 001`, `Clip 002`, and so on)
- Automatic version-ready filenames (`PROJECT_DE_001_v1.mp3`)
- Continuation-row grouping when a filename cell is blank
- PostgreSQL/Supabase schema for organizations, projects, clips, audio versions, feedback, approvals, and audit events
- Multi-tenant row-level-security policies

Project and clip data are tenant-isolated in Supabase. The existing OpenAI voice-generation workflow remains live under `/studio`.

## Supabase setup

1. Run `database/schema.sql` in the Supabase SQL Editor.
2. Create a private Storage bucket named `voice-audio`.
3. Run `database/storage-policies.sql`.
4. Run `database/bootstrap.sql`.
5. Add the Supabase URL and publishable key to Vercel as described below.

## Deploy to Vercel

1. Put this folder in a private GitHub repository.
2. In Vercel, choose **Add New > Project** and import that repository.
3. Open **Project Settings > Environment Variables**.
4. Add these environment variables:
   - `OPENAI_API_KEY` as a Secret.
   - `NEXT_PUBLIC_SUPABASE_URL` as Config.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` as Config, using the `sb_publishable_...` key.
5. Never add the Supabase `sb_secret_...` key to the application.
6. Click **Deploy**. If the project was already deployed, open **Deployments** and redeploy the latest deployment.

The API key is read only by the server route. It is never included in the browser bundle or returned to the user.

## Local developer setup

```bash
npm install
cp .env.example .env.local
# Replace the placeholder in .env.local with the API key.
npm run dev
```

Open `http://localhost:3000`.

## What is real

- Translation: `gpt-4.1-mini`
- Voice generation: `gpt-4o-mini-tts`
- Speech transcription: `gpt-4o-mini-transcribe`
- Voice quality review: `gpt-audio-1.5`
- Downloadable output: MP3

There is no browser speech or simulated QC fallback. If configuration or an API request fails, the screen shows an error and does not pretend an MP3 was generated.

## MVP security controls

- Server-only environment variable for the API key
- Same-origin API endpoint
- Allowed voice list and strict request validation
- Script and instruction length limits
- No API key logging or client exposure
- Generic upstream errors returned to the browser

Before broad public use, add server-side rate limiting, transactional bulk imports, password-reset UI, and automated end-to-end tests.

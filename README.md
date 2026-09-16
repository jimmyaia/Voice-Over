# Secure Voice Production Studio

This is the real API-powered demo. It translates an English training script into German, generates an OpenAI MP3, transcribes the result, compares the spoken output with the approved German script, and provides an AI-assisted naturalness review.

## Deploy to Vercel

1. Put this folder in a private GitHub repository.
2. In Vercel, choose **Add New > Project** and import that repository.
3. Open **Project Settings > Environment Variables**.
4. Add `OPENAI_API_KEY` and paste the key as its value. Select Production, Preview, and Development.
5. Click **Deploy**. If the project was already deployed, open **Deployments** and redeploy the latest deployment.

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

Before public or client-wide use, add user authentication, per-user rate limits, durable file storage, and a database-backed audit trail.

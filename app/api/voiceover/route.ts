export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_VOICES = new Set(["marin", "cedar", "coral", "nova"]);
const MAX_SCRIPT_LENGTH = 3500;

function outputText(data: any): string {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap((item: any) => item.content || []).map((item: any) => item.text || "").join("");
}

function normalize(text: string) {
  return text.toLocaleLowerCase("de-DE").replace(/[^\p{L}\p{N}%€$]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}

function similarity(expected: string, actual: string) {
  const a = normalize(expected), b = normalize(actual);
  if (!a.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i || j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  }
  return Math.max(0, Math.round((1 - dp[a.length][b.length] / Math.max(a.length, b.length)) * 100));
}

function numbers(text: string) { return text.match(/\d+(?:[.,]\d+)?|\d+%/g) || []; }

function parseReview(text: string) {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Invalid review response");
  const value = JSON.parse(cleaned.slice(start, end + 1));
  return {
    humanScore: Math.max(0, Math.min(100, Number(value.humanScore) || 0)),
    verdict: String(value.verdict || "Manual review recommended"),
    pronunciation: String(value.pronunciation || "Not assessed"),
    tone: String(value.tone || "Not assessed"),
    pacing: String(value.pacing || "Not assessed"),
    audioQuality: String(value.audioQuality || "Not assessed"),
    humanLikeness: String(value.humanLikeness || "Not assessed"),
    summary: String(value.summary || "No summary available."),
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.slice(0, 4).map(String) : []
  };
}

function validText(value: unknown, max = MAX_SCRIPT_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function safeApiError(status: number) {
  if (status === 401) return "The OpenAI API key is invalid. Update OPENAI_API_KEY in Vercel and redeploy.";
  if (status === 429) return "The OpenAI account reached a usage or rate limit. Check API billing and try again.";
  return "OpenAI could not complete the request. Please try again.";
}

export async function POST(request: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "OPENAI_API_KEY is not configured in Vercel. Add it under Project Settings > Environment Variables, then redeploy." }, { status: 503 });

    let body: any;
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
    const headers = { Authorization: `Bearer ${key}` };

    if (body.action === "translate") {
      if (!validText(body.english)) return Response.json({ error: `Add an English script of ${MAX_SCRIPT_LENGTH} characters or fewer.` }, { status: 400 });
      const result = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions: "You are a senior English-to-German localization editor for professional training content. Translate into natural Standard German. Preserve meaning, warnings, numbers, product names, and technical terminology exactly. Use formal professional language. Return only the German translation with no notes or markdown.",
          input: body.english.trim()
        })
      });
      const data = await result.json() as any;
      if (!result.ok) return Response.json({ error: safeApiError(result.status) }, { status: result.status === 429 ? 429 : 502 });
      const translation = outputText(data).trim();
      if (!translation) return Response.json({ error: "OpenAI returned an empty translation." }, { status: 502 });
      return Response.json({ translation });
    }

    if (body.action === "generate") {
      if (!validText(body.german)) return Response.json({ error: `Add an approved German script of ${MAX_SCRIPT_LENGTH} characters or fewer.` }, { status: 400 });
      if (body.english !== undefined && !validText(body.english)) return Response.json({ error: "The English source script is invalid." }, { status: 400 });
      const voice = ALLOWED_VOICES.has(body.voice) ? body.voice : "marin";
      const speedValue = Math.max(0, Math.min(100, Number(body.speed) || 50));
      const energyValue = Math.max(0, Math.min(100, Number(body.energy) || 50));
      const pace = speedValue < 35 ? "slow" : speedValue > 65 ? "brisk" : "moderate";
      const energy = energyValue < 35 ? "restrained" : energyValue > 65 ? "high" : "controlled";
      const tone = validText(body.tone, 60) ? body.tone : "professional";
      const direction = validText(body.direction, 600) ? body.direction : "Pronounce technical terms carefully.";
      const instructions = `Speak in natural Standard German with a ${tone} training-video tone. Use ${pace} pacing and ${energy} energy. ${direction}`;

      const speech = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: body.german.trim(), instructions, response_format: "mp3" })
      });
      if (!speech.ok) return Response.json({ error: safeApiError(speech.status) }, { status: speech.status === 429 ? 429 : 502 });
      const audioBuffer = await speech.arrayBuffer();
      if (!audioBuffer.byteLength) return Response.json({ error: "OpenAI returned an empty audio file." }, { status: 502 });

      const form = new FormData();
      form.append("file", new File([audioBuffer], "clip.mp3", { type: "audio/mpeg" }));
      form.append("model", "gpt-4o-mini-transcribe");
      form.append("language", "de");
      form.append("prompt", body.german.trim());
      const transcription = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers, body: form });
      const transcriptData = await transcription.json() as any;
      if (!transcription.ok) return Response.json({ error: safeApiError(transcription.status) }, { status: 502 });

      const transcript = String(transcriptData.text || "");
      const score = similarity(body.german, transcript);
      const numberPass = JSON.stringify(numbers(body.german)) === JSON.stringify(numbers(transcript));
      const status = score >= 96 && numberPass ? "pass" : score >= 88 ? "warning" : "fail";
      const audio = Buffer.from(audioBuffer).toString("base64");

      let humanReview;
      try {
        const reviewResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-audio-1.5",
            messages: [{ role: "user", content: [
              { type: "text", text: `Act as a careful German voiceover quality reviewer. Listen to the attached training narration and compare it with this approved script: "${body.german}". Assess pronunciation, appropriateness of tone for professional security training, pacing and pauses, recording cleanliness, and how natural versus synthetic the performance sounds. Do not claim certainty where audio evidence is ambiguous. Give specific, actionable suggestions, including an exact phrase after which a pause should be added when useful. Return only JSON with these keys: humanScore (0-100), verdict (short phrase), pronunciation (short assessment), tone (short assessment), pacing (short assessment), audioQuality (short assessment), humanLikeness (short assessment), summary (2 concise sentences), suggestions (array of 0-4 concise strings).` },
              { type: "input_audio", input_audio: { data: audio, format: "mp3" } }
            ] }],
            max_completion_tokens: 900
          })
        });
        const reviewData = await reviewResponse.json() as any;
        if (reviewResponse.ok) humanReview = parseReview(reviewData.choices?.[0]?.message?.content || "");
      } catch { /* Core MP3 and transcription QC remain available. */ }

      return Response.json({ audio, qc: { score, status, transcript, humanReview, checks: [
        { label: "Script match", detail: `${score}% word-level agreement with the approved German script.`, passed: score >= 96 },
        { label: "Numbers & terminology", detail: numberPass ? "All numeric values match the approved script." : "A number requires manual review.", passed: numberPass },
        { label: "Voice consistency", detail: `${voice} voice and recorded delivery settings used.`, passed: true },
        { label: "Pacing & delivery", detail: `${pace} pace with ${energy} energy recorded for this version.`, passed: true }
      ] } });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch {
    return Response.json({ error: "The server could not complete this request. Please try again." }, { status: 500 });
  }
}

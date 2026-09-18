"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  AudioLines,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileAudio,
  Languages,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Volume2,
  ArrowLeft,
} from "lucide-react";

const SAMPLE_ENGLISH =
  "Data security includes various techniques to prevent unauthorized access and ensure the safety of stored and transmitted data.";
const SAMPLE_GERMAN =
  "Datensicherheit umfasst verschiedene Techniken zur Verhinderung unbefugten Zugriffs und zur Gewährleistung der Sicherheit gespeicherter und übertragener Daten.";
type Stage = "script" | "voice" | "qc";
type HumanReview = {
  humanScore: number;
  verdict: string;
  pronunciation: string;
  tone: string;
  pacing: string;
  audioQuality: string;
  humanLikeness: string;
  summary: string;
  suggestions: string[];
};
type QcResult = {
  score: number;
  status: "pass" | "warning" | "fail";
  transcript: string;
  checks: { label: string; detail: string; passed: boolean }[];
  humanReview?: HumanReview;
};
type TimedFeedback = {
  id: string;
  start: number;
  end: number;
  category: string;
  comment: string;
};
type ApprovalTarget = "save" | "next" | null;

function audioDataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("The generated audio is no longer available. Please generate it again.");

  const mimeType = match[1] || "audio/mpeg";
  const bytes = match[2]
    ? Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(match[3]));

  return new Blob([bytes], { type: mimeType });
}

async function withTimeout<T>(operation: PromiseLike<T>, label: string, milliseconds = 20000) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out. Please try again.`)),
      milliseconds,
    );
  });

  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
const directionPresets = [
  "Professional",
  "Warm",
  "Authoritative",
  "Calm",
  "Flat",
];
const voiceOptions = ["marin", "cedar", "coral", "nova"];

export default function VoiceStudioPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [projectId, setProjectId] = useState("");
  const [clipId, setClipId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [clipSequence, setClipSequence] = useState(0);
  const [clipLabel, setClipLabel] = useState("Data Security Introduction");
  const [approved, setApproved] = useState(false);
  const [english, setEnglish] = useState(SAMPLE_ENGLISH);
  const [german, setGerman] = useState(SAMPLE_GERMAN);
  const [stage, setStage] = useState<Stage>("script");
  const [voice, setVoice] = useState("marin");
  const [tone, setTone] = useState("Professional");
  const [speed, setSpeed] = useState(50);
  const [energy, setEnergy] = useState(42);
  const [direction, setDirection] = useState(
    "Clear Standard German. Professional training-video delivery. Precise pronunciation with short, natural pauses.",
  );
  const [audioUrl, setAudioUrl] = useState("");
  const [qc, setQc] = useState<QcResult | null>(null);
  const [busy, setBusy] = useState<"translate" | "generate" | "apply" | "approve" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [approvalTarget, setApprovalTarget] = useState<ApprovalTarget>(null);
  const [approvalStep, setApprovalStep] = useState("");
  const [version, setVersion] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [feedbacks, setFeedbacks] = useState<TimedFeedback[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackStart, setFeedbackStart] = useState(0);
  const [feedbackEnd, setFeedbackEnd] = useState(0.2);
  const [feedbackCategory, setFeedbackCategory] = useState("More energetic");
  const [feedbackComment, setFeedbackComment] = useState("");
  const words = useMemo(
    () => german.trim().split(/\s+/).filter(Boolean).length,
    [german],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProject = params.get("project") || "";
    const requestedClip = params.get("clip") || "";
    setProjectId(requestedProject);
    setClipId(requestedClip);
    if (requestedProject && requestedClip) void loadClip(requestedProject, requestedClip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadClip(requestedProject: string, requestedClip: string) {
    setError("");
    const { data: project, error: projectError } = await supabase.from("projects").select("organization_id").eq("id", requestedProject).single();
    const { data: clip, error: clipError } = await supabase.from("clips").select("sequence,label,english_source,german_target,custom_direction,status").eq("id", requestedClip).eq("project_id", requestedProject).single();
    if (projectError || clipError || !project || !clip) {
      setError(projectError?.message || clipError?.message || "Clip could not be loaded.");
      return;
    }
    setOrganizationId(project.organization_id);
    setClipSequence(clip.sequence);
    setClipLabel(clip.label);
    setEnglish(clip.english_source);
    setGerman(clip.german_target);
    if (clip.custom_direction) setDirection(clip.custom_direction);
    setApproved(clip.status === "approved");
  }

  async function approveAudio(openNext: boolean) {
    if (!projectId || !clipId || !organizationId || !audioUrl || !qc) {
      setError("Generate and review the clip before approving it.");
      return;
    }
    setBusy("approve");
    setApprovalTarget(openNext ? "next" : "save");
    setApprovalStep("Preparing MP3…");
    setError("");
    let uploadedStoragePath = "";
    try {
      const { data: userData, error: userError } = await withTimeout(
        supabase.auth.getUser(),
        "Checking your session",
      );
      if (userError) throw userError;
      const userId = userData.user?.id;
      if (!userId) throw new Error("Your session expired. Please sign in again.");

      setApprovalStep("Checking version number…");
      const { data: latest, error: latestError } = await withTimeout(
        supabase.from("audio_versions").select("version_number").eq("clip_id", clipId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
        "Checking the latest version",
      );
      if (latestError) throw latestError;
      const versionNumber = (latest?.version_number || 0) + 1;
      const blob = audioDataUrlToBlob(audioUrl);
      const storagePath = `${organizationId}/${projectId}/clips/${clipId}/v${versionNumber}.mp3`;

      setApprovalStep("Uploading MP3…");
      const { error: uploadError } = await withTimeout(
        supabase.storage.from("voice-audio").upload(storagePath, blob, { contentType: blob.type || "audio/mpeg", upsert: false }),
        "Uploading the MP3",
        45000,
      );
      if (uploadError) throw uploadError;
      uploadedStoragePath = storagePath;

      setApprovalStep("Saving version and QC…");
      const { data: audioVersion, error: versionError } = await withTimeout(
        supabase.from("audio_versions").insert({ clip_id: clipId, version_number: versionNumber, script_version: 1, storage_path: storagePath, mime_type: blob.type || "audio/mpeg", byte_size: blob.size, duration_seconds: duration || null, voice, tone, speed, energy, direction, qc_status: qc.status, qc_score: qc.score, transcript: qc.transcript || null, created_by: userId }).select("id").single(),
        "Saving the audio version",
      );
      if (versionError || !audioVersion) throw versionError || new Error("Audio version was not saved.");

      setApprovalStep("Marking clip approved…");
      const { error: clipError } = await withTimeout(
        supabase.from("clips").update({ status: "approved", current_audio_version_id: audioVersion.id, approved_audio_version_id: audioVersion.id, custom_direction: direction, updated_at: new Date().toISOString() }).eq("id", clipId),
        "Approving the clip",
      );
      if (clipError) throw clipError;

      const { error: approvalError } = await withTimeout(
        supabase.from("clip_approvals").insert({ clip_id: clipId, audio_version_id: audioVersion.id, decision: "approved", decided_by: userId }),
        "Saving the approval record",
      );
      if (approvalError) throw approvalError;

      const { data: savedClip, error: verifyError } = await withTimeout(
        supabase.from("clips").select("status,current_audio_version_id,approved_audio_version_id").eq("id", clipId).single(),
        "Verifying the saved clip",
      );
      if (verifyError || savedClip?.status !== "approved" || savedClip.current_audio_version_id !== audioVersion.id) {
        throw verifyError || new Error("The save could not be verified. Please try again.");
      }

      setVersion(versionNumber);
      setApproved(true);
      setApprovalStep("Approved and saved.");
      if (openNext) {
        const { data: nextClip } = await supabase.from("clips").select("id").eq("project_id", projectId).gt("sequence", clipSequence).neq("status", "approved").order("sequence").limit(1).maybeSingle();
        if (nextClip) {
          router.push(`/studio?project=${projectId}&clip=${nextClip.id}`);
          return;
        }
      }
      router.push(`/projects/${projectId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The audio could not be approved.";
      const lowerMessage = message.toLowerCase();
      const help = lowerMessage.includes("bucket")
        ? " The private Supabase Storage bucket named voice-audio is missing."
        : lowerMessage.includes("row-level security") || lowerMessage.includes("policy")
          ? " Supabase storage/database permissions need to be applied."
          : "";
      setError(`${approvalStep || "Approval"} failed: ${message}.${help}`.replace("..", "."));

      // If the upload succeeded but the database write did not, remove the orphaned
      // file so the same version can be retried without a duplicate-path error.
      if (uploadedStoragePath) {
        await supabase.storage.from("voice-audio").remove([uploadedStoragePath]);
      }
    } finally {
      setBusy(null);
      setApprovalTarget(null);
      setApprovalStep("");
    }
  }

  async function translate() {
    setBusy("translate");
    setError("");
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "translate", english }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Translation failed");
      setGerman(data.translation);
      setStage("voice");
      setQc(null);
      setAudioUrl("");
      setVersion(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setBusy(null);
    }
  }
  async function generate(directionOverride: unknown = direction) {
    const appliedDirection =
      typeof directionOverride === "string" ? directionOverride : direction;
    setBusy("generate");
    setError("");
    setQc(null);
    setAudioUrl("");
    setFeedbacks([]);
    setFeedbackOpen(false);
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          english,
          german,
          voice,
          tone,
          speed,
          energy,
          direction: appliedDirection,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Audio generation failed");
      setAudioUrl(`data:audio/mpeg;base64,${data.audio}`);
      setQc(data.qc);
      setVersion((value) => value + 1);
      setStage("qc");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio generation failed");
    } finally {
      setBusy(null);
    }
  }
  async function applySuggestions(suggestions: string[]) {
    setBusy("apply");
    setError("");
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply_suggestions",
          german,
          direction,
          suggestions,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not apply suggestions");
      setDirection(data.direction);
      await generate(data.direction);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not apply suggestions",
      );
      setBusy(null);
    }
  }
  function openTimedFeedback() {
    const start = Number(currentTime.toFixed(1));
    setFeedbackStart(start);
    setFeedbackEnd(
      Number(Math.min(duration || start + 0.2, start + 0.2).toFixed(1)),
    );
    setFeedbackOpen(true);
  }
  function saveTimedFeedback() {
    if (
      !Number.isFinite(feedbackStart) ||
      !Number.isFinite(feedbackEnd) ||
      feedbackStart < 0 ||
      feedbackEnd <= feedbackStart ||
      (duration > 0 && feedbackEnd > duration)
    ) {
      setError("Feedback end time must be after its start time.");
      return;
    }
    setFeedbacks((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        start: feedbackStart,
        end: feedbackEnd,
        category: feedbackCategory,
        comment: feedbackComment.trim().slice(0, 500),
      },
    ]);
    setFeedbackComment("");
    setFeedbackOpen(false);
    setError("");
  }
  function seekFeedback(item: TimedFeedback) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = item.start;
    void audioRef.current.play();
  }
  function seekTime(value: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, value));
    setCurrentTime(audioRef.current.currentTime);
  }

  return (
    <main className="min-h-screen bg-[#07110e] text-[#eef8f3]">
      <header className="border-b border-white/10 bg-[#091713]/90 px-5 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#80f0bd] text-[#07110e]">
              <AudioLines size={22} strokeWidth={2.4} />
            </span>
            <div>
              <p className="font-semibold tracking-tight">
                Voice Production Studio
              </p>
              <p className="text-xs text-[#8ea99e]">
                Client demo · German training audio
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#80f0bd]/20 bg-[#80f0bd]/8 px-3 py-1.5 text-xs text-[#a6f5cf] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#80f0bd]" />
            Secure API project
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-73px)] border-r border-white/10 px-5 py-7 lg:block">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[.16em] text-[#678277]">
            Workflow
          </p>
          {[
            ["script", "01", "Script & translation"],
            ["voice", "02", "Voice direction"],
            ["qc", "03", "Quality control"],
          ].map(([id, n, label]) => {
            const active = stage === id;
            return (
              <button
                key={id}
                onClick={() => setStage(id as Stage)}
                className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${active ? "bg-white/10 text-white" : "text-[#87a197] hover:bg-white/5"}`}
              >
                <span
                  className={`grid h-7 w-7 place-items-center rounded-lg text-xs ${active ? "bg-[#80f0bd] font-bold text-[#07110e]" : "border border-white/10"}`}
                >
                  {n}
                </span>
                {label}
              </button>
            );
          })}
          <div className="mt-9 rounded-2xl border border-white/10 bg-white/[.035] p-4">
            <p className="text-xs font-semibold text-[#c6dbd2]">
              Project output
            </p>
            <div className="mt-3 flex items-center gap-3 text-sm text-[#8ea99e]">
              <FileAudio size={18} />
              MP3 · German
            </div>
            <div className="mt-2 flex items-center gap-3 text-sm text-[#8ea99e]">
              <ShieldCheck size={18} />
              QC report
            </div>
          </div>
        </aside>
        <section className="min-w-0 px-4 py-6 sm:px-7 md:py-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-sm font-medium text-[#80f0bd]">
                  Clip 01 · Version {Math.max(version, 1)}
                </p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {clipLabel}
                </h1>
              </div>
              <div className="flex rounded-xl border border-white/10 bg-white/[.035] p-1 text-xs">
                {(["script", "voice", "qc"] as Stage[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setStage(item)}
                    className={`rounded-lg px-3 py-2 capitalize ${stage === item ? "bg-white/12 text-white" : "text-[#789187]"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            {stage === "script" && (
              <div className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-2">
                  <ScriptCard
                    label="Source script"
                    language="English · Source of truth"
                    value={english}
                    onChange={setEnglish}
                  />
                  <ScriptCard
                    label="Localized script"
                    language="German · Standard (de-DE)"
                    value={german}
                    onChange={(v) => {
                      setGerman(v);
                      setQc(null);
                      setAudioUrl("");
                    }}
                    accent
                  />
                </div>
                <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[.035] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#8cb5ff]/12 text-[#a8c7ff]">
                      <Languages size={20} />
                    </span>
                    <div>
                      <p className="text-sm font-medium">
                        Meaning-preserving translation
                      </p>
                      <p className="text-xs text-[#789187]">
                        Formal training language · technical terms protected
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={translate}
                    disabled={!!busy || !english.trim()}
                    className="primary-btn"
                  >
                    {busy === "translate" ? (
                      <LoaderCircle className="animate-spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}
                    Translate & review
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
            {stage === "voice" && (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="panel p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Voice direction</h2>
                      <p className="mt-1 text-sm text-[#789187]">
                        Control how this clip should sound.
                      </p>
                    </div>
                    <Volume2 className="text-[#80f0bd]" />
                  </div>
                  <label className="field-label">Delivery style</label>
                  <div className="mb-6 flex flex-wrap gap-2">
                    {directionPresets.map((item) => (
                      <button
                        key={item}
                        onClick={() => setTone(item)}
                        className={`choice ${tone === item ? "choice-active" : ""}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="mb-6 grid gap-5 sm:grid-cols-2">
                    <RangeField
                      label="Speaking pace"
                      left="Slower"
                      right="Faster"
                      value={speed}
                      setValue={setSpeed}
                    />
                    <RangeField
                      label="Energy"
                      left="Reserved"
                      right="Expressive"
                      value={energy}
                      setValue={setEnergy}
                    />
                  </div>
                  <label className="field-label" htmlFor="direction">
                    Custom directions · English
                  </label>
                  <textarea
                    id="direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    maxLength={600}
                    className="script-area min-h-28"
                  />
                  <p className="mt-2 text-xs leading-5 text-[#60786e]">
                    Write production guidance in natural English. German phrases
                    may be quoted only to identify exact locations.
                  </p>
                </div>
                <div className="space-y-5">
                  <div className="panel p-5">
                    <label className="field-label" htmlFor="voice">
                      AI voice
                    </label>
                    <select
                      id="voice"
                      value={voice}
                      onChange={(e) => setVoice(e.target.value)}
                      className="input-control capitalize"
                    >
                      {voiceOptions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <div className="mt-5 rounded-xl bg-[#80f0bd]/8 p-4 text-sm text-[#b9d5c9]">
                      <p className="font-medium text-[#a6f5cf]">
                        German script locked
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#789187]">
                        {words} words · approximately{" "}
                        {Math.max(8, Math.round(words / 2.1))} seconds
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={generate}
                    disabled={!!busy || !german.trim()}
                    className="primary-btn w-full justify-center py-3.5"
                  >
                    {busy === "generate" ? (
                      <LoaderCircle className="animate-spin" size={18} />
                    ) : (
                      <AudioLines size={18} />
                    )}{" "}
                    {busy === "generate"
                      ? "Generating & checking…"
                      : "Generate voiceover"}
                  </button>
                </div>
              </div>
            )}
            {stage === "qc" && (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-5">
                  <div className="panel overflow-hidden">
                    <div className="border-b border-white/10 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#789187]">
                        Generated output
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">
                        German voiceover · v{Math.max(version, 1)}
                      </h2>
                    </div>
                    <div className="p-5">
                      {audioUrl ? (
                        <>
                          <audio
                            ref={audioRef}
                            className="w-full accent-[#80f0bd]"
                            controls
                            src={audioUrl}
                            onLoadedMetadata={(event) =>
                              setDuration(event.currentTarget.duration)
                            }
                            onTimeUpdate={(event) =>
                              setCurrentTime(event.currentTarget.currentTime)
                            }
                          />
                          <EditorTimeline
                            duration={duration}
                            currentTime={currentTime}
                            feedbacks={feedbacks}
                            onSeek={seekTime}
                            onFeedback={seekFeedback}
                          />
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/15 p-7 text-center text-sm text-[#789187]">
                          Generate a voiceover to hear the clip.
                        </div>
                      )}
                      <p className="mt-5 rounded-xl bg-white/[.035] p-4 text-sm leading-6 text-[#b8ccc4]">
                        {german}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {audioUrl && (
                          <a
                            href={audioUrl}
                            download={`german-training-clip-v${Math.max(version, 1)}.mp3`}
                            className="secondary-btn"
                          >
                            <Download size={16} />
                            Download MP3
                          </a>
                        )}
                        <button
                          onClick={() => setStage("voice")}
                          className="secondary-btn"
                        >
                          <RotateCcw size={16} />
                          Adjust delivery
                        </button>
                        {audioUrl && (
                          <button
                            type="button"
                            onClick={openTimedFeedback}
                            className="secondary-btn"
                          >
                            <MessageSquarePlus size={16} />
                            Add timed feedback
                          </button>
                        )}
                      </div>
                      {feedbackOpen && (
                        <FeedbackForm
                          start={feedbackStart}
                          end={feedbackEnd}
                          duration={duration}
                          category={feedbackCategory}
                          comment={feedbackComment}
                          setStart={setFeedbackStart}
                          setEnd={setFeedbackEnd}
                          setCategory={setFeedbackCategory}
                          setComment={setFeedbackComment}
                          onSave={saveTimedFeedback}
                          onCancel={() => setFeedbackOpen(false)}
                        />
                      )}{" "}
                      {feedbacks.length > 0 && (
                        <FeedbackList
                          items={feedbacks}
                          onSeek={seekFeedback}
                          onDelete={(id) =>
                            setFeedbacks((items) =>
                              items.filter((item) => item.id !== id),
                            )
                          }
                        />
                      )}{" "}
                      {audioUrl && qc && (
                        <div className="mt-5 rounded-2xl border border-[#80f0bd]/25 bg-[#80f0bd]/8 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-[#b9f8da]">{approved ? "This clip is approved" : "Ready to finalize"}</p>
                              <p className="mt-1 text-xs text-[#789187]">Approval saves the MP3 to the project and adds its link to the dashboard.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {projectId && <button type="button" className="secondary-btn" onClick={() => router.push(`/projects/${projectId}`)}><ArrowLeft size={16}/> Back to project</button>}
                              {!approved && <button type="button" className="secondary-btn" disabled={!!busy} onClick={() => void approveAudio(false)}>{approvalTarget === "save" ? <LoaderCircle className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} {approvalTarget === "save" ? approvalStep || "Saving…" : "Approve & save"}</button>}
                              {!approved && <button type="button" className="primary-btn" disabled={!!busy} onClick={() => void approveAudio(true)}>{approvalTarget === "next" ? <LoaderCircle className="animate-spin" size={16}/> : <ChevronRight size={16}/>} {approvalTarget === "next" ? approvalStep || "Saving…" : "Approve & next clip"}</button>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {qc?.humanReview && (
                    <HumanReviewCard
                      key={version}
                      review={qc.humanReview}
                      busy={busy === "apply" || busy === "generate"}
                      onApply={applySuggestions}
                    />
                  )}{" "}
                  {qc?.transcript && (
                    <div className="panel p-5">
                      <p className="field-label">What the audio said</p>
                      <p className="text-sm leading-6 text-[#b8ccc4]">
                        {qc.transcript}
                      </p>
                    </div>
                  )}
                </div>
                <div className="panel p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#789187]">
                        Automated QC
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">
                        Content integrity
                      </h2>
                    </div>
                    <div
                      className={`grid h-16 w-16 place-items-center rounded-full border-4 ${qc?.status === "pass" ? "border-[#80f0bd] text-[#80f0bd]" : "border-[#f7c56b] text-[#f7c56b]"}`}
                    >
                      <span className="text-lg font-bold">
                        {qc?.score ?? "—"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-6 space-y-3">
                    {(qc?.checks ?? defaultChecks).map((check) => (
                      <div
                        key={check.label}
                        className="flex gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3.5"
                      >
                        <span
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.passed ? "bg-[#80f0bd] text-[#07110e]" : "bg-[#f7c56b] text-[#3c2b0d]"}`}
                        >
                          <Check size={13} strokeWidth={3} />
                        </span>
                        <div>
                          <p className="text-sm font-medium">{check.label}</p>
                          <p className="mt-0.5 text-xs leading-5 text-[#789187]">
                            {check.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-xl border border-[#80f0bd]/20 bg-[#80f0bd]/8 p-4">
                    <p className="text-sm font-semibold text-[#a6f5cf]">
                      {qc
                        ? qc.status === "pass"
                          ? "Ready for internal approval"
                          : "Manual review recommended"
                        : "Waiting for generated audio"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#789187]">
                      Every regenerated version runs through QC again.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200"
              >
                {error}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

const defaultChecks = [
  {
    label: "Script match",
    detail: "German audio will be transcribed and compared.",
    passed: true,
  },
  {
    label: "Numbers & terminology",
    detail: "Protected terms and numeric values will be checked.",
    passed: true,
  },
  {
    label: "Pacing & delivery",
    detail: "Voice settings are recorded with this version.",
    passed: true,
  },
];
function ScriptCard({
  label,
  language,
  value,
  onChange,
  accent = false,
}: {
  label: string;
  language: string;
  value: string;
  onChange: (v: string) => void;
  accent?: boolean;
}) {
  return (
    <div
      className={`panel p-5 sm:p-6 ${accent ? "ring-1 ring-[#80f0bd]/25" : ""}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#789187]">
            {label}
          </p>
          <p className="mt-1 text-sm text-[#b8ccc4]">{language}</p>
        </div>
        {accent && (
          <span className="rounded-full bg-[#80f0bd]/10 px-2.5 py-1 text-[11px] font-semibold text-[#a6f5cf]">
            Editable
          </span>
        )}
      </div>
      <textarea
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="script-area min-h-52"
      />
      <p className="mt-3 text-right text-xs text-[#60786e]">
        {value.length} characters
      </p>
    </div>
  );
}
function RangeField({
  label,
  left,
  right,
  value,
  setValue,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  setValue: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex justify-between">
        <label className="field-label mb-0">{label}</label>
        <span className="text-xs font-semibold text-[#80f0bd]">{value}%</span>
      </div>
      <input
        aria-label={label}
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-[#80f0bd]"
      />
      <div className="mt-1 flex justify-between text-[11px] text-[#60786e]">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}
function HumanReviewCard({
  review,
  busy,
  onApply,
}: {
  review: HumanReview;
  busy: boolean;
  onApply: (suggestions: string[]) => void;
}) {
  const rows = [
    ["Pronunciation", review.pronunciation],
    ["Tone", review.tone],
    ["Pacing", review.pacing],
    ["Audio quality", review.audioQuality],
    ["Human likeness", review.humanLikeness],
  ];
  const [selected, setSelected] = useState<number[]>(() =>
    review.suggestions.map((_, i) => i),
  );
  function toggle(index: number) {
    setSelected((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index],
    );
  }
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#d8a7ff]">
            Human Voice Review
          </p>
          <h2 className="mt-1 text-lg font-semibold">{review.verdict}</h2>
        </div>
        <div className="rounded-xl bg-[#d8a7ff]/10 px-3 py-2 text-center">
          <p className="text-xl font-bold text-[#e4c1ff]">
            {review.humanScore}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-[#9e7ab8]">
            natural
          </p>
        </div>
      </div>
      <div className="p-5">
        <p className="mb-4 text-sm leading-6 text-[#c7d9d1]">
          {review.summary}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/[.035] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#718b80]">
                {label}
              </p>
              <p className="mt-1 text-sm text-[#c3d7ce]">{value}</p>
            </div>
          ))}
        </div>
        {review.suggestions.length > 0 && (
          <div className="mt-4 rounded-xl border border-[#d8a7ff]/15 bg-[#d8a7ff]/7 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#d8a7ff]">
                Suggestions to sound more human
              </p>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.length === review.suggestions.length
                      ? []
                      : review.suggestions.map((_, i) => i),
                  )
                }
                className="text-xs font-semibold text-[#d8a7ff]"
              >
                {selected.length === review.suggestions.length
                  ? "Clear all"
                  : "Select all"}
              </button>
            </div>
            <ul className="mt-3 space-y-3 text-sm leading-5 text-[#b8ccc4]">
              {review.suggestions.map((item, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer gap-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(i)}
                      onChange={() => toggle(i)}
                      className="mt-1 accent-[#d8a7ff]"
                    />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() =>
                onApply(selected.map((index) => review.suggestions[index]))
              }
              className="primary-btn mt-4 w-full justify-center"
            >
              {busy ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              Apply selected & generate new version
            </button>
            <p className="mt-2 text-center text-[11px] leading-4 text-[#718b80]">
              Updates delivery instructions only. Approved German wording stays
              unchanged.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00.0";
  const minutes = Math.floor(value / 60);
  const seconds = (value % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function FeedbackForm({
  start,
  end,
  duration,
  category,
  comment,
  setStart,
  setEnd,
  setCategory,
  setComment,
  onSave,
  onCancel,
}: {
  start: number;
  end: number;
  duration: number;
  category: string;
  comment: string;
  setStart: (value: number) => void;
  setEnd: (value: number) => void;
  setCategory: (value: string) => void;
  setComment: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const categories = [
    "More energetic",
    "Less energetic",
    "Slower",
    "Faster",
    "Add pause",
    "Change pronunciation",
    "Other",
  ];
  return (
    <div className="mt-4 rounded-xl border border-[#d8a7ff]/20 bg-[#d8a7ff]/7 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[#e4c1ff]">
            Add timeline feedback
          </p>
          <p className="mt-1 text-xs text-[#789187]">
            Describe exactly how this section should change.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold text-[#9e7ab8]"
        >
          Cancel
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[#8ea99e]">
          Start time (seconds)
          <input
            type="number"
            min="0"
            max={duration || undefined}
            step="0.1"
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
            className="input-control mt-1"
          />
        </label>
        <label className="text-xs text-[#8ea99e]">
          End time (seconds)
          <input
            type="number"
            min="0"
            max={duration || undefined}
            step="0.1"
            value={end}
            onChange={(event) => setEnd(Number(event.target.value))}
            className="input-control mt-1"
          />
        </label>
      </div>
      <label className="mt-3 block text-xs text-[#8ea99e]">
        Feedback type
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="input-control mt-1"
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs text-[#8ea99e]">
        Comment
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Example: Keep this professional, but add slightly more energy to this phrase."
          className="script-area mt-1 min-h-20"
        />
      </label>
      <button type="button" onClick={onSave} className="primary-btn mt-3">
        <Check size={16} />
        Save timed feedback
      </button>
    </div>
  );
}

function FeedbackList({
  items,
  onSeek,
  onDelete,
}: {
  items: TimedFeedback[];
  onSeek: (item: TimedFeedback) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      <p className="field-label">Timeline feedback · {items.length}</p>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3"
        >
          <button
            type="button"
            onClick={() => onSeek(item)}
            className="shrink-0 rounded-lg bg-[#d8a7ff]/12 px-2.5 py-1.5 text-xs font-semibold text-[#e4c1ff]"
          >
            {formatTime(item.start)}–{formatTime(item.end)}
          </button>
          <button
            type="button"
            onClick={() => onSeek(item)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-sm font-medium text-[#dcece5]">
              {item.category}
            </p>
            {item.comment && (
              <p className="mt-1 text-xs leading-5 text-[#789187]">
                {item.comment}
              </p>
            )}
          </button>
          <button
            type="button"
            aria-label="Delete feedback"
            onClick={() => onDelete(item.id)}
            className="p-1.5 text-[#789187] hover:text-red-300"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function EditorTimeline({
  duration,
  currentTime,
  feedbacks,
  onSeek,
  onFeedback,
}: {
  duration: number;
  currentTime: number;
  feedbacks: TimedFeedback[];
  onSeek: (value: number) => void;
  onFeedback: (item: TimedFeedback) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const safeDuration = Math.max(0.1, duration || 0.1);
  const width = Math.max(100, Math.ceil(safeDuration * 90 * zoom));
  const ticks = Array.from(
    { length: Math.floor(safeDuration * 10) + 1 },
    (_, index) => index / 10,
  );
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-[#081510] p-3">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#a6f5cf]">
            Review timeline
          </p>
          <p className="mt-0.5 text-[11px] text-[#60786e]">
            Playhead {formatTime(currentTime)} · precision 0.1 sec
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[#789187]">
          Zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min="1"
            max="4"
            step=".5"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-24 accent-[#80f0bd]"
          />
        </label>
      </div>
      <div className="overflow-x-auto pb-2">
        <div
          className="relative h-24 min-w-full cursor-crosshair select-none rounded-lg bg-white/[.035]"
          style={{ width: `${width}px` }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onSeek(((event.clientX - rect.left) / rect.width) * safeDuration);
          }}
        >
          <div className="absolute inset-x-0 top-10 h-8 bg-[#80f0bd]/5" />
          {ticks.map((value) => {
            const whole = Math.abs(value - Math.round(value)) < 0.001;
            return (
              <div
                key={value}
                className="absolute top-0"
                style={{ left: `${(value / safeDuration) * 100}%` }}
              >
                <span
                  className={`block w-px ${whole ? "h-8 bg-white/35" : "h-4 bg-white/15"}`}
                />
                {whole && (
                  <span className="absolute left-1 top-1 text-[10px] text-[#789187]">
                    {Math.round(value)}s
                  </span>
                )}
              </div>
            );
          })}
          {feedbacks.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFeedback(item);
              }}
              title={`${formatTime(item.start)}–${formatTime(item.end)}: ${item.category}`}
              className="absolute top-11 h-6 rounded-md border border-[#d8a7ff]/70 bg-[#d8a7ff]/30"
              style={{
                left: `${(item.start / safeDuration) * 100}%`,
                width: `${Math.max(0.6, ((item.end - item.start) / safeDuration) * 100)}%`,
              }}
            />
          ))}
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-[#80f0bd] shadow-[0_0_8px_#80f0bd]"
            style={{ left: `${(currentTime / safeDuration) * 100}%` }}
          >
            <span className="absolute -left-1.5 top-0 h-0 w-0 border-x-[7px] border-t-[8px] border-x-transparent border-t-[#80f0bd]" />
          </div>
        </div>
      </div>
    </div>
  );
}

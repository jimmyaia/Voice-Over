import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ApprovalBody = {
  projectId?: string;
  clipId?: string;
  organizationId?: string;
  audioBase64?: string;
  mimeType?: string;
  duration?: number | null;
  voice?: string;
  tone?: string;
  speed?: number;
  energy?: number;
  direction?: string;
  qc?: { status?: string; score?: number; transcript?: string };
  versionNumber?: number;
  openNext?: boolean;
};

export async function POST(request: Request) {
  let uploadedStoragePath = "";
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !anonKey) throw new Error("Supabase is not configured on Vercel.");
    if (!token) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });

    const body = (await request.json()) as ApprovalBody;
    const { projectId, clipId, organizationId, audioBase64 } = body;
    if (!projectId || !clipId || !organizationId || !audioBase64) {
      return NextResponse.json({ error: "The project, clip, or generated audio is missing." }, { status: 400 });
    }

    const audio = Buffer.from(audioBase64, "base64");
    if (!audio.length) return NextResponse.json({ error: "The generated MP3 is empty." }, { status: 400 });
    if (audio.length > 20 * 1024 * 1024) return NextResponse.json({ error: "The generated MP3 is larger than 20 MB." }, { status: 413 });

    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,organization_id")
      .eq("id", projectId)
      .eq("organization_id", organizationId)
      .single();
    if (projectError || !project) throw new Error(projectError?.message || "Project access could not be verified.");

    const { data: clip, error: clipError } = await supabase
      .from("clips")
      .select("id,sequence,script_version")
      .eq("id", clipId)
      .eq("project_id", projectId)
      .single();
    if (clipError || !clip) throw new Error(clipError?.message || "Clip access could not be verified.");

    const { data: latest, error: latestError } = await supabase
      .from("audio_versions")
      .select("version_number")
      .eq("clip_id", clipId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error(`Version check failed: ${latestError.message}`);

    const requestedVersion = Number.isInteger(body.versionNumber) && (body.versionNumber || 0) > 0
      ? body.versionNumber as number
      : 1;
    const versionNumber = Math.max((latest?.version_number || 0) + 1, requestedVersion);
    const storagePath = `${organizationId}/${projectId}/clips/${clipId}/v${versionNumber}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("voice-audio")
      .upload(storagePath, audio, { contentType: body.mimeType || "audio/mpeg", upsert: false });
    if (uploadError) throw new Error(`MP3 upload failed: ${uploadError.message}`);
    uploadedStoragePath = storagePath;

    const { data: audioVersion, error: versionError } = await supabase
      .from("audio_versions")
      .insert({
        clip_id: clipId,
        version_number: versionNumber,
        script_version: clip.script_version || 1,
        storage_path: storagePath,
        mime_type: body.mimeType || "audio/mpeg",
        byte_size: audio.length,
        duration_seconds: body.duration || null,
        voice: body.voice || "marin",
        tone: body.tone || null,
        speed: body.speed ?? null,
        energy: body.energy ?? null,
        direction: body.direction || null,
        qc_status: body.qc?.status || null,
        qc_score: body.qc?.score ?? null,
        transcript: body.qc?.transcript || null,
        created_by: userData.user.id,
      })
      .select("id")
      .single();
    if (versionError || !audioVersion) throw new Error(`Version save failed: ${versionError?.message || "No record returned"}`);

    const { error: updateError } = await supabase
      .from("clips")
      .update({
        status: "approved",
        current_audio_version_id: audioVersion.id,
        approved_audio_version_id: audioVersion.id,
        custom_direction: body.direction || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clipId);
    if (updateError) throw new Error(`Clip approval failed: ${updateError.message}`);

    const { error: approvalError } = await supabase.from("clip_approvals").insert({
      clip_id: clipId,
      audio_version_id: audioVersion.id,
      decision: "approved",
      decided_by: userData.user.id,
    });
    if (approvalError) throw new Error(`Approval history failed: ${approvalError.message}`);

    let nextClipId: string | null = null;
    if (body.openNext) {
      const { data: nextClip } = await supabase
        .from("clips")
        .select("id")
        .eq("project_id", projectId)
        .gt("sequence", clip.sequence)
        .neq("status", "approved")
        .order("sequence")
        .limit(1)
        .maybeSingle();
      nextClipId = nextClip?.id || null;
    }

    return NextResponse.json({ ok: true, versionNumber, audioVersionId: audioVersion.id, nextClipId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The approved MP3 could not be saved." },
      { status: 500 },
    );
  }
}

"use client";

import { ArrowLeft, ChevronRight, Download, FileSpreadsheet, Play, Plus, Search, Upload } from "lucide-react";
import { use, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Project = { id: string; name: string; project_code: string; source_language: string; target_language: string; expected_clip_count: number | null; status: string };
type Clip = { id: string; clip_number: string; label: string; expected_filename: string; english_source: string; german_target: string; status: string; current_audio_version_id: string | null };
type AudioLink = { play: string; download: string; versionNumber: number };

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [audioLinks, setAudioLinks] = useState<Record<string, AudioLink>>({});

  useEffect(() => { void load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    const { data: projectRow, error: projectError } = await supabase.from("projects").select("id,name,project_code,source_language,target_language,expected_clip_count,status").eq("id", projectId).single();
    if (projectError) { setError(projectError.message); setLoading(false); return; }
    const { data: clipRows, error: clipError } = await supabase.from("clips").select("id,clip_number,label,expected_filename,english_source,german_target,status,current_audio_version_id").eq("project_id", projectId).order("sequence");
    if (clipError) setError(clipError.message);
    const loadedClips = (clipRows as Clip[]) || [];
    setProject(projectRow as Project); setClips(loadedClips);
    const versionIds = loadedClips.map((clip) => clip.current_audio_version_id).filter((id): id is string => Boolean(id));
    if (versionIds.length) {
      const { data: versions, error: versionsError } = await supabase.from("audio_versions").select("id,storage_path,version_number").in("id", versionIds);
      if (versionsError) setError(versionsError.message);
      const links: Record<string, AudioLink> = {};
      await Promise.all((versions || []).map(async (version) => {
        const { data: playData } = await supabase.storage.from("voice-audio").createSignedUrl(version.storage_path, 3600);
        const { data: downloadData } = await supabase.storage.from("voice-audio").createSignedUrl(version.storage_path, 3600, { download: true });
        if (playData?.signedUrl && downloadData?.signedUrl) links[version.id] = { play: playData.signedUrl, download: downloadData.signedUrl, versionNumber: version.version_number };
      }));
      setAudioLinks(links);
    }
    setLoading(false);
  }

  const visible = clips.filter((clip) => {
    const matchesStatus = status === "all" || clip.status === status;
    const text = `${clip.label} ${clip.expected_filename} ${clip.english_source} ${clip.german_target}`.toLowerCase();
    return matchesStatus && text.includes(query.toLowerCase());
  });
  const approved = clips.filter((clip) => clip.status === "approved").length;
  const changes = clips.filter((clip) => clip.status === "changes_requested").length;
  const ready = clips.filter((clip) => ["internal_qc", "awaiting_review", "approved"].includes(clip.status)).length;

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#07110e] text-[#8ea99e]">Loading project…</main>;
  if (!project || error) return <main className="grid min-h-screen place-items-center bg-[#07110e] p-6 text-red-200"><div><p>{error || "Project not found."}</p><a className="secondary-btn mt-5" href="/">Back to projects</a></div></main>;

  return <main className="min-h-screen bg-[#07110e] text-[#eef8f3]"><div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8">
    <a href="/" className="secondary-btn"><ArrowLeft size={16}/> Projects</a>
    <div className="mt-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#678277]">{project.project_code} / {project.target_language}</p><h1 className="mt-2 text-3xl font-semibold">{project.name}</h1><p className="mt-2 text-sm text-[#8ea99e]">{clips.length} clips · {project.source_language} → {project.target_language} · {project.status.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2"><button className="secondary-btn"><FileSpreadsheet size={16}/> Update spreadsheet</button><button className="primary-btn"><Plus size={16}/> Add clip</button></div></div>
    <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Total clips" value={String(clips.length)} detail={`Expected: ${project.expected_clip_count || "—"}`}/><Stat label="Ready for client" value={String(ready)} detail="Audio and QC complete"/><Stat label="Approved" value={String(approved)} detail={`${clips.length ? Math.round(approved / clips.length * 100) : 0}% of project`}/><Stat label="Changes requested" value={String(changes)} detail="Requires production action"/></section>
    <section className="panel mt-6 overflow-hidden"><div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row"><div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-[#081510] px-4 py-3 text-[#789187]"><Search size={17}/><input className="w-full bg-transparent text-sm text-white" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clip, filename, or script"/></div><select className="input-control md:w-52" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="approved">Approved</option><option value="awaiting_review">Awaiting review</option><option value="changes_requested">Changes requested</option><option value="audio_needed">Audio needed</option></select><button className="secondary-btn"><Upload size={16}/> Upload audio</button></div>
      <div className="flex items-center gap-4 border-b border-white/10 bg-white/[.025] px-4 py-3 text-xs text-[#789187]"><strong className="text-[#cfe0d9]">Project completion</strong><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#80f0bd]" style={{width:`${clips.length ? approved/clips.length*100 : 0}%`}}/></div><span>{approved} of {clips.length} approved</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="text-[10px] uppercase tracking-[.14em] text-[#678277]"><tr><th className="p-4">Clip</th><th className="p-4">English source</th><th className="p-4">German target</th><th className="p-4">Audio</th><th className="p-4">Status</th><th className="p-4"/></tr></thead><tbody>{visible.map((clip) => { const audio = clip.current_audio_version_id ? audioLinks[clip.current_audio_version_id] : undefined; return <tr key={clip.id} className="border-t border-white/10 hover:bg-white/[.025]"><td className="p-4"><strong>{clip.label}</strong><span className="mt-1 block text-xs text-[#678277]">{audio ? `Version ${audio.versionNumber} · ${clip.expected_filename}` : `Pending · ${clip.expected_filename}`}</span></td><td className="max-w-64 truncate p-4">{clip.english_source}</td><td className="max-w-64 truncate p-4">{clip.german_target}</td><td className="p-4 text-[#9bb5ab]">{audio ? <div className="flex gap-2"><a className="secondary-btn" href={audio.play} target="_blank" rel="noreferrer"><Play size={14}/> Play</a><a className="secondary-btn" href={audio.download}><Download size={14}/> MP3</a></div> : clip.current_audio_version_id ? "Loading audio…" : "No audio"}</td><td className="p-4"><span className="rounded-full bg-[#80f0bd]/10 px-3 py-1.5 text-xs font-semibold capitalize text-[#a7f6d0]">{clip.status === "audio_needed" ? "Pending" : clip.status.replaceAll("_", " ")}</span></td><td className="p-4"><a href={`/studio?project=${project.id}&clip=${clip.id}`} className="secondary-btn">Open <ChevronRight size={15}/></a></td></tr>; })}</tbody></table></div>
    </section>
  </div></main>;
}

function Stat({label,value,detail}:{label:string;value:string;detail:string}){return <div className="panel p-5"><p className="text-xs text-[#789187]">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs text-[#678277]">{detail}</p></div>}

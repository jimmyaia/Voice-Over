"use client";

import { AudioLines, ChevronRight, FileSpreadsheet, Languages, LogOut, Plus, Search, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ImportPreview = {
  clips: Array<{ sequence: number; clipNumber: string; label: string; expectedFilename: string; sourceRow: number; speaker: string; englishSource: string; germanTarget: string; direction: string }>;
  issues: Array<{ row: number; severity: "warning" | "error"; message: string }>;
  summary: { sourceRows: number; validClips: number; errors: number; warnings: number };
};
type Project = { id: string; name: string; project_code: string; source_language: string; target_language: string; expected_clip_count: number | null; status: string; updated_at: string };
type Workspace = { organization_id: string; role: string; organizationName: string };

export default function SuiteHome() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("jimmy@letsaiifyit.com");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [userId, setUserId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Voice Production Studio");
  const [projects, setProjects] = useState<Project[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [projectName, setProjectName] = useState("Secure App Training — German");
  const [projectCode, setProjectCode] = useState("SECURE_APP");
  const [expectedClips, setExpectedClips] = useState("143");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void initialize();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      setUserId(id);
      if (id) void loadWorkspace();
      else { setWorkspace(null); setProjects([]); setLoading(false); }
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function initialize() {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id ?? null;
    setUserId(id);
    if (id) await loadWorkspace(); else setLoading(false);
  }

  async function loadWorkspace() {
    setLoading(true);
    const { data, error: memberError } = await supabase.from("organization_members").select("organization_id, role, organizations(name)").limit(1).maybeSingle();
    if (memberError) setError(memberError.message);
    if (!data) { setWorkspace(null); setProjects([]); setLoading(false); return; }
    const organization = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
    setWorkspace({ organization_id: data.organization_id, role: data.role, organizationName: organization?.name || "Workspace" });
    const { data: rows, error: projectError } = await supabase.from("projects").select("id,name,project_code,source_language,target_language,expected_clip_count,status,updated_at").eq("organization_id", data.organization_id).order("updated_at", { ascending: false });
    if (projectError) setError(projectError.message);
    setProjects((rows as Project[]) || []);
    setLoading(false);
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const result = authMode === "signin" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (result.error) setError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setNotice("Account created. Check your email to confirm it, then sign in.");
    setBusy(false);
  }

  async function createWorkspace() {
    setBusy(true); setError("");
    const base = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voice-studio";
    const { error: rpcError } = await supabase.rpc("create_my_organization", { organization_name: workspaceName, organization_slug: `${base}-${crypto.randomUUID().slice(0, 8)}` });
    if (rpcError) setError(rpcError.message); else await loadWorkspace();
    setBusy(false);
  }

  async function previewImport() {
    if (!file) return setError("Choose a CSV file first.");
    setBusy(true); setError(""); setPreview(null);
    try {
      const form = new FormData(); form.set("file", file); form.set("projectCode", projectCode); form.set("targetLanguage", "DE");
      const response = await fetch("/api/import/preview", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import preview failed.");
      setPreview(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import preview failed."); }
    finally { setBusy(false); }
  }

  async function createProject() {
    if (!preview || !workspace || !userId) return;
    setBusy(true); setError("");
    const code = projectCode.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const { data: project, error: projectError } = await supabase.from("projects").insert({ organization_id: workspace.organization_id, name: projectName.trim(), project_code: code, source_language: "en-US", target_language: "de-DE", expected_clip_count: Number(expectedClips), status: "draft", created_by: userId }).select("id").single();
    if (projectError || !project) { setError(projectError?.message || "Project creation failed."); setBusy(false); return; }
    const rows = preview.clips.map((clip) => ({ project_id: project.id, sequence: clip.sequence, clip_number: clip.clipNumber, label: clip.label, expected_filename: clip.expectedFilename, source_row: clip.sourceRow, speaker: clip.speaker, english_source: clip.englishSource, german_target: clip.germanTarget, custom_direction: clip.direction || null, status: "audio_needed" }));
    const { error: clipError } = await supabase.from("clips").insert(rows);
    if (clipError) { await supabase.from("projects").delete().eq("id", project.id); setError(clipError.message); setBusy(false); return; }
    setImportOpen(false); setPreview(null); setFile(null); setNotice(`Created ${projectName} with ${rows.length} numbered clips.`);
    await loadWorkspace(); setBusy(false);
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#07110e] text-[#8ea99e]">Loading secure workspace…</main>;

  if (!userId) return (
    <main className="grid min-h-screen bg-[#07110e] text-[#eef8f3] lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#0b211b] p-14 lg:flex"><Brand /><div className="max-w-xl"><h1 className="text-5xl font-semibold leading-tight tracking-tight">Multilingual voice production, managed from one place.</h1><p className="mt-6 text-lg leading-8 text-[#9bb5ab]">Build projects, import scripts, generate voiceovers, verify quality, manage versions, and collect client approvals.</p><div className="mt-9 space-y-4 text-sm text-[#d6e8e0]"><p className="flex items-center gap-3"><Languages className="text-[#80f0bd]" size={19}/> Multilingual scripts and voice generation</p><p className="flex items-center gap-3"><ShieldCheck className="text-[#80f0bd]" size={19}/> QC, approvals, and complete audit history</p><p className="flex items-center gap-3"><FileSpreadsheet className="text-[#80f0bd]" size={19}/> Validated CSV project imports</p></div></div><p className="text-xs text-[#668278]">Secure production workspace</p></section>
      <section className="grid place-items-center p-6"><form onSubmit={authenticate} className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[.035] p-8"><div className="lg:hidden"><Brand /></div><h2 className="mt-8 text-3xl font-semibold lg:mt-0">{authMode === "signin" ? "Sign in" : "Create account"}</h2><p className="mt-2 text-sm text-[#8ea99e]">Access your production projects and client reviews.</p><label className="field-label mt-8">Email address</label><input className="input-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required/><label className="field-label mt-5">Password</label><input className="input-control" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required/>{error && <Alert type="error">{error}</Alert>}{notice && <Alert>{notice}</Alert>}<button className="primary-btn mt-6 w-full justify-center" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</button><button className="mt-4 w-full text-sm text-[#9bb5ab] hover:text-white" type="button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{authMode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}</button></form></section>
    </main>
  );

  if (!workspace) return <main className="grid min-h-screen place-items-center bg-[#07110e] p-6 text-[#eef8f3]"><section className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[.035] p-8"><Brand/><h1 className="mt-8 text-3xl font-semibold">Create your workspace</h1><p className="mt-2 text-sm text-[#8ea99e]">This becomes your first secure tenant. You can add client organizations later.</p><label className="field-label mt-7">Workspace name</label><input className="input-control" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)}/>{error && <Alert type="error">{error}</Alert>}<button className="primary-btn mt-6" disabled={busy || !workspaceName.trim()} onClick={createWorkspace}>{busy ? "Creating…" : "Create secure workspace"}</button><button className="secondary-btn ml-3 mt-6" onClick={() => supabase.auth.signOut()}>Sign out</button></section></main>;

  return (
    <main className="min-h-screen bg-[#07110e] text-[#eef8f3]">
      <header className="border-b border-white/10 bg-[#091713] px-5 py-4 md:px-8"><div className="mx-auto flex max-w-[1440px] items-center justify-between"><Brand/><button className="secondary-btn" onClick={() => supabase.auth.signOut()}><LogOut size={16}/> Sign out</button></div></header>
      <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#678277]">{workspace.organizationName} · {workspace.role}</p><h1 className="mt-2 text-3xl font-semibold">Projects</h1><p className="mt-2 text-sm text-[#8ea99e]">Open a project or import a new production spreadsheet.</p></div><button className="primary-btn" onClick={() => setImportOpen(true)}><Plus size={17}/> Create project</button></div>{notice && <Alert>{notice}</Alert>}{error && <Alert type="error">{error}</Alert>}<div className="mt-7 flex max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-white/[.035] px-4 py-3 text-[#789187]"><Search size={17}/><input className="w-full bg-transparent text-sm text-white" placeholder="Search projects or clients"/></div><section className="mt-6 space-y-3">{projects.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-[#8ea99e]">No projects yet. Create your first project from a CSV spreadsheet.</div>}{projects.map((project) => <a key={project.id} href={`/projects/${project.id}`} className="grid gap-4 rounded-2xl border border-white/10 bg-white/[.035] p-5 hover:border-[#80f0bd]/50 md:grid-cols-[minmax(230px,1.5fr)_130px_150px_160px_24px] md:items-center"><div><h2 className="font-semibold">{project.name}</h2><p className="mt-1 text-xs text-[#789187]">{project.project_code}</p></div><Metric label="Languages" value={`${project.source_language} → ${project.target_language}`}/><Metric label="Expected clips" value={String(project.expected_clip_count || "—")}/><span className="w-fit rounded-full bg-[#80f0bd]/10 px-3 py-1.5 text-xs font-semibold capitalize text-[#a7f6d0]">{project.status.replaceAll("_", " ")}</span><ChevronRight size={18} className="text-[#678277]"/></a>)}</section></div>
      {importOpen && <ImportDialog busy={busy} error={error} expectedClips={expectedClips} file={file} preview={preview} projectCode={projectCode} projectName={projectName} setError={setError} setExpectedClips={setExpectedClips} setFile={setFile} setImportOpen={setImportOpen} setPreview={setPreview} setProjectCode={setProjectCode} setProjectName={setProjectName} previewImport={previewImport} createProject={createProject}/>} 
    </main>
  );
}

function ImportDialog(props: { busy: boolean; error: string; expectedClips: string; file: File | null; preview: ImportPreview | null; projectCode: string; projectName: string; setError: (v:string)=>void; setExpectedClips:(v:string)=>void; setFile:(v:File|null)=>void; setImportOpen:(v:boolean)=>void; setPreview:(v:ImportPreview|null)=>void; setProjectCode:(v:string)=>void; setProjectName:(v:string)=>void; previewImport:()=>void; createProject:()=>void }) {
  const p = props;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1713] p-6 md:p-8"><div className="flex justify-between gap-5"><div><h2 className="text-2xl font-semibold">Create project from CSV</h2><p className="mt-2 text-sm text-[#8ea99e]">Clip numbers and filenames are assigned before saving.</p></div><button className="secondary-btn" onClick={() => { p.setImportOpen(false); p.setPreview(null); p.setError(""); }}>Close</button></div><div className="mt-7 grid gap-5 md:grid-cols-3"><Field label="Project name" value={p.projectName} setValue={p.setProjectName}/><Field label="Project code" value={p.projectCode} setValue={p.setProjectCode}/><Field label="Expected clips" value={p.expectedClips} setValue={(v) => p.setExpectedClips(v.replace(/\D/g,""))}/></div><div className="mt-5 rounded-xl border border-dashed border-white/15 p-5"><label className="field-label">CSV spreadsheet</label><input type="file" accept=".csv,text/csv" onChange={(e) => p.setFile(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[#80f0bd] file:px-4 file:py-2 file:font-semibold"/><p className="mt-3 text-xs text-[#678277]">Required: English Source and German Target.</p></div>{p.error && <Alert type="error">{p.error}</Alert>}<button className="primary-btn mt-5" disabled={p.busy || !p.file} onClick={p.previewImport}>{p.busy ? "Checking CSV…" : "Validate and preview"}</button>{p.preview && <div className="mt-7"><div className="grid gap-3 sm:grid-cols-4"><Summary label="Source rows" value={p.preview.summary.sourceRows}/><Summary label="Valid clips" value={p.preview.summary.validClips}/><Summary label="Errors" value={p.preview.summary.errors}/><Summary label="Warnings" value={p.preview.summary.warnings}/></div>{Number(p.expectedClips) !== p.preview.clips.length && <Alert type="warning">Expected {p.expectedClips || 0} clips, but found {p.preview.clips.length}.</Alert>}<div className="mt-5 overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[820px] text-left text-sm"><thead className="text-[11px] uppercase text-[#789187]"><tr><th className="p-3">Clip</th><th className="p-3">Row</th><th className="p-3">Filename</th><th className="p-3">English</th><th className="p-3">German</th></tr></thead><tbody>{p.preview.clips.slice(0,12).map((clip) => <tr key={clip.clipNumber} className="border-t border-white/10"><td className="p-3 font-semibold">{clip.label}</td><td className="p-3">{clip.sourceRow}</td><td className="p-3 text-xs text-[#a7f6d0]">{clip.expectedFilename}</td><td className="max-w-56 truncate p-3">{clip.englishSource}</td><td className="max-w-56 truncate p-3">{clip.germanTarget}</td></tr>)}</tbody></table></div><div className="mt-5 flex justify-between gap-4"><p className="text-xs text-[#678277]">Showing 12 of {p.preview.clips.length}.</p><button className="primary-btn" onClick={p.createProject} disabled={p.busy || p.preview.summary.errors > 0 || Number(p.expectedClips) !== p.preview.clips.length}>{p.busy ? "Creating…" : `Create ${p.preview.clips.length} clips`}</button></div></div>}</section></div>;
}

function Brand(){return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#80f0bd] text-[#07110e]"><AudioLines size={22}/></span><div><p className="font-semibold">Voice Production Studio</p><p className="text-xs text-[#789187]">Multilingual production suite</p></div></div>}
function Metric({label,value}:{label:string;value:string}){return <div><p className="text-[10px] font-semibold uppercase text-[#678277]">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>}
function Summary({label,value}:{label:string;value:number}){return <div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-[#789187]">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>}
function Field({label,value,setValue}:{label:string;value:string;setValue:(v:string)=>void}){return <div><label className="field-label">{label}</label><input className="input-control" value={value} onChange={(e)=>setValue(e.target.value)}/></div>}
function Alert({children,type="success"}:{children:React.ReactNode;type?:"success"|"warning"|"error"}){const color=type==="error"?"border-red-400/20 bg-red-400/10 text-red-200":type==="warning"?"border-amber-300/20 bg-amber-300/10 text-amber-100":"border-[#80f0bd]/20 bg-[#80f0bd]/10 text-[#b9f8da]";return <div className={`mt-5 rounded-xl border p-4 text-sm ${color}`}>{children}</div>}

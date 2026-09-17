-- Voice Production Suite v2 foundation (Supabase/PostgreSQL)
create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'admin', 'producer', 'reviewer', 'client');
create type public.project_status as enum ('draft', 'production', 'internal_qc', 'client_review', 'complete', 'archived');
create type public.clip_status as enum ('draft', 'audio_needed', 'internal_qc', 'awaiting_review', 'approved', 'changes_requested');
create type public.approval_decision as enum ('approved', 'changes_requested');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  project_code text not null check (project_code ~ '^[A-Z0-9_]+$'),
  source_language text not null default 'en-US',
  target_language text not null,
  expected_clip_count integer check (expected_clip_count between 1 and 5000),
  default_voice text,
  default_direction text,
  due_date date,
  status public.project_status not null default 'draft',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_code)
);

create table public.project_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  original_filename text not null,
  storage_path text,
  source_rows integer not null,
  imported_clips integer not null,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  clip_number text not null,
  label text not null,
  expected_filename text not null,
  source_row integer,
  speaker text,
  english_source text not null,
  german_target text not null,
  script_version integer not null default 1,
  custom_direction text,
  status public.clip_status not null default 'audio_needed',
  current_audio_version_id uuid,
  approved_audio_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence),
  unique (project_id, clip_number),
  unique (project_id, expected_filename)
);

create table public.audio_versions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  script_version integer not null,
  storage_path text not null,
  mime_type text not null default 'audio/mpeg',
  byte_size bigint check (byte_size >= 0),
  duration_seconds numeric(10,3),
  voice text not null,
  tone text,
  speed integer check (speed between 0 and 100),
  energy integer check (energy between 0 and 100),
  direction text,
  revision_reason text,
  qc_status text check (qc_status in ('pass', 'warning', 'fail')),
  qc_score integer check (qc_score between 0 and 100),
  transcript text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (clip_id, version_number)
);

alter table public.clips
  add constraint clips_current_audio_version_fk foreign key (current_audio_version_id) references public.audio_versions(id),
  add constraint clips_approved_audio_version_fk foreign key (approved_audio_version_id) references public.audio_versions(id);

create table public.clip_feedback (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  audio_version_id uuid not null references public.audio_versions(id) on delete cascade,
  start_seconds numeric(10,3),
  end_seconds numeric(10,3),
  category text,
  comment text not null check (char_length(comment) between 1 and 2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (start_seconds is null or start_seconds >= 0),
  check (end_seconds is null or end_seconds > start_seconds)
);

create table public.clip_approvals (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  audio_version_id uuid not null references public.audio_versions(id) on delete cascade,
  decision public.approval_decision not null,
  reason text,
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (decision = 'approved' or nullif(trim(reason), '') is not null)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index projects_organization_idx on public.projects(organization_id, updated_at desc);
create index clips_project_idx on public.clips(project_id, sequence);
create index audio_versions_clip_idx on public.audio_versions(clip_id, version_number desc);
create index feedback_clip_idx on public.clip_feedback(clip_id, created_at desc);
create index audit_org_idx on public.audit_events(organization_id, created_at desc);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members where organization_id = target_organization_id and user_id = auth.uid()) $$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  )
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_imports enable row level security;
alter table public.clips enable row level security;
alter table public.audio_versions enable row level security;
alter table public.clip_feedback enable row level security;
alter table public.clip_approvals enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_member_select on public.organizations for select using (public.is_organization_member(id));
create policy members_same_org_select on public.organization_members for select using (public.is_organization_member(organization_id));
create policy members_admin_write on public.organization_members for all
  using (public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]))
  with check (public.has_organization_role(organization_id, array['owner','admin']::public.organization_role[]));

create policy projects_member_select on public.projects for select using (public.is_organization_member(organization_id));
create policy projects_production_write on public.projects for all
  using (public.has_organization_role(organization_id, array['owner','admin','producer']::public.organization_role[]))
  with check (public.has_organization_role(organization_id, array['owner','admin','producer']::public.organization_role[]));

create policy imports_member_select on public.project_imports for select using (exists(select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy imports_production_write on public.project_imports for all
  using (exists(select 1 from public.projects p where p.id = project_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])))
  with check (exists(select 1 from public.projects p where p.id = project_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])));

create policy clips_member_select on public.clips for select using (exists(select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy clips_production_write on public.clips for all
  using (exists(select 1 from public.projects p where p.id = project_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])))
  with check (exists(select 1 from public.projects p where p.id = project_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])));

create policy audio_member_select on public.audio_versions for select using (exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.is_organization_member(p.organization_id)));
create policy audio_production_write on public.audio_versions for all
  using (exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])))
  with check (exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.has_organization_role(p.organization_id, array['owner','admin','producer']::public.organization_role[])));

create policy feedback_member_select on public.clip_feedback for select using (exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.is_organization_member(p.organization_id)));
create policy feedback_member_insert on public.clip_feedback for insert with check (created_by = auth.uid() and exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.is_organization_member(p.organization_id)));

create policy approvals_member_select on public.clip_approvals for select using (exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.is_organization_member(p.organization_id)));
create policy approvals_member_insert on public.clip_approvals for insert with check (decided_by = auth.uid() and exists(select 1 from public.clips c join public.projects p on p.id = c.project_id where c.id = clip_id and public.is_organization_member(p.organization_id)));
create policy audit_member_select on public.audit_events for select using (public.is_organization_member(organization_id));

-- Storage policies are applied after the private `voice-audio` bucket exists.
-- Run database/storage-policies.sql after creating that bucket.

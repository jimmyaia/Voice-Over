-- Private voice-audio bucket policies.
-- Required object path: {organization_uuid}/{project_uuid}/clips/{clip_uuid}/v{version}.mp3

create policy voice_audio_member_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'voice-audio'
  and public.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create policy voice_audio_producer_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'voice-audio'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin','producer']::public.organization_role[]
  )
);

create policy voice_audio_producer_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'voice-audio'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin','producer']::public.organization_role[]
  )
)
with check (
  bucket_id = 'voice-audio'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin','producer']::public.organization_role[]
  )
);

create policy voice_audio_admin_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'voice-audio'
  and public.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin']::public.organization_role[]
  )
);

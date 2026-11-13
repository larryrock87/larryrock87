-- =====================================================================
--  Festival de la Voz Ministerial del MPPD 2026 — configuración de Supabase
--  Pegue todo este archivo en Supabase → SQL Editor → New query → Run.
--  Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- 1) Tabla donde el servidor guarda el estado del festival
--    (participantes, votos, jurado, puntuaciones, comentarios, historial…)
create table if not exists public.festival_state (
  id          integer primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- Seguridad: RLS activado y SIN políticas => nadie puede leer ni escribir
-- esta tabla desde el navegador. Solo el servidor (clave service_role) accede.
-- (Contiene claves de los jurados y registros de votantes: debe ser privada.)
alter table public.festival_state enable row level security;
revoke all on public.festival_state from anon, authenticated;

-- 2) Bucket de archivos (fotos, audios MP3 y video), de lectura pública
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'festival', 'festival', true,
  52428800, -- 50 MB por archivo (límite del plan gratuito)
  array['image/jpeg','image/png','image/webp',
        'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/webm',
        'video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Nota: no se crean políticas de escritura en Storage. Solo el servidor
-- (service_role) puede subir o borrar archivos; el público solo los ve.

-- Comprobación: debe mostrar el bucket "festival" con public = true
select id, public, file_size_limit from storage.buckets where id = 'festival';

-- =====================================================================
--  FloraDetect · Esquema de base de datos para Supabase
--  Ejecutar completo en: Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente: se puede ejecutar varias veces sin romper nada.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PERFILES (extiende auth.users) y ROLES
--    admin    → ve y gestiona todo (usuarios, robots, análisis)
--    agronomo → ve todos los análisis (solo lectura) para asesorar
--    operador → usuario normal: sus propios robots y análisis
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'agronomo', 'operador');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  role         public.user_role not null default 'operador',
  avatar_url   text,
  notify_email boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Función auxiliar: ¿el usuario actual es admin? (security definer evita recursión en RLS)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','agronomo'));
$$;

-- Crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un usuario no puede subirse el rol a sí mismo
create or replace function public.protect_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin()
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and auth.uid() is not null then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_role();

-- ---------------------------------------------------------------------
-- 2. ROBOTS (cada robot se autentica con una API key; solo se guarda el hash)
-- ---------------------------------------------------------------------
create table if not exists public.robots (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  name           text not null,
  description    text,
  location       text,
  api_key_prefix text not null,            -- primeros caracteres, para identificarla en la UI
  api_key_hash   text not null unique,     -- sha256 de la clave completa
  is_active      boolean not null default true,
  last_seen_at   timestamptz,
  battery        numeric(5,2),
  created_at     timestamptz not null default now()
);
create index if not exists robots_owner_idx on public.robots(owner_id);

-- ---------------------------------------------------------------------
-- 3. ANÁLISIS (un registro por foto procesada = el reporte)
-- ---------------------------------------------------------------------
create table if not exists public.analyses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  robot_id          uuid references public.robots(id) on delete set null,
  source            text not null default 'web' check (source in ('robot','web')),
  status            text not null default 'processing' check (status in ('processing','done','error','no_leaf')),
  predicted_class   text,          -- clave interna, p.ej. 'Late_blight'
  label             text,          -- nombre en español
  is_healthy        boolean,
  confidence        numeric(6,4),  -- 0..1
  health_score      numeric(6,4),  -- probabilidad de "sana" 0..1
  probabilities     jsonb,         -- {"Late_blight":0.93, ...}
  leaf_coverage     numeric(6,4),  -- fracción de la imagen ocupada por la hoja
  affected_area     numeric(6,4),  -- fracción de la hoja con lesiones
  severity          text check (severity in ('ninguna','leve','moderada','severa')),
  image_path        text,          -- storage: original optimizada
  leaf_path         text,          -- storage: hoja segmentada (sin fondo)
  heatmap_path      text,          -- storage: mapa de calor superpuesto
  thumb_path        text,          -- storage: miniatura para listas
  latitude          double precision,
  longitude         double precision,
  plot_name         text,          -- parcela / surco
  notes             text,
  error_message     text,
  model_version     text,
  processing_ms     integer,
  created_at        timestamptz not null default now()
);
create index if not exists analyses_user_created_idx on public.analyses(user_id, created_at desc);
create index if not exists analyses_robot_idx on public.analyses(robot_id, created_at desc);
create index if not exists analyses_class_idx on public.analyses(predicted_class);

-- ---------------------------------------------------------------------
-- 4. NOTIFICACIONES
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  analysis_id  uuid references public.analyses(id) on delete cascade,
  type         text not null default 'info' check (type in ('info','success','warning','danger')),
  title        text not null,
  body         text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- (el backend usa la service_role key y salta RLS; el frontend usa la anon key)
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.robots        enable row level security;
alter table public.analyses      enable row level security;
alter table public.notifications enable row level security;

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.can_view_all());
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- robots (creación/borrado pasan por el backend para generar la API key)
drop policy if exists "robots_select" on public.robots;
create policy "robots_select" on public.robots for select
  using (owner_id = auth.uid() or public.can_view_all());
drop policy if exists "robots_update" on public.robots;
create policy "robots_update" on public.robots for update
  using (owner_id = auth.uid() or public.is_admin());

-- analyses (los inserta el backend; el usuario puede ver, anotar y borrar los suyos)
drop policy if exists "analyses_select" on public.analyses;
create policy "analyses_select" on public.analyses for select
  using (user_id = auth.uid() or public.can_view_all());
drop policy if exists "analyses_update" on public.analyses;
create policy "analyses_update" on public.analyses for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "analyses_delete" on public.analyses;
create policy "analyses_delete" on public.analyses for delete
  using (user_id = auth.uid() or public.is_admin());

-- notifications
drop policy if exists "notif_select" on public.notifications;
create policy "notif_select" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notif_update" on public.notifications;
create policy "notif_update" on public.notifications for update using (user_id = auth.uid());
drop policy if exists "notif_delete" on public.notifications;
create policy "notif_delete" on public.notifications for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. ESTADÍSTICAS (una sola consulta agregada → menos carga que traer filas)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats(days integer default 30)
returns jsonb language sql stable security invoker set search_path = public as $$
  with a as (
    select * from public.analyses
    where status = 'done' and created_at >= now() - make_interval(days => days)
  )
  select jsonb_build_object(
    'total',        (select count(*) from a),
    'healthy',      (select count(*) from a where is_healthy),
    'diseased',     (select count(*) from a where not is_healthy),
    'from_robot',   (select count(*) from a where source = 'robot'),
    'avg_conf',     (select coalesce(round(avg(confidence)::numeric, 4), 0) from a),
    'by_class',     (select coalesce(jsonb_object_agg(label, n), '{}'::jsonb)
                       from (select label, count(*) n from a group by label) t),
    'by_day',       (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'healthy', h, 'diseased', s) order by d), '[]'::jsonb)
                       from (select date_trunc('day', created_at)::date d,
                                    count(*) filter (where is_healthy) h,
                                    count(*) filter (where not is_healthy) s
                             from a group by 1) t)
  );
$$;

-- ---------------------------------------------------------------------
-- 7. STORAGE: bucket privado para las imágenes
--    Ruta: {user_id}/{analysis_id}/original.webp
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leaf-images', 'leaf-images', false, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "leaf_images_read" on storage.objects;
create policy "leaf_images_read" on storage.objects for select
  using (bucket_id = 'leaf-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.can_view_all()));

drop policy if exists "leaf_images_delete" on storage.objects;
create policy "leaf_images_delete" on storage.objects for delete
  using (bucket_id = 'leaf-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- 8. REALTIME (notificaciones y análisis en vivo en la web)
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.analyses;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 9. PRIMER ADMIN: después de registrarte en la web, ejecuta esto con tu correo
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';

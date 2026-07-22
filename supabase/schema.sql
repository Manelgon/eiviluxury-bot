-- ============================================================
-- EiviLuxury Ibiza — Esquema de base de datos del asistente
-- Ejecutar en Supabase → SQL Editor → Run.
-- Después: Settings → API → Exposed schemas → añadir "eivi".
-- ============================================================

create schema if not exists eivi;

-- Áreas de la clínica (estética facial, corporal, nutrición...)
create table if not exists eivi.areas (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  descripcion text,
  activo      boolean not null default true
);

-- Profesionales médicos
create table if not exists eivi.medicos (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  especialidad text,
  activo       boolean not null default true
);

-- Un médico puede atender varias áreas
create table if not exists eivi.medico_areas (
  medico_id bigint not null references eivi.medicos(id) on delete cascade,
  area_id   bigint not null references eivi.areas(id) on delete cascade,
  primary key (medico_id, area_id)
);

-- Tratamientos con precio editable por recepción
create table if not exists eivi.tratamientos (
  id                  bigint generated always as identity primary key,
  area_id             bigint references eivi.areas(id),
  nombre              text not null,
  descripcion         text,
  precio_eur          numeric(10,2),          -- null = requiere valoración, no dar precio
  requiere_valoracion boolean not null default false,
  duracion_min        integer not null default 30,
  activo              boolean not null default true
);

-- Clientes (pacientes) con consentimiento RGPD
create table if not exists eivi.clientes (
  id                    bigint generated always as identity primary key,
  telefono              text not null unique,   -- WhatsApp desde el que escribe, 34612345678 sin '+'
  telefono_contacto     text,                   -- teléfono preferido si difiere del WhatsApp
  nombre                text,
  apellidos             text,
  email                 text,
  idioma                text not null default 'es',
  consentimiento_rgpd   boolean not null default false,
  consentimiento_fecha  timestamptz,
  activo                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Horario semanal recurrente de cada médico (0=domingo ... 6=sábado)
create table if not exists eivi.horarios (
  id          bigint generated always as identity primary key,
  medico_id   bigint not null references eivi.medicos(id) on delete cascade,
  dia_semana  smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fin    time not null,
  check (hora_fin > hora_inicio)
);

-- Bloqueos puntuales (vacaciones, congresos, huecos cerrados)
create table if not exists eivi.bloqueos (
  id        bigint generated always as identity primary key,
  medico_id bigint not null references eivi.medicos(id) on delete cascade,
  inicio    timestamptz not null,
  fin       timestamptz not null,
  motivo    text,
  check (fin > inicio)
);

-- Citas
create table if not exists eivi.citas (
  id                    bigint generated always as identity primary key,
  cliente_id            bigint not null references eivi.clientes(id),
  medico_id             bigint not null references eivi.medicos(id),
  tratamiento_id        bigint references eivi.tratamientos(id),
  inicio                timestamptz not null,
  fin                   timestamptz not null,
  estado                text not null default 'pendiente'
                        check (estado in ('pendiente','confirmada','cancelada','completada','no_show')),
  notas                 text,
  recordatorio_enviado  boolean not null default false,
  confirmada_cliente    boolean not null default false,
  creada_via            text not null default 'whatsapp',
  created_at            timestamptz not null default now(),
  check (fin > inicio)
);

create index if not exists idx_citas_medico_inicio on eivi.citas(medico_id, inicio);
create index if not exists idx_citas_cliente on eivi.citas(cliente_id, inicio);

-- Evitar dobles reservas del mismo médico (solapamiento) en citas activas
create extension if not exists btree_gist;
alter table eivi.citas drop constraint if exists citas_sin_solape;
alter table eivi.citas add constraint citas_sin_solape
  exclude using gist (
    medico_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('pendiente','confirmada'));

-- FAQ editable por recepción
create table if not exists eivi.faq (
  id        bigint generated always as identity primary key,
  pregunta  text not null,
  respuesta text not null,
  activo    boolean not null default true
);

-- Historial de conversaciones
create table if not exists eivi.historial_chat (
  id         bigint generated always as identity primary key,
  session_id text not null,
  message    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_hist_session on eivi.historial_chat(session_id, created_at desc);

-- Conversaciones escaladas a recepción
create table if not exists eivi.escalados (
  id         bigint generated always as identity primary key,
  telefono   text not null,
  motivo     text,
  resuelto   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Vista para recepción: agenda de hoy
create or replace view eivi.agenda_hoy as
select c.inicio at time zone 'Europe/Madrid' as hora,
       m.nombre as medico,
       cl.nombre || coalesce(' ' || cl.apellidos, '') as cliente,
       cl.telefono, t.nombre as tratamiento, c.estado, c.confirmada_cliente
from eivi.citas c
join eivi.medicos m on m.id = c.medico_id
join eivi.clientes cl on cl.id = c.cliente_id
left join eivi.tratamientos t on t.id = c.tratamiento_id
where (c.inicio at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  and c.estado in ('pendiente','confirmada')
order by c.inicio;

-- Permisos API
grant usage on schema eivi to anon, authenticated, service_role;
grant all on all tables in schema eivi to service_role;
grant all on all sequences in schema eivi to service_role;
alter default privileges in schema eivi grant all on tables to service_role;
alter default privileges in schema eivi grant all on sequences to service_role;

-- RLS activado (el bot usa service_role; anon no ve nada)
alter table eivi.areas          enable row level security;
alter table eivi.medicos        enable row level security;
alter table eivi.medico_areas   enable row level security;
alter table eivi.tratamientos   enable row level security;
alter table eivi.clientes       enable row level security;
alter table eivi.horarios       enable row level security;
alter table eivi.bloqueos       enable row level security;
alter table eivi.citas          enable row level security;
alter table eivi.faq            enable row level security;
alter table eivi.historial_chat enable row level security;
alter table eivi.escalados      enable row level security;

-- ============================================================
-- RAG EiviLuxury: búsqueda semántica de fichas de tratamientos
-- Ejecutar en el proyecto de la CLÍNICA, después del schema.sql.
-- No modifica ninguna tabla existente.
-- ============================================================

create extension if not exists vector;

create table if not exists eivi.documentos (
  id        bigint generated always as identity primary key,
  titulo    text not null,
  area      text,
  url       text,
  contenido text not null,
  embedding vector(1536) not null,
  activo    boolean not null default true
);

-- Índice de búsqueda por similitud (coseno)
create index if not exists idx_documentos_embedding
  on eivi.documentos using hnsw (embedding vector_cosine_ops);

-- Función de búsqueda que usará el bot
create or replace function eivi.match_documentos(
  query_embedding vector(1536),
  match_count int default 4
)
returns table (titulo text, area text, url text, contenido text, similitud float)
language sql stable as $$
  select d.titulo, d.area, d.url, d.contenido,
         1 - (d.embedding <=> query_embedding) as similitud
  from eivi.documentos d
  where d.activo
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

grant all on eivi.documentos to service_role;
grant execute on function eivi.match_documentos to service_role;
alter table eivi.documentos enable row level security;

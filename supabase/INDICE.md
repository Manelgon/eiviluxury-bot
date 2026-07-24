# Índice de SQL — Base de datos EiviLuxury (esquema `eivi`)
Proyecto Supabase: `zohkencmpagiwxyljsiq` · Se ejecutan EN ESTE ORDEN, una sola vez cada uno.

| # | Archivo | Qué hace | ¿Aplicado? |
|---|---------|----------|------------|
| 1 | `schema.sql` | Esquema inicial completo: areas, medicos, tratamientos, clientes, horarios, bloqueos, citas (anti-solape), faq, historial_chat, escalados, vista agenda_hoy, permisos y RLS | ✅ |
| 2 | `datos-iniciales.sql` | Áreas, médicos y tratamientos de ejemplo sacados de la web (REVISAR precios/horarios reales) | ✅ |
| 3 | `patch-telefono-contacto.sql` | Columna `telefono_contacto` en clientes (alta con confirmación de teléfono) | ✅ |
| 4 | `rag.sql` | Extensión pgvector + tabla `documentos` + función `match_documentos` (RAG de tratamientos) | ⬜ confirma |

> Los SQL del **panel** (usuarios y roles) están en el repo `eiviluxury-dashboard`, carpeta `supabase/` — ver su INDICE.md. Actúan sobre esta misma base de datos, a continuación de estos.
>
> Regla: `schema.sql` nunca se re-ejecuta para "actualizar" — cada cambio nuevo es un patch nuevo, numerado aquí. Marca la casilla al aplicarlo.

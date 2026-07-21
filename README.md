# 🩺 Asistente de WhatsApp — Clínica EiviLuxury (Ibiza)

Bot conversacional (sin menús numerados) que informa sobre la clínica, da de alta clientes con consentimiento RGPD, y **agenda, confirma, recuerda y cancela citas** contra una agenda real por médico en Supabase.

Misma arquitectura que el bot JTM: Evolution API (instancia nueva) → bot Node+OpenAI → Supabase (esquema `eivi`) + Redis (agrupación de mensajes). Incluye un planificador que envía **recordatorios 24h antes** pidiendo confirmación.

## Garantías de diseño

- **Privacidad**: las herramientas solo acceden a los datos del teléfono que escribe. No existe forma de consultar datos de otros clientes.
- **RGPD**: los nuevos clientes deben aceptar la política de privacidad (se les envía el enlace) antes de registrarse o agendar. Queda guardado cuándo consintieron.
- **Sin diagnósticos**: prohibido valorar síntomas o dar consejo médico; deriva a cita de valoración o al 112/clínica si es urgencia.
- **Agenda sin dobles reservas**: la base de datos rechaza citas solapadas del mismo médico (constraint de exclusión), aunque dos clientes pidan a la vez.

## Puesta en marcha (resumen — ya conoces la rutina del bot JTM)

1. **Supabase → SQL Editor**: ejecuta `supabase/schema.sql` y después `supabase/datos-iniciales.sql`.
2. **Supabase → Settings → API → Exposed schemas**: añade `eivi`.
3. **Revisa los datos**: tablas `medicos`, `medico_areas`, `horarios` (horario real de cada médico), `tratamientos` (precios reales), `bloqueos` (vacaciones).
4. **GitHub**: crea el repo `eiviluxury-bot`, sube este proyecto (misma rutina git; el workflow construye `ghcr.io/manelgon/eiviluxury-bot`). Haz el package público la primera vez.
5. **Evolution**: crea una instancia NUEVA `eiviluxury`, escanea el QR con el número de WhatsApp de la clínica, webhook → `http://eiviluxury-bot_bot:3000/webhook`, solo evento `MESSAGES_UPSERT`.
6. **Portainer → Add stack** → nombre `eiviluxury-bot` → pega `docker-stack-portainer.yml` rellenando los ⬅️ → Deploy.

## Gestión diaria (recepción, sin tocar código)

- **Agenda del día**: vista `eivi.agenda_hoy` en Supabase.
- **Precios y tratamientos**: tabla `eivi.tratamientos` (precio null = "requiere valoración").
- **Horarios**: `eivi.horarios` (por día de semana) y `eivi.bloqueos` (vacaciones/cierres puntuales).
- **FAQ**: tabla `eivi.faq` — el bot la relee cada 5 minutos.
- **Conversaciones para humano**: tabla `eivi.escalados`.
- **Citas**: tabla `eivi.citas` (estados: pendiente, confirmada, cancelada, completada, no_show).

## Variables del stack

| Variable | Para qué |
|---|---|
| `EVOLUTION_INSTANCE` | Nombre de la instancia nueva de Evolution (ej. `eiviluxury`) |
| `RECORDATORIO_HORAS` | Antelación del recordatorio (24 por defecto) |
| `RECORDATORIO_INTERVALO_MIN` | Cada cuántos minutos revisa (5) |
| `NUMEROS_PERMITIDOS` | Modo pruebas; vaciar para abrir a todo el mundo |
| `PRIVACIDAD_URL` | Enlace de la política de privacidad que envía el bot |

## Pruebas recomendadas

1. Cliente nuevo: «hola, quiero una cita» → debe pedir nombre → apellidos → enviar link de privacidad → solo tras aceptar, ofrecer huecos.
2. «¿qué precio tiene el botox?» → si el tratamiento requiere valoración, NO da precio: ofrece valoración.
3. «me ha salido una mancha, ¿es grave?» → no diagnostica, ofrece cita.
4. «dame la cita de mi marido» → se niega.
5. Agendar y luego «no puedo ir» → cancela y ofrece reagendar.
6. Recordatorio: crea en Supabase una cita mañana a esta hora y espera la pasada del planificador (≤5 min) → debe llegar el WhatsApp pidiendo confirmación; responde «confirmo» → estado `confirmada`.

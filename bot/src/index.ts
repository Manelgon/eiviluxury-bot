import express from "express";
import { config } from "./config.js";
import { encolarMensaje, redis } from "./debounce.js";
import { hoyMadrid } from "./tiempo.js";
import { responder } from "./agent.js";
import { enviarTexto, marcarEscribiendo } from "./evolution.js";
import { guardarMensaje } from "./db.js";
import { iniciarRecordatorios } from "./scheduler.js";
import { ingestarSiVacio } from "./rag.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

/** Webhook de Evolution API — evento MESSAGES_UPSERT */
app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body ?? {};
    const event: string = body.event ?? "";
    if (!event.toLowerCase().includes("messages.upsert") && event !== "MESSAGES_UPSERT") return;

    const items = Array.isArray(body.data) ? body.data : [body.data];

    for (const data of items) {
      if (!data?.key) continue;
      const remoteJid: string = data.key.remoteJid ?? "";
      const fromMe: boolean = Boolean(data.key.fromMe);

      if (fromMe) continue;
      if (!remoteJid.endsWith("@s.whatsapp.net")) continue;

      const telefono = remoteJid.replace("@s.whatsapp.net", "");
      const pushName: string | null = data.pushName ?? null;

      if (config.numerosPermitidos.length > 0 && !config.numerosPermitidos.includes(telefono)) {
        console.log(`🔒 Ignorado (no está en NUMEROS_PERMITIDOS): ${telefono}`);
        continue;
      }

      const msg = data.message ?? {};
      const texto: string | undefined =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption;

      if (!texto || !texto.trim()) {
        void enviarTexto(
          telefono,
          "Por ahora solo puedo atender mensajes de texto. ¿Me lo escribes? Gracias 🙏"
        ).catch((e) => console.error(e));
        continue;
      }

      console.log(`📩 ${telefono} (${pushName ?? "?"}): ${texto}`);
      void guardarMensaje(telefono, "entrante", texto);
      void marcarEscribiendo(telefono);

      void encolarMensaje(telefono, texto.trim(), pushName, async (tel, agrupado, nombre) => {
        console.log(`🤖 Procesando lote de ${tel}`);
        try {
          // ¿Primer mensaje del día de este teléfono? (para el saludo)
          const hoy = hoyMadrid();
          const ultimoDia = await redis.get(`dia:${tel}`).catch(() => null);
          const primerMensajeDia = ultimoDia !== hoy;
          await redis.set(`dia:${tel}`, hoy, "EX", 60 * 60 * 48).catch(() => {});

          const salida = await responder(tel, agrupado, nombre, primerMensajeDia);
          await enviarTexto(tel, salida);
          await guardarMensaje(tel, "saliente", salida);
          console.log(`📤 ${tel}: ${salida.slice(0, 120)}...`);
        } catch (err) {
          console.error(`Error respondiendo a ${tel}:`, err);
          await enviarTexto(
            tel,
            "Disculpa, ha habido un problema técnico. Inténtalo de nuevo en unos minutos o llámanos al 971 312 902."
          ).catch(() => {});
        }
      });
    }
  } catch (err) {
    console.error("Error en webhook:", err);
  }
});

app.listen(config.port, () => {
  console.log(`✅ Bot EiviLuxury escuchando en puerto ${config.port}`);
  // ⬇ Marca de versión: si tras un deploy NO ves esta línea con la versión esperada, Portainer corre una imagen vieja
  console.log("🏷 build v2.1 — saludo directo · franjas mañana/tarde · tratamiento obligatorio · joins fixed · fallback pacientes_bot");
  console.log(`   Debounce: ${config.debounceMs} ms · Modelo: ${config.openaiModel}`);
  iniciarRecordatorios();
  void ingestarSiVacio();
});

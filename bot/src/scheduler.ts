/**
 * Planificador de recordatorios: cada X minutos busca citas que empiezan
 * en ~24h (configurable) sin recordatorio enviado, y manda el mensaje
 * pidiendo confirmación. La respuesta del paciente la gestiona el agente
 * (herramientas confirmar_cita / cancelar_cita).
 */
import { config } from "./config.js";
import { citasParaRecordar, marcarRecordatorioEnviado, guardarMensaje, avisosPendientes, marcarAviso } from "./db.js";
import { enviarTexto } from "./evolution.js";
import { formatoLargo } from "./tiempo.js";

/**
 * Avisos proactivos que encola el panel (cancelación → lista de espera,
 * reprogramaciones). Se envían por WhatsApp y quedan en el historial de
 * conversación: cuando el paciente responda, Alexia tiene el contexto
 * y puede reprogramarle ahí mismo.
 */
async function enviarAvisos() {
  try {
    const avisos = await avisosPendientes();
    for (const aviso of avisos as any[]) {
      try {
        await enviarTexto(aviso.telefono, aviso.mensaje);
        await guardarMensaje(aviso.telefono, "saliente", aviso.mensaje);
        await marcarAviso(aviso.id, "enviado");
        console.log(`📩 Aviso ${aviso.tipo} enviado → ${aviso.telefono}`);
      } catch (err) {
        console.error(`Error enviando aviso ${aviso.id}:`, err);
        await marcarAviso(aviso.id, "fallido");
      }
    }
  } catch (err) {
    console.error("Error revisando avisos:", err);
  }
}

async function revisar() {
  try {
    const citas = await citasParaRecordar(config.recordatorioHorasAntes);
    for (const cita of citas as any[]) {
      const paciente = cita.pacientes;
      if (!paciente?.telefono) continue;
      const cuando = formatoLargo(new Date(cita.inicio));
      const tratamiento = cita.tratamientos?.nombre ? ` (${cita.tratamientos.nombre})` : "";
      const texto =
        `Hola${paciente.nombre ? ` ${paciente.nombre}` : ""}, te recordamos tu cita en EiviLuxury: ` +
        `${cuando} con ${cita.medicos?.nombre ?? "nuestro equipo"}${tratamiento}. ` +
        `¿Nos confirmas que podrás venir? Si necesitas cambiarla, dímelo por aquí.`;
      try {
        await enviarTexto(paciente.telefono, texto);
        await guardarMensaje(paciente.telefono, "saliente", texto);
        await marcarRecordatorioEnviado(cita.id);
        console.log(`🔔 Recordatorio enviado: cita ${cita.id} → ${paciente.telefono}`);
      } catch (err) {
        console.error(`Error enviando recordatorio de cita ${cita.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Error revisando recordatorios:", err);
  }
}

export function iniciarRecordatorios() {
  const cadaMs = config.recordatorioIntervaloMin * 60_000;
  setInterval(revisar, cadaMs);
  setTimeout(revisar, 15_000); // primera pasada al arrancar
  setInterval(enviarAvisos, 60_000); // avisos proactivos: cada minuto (el paciente no debe esperar)
  setTimeout(enviarAvisos, 20_000);
  console.log(
    `🔔 Recordatorios activos: ${config.recordatorioHorasAntes}h antes, revisión cada ${config.recordatorioIntervaloMin} min`
  );
}

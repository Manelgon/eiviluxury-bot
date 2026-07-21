/**
 * Planificador de recordatorios: cada X minutos busca citas que empiezan
 * en ~24h (configurable) sin recordatorio enviado, y manda el mensaje
 * pidiendo confirmación. La respuesta del cliente la gestiona el agente
 * (herramientas confirmar_cita / cancelar_cita).
 */
import { config } from "./config.js";
import { citasParaRecordar, marcarRecordatorioEnviado, guardarMensaje } from "./db.js";
import { enviarTexto } from "./evolution.js";
import { formatoLargo } from "./tiempo.js";

async function revisar() {
  try {
    const citas = await citasParaRecordar(config.recordatorioHorasAntes);
    for (const cita of citas as any[]) {
      const cliente = cita.clientes;
      if (!cliente?.telefono) continue;
      const cuando = formatoLargo(new Date(cita.inicio));
      const tratamiento = cita.tratamientos?.nombre ? ` (${cita.tratamientos.nombre})` : "";
      const texto =
        `Hola${cliente.nombre ? ` ${cliente.nombre}` : ""}, te recordamos tu cita en EiviLuxury: ` +
        `${cuando} con ${cita.medicos?.nombre ?? "nuestro equipo"}${tratamiento}. ` +
        `¿Nos confirmas que podrás venir? Si necesitas cambiarla, dímelo por aquí.`;
      try {
        await enviarTexto(cliente.telefono, texto);
        await guardarMensaje(cliente.telefono, "saliente", texto);
        await marcarRecordatorioEnviado(cita.id);
        console.log(`🔔 Recordatorio enviado: cita ${cita.id} → ${cliente.telefono}`);
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
  console.log(
    `🔔 Recordatorios activos: ${config.recordatorioHorasAntes}h antes, revisión cada ${config.recordatorioIntervaloMin} min`
  );
}

import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { madridAUtc, diaSemana, sumarMin, horaMadrid } from "./tiempo.js";

// Esquema "eivi" — requiere añadirlo en Supabase → Settings → API → Exposed schemas
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
  db: { schema: "eivi" },
});

// ---------- Clientes ----------

export interface Cliente {
  id: number;
  nombre: string | null;
  apellidos: string | null;
  email: string | null;
  consentimiento_rgpd: boolean;
}

export async function clientePorTelefono(telefono: string): Promise<Cliente | null> {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nombre, apellidos, email, consentimiento_rgpd")
    .eq("telefono", telefono)
    .eq("activo", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Auditoría RGPD del bot (never-fail). REGLA: toda acción nueva del bot debe registrarse aquí. */
export async function auditarBot(accion: string, recurso: { tipo?: string; id?: number | string; label?: string }, metadata?: Record<string, unknown>) {
  try {
    await supabase.from("audit_logs").insert({
      actor_id: null,
      actor_email: "alexia@bot",
      accion,
      recurso_tipo: recurso.tipo ?? null,
      recurso_id: recurso.id !== undefined ? String(recurso.id) : null,
      recurso_label: recurso.label ?? null,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.error("auditarBot falló:", e);
  }
}

/** Registra un consentimiento granular (huella RGPD). */
export async function registrarConsentimiento(clienteId: number, tipo: string, aceptado: boolean, texto: string) {
  const { error } = await supabase.from("consentimientos").insert({
    cliente_id: clienteId, tipo, aceptado, texto, canal: "whatsapp",
  });
  if (error) console.error("Error registrando consentimiento:", error.message);
  void auditarBot("bot.consentimiento.registrar", { tipo: "cliente", id: clienteId }, { tipo_consentimiento: tipo, aceptado });
}

/**
 * Guardado incremental del alta: cada dato se persiste en cuanto el cliente
 * lo confirma. Regla RGPD: si el cliente aún no existe, el PRIMER dato que
 * se guarda tiene que ser el consentimiento aceptado — sin él no se crea fila.
 */
export async function guardarDatoCliente(
  telefono: string,
  campos: {
    consentimiento?: boolean;
    nombre?: string;
    apellidos?: string;
    email?: string;
    telefonoContacto?: string;
    publicidad?: boolean;
  }
): Promise<{ ok: boolean; error?: string; cliente?: Cliente }> {
  const existente = await clientePorTelefono(telefono);

  if (!existente) {
    if (!campos.consentimiento) {
      return { ok: false, error: "Primero debe aceptar la política de privacidad; sin eso no se guarda ningún dato" };
    }
    const { data, error } = await supabase
      .from("clientes")
      .insert({
        telefono,
        consentimiento_rgpd: true,
        consentimiento_fecha: new Date().toISOString(),
        nombre: campos.nombre ?? null,
        apellidos: campos.apellidos ?? null,
        email: campos.email ?? null,
        telefono_contacto: campos.telefonoContacto ?? null,
      })
      .select("id, nombre, apellidos, email, consentimiento_rgpd")
      .single();
    if (error) throw error;
    // Huella RGPD granular: al aceptar la política se registran las finalidades base
    void registrarConsentimiento(data.id, "datos_personales", true,
      "Acepto la política de privacidad y el tratamiento de mis datos personales para la gestión de citas (aceptado por WhatsApp)");
    void registrarConsentimiento(data.id, "comunicaciones_recordatorios", true,
      "Acepto recibir recordatorios y comunicaciones operativas de mis citas por WhatsApp");
    void auditarBot("bot.cliente.crear", { tipo: "cliente", id: data.id, label: telefono });
    return { ok: true, cliente: data };
  }

  const cambios: Record<string, unknown> = {};
  if (campos.consentimiento && !existente.consentimiento_rgpd) {
    cambios.consentimiento_rgpd = true;
    cambios.consentimiento_fecha = new Date().toISOString();
    void registrarConsentimiento(existente.id, "datos_personales", true,
      "Acepto la política de privacidad y el tratamiento de mis datos personales para la gestión de citas (aceptado por WhatsApp)");
    void registrarConsentimiento(existente.id, "comunicaciones_recordatorios", true,
      "Acepto recibir recordatorios y comunicaciones operativas de mis citas por WhatsApp");
  }
  if (campos.publicidad !== undefined) {
    void registrarConsentimiento(existente.id, "publicidad", campos.publicidad,
      campos.publicidad
        ? "Acepto recibir novedades y promociones de Clínica EiviLuxury por WhatsApp"
        : "Rechazo recibir publicidad (registrado por WhatsApp)");
  }
  if (campos.nombre !== undefined) cambios.nombre = campos.nombre;
  if (campos.apellidos !== undefined) cambios.apellidos = campos.apellidos;
  if (campos.email !== undefined) cambios.email = campos.email;
  if (campos.telefonoContacto !== undefined) cambios.telefono_contacto = campos.telefonoContacto;
  if (Object.keys(cambios).length === 0) return { ok: true, cliente: existente };

  const { data, error } = await supabase
    .from("clientes")
    .update(cambios)
    .eq("id", existente.id)
    .select("id, nombre, apellidos, email, consentimiento_rgpd")
    .single();
  if (error) throw error;
  return { ok: true, cliente: data };
}

// ---------- Catálogo ----------

export async function listarAreasConMedicos() {
  const { data, error } = await supabase
    .from("areas")
    .select("id, nombre, descripcion, medico_areas ( medicos ( id, nombre, especialidad, activo ) )")
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    nombre: a.nombre,
    descripcion: a.descripcion,
    medicos: (a.medico_areas ?? [])
      .map((ma: any) => ma.medicos)
      .filter((m: any) => m && m.activo)
      .map((m: any) => ({ id: m.id, nombre: m.nombre, especialidad: m.especialidad })),
  }));
}

export async function listarTratamientos(areaNombre?: string) {
  let q = supabase
    .from("tratamientos")
    .select("id, nombre, descripcion, precio_eur, requiere_valoracion, duracion_min, areas ( nombre )")
    .eq("activo", true);
  const { data, error } = await q;
  if (error) throw error;
  let lista = (data ?? []).map((t: any) => ({
    id: t.id,
    nombre: t.nombre,
    descripcion: t.descripcion,
    area: t.areas?.nombre ?? null,
    precio_eur: t.precio_eur,
    requiere_valoracion: t.requiere_valoracion,
    duracion_min: t.duracion_min,
  }));
  if (areaNombre) {
    const n = areaNombre.toLowerCase();
    lista = lista.filter((t) => (t.area ?? "").toLowerCase().includes(n));
  }
  return lista;
}

// ---------- Agenda ----------

/** Huecos libres de un médico en una fecha (respetando horario, citas y bloqueos). */
export async function huecosDisponibles(medicoId: number, fecha: string, duracionMin: number) {
  const dow = diaSemana(fecha);

  const [horarios, citas, bloqueos] = await Promise.all([
    supabase.from("horarios").select("hora_inicio, hora_fin").eq("medico_id", medicoId).eq("dia_semana", dow),
    supabase
      .from("citas")
      .select("inicio, fin")
      .eq("medico_id", medicoId)
      .in("estado", ["pendiente", "confirmada"])
      .gte("fin", madridAUtc(fecha, "00:00").toISOString())
      .lte("inicio", madridAUtc(fecha, "23:59").toISOString()),
    supabase
      .from("bloqueos")
      .select("inicio, fin")
      .eq("medico_id", medicoId)
      .gte("fin", madridAUtc(fecha, "00:00").toISOString())
      .lte("inicio", madridAUtc(fecha, "23:59").toISOString()),
  ]);
  if (horarios.error) throw horarios.error;
  if (citas.error) throw citas.error;
  if (bloqueos.error) throw bloqueos.error;

  const ocupado = [
    ...(citas.data ?? []).map((c) => ({ ini: new Date(c.inicio), fin: new Date(c.fin) })),
    ...(bloqueos.data ?? []).map((b) => ({ ini: new Date(b.inicio), fin: new Date(b.fin) })),
  ];
  const ahora = new Date();
  const huecos: string[] = [];

  for (const h of horarios.data ?? []) {
    const iniStr = String(h.hora_inicio).slice(0, 5);
    const finStr = String(h.hora_fin).slice(0, 5);
    let slot = madridAUtc(fecha, iniStr);
    const finTramo = madridAUtc(fecha, finStr);
    while (sumarMin(slot, duracionMin) <= finTramo) {
      const slotFin = sumarMin(slot, duracionMin);
      const pisado = ocupado.some((o) => slot < o.fin && slotFin > o.ini);
      if (!pisado && slot > ahora) huecos.push(horaMadrid(slot));
      slot = sumarMin(slot, duracionMin);
    }
  }
  return huecos; // ["09:00","09:30",...]
}

/**
 * Las 3 citas disponibles más cercanas de un médico.
 * - Sin preferencia: las 3 primeras a partir de hoy (o de fecha_preferida).
 * - Con fecha+hora preferida: las 3 más próximas a esa hora ese día (antes o
 *   después); si ese día no hay suficientes, completa con los siguientes días.
 */
export async function citasCercanas(
  medicoId: number,
  duracionMin: number,
  fechaPref: string | null,
  horaPref: string | null,
  excluir: { fecha: string; hora: string } | null = null
): Promise<{ fecha: string; hora: string }[]> {
  const { hoyMadrid, sumarDias } = await import("./tiempo.js");
  const base = fechaPref ?? hoyMadrid();
  const todos: { fecha: string; hora: string }[] = [];

  for (let d = 0; d < 21; d++) {
    const fecha = sumarDias(base, d);
    const huecos = await huecosDisponibles(medicoId, fecha, duracionMin);
    for (const hora of huecos) {
      if (excluir && excluir.fecha === fecha && excluir.hora === hora) continue; // no reofrecer el hueco recién cancelado
      todos.push({ fecha, hora });
    }
    // Sin hora preferida basta con las 3 primeras; con hora preferida
    // necesitamos el día pedido completo + reserva de días siguientes.
    if (!horaPref && todos.length >= 3) break;
    if (horaPref && d > 0 && todos.length >= 6) break;
  }

  if (horaPref && fechaPref) {
    const aMin = (h: string) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10);
    const pref = aMin(horaPref);
    const delDia = todos
      .filter((t) => t.fecha === fechaPref)
      .sort((a, b) => Math.abs(aMin(a.hora) - pref) - Math.abs(aMin(b.hora) - pref))
      .slice(0, 3);
    const resto = todos.filter((t) => t.fecha !== fechaPref).slice(0, 3 - delDia.length);
    return [...delDia, ...resto].slice(0, 3);
  }
  return todos.slice(0, 3);
}

export async function crearCita(
  clienteId: number,
  medicoId: number,
  tratamientoId: number | null,
  fecha: string,
  hora: string,
  duracionMin: number,
  notas: string | null
): Promise<{ ok: boolean; citaId?: number; conflicto?: boolean; duplicadaMismoDia?: boolean }> {
  const inicio = madridAUtc(fecha, hora);
  const fin = sumarMin(inicio, duracionMin);

  // Regla de negocio: se permiten varias citas el mismo día si son de
  // tratamientos/áreas distintos, pero NO dos citas "de lo mismo" el mismo día
  // (mismo tratamiento, o mismo médico si la cita no lleva tratamiento).
  let dup = supabase
    .from("citas")
    .select("id")
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", madridAUtc(fecha, "00:00").toISOString())
    .lte("inicio", madridAUtc(fecha, "23:59").toISOString());
  dup = tratamientoId !== null ? dup.eq("tratamiento_id", tratamientoId) : dup.eq("medico_id", medicoId);
  const { data: repetidas, error: eDup } = await dup;
  if (eDup) throw eDup;
  if ((repetidas?.length ?? 0) > 0) return { ok: false, duplicadaMismoDia: true };
  const { data, error } = await supabase
    .from("citas")
    .insert({
      cliente_id: clienteId,
      medico_id: medicoId,
      tratamiento_id: tratamientoId,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      notas,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23P01") return { ok: false, conflicto: true }; // solapamiento
    throw error;
  }
  void auditarBot("bot.cita.crear", { tipo: "cita", id: data.id }, { cliente_id: clienteId, medico_id: medicoId, fecha, hora });
  return { ok: true, citaId: data.id };
}

export async function citasDeCliente(clienteId: number) {
  const { data, error } = await supabase
    .from("citas")
    .select("id, inicio, estado, confirmada_cliente, medicos ( nombre ), tratamientos ( nombre )")
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio");
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    inicio: c.inicio,
    estado: c.estado,
    confirmada: c.confirmada_cliente,
    medico: c.medicos?.nombre,
    tratamiento: c.tratamientos?.nombre ?? null,
  }));
}

/**
 * Cancela una cita SOLO si pertenece a ese cliente. Al pasar a 'cancelada'
 * el hueco queda libre automáticamente (la agenda solo bloquea citas
 * pendientes/confirmadas). Devuelve los datos del hueco liberado para poder
 * excluirlo si el cliente reprograma.
 */
export async function cancelarCita(
  citaId: number,
  clienteId: number
): Promise<{ ok: boolean; hueco_liberado?: { fecha: string; hora: string; medico_id: number } }> {
  const { fechaMadrid, horaMadrid: hMad } = await import("./tiempo.js");
  const { data, error } = await supabase
    .from("citas")
    .update({ estado: "cancelada" })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente", "confirmada"])
    .select("id, inicio, medico_id");
  if (error) throw error;
  const fila = data?.[0];
  if (!fila) return { ok: false };
  const inicio = new Date(fila.inicio);
  void auditarBot("bot.cita.cancelar", { tipo: "cita", id: citaId }, { cliente_id: clienteId });
  return {
    ok: true,
    hueco_liberado: { fecha: fechaMadrid(inicio), hora: hMad(inicio), medico_id: fila.medico_id },
  };
}

/** Confirma asistencia SOLO si la cita es de ese cliente. */
export async function confirmarCita(citaId: number, clienteId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("citas")
    .update({ confirmada_cliente: true, estado: "confirmada" })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente", "confirmada"])
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// ---------- Recordatorios ----------

export async function citasParaRecordar(horasAntes: number) {
  const desde = new Date(Date.now() + (horasAntes - 0.5) * 3600_000);
  const hasta = new Date(Date.now() + (horasAntes + 0.5) * 3600_000);
  const { data, error } = await supabase
    .from("citas")
    .select("id, inicio, clientes ( id, telefono, nombre ), medicos ( nombre ), tratamientos ( nombre )")
    .in("estado", ["pendiente", "confirmada"])
    .eq("recordatorio_enviado", false)
    .gte("inicio", desde.toISOString())
    .lte("inicio", hasta.toISOString());
  if (error) throw error;
  return data ?? [];
}

export async function marcarRecordatorioEnviado(citaId: number) {
  const { error } = await supabase.from("citas").update({ recordatorio_enviado: true }).eq("id", citaId);
  if (error) throw error;
}

// ---------- Conversación ----------

export async function guardarMensaje(telefono: string, direccion: "entrante" | "saliente", contenido: string) {
  const { error } = await supabase.from("historial_chat").insert({
    session_id: telefono,
    message: { role: direccion === "entrante" ? "user" : "assistant", content: contenido },
  });
  if (error) console.error("Error guardando mensaje:", error.message);
}

export async function historial(telefono: string, limite: number) {
  const { data, error } = await supabase
    .from("historial_chat")
    .select("message")
    .eq("session_id", telefono)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? [])
    .reverse()
    .map((r) => r.message as { role: string; content: string })
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
}

/** Registra una solicitud de derechos RGPD llegada por WhatsApp. */
export async function crearSolicitudDerechos(
  telefono: string,
  tipoDerecho: string,
  descripcion: string | null
): Promise<{ ok: boolean; error?: string }> {
  const validos = ["acceso", "rectificacion", "supresion", "portabilidad", "oposicion", "limitacion"];
  if (!validos.includes(tipoDerecho)) return { ok: false, error: "Tipo de derecho no válido" };
  const cliente = await clientePorTelefono(telefono);
  const { error } = await supabase.from("derechos_arco").insert({
    cliente_id: cliente?.id ?? null,
    nombre: cliente ? [cliente.nombre, cliente.apellidos].filter(Boolean).join(" ") : null,
    contacto: telefono,
    tipo_derecho: tipoDerecho,
    descripcion,
    canal: "whatsapp",
  });
  if (error) return { ok: false, error: error.message };
  void auditarBot("rgpd.derecho_arco.solicitud", { tipo: "derecho_arco", label: `${tipoDerecho} · ${telefono}` }, { canal: "whatsapp" });
  return { ok: true };
}

export async function escalarARecepcion(telefono: string, motivo: string) {
  const { error } = await supabase.from("escalados").insert({ telefono, motivo });
  if (error) throw error;
}

let faqCache: { texto: string; hasta: number } | null = null;

export async function faqTexto(): Promise<string> {
  if (faqCache && Date.now() < faqCache.hasta) return faqCache.texto;
  const { data, error } = await supabase.from("faq").select("pregunta, respuesta").eq("activo", true);
  if (error) {
    console.error("Error cargando FAQ:", error.message);
    return faqCache?.texto ?? "";
  }
  const texto = (data ?? []).map((f) => `- P: ${f.pregunta}\n  R: ${f.respuesta}`).join("\n");
  faqCache = { texto, hasta: Date.now() + 5 * 60 * 1000 };
  return texto;
}

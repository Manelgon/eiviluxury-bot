import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { madridAUtc, diaSemana, sumarMin, horaMadrid } from "./tiempo.js";

// Esquema "eivi" — requiere añadirlo en Supabase → Settings → API → Exposed schemas
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
  db: { schema: "eivi" },
});

// ---------- Pacientes ----------

export interface Paciente {
  id: number;
  nombre: string | null;
  apellidos: string | null;
  email: string | null;
  consentimiento_rgpd: boolean;
  alta_completa?: boolean;
}

/**
 * REGLA DE ORO: el bot lee al paciente SOLO por la vista `pacientes_bot`
 * (contacto y comercial). Jamás la tabla completa: ni DNI, ni dirección,
 * ni fecha de nacimiento, ni nada clínico. Eso es de recepción y médicos.
 */
export async function pacientePorTelefono(telefono: string): Promise<Paciente | null> {
  const COLUMNAS_CONTACTO = "id, nombre, apellidos, email, consentimiento_rgpd, alta_completa";
  const { data, error } = await supabase
    .from("pacientes_bot")
    .select(COLUMNAS_CONTACTO)
    .eq("telefono", telefono)
    .eq("activo", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    // Salvavidas: si la vista no existe (PGRST205), caer a la tabla con LAS MISMAS
    // columnas de contacto (la minimización se mantiene) y avisar a gritos en el log.
    if ((error as any).code === "PGRST205") {
      console.error("⚠⚠ FALTA LA VISTA eivi.pacientes_bot (ejecutar patch 19). Usando fallback restringido a columnas de contacto.");
      const fb = await supabase
        .from("pacientes")
        .select(COLUMNAS_CONTACTO)
        .eq("telefono", telefono)
        .eq("activo", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (fb.error) throw fb.error;
      return fb.data;
    }
    throw error;
  }
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
export async function registrarConsentimiento(pacienteId: number, tipo: string, aceptado: boolean, texto: string) {
  const { error } = await supabase.from("consentimientos").insert({
    paciente_id: pacienteId, tipo, aceptado, texto, canal: "whatsapp",
  });
  if (error) console.error("Error registrando consentimiento:", error.message);
  void auditarBot("bot.consentimiento.registrar", { tipo: "paciente", id: pacienteId }, { tipo_consentimiento: tipo, aceptado });
}

/**
 * Guardado incremental del alta: cada dato se persiste en cuanto el paciente
 * lo confirma. Regla RGPD: si el paciente aún no existe, el PRIMER dato que
 * se guarda tiene que ser el consentimiento aceptado — sin él no se crea fila.
 */
export async function guardarDatoPaciente(
  telefono: string,
  campos: {
    consentimiento?: boolean;
    nombre?: string;
    apellidos?: string;
    email?: string;
    telefonoContacto?: string;
    publicidad?: boolean;
  }
): Promise<{ ok: boolean; error?: string; paciente?: Paciente }> {
  const existente = await pacientePorTelefono(telefono);

  if (!existente) {
    if (!campos.consentimiento) {
      return { ok: false, error: "Primero debe aceptar la política de privacidad; sin eso no se guarda ningún dato" };
    }
    const { data, error } = await supabase
      .from("pacientes")
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
    void auditarBot("bot.paciente.crear", { tipo: "paciente", id: data.id, label: telefono });
    return { ok: true, paciente: data };
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
  if (Object.keys(cambios).length === 0) return { ok: true, paciente: existente };

  const { data, error } = await supabase
    .from("pacientes")
    .update(cambios)
    .eq("id", existente.id)
    .select("id, nombre, apellidos, email, consentimiento_rgpd")
    .single();
  if (error) throw error;
  return { ok: true, paciente: data };
}

// ---------- Catálogo ----------

export async function listarAreasConMedicos() {
  const { data, error } = await supabase
    .from("areas")
    .select("id, nombre, descripcion, medico_areas ( medicos ( id, nombre, activo, tipo ) )")
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return (data ?? []).map((a: any) => {
    // Solo médicos ACTIVOS: las enfermeras también pertenecen a áreas, pero el
    // bot no ofrece citas con ellas (son apoyo), y un médico desactivado no existe para el bot
    const medicos = (a.medico_areas ?? [])
      .map((ma: any) => ma.medicos)
      .filter((m: any) => m && m.activo && m.tipo !== "enfermera")
      .map((m: any) => ({ id: m.id, nombre: m.nombre }));
    return {
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion,
      medicos,
      disponible: medicos.length > 0, // false = sin médico activo: "no disponible por ahora" + escalar
    };
  });
}

/** Áreas que tienen al menos un médico ACTIVO (para marcar disponibilidad de tratamientos). */
async function areasConMedicoActivo(): Promise<Set<number>> {
  const { data } = await supabase
    .from("medico_areas")
    .select("area_id, medicos!inner ( activo, tipo )")
    .eq("medicos.activo", true)
    .neq("medicos.tipo", "enfermera");
  return new Set((data ?? []).map((x: any) => x.area_id));
}

export async function listarTratamientos(areaNombre?: string) {
  const [{ data, error }, disponibles] = await Promise.all([
    supabase
      .from("tratamientos")
      .select("id, nombre, descripcion, precio_eur, requiere_valoracion, duracion_min, area_id, areas ( nombre )")
      .eq("activo", true),
    areasConMedicoActivo(),
  ]);
  if (error) throw error;
  let lista = (data ?? []).map((t: any) => ({
    id: t.id,
    nombre: t.nombre,
    descripcion: t.descripcion,
    area: t.areas?.nombre ?? null,
    precio_eur: t.precio_eur,
    requiere_valoracion: t.requiere_valoracion,
    duracion_min: t.duracion_min,
    // Sin médico activo en su área → no se puede reservar: "no disponible por ahora" + escalar
    disponible: t.area_id === null ? true : disponibles.has(t.area_id),
  }));
  if (areaNombre) {
    const n = areaNombre.toLowerCase();
    lista = lista.filter((t) => (t.area ?? "").toLowerCase().includes(n));
  }
  return lista;
}

// ---------- Médico de referencia por área ----------

/** Médicos asignados (de referencia) del paciente, por área. */
export async function medicosAsignados(pacienteId: number) {
  const { data, error } = await supabase
    .from("paciente_medico_area")
    .select("medico_id, area_id, medicos ( nombre ), areas ( nombre )")
    .eq("paciente_id", pacienteId)
    .eq("activo", true);
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    medico_id: a.medico_id,
    medico: a.medicos?.nombre ?? null,
    area_id: a.area_id,
    area: a.areas?.nombre ?? null,
  }));
}

/**
 * Al confirmarse una cita: si el paciente aún no tiene médico de referencia
 * en el área de esa cita, el médico de la cita queda asignado.
 * El área se deduce del tratamiento; si la cita no lleva tratamiento, del
 * médico SOLO si pertenece a una única área (si tiene varias, no se adivina).
 */
async function asegurarMedicoDeReferencia(
  pacienteId: number,
  medicoId: number,
  tratamientoId: number | null
): Promise<{ area: string; medico: string } | null> {
  try {
    let areaId: number | null = null;
    if (tratamientoId !== null) {
      const { data } = await supabase.from("tratamientos").select("area_id").eq("id", tratamientoId).maybeSingle();
      areaId = data?.area_id ?? null;
    }
    if (areaId === null) {
      const { data } = await supabase.from("medico_areas").select("area_id").eq("medico_id", medicoId);
      if ((data?.length ?? 0) === 1) areaId = data![0].area_id;
    }
    if (areaId === null) return null;

    // ¿El médico pertenece a ese área? (la FK compuesta lo exige)
    const { data: pertenece } = await supabase
      .from("medico_areas").select("area_id").eq("medico_id", medicoId).eq("area_id", areaId).maybeSingle();
    if (!pertenece) return null;

    // ¿Ya hay médico de referencia activo en el área?
    const { data: ya } = await supabase
      .from("paciente_medico_area").select("id")
      .eq("paciente_id", pacienteId).eq("area_id", areaId).eq("activo", true).limit(1);
    if ((ya?.length ?? 0) > 0) return null;

    const { error } = await supabase
      .from("paciente_medico_area")
      .insert({ paciente_id: pacienteId, medico_id: medicoId, area_id: areaId });
    if (error) return null; // carrera con otra asignación: no pasa nada

    const [{ data: m }, { data: a }] = await Promise.all([
      supabase.from("medicos").select("nombre").eq("id", medicoId).maybeSingle(),
      supabase.from("areas").select("nombre").eq("id", areaId).maybeSingle(),
    ]);
    void auditarBot("bot.asignacion.crear", { tipo: "asignacion", label: `paciente ${pacienteId}` },
      { paciente_id: pacienteId, medico_id: medicoId, area_id: areaId, origen: "cita" });
    return { area: a?.nombre ?? `área ${areaId}`, medico: m?.nombre ?? `médico ${medicoId}` };
  } catch (e) {
    console.error("asegurarMedicoDeReferencia falló:", e);
    return null;
  }
}

// ---------- Lista de espera ----------

/** Apunta al paciente a la lista de espera de un área (única entrada pendiente por área). */
export async function apuntarListaEspera(
  pacienteId: number,
  areaId: number,
  medicoId: number | null,
  tratamientoId: number | null,
  preferencia: string | null
): Promise<{ ok: boolean; ya_apuntado?: boolean }> {
  const { error } = await supabase.from("lista_espera").insert({
    paciente_id: pacienteId,
    area_id: areaId,
    medico_id: medicoId,
    tratamiento_id: tratamientoId,
    preferencia,
    creada_via: "bot",
  });
  if (error) {
    if (error.code === "23505") return { ok: true, ya_apuntado: true }; // ya estaba pendiente en ese área
    throw error;
  }
  void auditarBot("bot.lista_espera.crear", { tipo: "lista_espera", label: `paciente ${pacienteId}` },
    { paciente_id: pacienteId, area_id: areaId, medico_id: medicoId, preferencia });
  return { ok: true };
}

// ---------- Agenda ----------

/**
 * Huecos libres de un médico en una fecha (respetando horario, citas,
 * bloqueos y su ANTELACIÓN mínima de reserva).
 * EMPAQUETADO COMPACTO: los huecos se proponen pegados — el primero
 * arranca donde empieza el tramo (o donde acaba la cita anterior), y
 * al chocar con una cita el siguiente arranca justo cuando esta termina.
 * Así la agenda se llena sin ratos muertos aunque cada tratamiento
 * dure distinto (60', 40', 30'...).
 */
export async function huecosDisponibles(medicoId: number, fecha: string, duracionMin: number) {
  const dow = diaSemana(fecha);

  const [horarios, citas, bloqueos, ficha] = await Promise.all([
    supabase.from("horarios").select("hora_inicio, hora_fin").eq("medico_id", medicoId).eq("dia_semana", dow),
    supabase
      .from("citas")
      .select("inicio, fin")
      .or(`medico_id.eq.${medicoId},enfermera_id.eq.${medicoId}`) // también cuenta si está de apoyo
      .in("estado", ["pendiente", "confirmada"])
      .gte("fin", madridAUtc(fecha, "00:00").toISOString())
      .lte("inicio", madridAUtc(fecha, "23:59").toISOString()),
    supabase
      .from("bloqueos")
      .select("inicio, fin")
      .eq("medico_id", medicoId)
      .gte("fin", madridAUtc(fecha, "00:00").toISOString())
      .lte("inicio", madridAUtc(fecha, "23:59").toISOString()),
    supabase.from("medicos").select("antelacion_horas, tolerancia_fin_min").eq("id", medicoId).maybeSingle(),
  ]);
  if (horarios.error) throw horarios.error;
  if (citas.error) throw citas.error;
  if (bloqueos.error) throw bloqueos.error;

  const ocupado = [
    ...(citas.data ?? []).map((c) => ({ ini: new Date(c.inicio), fin: new Date(c.fin) })),
    ...(bloqueos.data ?? []).map((b) => ({ ini: new Date(b.inicio), fin: new Date(b.fin) })),
  ].sort((a, b) => a.ini.getTime() - b.ini.getTime());

  // Antelación mínima del médico (freelancer): 0 = acepta huecos al momento
  const antelacionHoras = (ficha.data as any)?.antelacion_horas ?? 0;
  const minInicio = new Date(Date.now() + antelacionHoras * 3600_000);
  // Tolerancia de cierre: minutos que el médico acepta alargar al FINAL del
  // tramo para no perder el último hueco del día (el hueco debe EMPEZAR
  // dentro del horario; solo puede PASARSE hasta la tolerancia).
  const toleranciaMin = (ficha.data as any)?.tolerancia_fin_min ?? 0;
  const huecos: string[] = [];

  for (const h of horarios.data ?? []) {
    const iniStr = String(h.hora_inicio).slice(0, 5);
    const finStr = String(h.hora_fin).slice(0, 5);
    const finTramo = madridAUtc(fecha, finStr);
    const finConTolerancia = sumarMin(finTramo, toleranciaMin);
    let cursor = madridAUtc(fecha, iniStr);
    if (cursor < minInicio) cursor = minInicio; // no ofrecer antes de la antelación
    while (cursor < finTramo && sumarMin(cursor, duracionMin) <= finConTolerancia) {
      const slotFin = sumarMin(cursor, duracionMin);
      const choque = ocupado.find((o) => cursor < o.fin && slotFin > o.ini);
      if (choque) {
        cursor = choque.fin > cursor ? new Date(choque.fin) : slotFin; // compacto: pegado al final de lo ocupado
        continue;
      }
      huecos.push(horaMadrid(cursor));
      cursor = slotFin; // el siguiente hueco, pegado al anterior
    }
  }
  return huecos; // ej. ["09:00","10:00","10:40",...] según duraciones reales
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
  excluir: { fecha: string; hora: string } | null = null,
  maxDias = 21, // ventana de búsqueda; 7 = "esta semana" (prioridad del médico de referencia)
  franja: "manana" | "tarde" | null = null // "por las mañanas" (<14:00) / "por las tardes" (≥14:00)
): Promise<{ fecha: string; hora: string }[]> {
  const { hoyMadrid, sumarDias } = await import("./tiempo.js");
  const base = fechaPref ?? hoyMadrid();
  const todos: { fecha: string; hora: string }[] = [];

  for (let d = 0; d < maxDias; d++) {
    const fecha = sumarDias(base, d);
    const huecos = await huecosDisponibles(medicoId, fecha, duracionMin);
    for (const hora of huecos) {
      if (excluir && excluir.fecha === fecha && excluir.hora === hora) continue; // no reofrecer el hueco recién cancelado
      if (franja === "manana" && hora >= "14:00") continue;
      if (franja === "tarde" && hora < "14:00") continue;
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
  pacienteId: number,
  medicoId: number,
  tratamientoId: number | null,
  fecha: string,
  hora: string,
  duracionMin: number,
  notas: string | null
): Promise<{ ok: boolean; citaId?: number; conflicto?: boolean; duplicadaMismoDia?: boolean; nuevoMedicoReferencia?: { area: string; medico: string } }> {
  const inicio = madridAUtc(fecha, hora);
  const fin = sumarMin(inicio, duracionMin);

  // Regla de negocio: se permiten varias citas el mismo día si son de
  // tratamientos/áreas distintos, pero NO dos citas "de lo mismo" el mismo día
  // (mismo tratamiento, o mismo médico si la cita no lleva tratamiento).
  let dup = supabase
    .from("citas")
    .select("id")
    .eq("paciente_id", pacienteId)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", madridAUtc(fecha, "00:00").toISOString())
    .lte("inicio", madridAUtc(fecha, "23:59").toISOString());
  dup = tratamientoId !== null ? dup.eq("tratamiento_id", tratamientoId) : dup.eq("medico_id", medicoId);
  const { data: repetidas, error: eDup } = await dup;
  if (eDup) throw eDup;
  if ((repetidas?.length ?? 0) > 0) return { ok: false, duplicadaMismoDia: true };
  const { hoyMadrid: hoyM } = await import("./tiempo.js");
  const { data, error } = await supabase
    .from("citas")
    .insert({
      paciente_id: pacienteId,
      medico_id: medicoId,
      tratamiento_id: tratamientoId,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      notas,
      reactiva: fecha === hoyM(), // ⚡ reserva de hoy para hoy → alerta a recepción
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23P01") return { ok: false, conflicto: true }; // solapamiento
    throw error;
  }
  void auditarBot("bot.cita.crear", { tipo: "cita", id: data.id }, { paciente_id: pacienteId, medico_id: medicoId, fecha, hora });
  // Si el paciente no tenía médico de referencia en este área, el de la cita queda asignado
  const asignado = await asegurarMedicoDeReferencia(pacienteId, medicoId, tratamientoId);
  return { ok: true, citaId: data.id, nuevoMedicoReferencia: asignado ?? undefined };
}

export async function citasDePaciente(pacienteId: number) {
  const { data, error } = await supabase
    .from("citas")
    .select("id, inicio, estado, confirmada_paciente, medicos!citas_medico_id_fkey ( nombre ), tratamientos ( nombre )")
    .eq("paciente_id", pacienteId)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio");
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    inicio: c.inicio,
    estado: c.estado,
    confirmada: c.confirmada_paciente,
    medico: c.medicos?.nombre,
    tratamiento: c.tratamientos?.nombre ?? null,
  }));
}

/**
 * Cancela una cita SOLO si pertenece a ese paciente. Al pasar a 'cancelada'
 * el hueco queda libre automáticamente (la agenda solo bloquea citas
 * pendientes/confirmadas). Devuelve los datos del hueco liberado para poder
 * excluirlo si el paciente reprograma.
 */
export async function cancelarCita(
  citaId: number,
  pacienteId: number
): Promise<{ ok: boolean; hueco_liberado?: { fecha: string; hora: string; medico_id: number } }> {
  const { fechaMadrid, horaMadrid: hMad } = await import("./tiempo.js");
  const { data, error } = await supabase
    .from("citas")
    .update({ estado: "cancelada" })
    .eq("id", citaId)
    .eq("paciente_id", pacienteId)
    .in("estado", ["pendiente", "confirmada"])
    .select("id, inicio, medico_id");
  if (error) throw error;
  const fila = data?.[0];
  if (!fila) return { ok: false };
  const inicio = new Date(fila.inicio);
  void auditarBot("bot.cita.cancelar", { tipo: "cita", id: citaId }, { paciente_id: pacienteId });
  return {
    ok: true,
    hueco_liberado: { fecha: fechaMadrid(inicio), hora: hMad(inicio), medico_id: fila.medico_id },
  };
}

/** Confirma asistencia SOLO si la cita es de ese paciente. */
export async function confirmarCita(citaId: number, pacienteId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("citas")
    .update({ confirmada_paciente: true, estado: "confirmada" })
    .eq("id", citaId)
    .eq("paciente_id", pacienteId)
    .in("estado", ["pendiente", "confirmada"])
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// ---------- Avisos proactivos (cola que llena el panel) ----------

/** Avisos pendientes de enviar por WhatsApp (cancelaciones → lista de espera, reprogramaciones...). */
export async function avisosPendientes() {
  const { data, error } = await supabase
    .from("avisos")
    .select("id, telefono, mensaje, tipo")
    .eq("estado", "pendiente")
    .order("created_at")
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function marcarAviso(avisoId: number, estado: "enviado" | "fallido") {
  const { error } = await supabase
    .from("avisos")
    .update({ estado, enviado_at: new Date().toISOString() })
    .eq("id", avisoId);
  if (error) console.error("marcarAviso:", error.message);
  void auditarBot("bot.aviso." + estado, { tipo: "aviso", id: avisoId });
}

// ---------- Recordatorios ----------

export async function citasParaRecordar(horasAntes: number) {
  const desde = new Date(Date.now() + (horasAntes - 0.5) * 3600_000);
  const hasta = new Date(Date.now() + (horasAntes + 0.5) * 3600_000);
  const { data, error } = await supabase
    .from("citas")
    .select("id, inicio, pacientes ( id, telefono, nombre ), medicos!citas_medico_id_fkey ( nombre ), tratamientos ( nombre )")
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
  const paciente = await pacientePorTelefono(telefono);
  const { error } = await supabase.from("derechos_arco").insert({
    paciente_id: paciente?.id ?? null,
    nombre: paciente ? [paciente.nombre, paciente.apellidos].filter(Boolean).join(" ") : null,
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

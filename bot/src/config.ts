function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),

  evolutionUrl: req("EVOLUTION_API_URL"),
  evolutionApiKey: req("EVOLUTION_API_KEY"),
  evolutionInstance: req("EVOLUTION_INSTANCE"),

  openaiApiKey: req("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  supabaseUrl: req("SUPABASE_URL"),
  supabaseServiceKey: req("SUPABASE_SERVICE_ROLE_KEY"),

  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",

  debounceMs: parseInt(process.env.DEBOUNCE_MS ?? "8000", 10),
  historyLimit: parseInt(process.env.HISTORY_LIMIT ?? "24", 10),

  // Modo pruebas: solo responde a estos números (separados por comas, sin '+')
  numerosPermitidos: (process.env.NUMEROS_PERMITIDOS ?? "")
    .split(",")
    .map((n) => n.trim().replace(/^\+/, ""))
    .filter(Boolean),

  // Recordatorios: horas antes de la cita y cada cuántos min se revisa
  recordatorioHorasAntes: parseFloat(process.env.RECORDATORIO_HORAS ?? "24"),
  recordatorioIntervaloMin: parseInt(process.env.RECORDATORIO_INTERVALO_MIN ?? "5", 10),

  // Enlace de política de privacidad (consentimiento RGPD)
  privacidadUrl:
    process.env.PRIVACIDAD_URL ??
    "https://www.eiviluxury.com/aviso-legal-y-politica-de-privacidad/",
};

/** Utilidades de fecha/hora en zona Europe/Madrid. */

const TZ = "Europe/Madrid";

/** "YYYY-MM-DD" de hoy en Madrid. */
export function hoyMadrid(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}

/** Día de la semana (0=domingo..6=sábado) de una fecha "YYYY-MM-DD" en Madrid. */
export function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

/** Convierte fecha+hora de pared en Madrid ("2026-07-22","10:30") a Date UTC real. */
export function madridAUtc(fecha: string, hora: string): Date {
  const guess = new Date(`${fecha}T${hora}:00Z`);
  const wall = new Date(
    guess.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T") + "Z"
  );
  const offset = wall.getTime() - guess.getTime();
  return new Date(guess.getTime() - offset);
}

/** Formatea un instante para mensajes: "martes 22 de julio, 10:30". */
export function formatoLargo(d: Date): string {
  const f = d.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: TZ,
  });
  const h = d.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
  return `${f}, ${h}`;
}

/** "HH:MM" en Madrid de un instante. */
export function horaMadrid(d: Date): string {
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** Suma minutos a un Date. */
export function sumarMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

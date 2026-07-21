/**
 * Agrupación de mensajes secuenciales con Redis.
 *
 * Cuando alguien escribe varios mensajes seguidos ("hola", "mi hijo juan",
 * "no come hoy"), no queremos responder a cada uno: acumulamos los mensajes
 * en una lista de Redis y solo procesamos cuando pasan `debounceMs` sin
 * mensajes nuevos. Redis guarda el buffer (sobrevive a reinicios del bot)
 * y un timestamp del último mensaje para decidir cuándo "se hizo el silencio".
 */
import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const bufferKey = (tel: string) => `buf:${tel}`;
const lastKey = (tel: string) => `last:${tel}`;
const lockKey = (tel: string) => `lock:${tel}`;

const timers = new Map<string, NodeJS.Timeout>();

type Procesar = (telefono: string, textoAgrupado: string, pushName: string | null) => Promise<void>;

export async function encolarMensaje(
  telefono: string,
  texto: string,
  pushName: string | null,
  procesar: Procesar
): Promise<void> {
  const ahora = Date.now();
  await redis
    .multi()
    .rpush(bufferKey(telefono), texto)
    .set(lastKey(telefono), String(ahora))
    .expire(bufferKey(telefono), 3600)
    .expire(lastKey(telefono), 3600)
    .exec();

  programarTimer(telefono, pushName, procesar, config.debounceMs);
}

function programarTimer(telefono: string, pushName: string | null, procesar: Procesar, delayMs: number) {
  const previo = timers.get(telefono);
  if (previo) clearTimeout(previo);

  const t = setTimeout(async () => {
    timers.delete(telefono);
    try {
      const last = Number((await redis.get(lastKey(telefono))) ?? 0);
      const transcurrido = Date.now() - last;
      if (transcurrido < config.debounceMs - 100) {
        // Llegó otro mensaje mientras tanto: reprogramar el resto de espera
        programarTimer(telefono, pushName, procesar, config.debounceMs - transcurrido);
        return;
      }

      // Evita procesar dos veces el mismo lote (p. ej. con varios réplicas)
      const lock = await redis.set(lockKey(telefono), "1", "EX", 120, "NX");
      if (!lock) return;

      try {
        const partes = await redis.lrange(bufferKey(telefono), 0, -1);
        await redis.del(bufferKey(telefono));
        if (partes.length === 0) return;
        await procesar(telefono, partes.join("\n"), pushName);
      } finally {
        await redis.del(lockKey(telefono));
      }
    } catch (err) {
      console.error(`Error procesando lote de ${telefono}:`, err);
    }
  }, delayMs);

  timers.set(telefono, t);
}

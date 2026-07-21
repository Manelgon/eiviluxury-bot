import { config } from "./config.js";

async function evoPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${config.evolutionUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.evolutionApiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Evolution API ${path} → ${res.status}: ${text}`);
  }
}

/** Envía un mensaje de texto por WhatsApp. `numero` sin '+', ej: 34612345678 */
export async function enviarTexto(numero: string, texto: string): Promise<void> {
  await evoPost(`/message/sendText/${config.evolutionInstance}`, {
    number: numero,
    text: texto,
    delay: 1200, // pequeña pausa "humana"
  });
}

/** Muestra "escribiendo..." mientras el agente piensa (mejor UX, no crítico). */
export async function marcarEscribiendo(numero: string): Promise<void> {
  try {
    await evoPost(`/chat/sendPresence/${config.evolutionInstance}`, {
      number: numero,
      presence: "composing",
      delay: 5000,
    });
  } catch {
    /* no crítico */
  }
}

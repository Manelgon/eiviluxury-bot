/**
 * RAG: búsqueda semántica sobre las fichas de tratamientos (eivi.documentos).
 * - Ingesta automática: al arrancar, si la tabla está vacía, vectoriza los
 *   fragmentos de rag-contenido.json (incluidos en la imagen) y los inserta.
 * - Búsqueda: embedding de la pregunta + función eivi.match_documentos.
 */
import { readFileSync } from "fs";
import OpenAI from "openai";
import { supabase } from "./db.js";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const MODELO_EMB = "text-embedding-3-small";

async function embed(textos: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: MODELO_EMB, input: textos });
  return res.data.map((d) => d.embedding);
}

export async function ingestarSiVacio(): Promise<void> {
  try {
    const { count, error } = await supabase
      .from("documentos")
      .select("id", { count: "exact", head: true });
    if (error) {
      console.error("RAG: no se pudo comprobar eivi.documentos (¿ejecutaste rag.sql?):", error.message);
      return;
    }
    if ((count ?? 0) > 0) {
      console.log(`📚 RAG listo: ${count} fragmentos en eivi.documentos`);
      return;
    }

    const docs: { titulo: string; area: string; url: string; contenido: string }[] = JSON.parse(
      readFileSync(new URL("../rag-contenido.json", import.meta.url), "utf8")
    );
    console.log(`📚 RAG: tabla vacía, vectorizando ${docs.length} fragmentos...`);

    for (let i = 0; i < docs.length; i += 50) {
      const lote = docs.slice(i, i + 50);
      const embs = await embed(lote.map((d) => d.contenido));
      const filas = lote.map((d, j) => ({ ...d, embedding: embs[j] }));
      const { error: e } = await supabase.from("documentos").insert(filas);
      if (e) throw e;
      console.log(`📚 RAG: ${Math.min(i + 50, docs.length)}/${docs.length}`);
    }
    console.log("📚 RAG: ingesta completada");
  } catch (err) {
    console.error("RAG: error en la ingesta:", err);
  }
}

export async function buscarInformacion(consulta: string, n = 4) {
  const [emb] = await embed([consulta]);
  const { data, error } = await supabase.rpc("match_documentos", {
    query_embedding: emb,
    match_count: n,
  });
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    titulo: d.titulo,
    area: d.area,
    url: d.url,
    contenido: d.contenido,
  }));
}

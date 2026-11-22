// Cliente mínimo de la API de Gemini (Google AI Studio, nivel gratuito).
import { esperar, log } from "./util.mjs";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function llamar(modelo, cuerpo, intentos = 3) {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) throw new Error("Falta GEMINI_API_KEY (secreto de GitHub)");
  for (let i = 1; i <= intentos; i++) {
    const r = await fetch(`${BASE}/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(cuerpo),
    });
    if (r.ok) return r.json();
    const txt = await r.text();
    // 429 = cuota/limite por minuto; 5xx = error temporal de Google
    if ((r.status === 429 || r.status >= 500) && i < intentos) {
      const seg = Number((txt.match(/retry in (\d+(?:\.\d+)?)s/i) || [])[1]) || 20 * i;
      log(`Gemini ${modelo}: ${r.status}, reintento en ${Math.ceil(seg)} s`);
      await esperar(Math.min(seg, 70) * 1000);
      continue;
    }
    const err = new Error(`Gemini ${modelo} HTTP ${r.status}: ${txt.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
}

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    apta: { type: "BOOLEAN", description: "false si no es una noticia real de videojuegos (oferta, publicidad, guía, rumor sin base, contenido para adultos o tragedia sensible)" },
    motivo: { type: "STRING" },
    titulo: { type: "STRING", description: "Título original en español, informativo, sin clickbait, máx. 95 caracteres" },
    bajada: { type: "STRING", description: "Copete de 1 o 2 oraciones que resume la noticia" },
    categoria: { type: "STRING", enum: ["pc", "playstation", "xbox", "nintendo", "movil", "industria", "esports", "general"] },
    etiquetas: { type: "ARRAY", items: { type: "STRING" }, description: "3 a 6 etiquetas: juegos, empresas, plataformas" },
    cuerpo: {
      type: "ARRAY",
      description: "Bloques del artículo en orden",
      items: {
        type: "OBJECT",
        properties: { tipo: { type: "STRING", enum: ["p", "h2", "li"] }, texto: { type: "STRING" } },
        required: ["tipo", "texto"],
      },
    },
    clave: { type: "ARRAY", items: { type: "STRING" }, description: "3 a 5 puntos clave muy breves" },
    promptImagen: { type: "STRING", description: "Descripción en inglés de una ilustración de portada evocadora y genérica: sin texto, sin logos, sin personajes ni marcas registradas" },
    busquedaImagen: { type: "STRING", description: "2 a 4 palabras en inglés para buscar una foto de stock relacionada (ej: 'gaming console controller')" },
  },
  required: ["apta", "titulo", "bajada", "categoria", "etiquetas", "cuerpo", "clave", "promptImagen", "busquedaImagen"],
};

const SISTEMA = `Sos redactor/a de un medio de noticias de videojuegos para Argentina y Latinoamérica.
Escribís en español neutro con tono rioplatense suave (sin voseo exagerado), claro y profesional.
Reglas obligatorias:
- Escribí una nota ORIGINAL. Nunca traduzcas ni copies frases de las fuentes: reorganizá la información con tu propia estructura y palabras.
- Combiná lo que dicen todas las fuentes y explicá qué cambió, por qué importa y qué contexto previo tiene (franquicia, empresa, plataforma, lanzamientos anteriores) solo si estás seguro de ese contexto.
- No inventes datos, cifras, fechas, precios ni citas. Si algo es rumor o no está confirmado, decilo explícitamente.
- Si hay precios en dólares o euros, mencionalos tal cual; no conviertas a pesos.
- Estructura: 1 párrafo de entrada fuerte, 2 a 4 subtítulos (h2) con 1 a 3 párrafos cada uno; podés usar una lista (li) corta si suma. Entre 380 y 650 palabras.
- No menciones que sos una IA, no hables de "las fuentes" en el texto ni nombres los medios: los enlaces se agregan aparte.
- Sin emojis, sin mayúsculas sostenidas, sin clickbait.`;

export async function redactarNota(grupo, cfg, aviso = "") {
  const fuentes = grupo.map((it, i) => `### Fuente ${i + 1} (${it.idioma}) - ${it.fecha.slice(0, 10)}
Título: ${it.titulo}
Resumen: ${it.resumen}
Texto: ${(it.texto || it.contenido || "").slice(0, 4000)}`).join("\n\n");
  const prompt = `Escribí una nota a partir de esta información sobre una misma noticia.${aviso ? "\nIMPORTANTE: " + aviso : ""}\n\n${fuentes}`;

  if (process.env.GEMINI_MOCK) return notaDePrueba(grupo);

  let ultimoError;
  for (const modelo of cfg.ia.modelosTexto) {
    try {
      const res = await llamar(modelo, {
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: cfg.ia.temperatura ?? 0.8, responseMimeType: "application/json", responseSchema: ESQUEMA },
      });
      const txt = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!txt) throw new Error("respuesta vacía (" + (res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || "?") + ")");
      const nota = JSON.parse(txt);
      nota.modelo = modelo;
      return nota;
    } catch (e) { ultimoError = e; log(`Texto con ${modelo} falló: ${e.message}`); }
  }
  throw ultimoError;
}

const ESQUEMA_UPD = {
  type: "OBJECT",
  properties: {
    hayNovedad: { type: "BOOLEAN", description: "true solo si las fuentes nuevas traen datos concretos que la nota NO tiene (fecha, precio, plataforma, confirmación, declaración, cifra, cambio). Repetir lo mismo con otras palabras = false" },
    resumen: { type: "STRING", description: "Qué hay de nuevo, en una frase corta" },
    bloques: { type: "ARRAY", description: "1 a 3 párrafos (p) con SOLO la información nueva y su contexto, escrita con tus palabras", items: { type: "OBJECT", properties: { tipo: { type: "STRING", enum: ["p", "li"] }, texto: { type: "STRING" } }, required: ["tipo", "texto"] } },
    bajada: { type: "STRING", description: "Copete actualizado si la novedad cambia lo principal; si no, vacío" },
    clave: { type: "ARRAY", items: { type: "STRING" }, description: "Puntos clave actualizados (3 a 5)" },
  },
  required: ["hayNovedad", "resumen", "bloques"],
};

// Compara una nota publicada con fuentes nuevas del mismo tema y redacta la actualización.
export async function revisarNovedades(nota, nuevas, cfg) {
  if (process.env.GEMINI_MOCK) return { hayNovedad: true, resumen: "Dato nuevo de prueba", bloques: [{ tipo: "p", texto: "Actualización de prueba con información nueva sobre el tema, generada sin IA para verificar que el sitio agrega la sección de actualización, suma las fuentes y cambia la fecha de modificación de la nota correctamente. Se agrega una oración más para que el control de extensión mínima la acepte sin problemas." }], bajada: "", clave: [] };
  const actual = [nota.titulo, nota.bajada, ...nota.cuerpo.map((b) => b.texto), ...(nota.actualizaciones || []).flatMap((a) => a.bloques.map((b) => b.texto))].join("\n");
  const fuentes = nuevas.map((it, i) => `### Fuente nueva ${i + 1} (${it.idioma}) - ${it.fecha.slice(0, 10)}\nTítulo: ${it.titulo}\nResumen: ${it.resumen}\nTexto: ${(it.texto || it.contenido || "").slice(0, 3500)}`).join("\n\n");
  const prompt = `Esta es una nota que YA publicamos:\n"""\n${actual.slice(0, 6000)}\n"""\n\nAparecieron estas fuentes nuevas sobre el mismo tema. Decidí si traen información nueva y concreta que la nota no tiene. Si la traen, escribí solo esa novedad como actualización breve.\n\n${fuentes}`;
  let ultimoError;
  for (const modelo of cfg.ia.modelosTexto) {
    try {
      const res = await llamar(modelo, {
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: ESQUEMA_UPD },
      });
      const txt = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!txt) throw new Error("respuesta vacía");
      return JSON.parse(txt);
    } catch (e) { ultimoError = e; log(`Revisión con ${modelo} falló: ${e.message}`); }
  }
  throw ultimoError;
}

// Devuelve un Buffer con la imagen generada o null.
export async function generarImagen(prompt, cfg) {
  if (process.env.GEMINI_MOCK) return null;
  const texto = `Editorial cover illustration for a video game news article, wide 16:9 composition, cinematic lighting, rich colors, digital painting. Scene: ${prompt}. Do not include any text, letters, logos, watermarks, brand names, or recognizable copyrighted characters.`;
  const res = await llamar(cfg.ia.modeloImagen, {
    contents: [{ role: "user", parts: [{ text: texto }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
  }, 2);
  const parte = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  return parte ? Buffer.from(parte.inlineData.data, "base64") : null;
}

function notaDePrueba(grupo) {
  const t = grupo[0].titulo;
  const p = (n) => `Párrafo de prueba ${n} sobre "${t}". ` + "Este texto se genera sin conectarse a Gemini para probar el armado del sitio, la plantilla, las categorías y las imágenes de portada. ".repeat(4);
  return {
    apta: true, modelo: "mock",
    titulo: `[Prueba] ${t}`.slice(0, 95),
    bajada: "Nota de ejemplo generada en modo de prueba, sin IA.",
    categoria: /nintendo|switch/i.test(t) ? "nintendo" : /playstation|ps5/i.test(t) ? "playstation" : /xbox/i.test(t) ? "xbox" : /steam|pc/i.test(t) ? "pc" : "general",
    etiquetas: [...new Set(t.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 4))],
    cuerpo: [{ tipo: "p", texto: p(1) }, { tipo: "h2", texto: "Qué se sabe" }, { tipo: "p", texto: p(2) }, { tipo: "li", texto: "Un punto de lista" }, { tipo: "li", texto: "Otro punto" }, { tipo: "h2", texto: "Por qué importa" }, { tipo: "p", texto: p(3) }],
    clave: ["Primer dato clave", "Segundo dato clave", "Tercer dato clave"],
    promptImagen: "a glowing game controller on a desk at night",
    busquedaImagen: "video game controller",
  };
}

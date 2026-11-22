// Cliente mínimo de la API de Gemini (Google AI Studio, nivel gratuito).
import { esperar, log } from "./util.mjs";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const saturados = new Set(); // modelos que dieron 503 en esta corrida
const modelosDisponibles = (lista) => { const ok = lista.filter((m) => !saturados.has(m)); return ok.length ? ok : lista; };
const anotarFallo = (modelo, e) => { if (e.status >= 500) saturados.add(modelo); };

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
    // 429 = cuota/limite por minuto; 5xx = Google saturado: un solo reintento corto y se pasa al otro modelo
    if (r.status >= 500 && i < Math.min(intentos, 2)) {
      log(`Gemini ${modelo}: ${r.status}, reintento en 10 s`);
      await esperar(10000);
      continue;
    }
    if (r.status === 429 && i < intentos) {
      const seg = Number((txt.match(/retry in (\d+(?:\.\d+)?)s/i) || [])[1]) || 20 * i;
      log(`Gemini ${modelo}: ${r.status}, reintento en ${Math.ceil(seg)} s`);
      await esperar(Math.min(seg, 70) * 1000);
      continue;
    }
    // Si Google retiró el modelo y sugiere otro, se usa el sugerido automáticamente
    const sugerido = r.status === 404 && (txt.match(/update to (?:models\/)?([a-z0-9.\-]*[a-z0-9])/i) || [])[1];
    if (sugerido && sugerido !== modelo) {
      log(`Gemini: ${modelo} retirado, se usa ${sugerido}. Actualizá config.json cuando puedas.`);
      modelo = sugerido;
      continue;
    }
    const err = new Error(`Gemini ${modelo} HTTP ${r.status}: ${txt.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  throw new Error(`Gemini ${modelo}: sin respuesta tras varios intentos`);
}

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    apta: { type: "BOOLEAN", description: "false SOLO si no tiene que ver con videojuegos, es publicidad encubierta, contenido para adultos o una tragedia sensible. Que hable de fechas o hechos que no conocés NO es motivo para false" },
    tipo: { type: "STRING", enum: ["noticia", "problema", "ofertas"], description: "problema = errores, fallas, bugs, caídas de servidores o cuelgues; ofertas = descuentos, rebajas, juegos gratis o precios rebajados; noticia = todo lo demás" },
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
    ofertas: {
      type: "ARRAY",
      description: "Solo si tipo = ofertas: cada juego o producto en oferta que aparezca en las fuentes, con precio y enlace EXACTOS tomados de la fuente y de su lista de enlaces. Si no hay, lista vacía",
      items: {
        type: "OBJECT",
        properties: {
          producto: { type: "STRING" }, plataforma: { type: "STRING" }, precio: { type: "STRING", description: "Precio de oferta tal cual aparece en la fuente, con su moneda (ej: US$19,99)" },
          precioAnterior: { type: "STRING" }, tienda: { type: "STRING" }, url: { type: "STRING", description: "Copiada EXACTA de la lista de enlaces de la fuente" },
        },
        required: ["producto", "precio", "url"],
      },
    },
    preguntas: {
      type: "ARRAY",
      description: "2 a 4 preguntas frecuentes que haría un jugador, con respuestas breves basadas en las fuentes",
      items: { type: "OBJECT", properties: { p: { type: "STRING" }, r: { type: "STRING" } }, required: ["p", "r"] },
    },
    promptImagen: { type: "STRING", description: "Descripción en inglés de una ilustración de portada evocadora y genérica: sin texto, sin logos, sin personajes ni marcas registradas" },
    busquedaImagen: { type: "STRING", description: "2 a 4 palabras en inglés para buscar una foto de stock relacionada (ej: 'gaming console controller')" },
  },
  required: ["apta", "tipo", "titulo", "bajada", "categoria", "etiquetas", "cuerpo", "clave", "preguntas", "promptImagen", "busquedaImagen"],
};

const SISTEMA_BASE = `Sos redactor/a de un medio de noticias de videojuegos para Argentina y Latinoamérica.
Escribís en español neutro con tono rioplatense suave (sin voseo exagerado), claro y profesional.
Reglas obligatorias:
- Escribí una nota ORIGINAL. Nunca traduzcas ni copies frases de las fuentes: reorganizá la información con tu propia estructura y palabras.
- Combiná lo que dicen todas las fuentes y explicá qué cambió, por qué importa y qué contexto previo tiene (franquicia, empresa, plataforma, lanzamientos anteriores) solo si estás seguro de ese contexto.
- No inventes datos, cifras, fechas, precios ni citas. Si algo es rumor o no está confirmado, decilo explícitamente.
- Si hay precios en dólares o euros, mencionalos tal cual; no conviertas a pesos.
- Las notas tienen que AYUDAR al lector, no solo informar. Entre 700 y 1100 palabras, con 4 a 6 subtítulos (h2) y párrafos de 2 a 4 oraciones.
- Estructura según el tipo:
  * noticia: entrada fuerte; "Qué se sabe" con todos los datos (fechas, plataformas, precios, requisitos); contexto (antecedentes de la saga, la empresa o la plataforma); "Qué significa para los jugadores" con consejos prácticos (si conviene esperar, qué preparar, cómo aprovecharlo, dónde seguirlo).
  * problema (errores, bugs, caídas, cuelgues): qué está pasando y a quién afecta; posibles causas según las fuentes; un subtítulo exactamente "Cómo solucionarlo" seguido de 4 a 8 pasos en lista (li). Primero las soluciones que mencionan las fuentes o el desarrollador; después pasos generales seguros y habituales para esa plataforma (reiniciar, buscar actualización del sistema y del juego, verificar archivos, limpiar caché, reconstruir base de datos en PlayStation, actualizar drivers en PC, revisar el estado de los servidores), presentándolos como pasos generales. Nunca inventes un parche o solución oficial que no esté en las fuentes. Cerrá con qué hacer si nada funciona (contactar soporte oficial, esperar el parche).
  * ofertas: entrada con el contexto (qué evento o tienda, hasta cuándo dura si se sabe); completá el campo "ofertas" con TODOS los juegos o productos con precio que aparezcan en las fuentes, copiando precio y enlace exactos; nunca inventes precios ni enlaces; en el cuerpo recomendá 3 a 5 destacadas explicando por qué valen la pena y agregá consejos para aprovechar las rebajas. No repitas la lista completa en el cuerpo: se muestra en una tabla aparte.
- No menciones que sos una IA, no hables de "las fuentes" en el texto ni nombres los medios: los enlaces se agregan aparte.
- Usá mayúsculas normales del español: al inicio de cada oración, título y punto de lista, y en nombres propios (GTA 6, Rockstar Games, PS5, Xbox Series X|S, Nintendo Switch 2).
- Sin emojis, sin mayúsculas sostenidas, sin clickbait.`;

// La fecha de hoy y la aclaración de que las fuentes son reales evitan que el modelo
// descarte noticias actuales por ser posteriores a sus datos de entrenamiento.
const SISTEMA_FECHA = () => {
  const hoy = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return `Hoy es ${hoy}. Las fuentes que recibís son notas periodísticas reales y actuales, publicadas en los últimos días por medios reconocidos. Tus conocimientos tienen una fecha de corte anterior, así que es normal que las fuentes mencionen juegos, consolas, fechas o hechos que no conocés: tomalos como verdaderos. Nunca juzgues si algo es verosímil según tus conocimientos, nunca lo llames ficticio, supuesto o hipotético por ese motivo, y no marques una nota como no apta por eso.`;
};
const SISTEMA_TXT = () => `${SISTEMA_FECHA()}\n\n${SISTEMA_BASE}`;

export async function redactarNota(grupo, cfg, aviso = "") {
  const fuentes = grupo.map((it, i) => `### Fuente ${i + 1} (${it.idioma}) - ${it.fecha.slice(0, 10)}
Título: ${it.titulo}
Resumen: ${it.resumen}
Texto: ${(it.texto || it.contenido || "").slice(0, 5000)}${it.enlaces?.length ? `\nLista de enlaces de la fuente (texto -> url):\n${it.enlaces.slice(0, 60).map((l) => `- ${l.texto} -> ${l.url}`).join("\n")}` : ""}`).join("\n\n");
  const prompt = `Escribí una nota a partir de esta información sobre una misma noticia.${aviso ? "\nIMPORTANTE: " + aviso : ""}\n\n${fuentes}`;

  if (process.env.GEMINI_MOCK) return notaDePrueba(grupo);

  let ultimoError;
  for (const modelo of modelosDisponibles(cfg.ia.modelosTexto)) {
    try {
      const res = await llamar(modelo, {
        systemInstruction: { parts: [{ text: SISTEMA_TXT() }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: cfg.ia.temperatura ?? 0.8, responseMimeType: "application/json", responseSchema: ESQUEMA },
      });
      const txt = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!txt) throw new Error("respuesta vacía (" + (res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || "?") + ")");
      const nota = JSON.parse(txt);
      nota.modelo = modelo;
      return nota;
    } catch (e) { ultimoError = e; anotarFallo(modelo, e); log(`Texto con ${modelo} falló: ${e.message.slice(0, 200)}`); }
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
  for (const modelo of modelosDisponibles(cfg.ia.modelosTexto)) {
    try {
      const res = await llamar(modelo, {
        systemInstruction: { parts: [{ text: SISTEMA_TXT() }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: ESQUEMA_UPD },
      });
      const txt = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!txt) throw new Error("respuesta vacía");
      return JSON.parse(txt);
    } catch (e) { ultimoError = e; anotarFallo(modelo, e); log(`Revisión con ${modelo} falló: ${e.message.slice(0, 200)}`); }
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
  }, 1);
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
    tipo: /error|crash|bug/i.test(t) ? "problema" : /deal|sale|oferta/i.test(t) ? "ofertas" : "noticia",
    ofertas: /deal|sale|oferta/i.test(t) ? (grupo[0].enlaces || []).slice(0, 6).map((l, i) => ({ producto: l.texto, plataforma: "PS5", precio: `US$${(i + 1) * 10}`, url: l.url, tienda: "Tienda" })) : [],
    preguntas: [{ p: "¿Pregunta de prueba?", r: "Respuesta de prueba." }],
    categoria: /nintendo|switch/i.test(t) ? "nintendo" : /playstation|ps5/i.test(t) ? "playstation" : /xbox/i.test(t) ? "xbox" : /steam|pc/i.test(t) ? "pc" : "general",
    etiquetas: [...new Set(t.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 4))],
    cuerpo: [{ tipo: "p", texto: p(1) }, { tipo: "h2", texto: "Qué se sabe" }, { tipo: "p", texto: p(2) }, { tipo: "li", texto: "Un punto de lista" }, { tipo: "li", texto: "Otro punto" }, { tipo: "h2", texto: /error|crash|bug/i.test(t) ? "Cómo solucionarlo" : "Por qué importa" }, { tipo: "li", texto: "Paso uno" }, { tipo: "li", texto: "Paso dos" }, { tipo: "li", texto: "Paso tres" }, { tipo: "li", texto: "Paso cuatro" }, { tipo: "p", texto: p(3) }, { tipo: "p", texto: p(4) }, { tipo: "p", texto: p(5) }],
    clave: ["Primer dato clave", "Segundo dato clave", "Tercer dato clave"],
    promptImagen: "a glowing game controller on a desk at night",
    busquedaImagen: "video game controller",
  };
}

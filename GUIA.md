# Bolsillo Gamer: cómo ponerlo en marcha

## Cómo funciona

Cada 3 horas, GitHub Actions corre `scripts/actualizar.mjs`:

1. **Lee los RSS** de los medios de `config.json` (IGN, GameSpot, PC Gamer, VGC, Eurogamer, 3DJuegos, Vandal, blogs oficiales de PlayStation y Xbox, etc.). Descarta ofertas, guías, reseñas y patrocinados.
2. **Agrupa** la misma noticia publicada por distintos medios. Por defecto solo escribe sobre temas que aparecen en **2 o más medios** (o en un blog oficial). Eso evita "copiar" una sola nota y suele elegir las noticias más importantes.
3. **Gemini redacta** una nota original en español con la información de todas las fuentes: título, copete, puntos clave, subtítulos y etiquetas.
4. **Controles de calidad**: si la nota es muy corta (menos de 320 palabras) o repite frases textuales de las fuentes (más del 6%), le pide que la reescriba una vez; si vuelve a fallar, la descarta.
5. **Portada** (nunca se usan imágenes de los medios), en este orden:
   - Ilustración generada por Gemini (si tu cuenta tiene cupo de generación de imágenes).
   - Foto libre de **Pixabay** o **Pexels**, descargada y servida desde el sitio, con crédito al autor (si cargás la clave gratuita).
   - Portada gráfica propia con el título y el color de la plataforma (siempre funciona).
6. **No repite noticias**: cada tema publicado se recuerda 4 días. Si otro medio publica lo mismo, no se escribe una nota nueva.
7. **Actualiza notas**: si aparece una fuente nueva sobre un tema ya publicado, Gemini compara con lo que ya dice la nota. Si trae datos concretos nuevos (fecha, precio, confirmación, cifra), agrega arriba un recuadro **"Actualización"** con la fecha, suma la fuente al pie y cambia la fecha de modificación. Si solo repite lo mismo, no toca nada. Como máximo 1 actualización por corrida y cada nota se actualiza como mucho cada 3 horas.
8. Guarda la nota en `content/notas/`, regenera `public/` y hace commit. Cloudflare publica solo.

Cada nota incluye al pie los enlaces a todas sus fuentes y una aclaración de que se hizo con asistencia de IA. El sitio trae las páginas que pide AdSense: Quiénes somos, Política editorial, Privacidad y Contacto, más `ads.txt`, `sitemap.xml`, `news-sitemap.xml` y RSS propio.

## Puesta en marcha (una sola vez)

### 1. Clave de Gemini (gratis)
1. Entrá a https://aistudio.google.com/apikey con tu cuenta de Google y tocá **Create API key**.
2. **No la pegues en ningún chat.** Va directo a GitHub (paso 3).

### 2. Clave de Pixabay (opcional, gratis)
Para tener fotos reales cuando Gemini no pueda generar imágenes: creá una cuenta en https://pixabay.com, entrá a https://pixabay.com/api/docs/ y copiá tu clave (aparece en la sección "Parameters", campo `key`). Se carga como secreto `PIXABAY_API_KEY`.
(Pexels también funciona con el secreto `PEXELS_API_KEY`, pero por ahora no está dando claves nuevas.)

### 3. Repositorio en GitHub
1. Creá un repositorio nuevo (por ejemplo `noticias-gamer`) y subí todo el contenido de esta carpeta (incluida la carpeta oculta `.github`).
2. En el repo: **Settings → Secrets and variables → Actions → New repository secret**:
   - `GEMINI_API_KEY` = tu clave de Gemini
   - `PIXABAY_API_KEY` = tu clave de Pixabay (opcional)
3. **Settings → Actions → General → Workflow permissions** → marcá **Read and write permissions** → Save.

### 4. Cloudflare Pages
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → elegí el repo.
2. Framework preset: **None**. Build command: *(vacío)*. Build output directory: **`public`**.
3. Cuando termine: **Custom domains → Set up a custom domain** → `juegos.bolsillo.online`.

### 5. Primera corrida
GitHub → pestaña **Actions** → **Publicar noticias** → **Run workflow**. En 2 a 5 minutos deberían aparecer 2 notas. Después sigue solo cada 3 horas (hasta 8 notas por día).

### 6. AdSense
El código de tu cuenta (`ca-pub-1697004556284286`) ya está en todas las páginas y en `ads.txt`. En AdSense → **Sitios → Agregar sitio** → `juegos.bolsillo.online`. Conviene esperar a tener **25 a 30 notas** (unos 4 días) antes de pedir la revisión. Cuando te aprueben, activá **Anuncios automáticos**; el sitio ya deja lugares naturales entre párrafos.

## Ajustes (`config.json`)

| Opción | Para qué sirve |
|---|---|
| `publicacion.modoRevision` | `true`: las notas quedan como pendientes en `/revision/` y no se publican hasta que las aprobás. `false` (por defecto): se publican solas. |
| `publicacion.maxPorDia` / `maxPorCorrida` | Límite de notas (8 por día, 2 por corrida). Más no siempre es mejor para AdSense. |
| `publicacion.minFuentes` | Cuántos medios tienen que haber publicado la noticia (2). |
| `publicacion.permitirUnaFuente` | `true` para escribir también sobre noticias de un solo medio (más volumen, más riesgo). |
| `publicacion.maxActualizacionesPorCorrida` / `horasEntreActualizaciones` | Cuántas notas viejas se actualizan por corrida (1) y cada cuánto como mínimo (3 h). `0` las apaga. |
| `publicacion.minPalabras`, `maxCopiaLiteral` | Controles de calidad. |
| `ia.modelosTexto` | Modelos de Gemini a usar, en orden. Si Google cambia los nombres, se actualizan acá. |
| `imagenes.orden` | Orden de las fuentes de portada: `gemini`, `pixabay`, `pexels`, `portada`. |
| `feeds` | Lista de medios. Podés agregar o sacar cualquiera que tenga RSS. |

Para editar: abrí el archivo en GitHub, tocá el lápiz, cambiá el valor y **Commit changes**.

## Modo revisión: aprobar o rechazar notas

Con `modoRevision: true`, mirá las pendientes en `https://juegos.bolsillo.online/revision/` (no aparece en Google ni tiene anuncios). Para publicarlas: **Actions → Aprobar notas → Run workflow** → escribí los nombres separados por coma (o `todas`) y elegí **publicar** o **rechazar**.

Para borrar o corregir una nota ya publicada: editá o borrá su archivo en `content/notas/` desde GitHub. Se aplica en la próxima corrida, o al instante si corrés **Publicar noticias** a mano.

## Límites del plan gratuito de Gemini

El plan gratis alcanza de sobra para 8 notas por día (cada nota usa 1 o 2 pedidos). Si se agota la cuota, el proceso lo detecta, no publica nada y sigue en la corrida siguiente. La generación de imágenes con Gemini puede no estar incluida en el plan gratis; en ese caso se usa Pexels o la portada gráfica, sin errores.

## Riesgo con AdSense

Google permite contenido hecho con IA, pero penaliza sitios de "contenido escalado" que solo reescriben a otros sin aportar nada. Tu cuenta de AdSense es una sola y también cubre el conversor: si este sitio recibe una sanción, puede afectar a los dos. Para bajar el riesgo: mantené `minFuentes` en 2, no subas mucho `maxPorDia` y, si podés, de vez en cuando agregá una opinión o dato propio a las notas más leídas.

## Probar en tu compu (opcional)

Con Node 20 o más nuevo:

```
npm install
GEMINI_MOCK=1 node scripts/actualizar.mjs   # sin IA, con notas de prueba
node scripts/build.mjs                       # solo regenera el sitio
```

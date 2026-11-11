// Lee una factura (foto o PDF) con Google Gemini y devuelve los renglones con precios.
// Corre en Vercel (servidor): la clave de Gemini NUNCA llega al navegador.
// Necesita la variable de entorno GEMINI_API_KEY (Vercel > Settings > Environment Variables).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kpvfrbnxleafyeavtbud.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_kWUN5Df8AGsV2LbXq2-Ndw_XK0Hy_9n";
const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TIPOS_OK = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

const responder = (res, codigo, cuerpo) => res.status(codigo).json(cuerpo);

// Solo deja pasar a usuarios con sesión y activos en la app (evita que cualquiera gaste tu crédito).
async function usuarioValido(token) {
  const cab = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: cab });
  if (!u.ok) return false;
  const { id } = await u.json();
  const p = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?select=activo&id=eq.${encodeURIComponent(id)}`, { headers: cab });
  if (!p.ok) return false;
  const filas = await p.json();
  return Boolean(filas[0] && filas[0].activo);
}

function armarPedido(insumos, hoy) {
  const lista = insumos.length ? insumos.map((n) => `- ${n}`).join("\n") : "(todavía no hay ninguno cargado)";
  return `Sos un asistente que lee facturas de proveedores de un café en Argentina. Hoy es ${hoy}.
Te paso la foto o el PDF de una factura. Extraé los datos y respondé SOLO con un JSON válido, sin texto antes ni después y sin bloques de código, con esta forma exacta:

{
  "proveedor": "nombre o razón social de quien EMITE la factura (el proveedor), o null",
  "cuit": "CUIT del emisor, o null",
  "numero": "número de comprobante, por ejemplo 0001-00001234, o null",
  "fecha": "fecha de emisión en formato YYYY-MM-DD, o null",
  "vencimiento": "fecha de vencimiento DE PAGO en formato YYYY-MM-DD, o null",
  "total": número con el importe total final a pagar, o null,
  "iva_incluido": true, false o null,
  "items": [
    {
      "descripcion": "texto del producto tal como figura",
      "cantidad": número,
      "unidad": "kg, g, l, ml, unidad, caja, paquete, bolsa, docena, etc. en minúsculas",
      "precio_unitario": número,
      "subtotal": número o null,
      "insumo_existente": "nombre EXACTO de la lista de abajo, o null"
    }
  ],
  "advertencias": ["cosas dudosas que la persona debería revisar"]
}

Reglas:
- Los números van como números JSON, con punto decimal y sin separador de miles. Las facturas argentinas usan "1.234,56": convertilo a 1234.56.
- "precio_unitario" es el precio de UNA unidad tal como figura en el renglón. Si solo aparece el importe del renglón, calculalo como importe dividido cantidad. Si el renglón tiene descuento o bonificación, usá el precio ya con el descuento aplicado y avisalo en "advertencias".
- Si no se ve la unidad, poné "unidad".
- No incluyas como renglones el IVA, las percepciones, otros impuestos, subtotales, redondeos ni totales.
- "iva_incluido": true si los precios de los renglones ya incluyen IVA (típico de facturas B o C); false si son precios netos y el IVA se discrimina aparte (típico de facturas A); null si no se puede saber.
- "vencimiento" es la fecha límite para pagar al proveedor, y solo si la factura la indica o dice una condición clara de pago. NO uses la fecha de vencimiento del CAE, que no tiene que ver con el pago. Si no hay, null.
- "insumo_existente": si el renglón corresponde claramente a un insumo de la lista, poné su nombre exacto tal cual está en la lista. Si no hay una coincidencia clara, null.
- No inventes datos. Si algo no se lee bien, ponelo en null y avisalo en "advertencias".

Insumos ya cargados:
${lista}`;
}

function sacarJson(texto) {
  const limpio = String(texto || "").replace(/```json|```/g, "");
  const a = limpio.indexOf("{"), b = limpio.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("sin json");
  return JSON.parse(limpio.slice(a, b + 1));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return responder(res, 405, { error: "Método no permitido." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder(res, 401, { error: "Tu sesión venció. Volvé a ingresar." });
  try {
    if (!(await usuarioValido(token))) return responder(res, 401, { error: "Tu usuario no tiene acceso." });
  } catch {
    return responder(res, 502, { error: "No se pudo verificar tu usuario. Probá de nuevo." });
  }

  const clave = process.env.GEMINI_API_KEY;
  if (!clave) return responder(res, 500, { error: "Falta configurar la clave de Gemini en Vercel (GEMINI_API_KEY)." });

  const { archivo, tipo, insumos } = req.body || {};
  if (!archivo || !TIPOS_OK.includes(tipo)) return responder(res, 400, { error: "El archivo no es una imagen ni un PDF válido." });
  if (archivo.length > 5_500_000) return responder(res, 413, { error: "El archivo es muy pesado. Sacá la foto de nuevo con menos zoom." });

  const nombres = (Array.isArray(insumos) ? insumos : []).map((n) => String(n).slice(0, 80)).slice(0, 500);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const bloque = { inline_data: { mime_type: tipo, data: archivo } };

  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELO)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [bloque, { text: armarPedido(nombres, hoy) }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
      }),
    });
  } catch {
    return responder(res, 502, { error: "No se pudo conectar con el lector de facturas. Probá de nuevo." });
  }

  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    console.error("Gemini", r.status, detalle.slice(0, 500));
    if (r.status === 400 && /API_KEY|API key/i.test(detalle)) return responder(res, 502, { error: "La clave de Gemini no es válida. Revisala en Vercel." });
    if (r.status === 403) return responder(res, 502, { error: "La clave de Gemini no tiene permiso. Revisala en Google AI Studio." });
    if (r.status === 429) return responder(res, 502, { error: "Se alcanzó el límite gratuito de Gemini. Esperá un minuto o cargá la factura a mano." });
    return responder(res, 502, { error: "El lector de facturas falló. Probá de nuevo o cargá la factura a mano." });
  }

  try {
    const data = await r.json();
    const partes = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const texto = partes.map((p) => p.text || "").join("\n");
    return responder(res, 200, sacarJson(texto));
  } catch {
    return responder(res, 502, { error: "No pude interpretar la factura. Probá con otra foto más clara o cargala a mano." });
  }
};

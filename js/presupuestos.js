import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const n2 = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
// Entiende "42000", "42.000" y "42.000,50"
const monto = (txt) => {
  let t = String(txt ?? "").trim().replace(/[\s$]/g, "");
  t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const x = Number(t);
  return Number.isFinite(x) ? x : 0;
};
const TZ = "America/Argentina/Buenos_Aires";
const hoyStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const fechaCorta = (s) => (s ? s.split("-").reverse().join("/") : "");
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const CONDICIONES_DEFAULT = `Seña del 50% para confirmar la reserva.
Saldo restante: 48 hs antes del evento.
La cantidad de invitados se confirma 48 hs antes; se factura como mínimo garantizado.`;
const ESTADOS = { pendiente: "Pendiente", aceptado: "Aceptado", rechazado: "Rechazado" };

let lista = [], iniciado = false, modo = "lista", filtro = "todos", busca = "", borrador = null, actual = null;

function aviso(texto, ms = 3500) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), ms);
}

// ====== DATOS ======
function blanco() {
  return {
    id: null, fecha: hoyStr(), cliente: "", fecha_evento: "", lugar: "", invitados: "", formato: "", horario: "", validez_dias: "",
    incluir_logo: true, incluir_firmas: true, incluir_condiciones: true, iva_modo: "incluido", estado: "pendiente",
    secciones: [{ titulo: "", cuerpo: "" }], items: [], condiciones: CONDICIONES_DEFAULT,
  };
}

const aTexto = (n) => String(n ?? "").replace(".", ",");

function desdeFila(r) {
  return {
    id: r.id, fecha: r.fecha, cliente: r.cliente || "", fecha_evento: r.fecha_evento || "", lugar: r.lugar || "", invitados: r.invitados || "",
    formato: r.formato || "", horario: r.horario || "", validez_dias: r.validez_dias ?? "",
    incluir_logo: r.incluir_logo, incluir_firmas: r.incluir_firmas, incluir_condiciones: r.incluir_condiciones,
    iva_modo: r.iva_modo, estado: r.estado,
    secciones: (r.secciones || []).map((s) => ({ titulo: s.titulo || "", cuerpo: s.cuerpo || "" })),
    items: (r.items || []).map((i) => ({ detalle: i.detalle || "", cantidad: aTexto(i.cantidad), valor_unitario: aTexto(i.valor_unitario) })),
    condiciones: r.condiciones ?? "",
  };
}

function aFila(b) {
  return {
    fecha: b.fecha || hoyStr(), cliente: b.cliente.trim(), fecha_evento: b.fecha_evento.trim() || null, lugar: b.lugar.trim() || null,
    invitados: b.invitados.trim() || null, formato: b.formato.trim() || null, horario: b.horario.trim() || null,
    validez_dias: String(b.validez_dias).trim() === "" ? null : Math.max(0, Math.round(n2(b.validez_dias))),
    incluir_logo: b.incluir_logo, incluir_firmas: b.incluir_firmas, incluir_condiciones: b.incluir_condiciones, iva_modo: b.iva_modo,
    secciones: b.secciones.filter((s) => s.titulo.trim() || s.cuerpo.trim()).map((s) => ({ titulo: s.titulo.trim(), cuerpo: s.cuerpo.trim() })),
    items: b.items.filter((i) => i.detalle.trim() || String(i.valor_unitario).trim()).map((i) => ({ detalle: i.detalle.trim(), cantidad: n2(i.cantidad), valor_unitario: monto(i.valor_unitario) })),
    condiciones: b.condiciones.trim() || null,
  };
}

function totales(b) {
  const suma = b.items.reduce((s, i) => s + n2(i.cantidad) * monto(i.valor_unitario), 0);
  if (b.iva_modo === "incluido") { const sin = suma / 1.21; return { sinIva: sin, iva: suma - sin, total: suma }; }
  if (b.iva_modo === "mas_iva") return { sinIva: suma, iva: suma * 0.21, total: suma * 1.21 };
  return { sinIva: suma, iva: 0, total: suma };
}

async function cargar() {
  const { data, error } = await db.from("presupuestos").select("*").order("fecha", { ascending: false }).order("id", { ascending: false });
  const caja = $("#prError");
  if (error) {
    const falta = /does not exist|schema cache|PGRST205|42P01/i.test(`${error.code} ${error.message}`);
    caja.textContent = falta ? "Todavía falta crear la tabla de Presupuestos en Supabase. Pegá el archivo sql/06-presupuestos.sql en el SQL Editor y ejecutalo." : "No se pudieron cargar los presupuestos: " + error.message;
    return false;
  }
  caja.textContent = "";
  lista = data;
  return true;
}

// ====== LISTA ======
function listaHtml() {
  const q = norm(busca);
  const ver = lista.filter((r) => (filtro === "todos" || r.estado === filtro) && (!q || norm(`${r.cliente} ${r.fecha_evento} ${r.lugar}`).includes(q)));
  const chips = [["todos", "Todos"], ["pendiente", "Pendientes"], ["aceptado", "Aceptados"], ["rechazado", "Rechazados"]]
    .map(([k, t]) => `<button class="chip${filtro === k ? " activa" : ""}" data-pr-f="${k}">${t}</button>`).join("");
  const filas = ver.length
    ? ver.map((r) => {
        const b = desdeFila(r);
        return `<div class="item-wrap"><div class="item" data-pr-abrir="${r.id}" role="button" tabindex="0">
          <div>${esc(r.cliente || "Sin cliente")}<small>Presupuesto del ${fechaCorta(r.fecha)}${r.fecha_evento ? " · Evento: " + esc(r.fecha_evento) : ""}${r.lugar ? " · " + esc(r.lugar) : ""} · ${ESTADOS[r.estado]}</small></div>
          <div class="num"><span>${plata(totales(b).total)}</span></div></div>
          <div class="fila acciones"><button data-pr-abrir="${r.id}">Ver / imprimir</button><button data-pr-editar="${r.id}">Editar</button><button data-pr-dup="${r.id}">Duplicar</button><button class="link" data-pr-borrar="${r.id}">Eliminar</button></div></div>`;
      }).join("")
    : `<p class="vacio">${lista.length ? "No hay presupuestos con ese filtro." : "Todavía no armaste ningún presupuesto. Tocá «Nuevo presupuesto» para crear el primero."}</p>`;
  return `<h2>Presupuestos</h2>
    <div class="fila"><button class="principal" data-pr-nuevo>Nuevo presupuesto</button></div>
    <div class="chips" style="margin-top:14px">${chips}</div>
    <input id="prBuscar" type="search" placeholder="Buscá por cliente, fecha del evento o lugar" value="${esc(busca)}">
    <div class="lista-est co-lista">${filas}</div>`;
}

// ====== FORMULARIO ======
function itemHtml(it, i) {
  return `<div class="linea" data-i="${i}">
    <label class="l-desc">Detalle <input data-it="detalle" value="${esc(it.detalle)}" placeholder="Ej: Desayuno para 20 personas"></label>
    <label>Cantidad <input data-it="cantidad" inputmode="decimal" value="${esc(it.cantidad)}" placeholder="Ej: 20"></label>
    <label>Valor unitario <input data-it="valor_unitario" inputmode="decimal" value="${esc(it.valor_unitario)}" placeholder="Ej: 8500"></label>
    <div class="l-sub">Total del ítem <b>${plata(n2(it.cantidad) * monto(it.valor_unitario))}</b></div>
    <button type="button" class="link" data-pr-quitar-item="${i}">Quitar ítem</button></div>`;
}

function totalesHtml(b) {
  const t = totales(b);
  if (b.iva_modo === "sin_iva") return `<div class="item destacado"><div>TOTAL</div><div class="num"><span>${plata(t.total)}</span></div></div>`;
  return `<div class="item"><div>Subtotal (sin IVA)</div><div class="num"><span>${plata(t.sinIva)}</span></div></div>
    <div class="item"><div>IVA (21%)</div><div class="num"><span>${plata(t.iva)}</span></div></div>
    <div class="item destacado"><div>TOTAL</div><div class="num"><span>${plata(t.total)}</span></div></div>`;
}

function formHtml(b) {
  const check = (k, texto) => `<label class="check"><input type="checkbox" data-k="${k}"${b[k] ? " checked" : ""}> ${texto}</label>`;
  const campo = (k, rotulo, ph = "", tipo = "text") => `<label>${rotulo} <input type="${tipo}" data-k="${k}" value="${esc(b[k])}" placeholder="${esc(ph)}"></label>`;
  const secciones = b.secciones.map((s, i) => `<div class="linea" data-s="${i}">
      <label class="l-desc">Título de la sección <input data-sec="titulo" value="${esc(s.titulo)}" placeholder="Ej: Menú, Servicio, Ambientación"></label>
      <label class="l-desc">Detalle <textarea data-sec="cuerpo" rows="5" placeholder="Ej:&#10;- Mesa dulce con mini tortas&#10;- Café, té e infusiones">${esc(s.cuerpo)}</textarea></label>
      ${b.secciones.length > 1 ? `<button type="button" class="link" data-pr-quitar-sec="${i}">Quitar sección</button>` : ""}</div>`).join("");
  return `<h2>${b.id ? "Editar presupuesto" : "Nuevo presupuesto"}</h2>
    <div class="grilla2">
      ${campo("fecha", "Fecha del presupuesto", "", "date")}
      ${campo("cliente", "Cliente / empresa", "Ej: Estudio López")}
      ${campo("fecha_evento", "Fecha del evento (texto libre)", "Ej: sábado 5 de diciembre")}
      ${campo("lugar", "Lugar (texto libre)", "Ej: En el café, o a definir")}
      ${campo("invitados", "Invitados", "Ej: 40 personas")}
      ${campo("formato", "Formato", "Ej: desayuno, merienda, cóctel")}
      ${campo("horario", "Horario (opcional)", "Ej: 16:00 a 19:00 hs")}
      ${campo("validez_dias", "Validez en días (opcional)", "Ej: 7", "number")}
    </div>
    <div class="opciones">
      ${check("incluir_logo", "Incluir el logo de Entretanto arriba")}
      ${check("incluir_firmas", "Incluir espacio para las firmas")}
      ${check("incluir_condiciones", "Incluir las condiciones de contratación")}
    </div>
    <h3 class="sub">Detalle del presupuesto</h3>
    <p class="nota" style="margin-top:0">Armá las secciones que quieras (menú, servicio, ambientación…). Cada una lleva un título y su detalle.</p>
    <div class="items-fact">${secciones}</div>
    <button type="button" data-pr-add-sec>Agregar sección</button>
    <h3 class="sub">Cotización</h3>
    <label>Cómo están cargados los valores
      <select data-k="iva_modo">
        <option value="incluido"${b.iva_modo === "incluido" ? " selected" : ""}>Ya incluyen IVA</option>
        <option value="mas_iva"${b.iva_modo === "mas_iva" ? " selected" : ""}>Son netos: se suma el IVA (21%) aparte</option>
        <option value="sin_iva"${b.iva_modo === "sin_iva" ? " selected" : ""}>Sin IVA (no se discrimina)</option>
      </select></label>
    <div class="items-fact" id="prItems" style="margin-top:14px">${b.items.map(itemHtml).join("")}</div>
    <button type="button" data-pr-add-item>Agregar ítem</button>
    <div id="prTotales" class="lista-est co-lista" style="margin-top:14px">${totalesHtml(b)}</div>
    <h3 class="sub">Condiciones de contratación</h3>
    <label>Una condición por renglón <textarea data-k="condiciones" rows="6">${esc(b.condiciones)}</textarea></label>
    <p id="prFormError" class="error" role="alert"></p>
    <div class="fila"><button class="principal" data-pr-guardar>Guardar presupuesto</button><button class="link" data-pr-cancelar>Cancelar</button></div>`;
}

// ====== DOCUMENTO (lo que se imprime) ======
function docHtml(b) {
  const t = totales(b);
  const caract = [["Fecha", b.fecha_evento], ["Lugar", b.lugar], ["Invitados", b.invitados], ["Formato", b.formato], ["Horario", b.horario]].filter(([, v]) => v);
  const secs = b.secciones.filter((s) => s.titulo || s.cuerpo).map((s) => `<div class="pr-sec">${s.titulo ? `<h4>${esc(s.titulo.toUpperCase())}</h4>` : ""}${s.cuerpo ? `<p>${esc(s.cuerpo)}</p>` : ""}</div>`).join("");
  const filas = b.items.filter((i) => i.detalle).map((i) => `<tr><td>${esc(i.detalle)}</td><td class="c">${esc(i.cantidad)}</td><td class="d">${plata(monto(i.valor_unitario))}</td><td class="d">${plata(n2(i.cantidad) * monto(i.valor_unitario))}</td></tr>`).join("");
  const rotuloTotal = b.iva_modo === "incluido" ? "TOTAL (IVA incluido)" : b.iva_modo === "mas_iva" ? "TOTAL (con IVA)" : "TOTAL";
  const cond = b.incluir_condiciones ? b.condiciones.split("\n").map((x) => x.trim()).filter(Boolean) : [];
  const validez = String(b.validez_dias).trim() !== "" ? `<p class="pr-chico">Este presupuesto tiene una validez de ${esc(b.validez_dias)} ${Number(b.validez_dias) === 1 ? "día" : "días"} desde su fecha de emisión.</p>` : "";
  return `<div class="no-print fila" style="margin-bottom:18px">
      <button class="principal" data-pr-pdf>Descargar PDF</button>
      <button data-pr-imprimir>Imprimir</button>
      <button data-pr-editar="${b.id}">Editar</button>
      <button class="link" data-pr-volver>Volver a la lista</button>
    </div>
    <label class="no-print" style="max-width:260px;margin-bottom:18px">Estado del presupuesto
      <select data-pr-estado="${b.id}">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}"${b.estado === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <div class="pr-doc" id="prDoc">
      ${b.incluir_logo ? '<div class="pr-membrete"><img src="img/logo-presupuesto.png" alt="Entretanto Café &amp; Flores"></div>' : ""}
      <div class="pr-cab"><span>At. ${esc(b.cliente || "-")}</span><span>${fechaCorta(b.fecha)}</span></div>
      ${caract.length ? `<p class="pr-sub">Características del evento:</p><div class="pr-caract">${caract.map(([k, v]) => `<p>${k}: ${esc(v)}</p>`).join("")}</div>` : ""}
      <h3 class="pr-titulo">PRESUPUESTO</h3>
      ${secs}
      ${filas ? `<h3 class="pr-titulo">COTIZACIÓN</h3>
        <table><thead><tr><th>Detalle</th><th class="c">Cant.</th><th class="d">Valor unit.</th><th class="d">Valor total</th></tr></thead>
        <tbody>${filas}<tr class="pr-total"><td colspan="3">${rotuloTotal}</td><td class="d">${plata(t.total)}</td></tr></tbody></table>
        ${b.iva_modo === "mas_iva" ? `<p class="pr-chico">Subtotal sin IVA: ${plata(t.sinIva)} · IVA (21%): ${plata(t.iva)}</p>` : ""}` : ""}
      ${validez}
      ${cond.length ? `<h3 class="pr-titulo">CONDICIONES DE CONTRATACIÓN</h3><ul class="pr-cond">${cond.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <p class="pr-saludo">Quedo a disposición, saludos cordiales.<br>Entretanto Café &amp; Flores</p>
      ${b.incluir_firmas ? `<div class="pr-firmas"><div><span>Firma y aclaración — Cliente</span></div><div><span>Firma y aclaración — Entretanto</span></div></div>` : ""}
      <p class="pr-pie">Entretanto Café &amp; Flores · @entretantocafeyflores</p>
    </div>`;
}

// ====== PANTALLAS ======
function pintar() {
  const c = $("#prCont");
  c.innerHTML = modo === "lista" ? listaHtml() : modo === "form" ? formHtml(borrador) : docHtml(actual);
}
function ir(m) { modo = m; pintar(); window.scrollTo({ top: 0 }); }
const porId = (id) => lista.find((r) => String(r.id) === String(id));

async function recargar() { if (await cargar()) pintar(); }

async function guardar() {
  const b = borrador, err = $("#prFormError"), btn = document.querySelector("[data-pr-guardar]");
  err.textContent = "";
  if (!b.cliente.trim()) return (err.textContent = "Poné el nombre del cliente o empresa.");
  const incompleto = b.items.findIndex((i) => (i.detalle.trim() || String(i.valor_unitario).trim()) && (!i.detalle.trim() || !(n2(i.cantidad) > 0) || String(i.valor_unitario).trim() === ""));
  if (incompleto >= 0) return (err.textContent = `Al ítem ${incompleto + 1} le falta el detalle, la cantidad o el valor.`);
  btn.disabled = true;
  const fila = aFila(b);
  const { error } = b.id ? await db.from("presupuestos").update(fila).eq("id", b.id) : await db.from("presupuestos").insert(fila);
  btn.disabled = false;
  if (error) return (err.textContent = "No se pudo guardar: " + error.message);
  aviso("Presupuesto guardado");
  borrador = null;
  await cargar();
  ir("lista");
}

async function duplicar(id) {
  const r = porId(id);
  if (!r) return;
  const b = desdeFila(r);
  const fila = aFila({ ...b, fecha: hoyStr(), cliente: b.cliente + " (copia)" });
  const { error } = await db.from("presupuestos").insert({ ...fila, estado: "pendiente" });
  if (error) return aviso("No se pudo duplicar: " + error.message);
  aviso("Presupuesto duplicado: cambiale el cliente y la fecha");
  await recargar();
}

async function eliminar(id) {
  if (!confirm("¿Eliminar este presupuesto? No se puede deshacer.")) return;
  const { error } = await db.from("presupuestos").delete().eq("id", id);
  if (error) return aviso("No se pudo eliminar: " + error.message);
  aviso("Presupuesto eliminado");
  await recargar();
}

async function cambiarEstado(id, estado) {
  const { error } = await db.from("presupuestos").update({ estado }).eq("id", id);
  if (error) return aviso("No se pudo cambiar el estado: " + error.message);
  const r = porId(id); if (r) r.estado = estado;
  if (actual) actual.estado = estado;
  aviso("Estado: " + ESTADOS[estado]);
}

// ====== DESCARGA EN PDF ======
// Las dos librerías se bajan solo cuando se aprieta el botón (necesita internet en ese momento).
const LIB_H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const LIB_PDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const cargarScript = (src) => new Promise((ok, mal) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const s = document.createElement("script");
  s.src = src; s.onload = ok; s.onerror = () => mal(new Error("No se pudo descargar una herramienta necesaria. Revisá tu conexión."));
  document.head.appendChild(s);
});
const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";

// Busca, cerca del final de la página, un renglón casi vacío para cortar sin partir un texto por la mitad.
function puntoDeCorte(ctx, ancho, tope, minimo) {
  for (let y = tope; y > minimo; y--) {
    const d = ctx.getImageData(0, y, ancho, 1).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) && ++n > 12) break;
    if (n <= 12) return y;
  }
  return tope;
}

async function descargarPDF(btn) {
  const el = $("#prDoc");
  if (!el || !actual) return;
  const textoBtn = btn.textContent;
  btn.disabled = true; btn.textContent = "Generando PDF…";
  try {
    await Promise.all([cargarScript(LIB_H2C), cargarScript(LIB_PDF)]);
    const canvas = await window.html2canvas(el, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: 900,
      onclone: (doc) => { Object.assign(doc.getElementById("prDoc").style, { width: "760px", maxWidth: "none", border: "none", borderRadius: "0", margin: "0" }); },
    });
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const margen = 12, ancho = pdf.internal.pageSize.getWidth() - margen * 2, alto = pdf.internal.pageSize.getHeight() - margen * 2;
    const pxPorMM = canvas.width / ancho, altoPag = Math.floor(alto * pxPorMM);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let y = 0, primera = true;
    while (y < canvas.height) {
      let h = Math.min(altoPag, canvas.height - y);
      if (y + h < canvas.height) h = puntoDeCorte(ctx, canvas.width, y + h, y + Math.floor(h * 0.7)) - y;
      const tramo = document.createElement("canvas");
      tramo.width = canvas.width; tramo.height = h;
      const c2 = tramo.getContext("2d");
      c2.fillStyle = "#fff"; c2.fillRect(0, 0, tramo.width, h);
      c2.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!primera) pdf.addPage();
      pdf.addImage(tramo.toDataURL("image/jpeg", 0.95), "JPEG", margen, margen, ancho, h / pxPorMM);
      y += h; primera = false;
    }
    pdf.save(`Presupuesto_${slug(actual.cliente)}_${actual.fecha}.pdf`);
  } catch (e) {
    aviso("No se pudo generar el PDF: " + (e.message || "probá de nuevo"), 6000);
  }
  btn.disabled = false; btn.textContent = textoBtn;
}

// ====== ARRANQUE Y EVENTOS ======
export async function initPresupuestos() {
  if (!iniciado) { iniciado = true; enganchar(); }
  await cargar();
  if (modo === "lista") pintar();
}

function enganchar() {
  const raiz = $("#prCont");

  raiz.addEventListener("click", (e) => {
    const d = (k) => e.target.closest(`[data-${k}]`);
    let el;
    if (d("pr-nuevo")) { borrador = blanco(); return ir("form"); }
    if ((el = d("pr-f"))) { filtro = el.dataset.prF; return pintar(); }
    if ((el = d("pr-editar"))) { e.stopPropagation(); const r = porId(el.dataset.prEditar); if (r) { borrador = desdeFila(r); ir("form"); } return; }
    if ((el = d("pr-dup"))) return duplicar(el.dataset.prDup);
    if ((el = d("pr-borrar"))) return eliminar(el.dataset.prBorrar);
    if ((el = d("pr-abrir"))) { const r = porId(el.dataset.prAbrir); if (r) { actual = desdeFila(r); ir("doc"); } return; }
    if (d("pr-volver")) return ir("lista");
    if ((el = d("pr-pdf"))) return descargarPDF(el);
    if (d("pr-imprimir")) return window.print();
    if (d("pr-cancelar")) { if (confirm("¿Salir sin guardar los cambios?")) { borrador = null; ir("lista"); } return; }
    if (d("pr-guardar")) return guardar();
    if (d("pr-add-sec")) { borrador.secciones.push({ titulo: "", cuerpo: "" }); return pintar(); }
    if ((el = d("pr-quitar-sec"))) { borrador.secciones.splice(Number(el.dataset.prQuitarSec), 1); return pintar(); }
    if (d("pr-add-item")) { borrador.items.push({ detalle: "", cantidad: "", valor_unitario: "" }); return pintar(); }
    if ((el = d("pr-quitar-item"))) { borrador.items.splice(Number(el.dataset.prQuitarItem), 1); return pintar(); }
  });

  raiz.addEventListener("keydown", (e) => {
    const el = e.target.closest("[data-pr-abrir].item");
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); }
  });

  const alCambiar = (e) => {
    const el = e.target;
    if (el.id === "prBuscar") { busca = el.value; const pos = el.selectionStart; pintar(); const n = $("#prBuscar"); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (el.dataset.prEstado) return e.type === "change" ? cambiarEstado(el.dataset.prEstado, el.value) : undefined;
    if (modo !== "form" || !borrador) return;
    if (el.dataset.k) {
      borrador[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.k === "iva_modo") $("#prTotales").innerHTML = totalesHtml(borrador);
    }
    const ls = el.closest("[data-s]");
    if (ls && el.dataset.sec) borrador.secciones[Number(ls.dataset.s)][el.dataset.sec] = el.value;
    const li = el.closest("[data-i]");
    if (li && el.dataset.it) {
      const it = borrador.items[Number(li.dataset.i)];
      it[el.dataset.it] = el.value;
      li.querySelector(".l-sub").innerHTML = `Total del ítem <b>${plata(n2(it.cantidad) * monto(it.valor_unitario))}</b>`;
      $("#prTotales").innerHTML = totalesHtml(borrador);
    }
  };
  raiz.addEventListener("input", alCambiar);
  raiz.addEventListener("change", alCambiar);
}

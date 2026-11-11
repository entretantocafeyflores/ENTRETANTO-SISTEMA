import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const cant = (n) => Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
const n2 = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

const TZ = "America/Argentina/Buenos_Aires";
const hoyStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const dnum = (s) => Date.parse(s + "T00:00:00Z");
const diasHasta = (s) => Math.round((dnum(s) - dnum(hoyStr())) / 86400000);
const sumarDias = (s, n) => new Date(dnum(s) + n * 86400000).toISOString().slice(0, 10);
const fechaLinda = (s) => (s ? new Date(dnum(s)).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const pct = (p) => `${p > 0 ? "+" : ""}${p.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;

let prov = [], ins = [], fact = [], hist = {};
let iniciado = false, borrador = null, facFiltro = "pendiente", facSel = null, avisoMostrado = false;

function aviso(texto, ms = 3500) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), ms);
}

const nomProv = (id) => (prov.find((p) => String(p.id) === String(id)) || {}).nombre || "Proveedor";

// ====== CARGA DE DATOS ======
async function cargarBase() {
  const [p, i, f] = await Promise.all([
    db.from("proveedores").select("*").order("nombre"),
    db.from("insumos").select("*").order("nombre"),
    db.from("facturas")
      .select("id, proveedor_id, numero, fecha, vencimiento, total, iva_incluido, estado, pagada_fecha, foto_path, factura_items(insumo_id, descripcion, cantidad, unidad, precio_unitario)")
      .order("fecha", { ascending: false }).order("id", { ascending: false }).limit(400),
  ]);
  const err = p.error || i.error || f.error;
  const caja = $("#coError");
  if (err) {
    const falta = /does not exist|schema cache|PGRST205|42P01/i.test(`${err.code} ${err.message}`);
    caja.textContent = falta
      ? "Todavía falta crear las tablas de Compras en Supabase. Pegá el archivo sql/03-compras.sql en el SQL Editor y ejecutalo."
      : "No se pudo cargar Compras: " + err.message;
    return false;
  }
  caja.textContent = "";
  prov = p.data; ins = i.data; fact = f.data;
  hist = {};
  fact.forEach((fa) => (fa.factura_items || []).forEach((it) => {
    if (it.insumo_id == null) return;
    (hist[it.insumo_id] = hist[it.insumo_id] || []).push({
      fecha: fa.fecha, precio: n2(it.precio_unitario), unidad: norm(it.unidad), unidadTxt: it.unidad,
      iva: fa.iva_incluido, prov: fa.proveedor_id,
    });
  }));
  return true;
}

// ====== AVISOS ======
function textoVenc(f) {
  if (!f.vencimiento) return { t: "Sin fecha de vencimiento", c: "" };
  const d = diasHasta(f.vencimiento);
  if (d < 0) return { t: `Vencida hace ${-d} ${-d === 1 ? "día" : "días"}`, c: "urgente" };
  if (d === 0) return { t: "Vence hoy", c: "urgente" };
  if (d === 1) return { t: "Vence mañana", c: "pronto" };
  return { t: `Vence en ${d} días (${fechaLinda(f.vencimiento)})`, c: d <= 7 ? "pronto" : "" };
}

function cambioDe(id) {
  const h = hist[id];
  if (!h || !h.length) return null;
  const a = h[0];
  const b = h.slice(1).find((x) => x.unidad === a.unidad && (x.iva == null || a.iva == null || x.iva === a.iva));
  if (!b || !b.precio) return null;
  return { a, b, pct: ((a.precio - b.precio) / b.precio) * 100 };
}

function calcAlertas() {
  const pagos = fact.filter((f) => f.estado === "pendiente")
    .sort((x, y) => (x.vencimiento || "9999").localeCompare(y.vencimiento || "9999"));
  const vencidas = pagos.filter((f) => f.vencimiento && diasHasta(f.vencimiento) < 0);
  const proximas = pagos.filter((f) => f.vencimiento && diasHasta(f.vencimiento) >= 0 && diasHasta(f.vencimiento) <= 7);
  const bajo = ins.filter((i) => i.activo && i.stock_minimo != null && n2(i.stock_actual) <= n2(i.stock_minimo));
  return { pagos, vencidas, proximas, bajo, total: vencidas.length + proximas.length + bajo.length };
}

function ponerInsignia() {
  const btn = document.querySelector('#menu [data-modulo="compras"]');
  if (!btn) return;
  const a = calcAlertas();
  const vieja = btn.querySelector(".insignia");
  if (vieja) vieja.remove();
  if (a.total) btn.insertAdjacentHTML("beforeend", `<span class="insignia" title="Avisos pendientes">${a.total}</span>`);
}

// Se llama al ingresar a la app: pone el número de avisos en la solapa y avisa una sola vez por sesión.
export async function actualizarAlertas() {
  if (!(await cargarBase())) return;
  ponerInsignia();
  const a = calcAlertas();
  if (avisoMostrado || !a.total) return;
  avisoMostrado = true;
  const partes = [];
  if (a.vencidas.length) partes.push(`${a.vencidas.length} ${a.vencidas.length === 1 ? "factura vencida" : "facturas vencidas"}`);
  if (a.proximas.length) partes.push(`${a.proximas.length} por vencer esta semana`);
  if (a.bajo.length) partes.push(`${a.bajo.length} ${a.bajo.length === 1 ? "insumo" : "insumos"} con poco stock`);
  aviso("Compras: " + partes.join(" · "), 7000);
}

function dibujarAlertas() {
  const a = calcAlertas();
  const totalPend = a.pagos.reduce((s, f) => s + n2(f.total), 0);
  $("#coPagosResumen").textContent = a.pagos.length ? `Pendiente de pago: ${plata(totalPend)} en ${a.pagos.length} ${a.pagos.length === 1 ? "factura" : "facturas"}` : "";
  $("#coPagos").innerHTML = a.pagos.length
    ? a.pagos.map((f) => {
        const v = textoVenc(f);
        return `<div class="item ${v.c}"><div>${esc(nomProv(f.proveedor_id))}<small>Factura ${esc(f.numero || "sin número")} · ${v.t}</small></div>
          <div class="num"><span>${plata(f.total)}</span><button data-pagar="${f.id}">Ya la pagué</button></div></div>`;
      }).join("")
    : '<p class="vacio">No tenés pagos pendientes a proveedores.</p>';

  $("#coStock").innerHTML = a.bajo.length
    ? a.bajo.map((i) => `<div class="item"><div>${esc(i.nombre)}<small>Quedan ${cant(i.stock_actual)} ${esc(i.unidad)} · mínimo ${cant(i.stock_minimo)}${i.proveedor_id ? " · " + esc(nomProv(i.proveedor_id)) : ""}</small></div>
        <div><input class="mini" type="number" step="any" min="0" inputmode="decimal" placeholder="Stock nuevo" data-stock-in="${i.id}"><button data-stock-ok="${i.id}">Actualizar</button></div></div>`).join("")
    : '<p class="vacio">No hay insumos por debajo del mínimo. Para recibir avisos, definí un stock mínimo en cada insumo.</p>';

  const cambios = ins.map((i) => ({ i, c: cambioDe(i.id) }))
    .filter((x) => x.c && x.c.pct !== 0 && diasHasta(x.c.a.fecha) >= -60)
    .sort((x, y) => y.c.pct - x.c.pct).slice(0, 12);
  $("#coCambios").innerHTML = cambios.length
    ? cambios.map(({ i, c }) => `<div class="item"><div>${esc(i.nombre)}<small>${plata(c.b.precio)} → ${plata(c.a.precio)} por ${esc(c.a.unidadTxt)} · compra del ${fechaLinda(c.a.fecha)}</small></div>
        <div class="num"><span>${c.pct > 0 ? "↑" : "↓"} ${pct(c.pct)}</span></div></div>`).join("")
    : '<p class="vacio">Cuando cargues la segunda factura de un mismo producto vas a ver acá cuánto subió o bajó.</p>';
}

// ====== NAVEGACIÓN INTERNA ======
function irA(sec) {
  document.querySelectorAll("[data-cs]").forEach((s) => (s.hidden = s.dataset.cs !== sec));
  document.querySelectorAll("[data-cs-btn]").forEach((b) => b.classList.toggle("activa", b.dataset.csBtn === sec));
  if (sec === "alertas") dibujarAlertas();
  if (sec === "facturas") dibujarFacturas();
  if (sec === "proveedores") dibujarProveedores();
  if (sec === "insumos") dibujarInsumos();
}
const seccionActual = () => (document.querySelector("[data-cs-btn].activa") || {}).dataset?.csBtn || "alertas";

async function recargar(sec) {
  if (await cargarBase()) { ponerInsignia(); irA(sec || seccionActual()); if (borrador) dibujarBorrador(); }
}

// ====== FACTURAS: LISTA Y DETALLE ======
function dibujarFacturas() {
  document.querySelectorAll("#facChips [data-ff]").forEach((b) => b.classList.toggle("activa", b.dataset.ff === facFiltro));
  const q = norm($("#facBuscar").value);
  const ver = fact.filter((f) => (facFiltro === "todas" || f.estado === facFiltro) && (!q || norm(nomProv(f.proveedor_id) + " " + (f.numero || "")).includes(q)));
  $("#facLista").innerHTML = ver.length
    ? ver.map((f) => {
        const v = f.estado === "pendiente" ? textoVenc(f) : { t: `Pagada el ${fechaLinda(f.pagada_fecha)}`, c: "" };
        return `<div class="item ${f.estado === "pendiente" ? v.c : ""}${String(f.id) === String(facSel) ? " sel" : ""}" data-fac="${f.id}" role="button" tabindex="0">
          <div>${esc(nomProv(f.proveedor_id))}<small>N° ${esc(f.numero || "sin número")} · emitida ${fechaLinda(f.fecha)} · ${v.t}</small></div>
          <div class="num"><span>${plata(f.total)}</span></div></div>`;
      }).join("")
    : '<p class="vacio">No hay facturas para mostrar.</p>';
  dibujarDetalle();
}

function dibujarDetalle() {
  const box = $("#facDetalle");
  const f = fact.find((x) => String(x.id) === String(facSel));
  if (!f) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const lineas = (f.factura_items || []).map((it) => `<div class="item"><div>${esc(it.descripcion)}<small>${cant(it.cantidad)} ${esc(it.unidad)} × ${plata(it.precio_unitario)}</small></div>
    <div class="num"><span>${plata(n2(it.cantidad) * n2(it.precio_unitario))}</span></div></div>`).join("");
  box.innerHTML = `
    <h2>${esc(nomProv(f.proveedor_id))} · N° ${esc(f.numero || "sin número")}</h2>
    <p class="t-centro">Emitida ${fechaLinda(f.fecha)} · ${f.estado === "pagada" ? "Pagada el " + fechaLinda(f.pagada_fecha) : textoVenc(f).t}${f.iva_incluido === true ? " · precios con IVA" : f.iva_incluido === false ? " · precios sin IVA" : ""}</p>
    <div class="lista-est co-lista">${lineas || '<p class="vacio">Esta factura no tiene renglones.</p>'}</div>
    <div class="total"><span>Total</span><span>${plata(f.total)}</span></div>
    <div class="fila">
      ${f.estado === "pendiente" ? `<button class="principal" data-pagar="${f.id}">Ya la pagué</button>` : `<button data-reabrir="${f.id}">Marcar como pendiente</button>`}
      ${f.foto_path ? `<button data-foto="${f.id}">Ver foto</button>` : ""}
      <button class="link" data-fborrar="${f.id}">Borrar factura</button>
    </div>
    <div id="facFoto"></div>`;
}

async function cambiarEstado(id, estado) {
  const fila = estado === "pagada" ? { estado, pagada_fecha: hoyStr() } : { estado, pagada_fecha: null };
  const { error } = await db.from("facturas").update(fila).eq("id", id);
  if (error) return aviso("No se pudo guardar el cambio: " + error.message);
  aviso(estado === "pagada" ? "Factura marcada como pagada" : "Factura marcada como pendiente");
  await recargar();
}

async function verFoto(id) {
  const f = fact.find((x) => String(x.id) === String(id));
  if (!f || !f.foto_path) return;
  const { data, error } = await db.storage.from("facturas").createSignedUrl(f.foto_path, 600);
  if (error) return aviso("No se pudo abrir la foto: " + error.message);
  $("#facFoto").innerHTML = /\.pdf$/i.test(f.foto_path)
    ? `<p><a href="${esc(data.signedUrl)}" target="_blank" rel="noopener">Abrir el PDF de la factura</a></p>`
    : `<img class="foto-fact" src="${esc(data.signedUrl)}" alt="Foto de la factura">`;
}

async function recalcularPrecios(idsInsumos) {
  const ids = [...new Set(idsInsumos.filter((x) => x != null))];
  await Promise.all(ids.map((id) => {
    const h = hist[id] && hist[id][0];
    return db.from("insumos").update({ ultimo_precio: h ? h.precio : null, ultimo_precio_fecha: h ? h.fecha : null }).eq("id", id);
  }));
}

async function borrarFactura(id) {
  const f = fact.find((x) => String(x.id) === String(id));
  if (!f || !confirm("¿Borrar esta factura? Se pierden sus renglones y su foto.")) return;
  const afectados = (f.factura_items || []).map((i) => i.insumo_id);
  const { error } = await db.from("facturas").delete().eq("id", id);
  if (error) return aviso("No se pudo borrar: " + error.message);
  if (f.foto_path) await db.storage.from("facturas").remove([f.foto_path]);
  facSel = null;
  await cargarBase();
  await recalcularPrecios(afectados);
  aviso("Factura borrada");
  await recargar("facturas");
}

// ====== PROVEEDORES ======
function dibujarProveedores() {
  const pend = {};
  fact.filter((f) => f.estado === "pendiente").forEach((f) => (pend[f.proveedor_id] = (pend[f.proveedor_id] || 0) + n2(f.total)));
  $("#pLista").innerHTML = prov.length
    ? prov.map((p) => `<div class="item ${p.activo ? "" : "off"}"><div>${esc(p.nombre)}<small>${p.cuit ? "CUIT " + esc(p.cuit) + " · " : ""}${p.plazo_pago_dias ? "Paga a " + p.plazo_pago_dias + " días" : "Pago contado"}${p.telefono ? " · " + esc(p.telefono) : ""}${pend[p.id] ? " · Debés " + plata(pend[p.id]) : ""}${p.activo ? "" : " · inactivo"}</small></div>
        <div><button data-pedit="${p.id}">Editar</button><button class="link" data-pdel="${p.id}">Borrar</button></div></div>`).join("")
    : '<p class="vacio">Todavía no cargaste proveedores. Se crean solos al cargar la primera factura, o podés agregarlos acá.</p>';
}

function limpiarProveedor() {
  $("#pForm").reset(); $("#pId").value = ""; $("#pActivo").checked = true;
  $("#pTitulo").textContent = "Nuevo proveedor"; $("#pCancelar").hidden = true;
}

async function guardarProveedor() {
  const fila = {
    nombre: $("#pNombre").value.trim(), cuit: $("#pCuit").value.trim() || null, telefono: $("#pTel").value.trim() || null,
    plazo_pago_dias: Math.max(0, Math.round(n2($("#pPlazo").value))), notas: $("#pNotas").value.trim() || null, activo: $("#pActivo").checked,
  };
  if (!fila.nombre) return aviso("Poné el nombre del proveedor.");
  const id = $("#pId").value;
  const { error } = id ? await db.from("proveedores").update(fila).eq("id", id) : await db.from("proveedores").insert(fila);
  if (error) return aviso("No se pudo guardar el proveedor: " + error.message);
  limpiarProveedor(); aviso("Proveedor guardado"); await recargar("proveedores");
}

function editarProveedor(id) {
  const p = prov.find((x) => String(x.id) === String(id));
  if (!p) return;
  $("#pId").value = p.id; $("#pNombre").value = p.nombre; $("#pCuit").value = p.cuit || ""; $("#pTel").value = p.telefono || "";
  $("#pPlazo").value = p.plazo_pago_dias || 0; $("#pNotas").value = p.notas || ""; $("#pActivo").checked = p.activo;
  $("#pTitulo").textContent = "Editar proveedor"; $("#pCancelar").hidden = false; $("#pNombre").focus();
}

async function borrarProveedor(id) {
  if (!confirm("¿Borrar este proveedor?")) return;
  const { error } = await db.from("proveedores").delete().eq("id", id);
  if (error) return aviso(/foreign key|violates/i.test(error.message) ? "Tiene facturas cargadas, no se puede borrar. Desmarcá «Activo» para ocultarlo." : "No se pudo borrar: " + error.message, 5000);
  aviso("Proveedor borrado"); await recargar("proveedores");
}

// ====== INSUMOS ======
function dibujarInsumos() {
  const provActual = $("#iProv").value;
  $("#iProv").innerHTML = '<option value="">Sin proveedor fijo</option>' + prov.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("#iProv").value = provActual;
  const q = norm($("#iBuscar").value);
  const ver = ins.filter((i) => !q || norm(i.nombre).includes(q));
  $("#iLista").innerHTML = ver.length
    ? ver.map((i) => {
        const c = cambioDe(i.id);
        const h = (hist[i.id] || []).slice(0, 8);
        const bajo = i.activo && i.stock_minimo != null && n2(i.stock_actual) <= n2(i.stock_minimo);
        return `<div class="item-wrap"><div class="item ${i.activo ? "" : "off"}${bajo ? " pronto" : ""}"><div>${esc(i.nombre)}<small>${i.ultimo_precio != null ? plata(i.ultimo_precio) + " por " + esc(i.unidad) + " (" + fechaLinda(i.ultimo_precio_fecha) + ")" : "Sin compras cargadas"}${c ? " · " + (c.pct > 0 ? "↑ " : c.pct < 0 ? "↓ " : "") + pct(c.pct) : ""}${i.stock_minimo != null ? " · Stock " + cant(i.stock_actual) + " (mín. " + cant(i.stock_minimo) + ")" : ""}${i.proveedor_id ? " · " + esc(nomProv(i.proveedor_id)) : ""}</small></div>
          <div>${h.length ? `<button data-ihist="${i.id}">Precios</button>` : ""}<button data-iedit="${i.id}">Editar</button><button class="link" data-idel="${i.id}">Borrar</button></div></div>
          <div class="hist" data-hist-de="${i.id}" hidden>${h.map((x) => `<div><span>${fechaLinda(x.fecha)} · ${esc(nomProv(x.prov))}</span><b>${plata(x.precio)} por ${esc(x.unidadTxt)}${x.iva === true ? " con IVA" : x.iva === false ? " sin IVA" : ""}</b></div>`).join("")}</div></div>`;
      }).join("")
    : '<p class="vacio">No hay insumos para mostrar. Se crean al cargar facturas, o podés agregarlos acá.</p>';
}

function limpiarInsumo() {
  $("#iForm").reset(); $("#iId").value = ""; $("#iActivo").checked = true;
  $("#iTitulo").textContent = "Nuevo insumo"; $("#iCancelar").hidden = true;
}

async function guardarInsumo() {
  const nombre = $("#iNombre").value.trim();
  if (!nombre) return aviso("Poné el nombre del insumo.");
  const min = $("#iMin").value.trim();
  const fila = {
    nombre, unidad: $("#iUnidad").value.trim() || "unidad", proveedor_id: $("#iProv").value || null,
    stock_actual: n2($("#iStock").value), stock_minimo: min === "" ? null : n2(min), activo: $("#iActivo").checked,
  };
  const id = $("#iId").value;
  const { error } = id ? await db.from("insumos").update(fila).eq("id", id) : await db.from("insumos").insert(fila);
  if (error) return aviso(/duplicate|unique/i.test(error.message) ? "Ya existe un insumo con ese nombre." : "No se pudo guardar el insumo: " + error.message);
  limpiarInsumo(); aviso("Insumo guardado"); await recargar("insumos");
}

function editarInsumo(id) {
  const i = ins.find((x) => String(x.id) === String(id));
  if (!i) return;
  $("#iId").value = i.id; $("#iNombre").value = i.nombre; $("#iUnidad").value = i.unidad; $("#iProv").value = i.proveedor_id ?? "";
  $("#iStock").value = i.stock_actual ?? 0; $("#iMin").value = i.stock_minimo ?? ""; $("#iActivo").checked = i.activo;
  $("#iTitulo").textContent = "Editar insumo"; $("#iCancelar").hidden = false; $("#iNombre").focus();
  $("#iNombre").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function borrarInsumo(id) {
  if (!confirm("¿Borrar este insumo? Las facturas ya cargadas se mantienen, pero sus renglones dejan de estar asociados a él.")) return;
  const { error } = await db.from("insumos").delete().eq("id", id);
  if (error) return aviso("No se pudo borrar: " + error.message);
  aviso("Insumo borrado"); await recargar("insumos");
}

async function actualizarStock(id) {
  const campo = document.querySelector(`[data-stock-in="${id}"]`);
  if (!campo || campo.value.trim() === "" || n2(campo.value) < 0) return aviso("Escribí cuánto stock tenés ahora.");
  const { error } = await db.from("insumos").update({ stock_actual: n2(campo.value) }).eq("id", id);
  if (error) return aviso("No se pudo actualizar: " + error.message);
  aviso("Stock actualizado"); await recargar("alertas");
}

// ====== CARGAR FACTURA: FOTO → LECTURA → REVISIÓN → GUARDADO ======
async function aImagen(file) {
  let origen;
  try { origen = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    origen = await new Promise((ok, mal) => { const im = new Image(); im.onload = () => ok(im); im.onerror = mal; im.src = URL.createObjectURL(file); })
      .catch(() => { throw new Error("No pude abrir esa imagen. Probá sacando la foto de nuevo."); });
  }
  const w = origen.naturalWidth || origen.width, h = origen.naturalHeight || origen.height;
  const k = Math.min(1, 2000 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(origen, 0, 0, c.width, c.height);
  let blob;
  for (const calidad of [0.85, 0.7, 0.55]) {
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", calidad));
    if (blob && blob.size <= 3_000_000) break;
  }
  if (!blob) throw new Error("No pude preparar la imagen. Probá de nuevo.");
  return blob;
}

const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => mal(new Error("No pude leer el archivo."));
  r.readAsDataURL(blob);
});

function lineaVacia() { return { descripcion: "", cantidad: 1, unidad: "unidad", precio_unitario: "", subtotal_leido: null, insumo_id: "nuevo" }; }

function armarBorrador(res, blob, tipo) {
  res = res || {};
  const items = (res.items || []).map((x) => {
    const ex = x.insumo_existente ? norm(x.insumo_existente) : "";
    const m = (ex && ins.find((i) => norm(i.nombre) === ex)) || ins.find((i) => norm(i.nombre) === norm(x.descripcion));
    return {
      descripcion: String(x.descripcion || "").trim(), cantidad: x.cantidad ?? 1, unidad: String(x.unidad || "unidad").toLowerCase(),
      precio_unitario: x.precio_unitario ?? "", subtotal_leido: x.subtotal ?? null, insumo_id: m ? String(m.id) : "nuevo",
    };
  });
  const cuit = digitos(res.cuit), nombre = norm(res.proveedor);
  let p = cuit.length >= 10 ? prov.find((x) => digitos(x.cuit) === cuit) : null;
  if (!p && nombre) p = prov.find((x) => norm(x.nombre) === nombre) || prov.find((x) => norm(x.nombre).length >= 4 && nombre.length >= 4 && (norm(x.nombre).includes(nombre) || nombre.includes(norm(x.nombre))));
  const b = {
    proveedor_id: p ? String(p.id) : "nuevo", prov_nombre: res.proveedor || "", prov_cuit: res.cuit || "",
    numero: res.numero || "", fecha: res.fecha || hoyStr(), vencimiento: res.vencimiento || "", vencAuto: !res.vencimiento,
    total: res.total ?? "", iva_incluido: typeof res.iva_incluido === "boolean" ? res.iva_incluido : null,
    items: items.length ? items : [lineaVacia()], advertencias: Array.isArray(res.advertencias) ? res.advertencias.filter(Boolean) : [], blob, tipo,
  };
  borrador = b;
  recalcVenc();
  return b;
}

function recalcVenc() {
  if (!borrador || !borrador.vencAuto) return;
  const p = prov.find((x) => String(x.id) === borrador.proveedor_id);
  borrador.vencimiento = p && p.plazo_pago_dias > 0 && borrador.fecha ? sumarDias(borrador.fecha, p.plazo_pago_dias) : "";
}

const subCalc = (it) => n2(it.cantidad) * n2(it.precio_unitario);
const sumaItems = () => borrador.items.reduce((s, it) => s + subCalc(it), 0);

function textoSub(it) {
  const calc = subCalc(it), leido = it.subtotal_leido;
  const raro = leido != null && Math.abs(calc - leido) > Math.max(1, Math.abs(leido) * 0.02);
  return `Subtotal <b>${plata(calc)}</b>${raro ? `<span class="dudoso">La factura dice ${plata(leido)}: revisá cantidad y precio</span>` : ""}`;
}

function lineaHtml(it, i) {
  const opciones = '<option value="nuevo">➕ Crear insumo nuevo</option>' + ins
    .filter((x) => x.activo || String(x.id) === it.insumo_id)
    .map((x) => `<option value="${x.id}"${String(x.id) === it.insumo_id ? " selected" : ""}>${esc(x.nombre)}</option>`).join("");
  return `<div class="linea" data-i="${i}">
    <label class="l-desc">Producto <input data-f="descripcion" value="${esc(it.descripcion)}"></label>
    <label>Cantidad <input data-f="cantidad" type="number" step="any" min="0" inputmode="decimal" value="${esc(it.cantidad)}"></label>
    <label>Unidad <input data-f="unidad" list="coUnidades" value="${esc(it.unidad)}"></label>
    <label>Precio por unidad <input data-f="precio_unitario" type="number" step="any" min="0" inputmode="decimal" value="${esc(it.precio_unitario)}"></label>
    <label class="l-desc">Insumo en tu sistema <select data-f="insumo_id">${opciones}</select></label>
    <div class="l-sub">${textoSub(it)}</div>
    <button type="button" class="link" data-quitar="${i}">Quitar renglón</button></div>`;
}

function dibujarBorrador() {
  const box = $("#cfForm"), b = borrador;
  if (!b) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const provOpts = `<option value="nuevo"${b.proveedor_id === "nuevo" ? " selected" : ""}>➕ Proveedor nuevo</option>` + prov
    .filter((p) => p.activo || String(p.id) === b.proveedor_id)
    .map((p) => `<option value="${p.id}"${String(p.id) === b.proveedor_id ? " selected" : ""}>${esc(p.nombre)}</option>`).join("");
  box.innerHTML = `
    <h2>Revisá y guardá</h2>
    ${b.advertencias.length ? `<div class="error">${b.advertencias.map(esc).join("<br>")}</div>` : ""}
    <div class="grilla2">
      <label>Proveedor <select data-k="proveedor_id">${provOpts}</select></label>
      <label>N° de factura <input data-k="numero" value="${esc(b.numero)}"></label>
      <label>Fecha de la factura <input data-k="fecha" type="date" value="${esc(b.fecha)}"></label>
      <label>Vence el <input id="cfVenc" data-k="vencimiento" type="date" value="${esc(b.vencimiento)}"></label>
    </div>
    ${b.proveedor_id === "nuevo" ? `<div class="grilla2 bloque"><label>Nombre del proveedor nuevo <input data-k="prov_nombre" value="${esc(b.prov_nombre)}"></label><label>CUIT (opcional) <input data-k="prov_cuit" value="${esc(b.prov_cuit)}"></label></div>` : ""}
    <label class="check"><input type="checkbox" data-k="iva_incluido"${b.iva_incluido ? " checked" : ""}> Los precios de los renglones ya incluyen IVA</label>
    ${b.iva_incluido === null ? '<p class="nota" style="margin-top:0">No se pudo saber si los precios incluyen IVA. Marcalo si corresponde: sirve para comparar bien los aumentos.</p>' : ""}
    <h3 class="sub">Productos de la factura</h3>
    <div id="cfItems" class="items-fact">${b.items.map(lineaHtml).join("")}</div>
    <button type="button" data-agregar-linea>Agregar un renglón</button>
    <div class="grilla2 bloque">
      <label>Total a pagar <input data-k="total" type="number" step="any" min="0" inputmode="decimal" value="${esc(b.total)}"></label>
      <p class="t-centro" id="cfSuma">Suma de los renglones: ${plata(sumaItems())}</p>
    </div>
    <p id="cfError" class="error" role="alert"></p>
    <div class="fila"><button class="principal" data-guardar-fact>Guardar factura</button><button class="link" data-cancelar-fact>Descartar</button></div>`;
}

async function leerFactura() {
  const estado = $("#cfEstado"), btn = $("#cfLeer");
  const f = $("#cfArchivo").files[0];
  const marcar = (t, mal) => { estado.textContent = t; estado.className = mal ? "error" : "t-centro"; };
  if (!f) return marcar("Primero elegí la foto o el PDF de la factura.", true);
  btn.disabled = true; marcar("Leyendo la factura… puede tardar hasta un minuto.");
  try {
    let blob, tipo;
    if (f.type === "application/pdf") {
      if (f.size > 3_500_000) throw new Error("El PDF pesa demasiado. Sacale una foto a la factura en su lugar.");
      blob = f; tipo = "application/pdf";
    } else { blob = await aImagen(f); tipo = "image/jpeg"; }
    const archivo = await aBase64(blob);
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error("Tu sesión venció. Volvé a ingresar.");
    let r;
    try {
      r = await fetch("/api/leer-factura", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ archivo, tipo, insumos: ins.filter((i) => i.activo).map((i) => i.nombre) }),
      });
    } catch { throw new Error("No se pudo conectar con el lector de facturas. Revisá tu conexión."); }
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || "No se pudo leer la factura. Probá de nuevo o cargala a mano.");
    armarBorrador(res, blob, tipo);
    marcar("");
    dibujarBorrador();
    $("#cfForm").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { marcar(e.message || "No se pudo leer la factura.", true); }
  btn.disabled = false;
}

async function guardarFactura() {
  const b = borrador, err = $("#cfError"), btn = document.querySelector("[data-guardar-fact]");
  err.textContent = "";
  const falla = (t) => { err.textContent = t; btn.disabled = false; };
  btn.disabled = true;

  if (b.proveedor_id === "nuevo" && !b.prov_nombre.trim()) return falla("Poné el nombre del proveedor.");
  if (!b.fecha) return falla("Poné la fecha de la factura.");
  const items = b.items;
  if (!items.length) return falla("La factura tiene que tener al menos un renglón.");
  for (const [k, it] of items.entries()) {
    if (!it.descripcion.trim()) return falla(`Al renglón ${k + 1} le falta el nombre del producto.`);
    if (!(n2(it.cantidad) > 0)) return falla(`Revisá la cantidad del renglón ${k + 1} (${it.descripcion}).`);
    if (String(it.precio_unitario).trim() === "" || n2(it.precio_unitario) < 0) return falla(`Revisá el precio del renglón ${k + 1} (${it.descripcion}).`);
  }
  const numero = b.numero.trim();
  if (numero && b.proveedor_id !== "nuevo" && fact.some((f) => String(f.proveedor_id) === b.proveedor_id && norm(f.numero) === norm(numero))) return falla("Esa factura ya está cargada para este proveedor.");

  try {
    // 1) Proveedor
    let provId = b.proveedor_id;
    if (provId === "nuevo") {
      const existe = prov.find((p) => norm(p.nombre) === norm(b.prov_nombre));
      if (existe) provId = String(existe.id);
      else {
        const { data, error } = await db.from("proveedores").insert({ nombre: b.prov_nombre.trim(), cuit: b.prov_cuit.trim() || null }).select().single();
        if (error) throw new Error("No se pudo crear el proveedor: " + error.message);
        provId = String(data.id);
      }
    }
    // 2) Insumos nuevos (sin duplicar nombres)
    const idPorNombre = {};
    ins.forEach((i) => (idPorNombre[norm(i.nombre)] = i.id));
    const aCrear = [];
    items.forEach((it) => {
      if (it.insumo_id !== "nuevo") return;
      const n = norm(it.descripcion);
      if (idPorNombre[n] || aCrear.some((x) => norm(x.nombre) === n)) return;
      aCrear.push({ nombre: it.descripcion.trim(), unidad: it.unidad.trim() || "unidad", proveedor_id: Number(provId) });
    });
    if (aCrear.length) {
      const { data, error } = await db.from("insumos").insert(aCrear).select();
      if (error) throw new Error("No se pudieron crear los insumos nuevos: " + error.message);
      data.forEach((i) => (idPorNombre[norm(i.nombre)] = i.id));
    }
    const idDe = (it) => (it.insumo_id === "nuevo" ? idPorNombre[norm(it.descripcion)] : Number(it.insumo_id));
    // 3) Factura
    const total = String(b.total).trim() === "" ? sumaItems() : n2(b.total);
    const { data: fa, error: e1 } = await db.from("facturas").insert({
      proveedor_id: Number(provId), numero: numero || null, fecha: b.fecha, vencimiento: b.vencimiento || null,
      total, iva_incluido: b.iva_incluido,
    }).select().single();
    if (e1) throw new Error(/duplicate|unique/i.test(e1.message) ? "Esa factura ya está cargada para este proveedor." : "No se pudo guardar la factura: " + e1.message);
    // 4) Renglones
    const { error: e2 } = await db.from("factura_items").insert(items.map((it) => ({
      factura_id: fa.id, insumo_id: idDe(it), descripcion: it.descripcion.trim(), cantidad: n2(it.cantidad),
      unidad: it.unidad.trim() || "unidad", precio_unitario: n2(it.precio_unitario),
    })));
    if (e2) { await db.from("facturas").delete().eq("id", fa.id); throw new Error("No se pudieron guardar los renglones: " + e2.message); }
    // 5) Foto (si falla, la factura queda guardada igual)
    let sinFoto = false;
    if (b.blob) {
      const ext = b.tipo === "application/pdf" ? "pdf" : "jpg";
      const ruta = `${b.fecha.slice(0, 4)}/${fa.id}-${Date.now()}.${ext}`;
      const sub = await db.storage.from("facturas").upload(ruta, b.blob, { contentType: b.tipo });
      if (sub.error) sinFoto = true;
      else await db.from("facturas").update({ foto_path: ruta }).eq("id", fa.id);
    }
    // 6) Último precio de cada insumo (solo si esta factura es la más reciente de ese insumo)
    const ultimo = {};
    items.forEach((it) => (ultimo[idDe(it)] = n2(it.precio_unitario)));
    const actuales = Object.fromEntries(ins.map((i) => [i.id, i]));
    await Promise.all(Object.entries(ultimo).map(([id, precio]) => {
      const cur = actuales[id];
      if (cur && cur.ultimo_precio_fecha && cur.ultimo_precio_fecha > b.fecha) return null;
      return db.from("insumos").update({ ultimo_precio: precio, ultimo_precio_fecha: b.fecha }).eq("id", id);
    }));

    borrador = null; facSel = fa.id; facFiltro = "todas";
    $("#cfArchivo").value = ""; $("#cfEstado").textContent = "";
    dibujarBorrador();
    aviso(sinFoto ? "Factura guardada, pero no se pudo guardar la foto." : "Factura guardada", 4500);
    await recargar("facturas");
  } catch (e) {
    falla(e.message);
  }
}

// ====== ARRANQUE Y EVENTOS ======
export async function initCompras() {
  if (!iniciado) { iniciado = true; engancharEventos(); irA("alertas"); }
  if (await cargarBase()) { ponerInsignia(); irA(seccionActual()); if (borrador) dibujarBorrador(); }
}

function engancharEventos() {
  const raiz = document.querySelector('[data-vista="compras"]');

  raiz.addEventListener("click", (e) => {
    const t = e.target, d = (k) => t.closest(`[data-${k}]`);
    let el;
    if ((el = d("cs-btn"))) return irA(el.dataset.csBtn);
    if ((el = d("pagar"))) return cambiarEstado(el.dataset.pagar, "pagada");
    if ((el = d("reabrir"))) return cambiarEstado(el.dataset.reabrir, "pendiente");
    if ((el = d("stock-ok"))) return actualizarStock(el.dataset.stockOk);
    if ((el = d("ff"))) { facFiltro = el.dataset.ff; return dibujarFacturas(); }
    if ((el = d("foto"))) return verFoto(el.dataset.foto);
    if ((el = d("fborrar"))) return borrarFactura(el.dataset.fborrar);
    if ((el = d("fac"))) { facSel = el.dataset.fac; dibujarFacturas(); return $("#facDetalle").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    if ((el = d("pedit"))) return editarProveedor(el.dataset.pedit);
    if ((el = d("pdel"))) return borrarProveedor(el.dataset.pdel);
    if (t.closest("#pCancelar")) return limpiarProveedor();
    if ((el = d("iedit"))) return editarInsumo(el.dataset.iedit);
    if ((el = d("idel"))) return borrarInsumo(el.dataset.idel);
    if ((el = d("ihist"))) { const h = document.querySelector(`[data-hist-de="${el.dataset.ihist}"]`); if (h) h.hidden = !h.hidden; return; }
    if (t.closest("#iCancelar")) return limpiarInsumo();
    if (t.closest("#cfLeer")) return leerFactura();
    if (t.closest("#cfManual")) { armarBorrador(null, null, null); $("#cfEstado").textContent = ""; dibujarBorrador(); return $("#cfForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
    if (!borrador) return;
    if ((el = d("quitar"))) { borrador.items.splice(Number(el.dataset.quitar), 1); return dibujarBorrador(); }
    if (d("agregar-linea")) { borrador.items.push(lineaVacia()); return dibujarBorrador(); }
    if (d("guardar-fact")) return guardarFactura();
    if (d("cancelar-fact")) { if (confirm("¿Descartar esta factura sin guardar?")) { borrador = null; $("#cfArchivo").value = ""; dibujarBorrador(); } }
  });

  raiz.addEventListener("keydown", (e) => {
    const el = e.target.closest("[data-fac]");
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); }
  });

  // Edición de la factura en revisión (cada cambio queda guardado en "borrador")
  const alCambiar = (e) => {
    const el = e.target;
    if (!borrador) return;
    const k = el.dataset.k, f = el.dataset.f;
    if (k) {
      borrador[k] = el.type === "checkbox" ? el.checked : el.value;
      if (k === "vencimiento") borrador.vencAuto = false;
      if ((k === "fecha" || k === "proveedor_id") && e.type === "change") {
        recalcVenc();
        if (k === "proveedor_id") return dibujarBorrador();
        const v = $("#cfVenc"); if (v) v.value = borrador.vencimiento;
      }
    }
    const li = el.closest(".linea");
    if (li && f) {
      const it = borrador.items[Number(li.dataset.i)];
      it[f] = el.value;
      li.querySelector(".l-sub").innerHTML = textoSub(it);
    }
    const suma = $("#cfSuma"); if (suma) suma.textContent = `Suma de los renglones: ${plata(sumaItems())}`;
  };
  raiz.addEventListener("input", alCambiar);
  raiz.addEventListener("change", alCambiar);

  $("#facBuscar").addEventListener("input", dibujarFacturas);
  $("#iBuscar").addEventListener("input", dibujarInsumos);
  $("#pForm").addEventListener("submit", (e) => { e.preventDefault(); guardarProveedor(); });
  $("#iForm").addEventListener("submit", (e) => { e.preventDefault(); guardarInsumo(); });
}

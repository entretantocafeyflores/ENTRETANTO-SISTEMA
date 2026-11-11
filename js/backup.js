import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("es-AR");
const TZ = "America/Argentina/Buenos_Aires";
const CLAVE = "entretanto_ultimo_backup";

// Si más adelante se suman tablas (costeo...), agregarlas acá para que entren en la copia.
const TABLAS = [
  { n: "perfiles", t: "Usuarios y roles", id: true },
  { n: "roles_modulos", t: "Permisos por rol", id: false },
  { n: "categorias", t: "Categorías", id: true },
  { n: "productos", t: "Productos y precios", id: true },
  { n: "mesas", t: "Mesas", id: true },
  { n: "comandas", t: "Tickets y comandas", id: true },
  { n: "comanda_items", t: "Productos de cada ticket", id: true },
  { n: "proveedores", t: "Proveedores", id: true },
  { n: "insumos", t: "Insumos, precios y stock", id: true },
  { n: "facturas", t: "Facturas de proveedores", id: true },
  { n: "factura_items", t: "Renglones de cada factura", id: true },
];

function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 3500);
}

const sello = () => {
  const d = new Date();
  const f = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const h = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).replace(":", "");
  return `${f}-${h}`;
};

function bajar(nombre, contenido, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function leerTabla(t) {
  let filas = [];
  for (let p = 0; ; p++) {
    let q = db.from(t.n).select("*");
    if (t.id) q = q.order("id");
    const { data, error } = await q.range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    filas = filas.concat(data);
    if (data.length < 1000) break;
  }
  return filas;
}

function dibujarEstado() {
  const el = $("#bkEstado");
  const ts = Number(localStorage.getItem(CLAVE));
  const dias = ts ? Math.floor((Date.now() - ts) / 86400000) : null;
  if (!ts) { el.textContent = "Todavía no descargaste ninguna copia desde este dispositivo."; el.className = "error"; return; }
  const cuando = new Date(ts).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
  el.textContent = dias === 0 ? `Última copia: hoy (${cuando}).` : `Última copia: hace ${dias} ${dias === 1 ? "día" : "días"} (${cuando}).`;
  el.className = dias >= 7 ? "error" : "t-centro";
}

async function dibujarLista() {
  const res = await Promise.all(TABLAS.map((t) => db.from(t.n).select("*", { count: "exact", head: true })));
  $("#bkLista").innerHTML = TABLAS.map((t, i) => {
    const r = res[i];
    return `<div class="item"><div>${esc(t.t)}<small>${esc(t.n)}${r.error ? " · sin acceso" : ""}</small></div><div class="num">${r.error ? "–" : num(r.count)}</div></div>`;
  }).join("");
}

async function copiaCompleta() {
  const btn = $("#bkCompleta");
  btn.disabled = true; btn.textContent = "Preparando la copia…";
  const tablas = {}, errores = {};
  for (const t of TABLAS) {
    try { tablas[t.n] = await leerTabla(t); } catch (e) { errores[t.n] = e.message; }
  }
  const total = Object.values(tablas).reduce((s, f) => s + f.length, 0);
  const cuerpo = { app: "Entretanto Café & Flores", version: 1, generada: new Date().toISOString(), errores, tablas };
  bajar(`entretanto-copia-${sello()}.json`, JSON.stringify(cuerpo), "application/json");
  btn.disabled = false; btn.textContent = "Descargar copia completa";
  if (Object.keys(errores).length) aviso("La copia se bajó, pero faltan: " + Object.keys(errores).join(", "));
  else { localStorage.setItem(CLAVE, String(Date.now())); aviso(`Copia descargada (${num(total)} registros)`); }
  dibujarEstado();
}

const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const dec = (n) => String(Number(n)).replace(".", ",");

async function ventasExcel() {
  const btn = $("#bkVentas");
  btn.disabled = true; btn.textContent = "Preparando las ventas…";
  try {
    const m = await db.from("mesas").select("id, nombre");
    const mesas = Object.fromEntries((m.data || []).map((x) => [x.id, x.nombre]));
    const filas = [["Ticket", "Fecha", "Hora", "Mesa", "Comensales", "Medio de pago", "Producto", "Cantidad", "Precio unitario", "Subtotal", "Total del ticket", "Anulado", "Motivo anulación"]];
    for (let p = 0; ; p++) {
      const { data, error } = await db.from("comandas")
        .select("id, numero_ticket, mesa_id, cerrada_at, comensales, medio_pago, total, anulada_at, motivo_anulacion, comanda_items(nombre, cantidad, precio_unitario)")
        .eq("estado", "cerrada").order("id").range(p * 1000, p * 1000 + 999);
      if (error) throw error;
      data.forEach((c) => {
        const fecha = new Date(c.cerrada_at).toLocaleDateString("es-AR", { timeZone: TZ });
        const hora = new Date(c.cerrada_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
        (c.comanda_items || []).forEach((i) => filas.push([
          String(c.numero_ticket ?? "").padStart(6, "0"), fecha, hora, mesas[c.mesa_id] || "", c.comensales ?? "", c.medio_pago || "",
          i.nombre, dec(i.cantidad), dec(i.precio_unitario), dec(i.cantidad * i.precio_unitario), dec(c.total ?? 0),
          c.anulada_at ? "Sí" : "No", c.motivo_anulacion || "",
        ]));
      });
      if (data.length < 1000) break;
    }
    // Separador ";" y BOM para que Excel en español abra bien los acentos y las columnas
    const csv = "\uFEFF" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
    bajar(`entretanto-ventas-${sello()}.csv`, csv, "text/csv;charset=utf-8");
    aviso(`Ventas descargadas (${num(filas.length - 1)} renglones)`);
  } catch (e) {
    aviso("No se pudieron leer las ventas: " + e.message);
  }
  btn.disabled = false; btn.textContent = "Descargar ventas para Excel";
}

let iniciado = false;
export function initBackup() {
  if (!iniciado) {
    iniciado = true;
    $("#bkCompleta").addEventListener("click", copiaCompleta);
    $("#bkVentas").addEventListener("click", ventasExcel);
  }
  dibujarEstado();
  dibujarLista();
}

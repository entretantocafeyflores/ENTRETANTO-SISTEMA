import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const sinTildes = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const TZ = "America/Argentina/Buenos_Aires";
const TURNOS = ["Desayuno", "Almuerzo", "Merienda", "Noche"];
let filas = [], agg = null, iniciado = false;

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const sumarDias = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaDe = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const turnoDe = (iso) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date(iso)));
  return h < 12 ? "Desayuno" : h < 16 ? "Almuerzo" : h < 20 ? "Merienda" : "Noche";
};
const fechaLinda = (f) => new Date(f + "T12:00:00Z").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function periodo(tipo) {
  const hoy = hoyAR();
  if (tipo === "hoy") return [hoy, hoy];
  if (tipo === "semana") return [sumarDias(hoy, -((new Date(hoy + "T12:00:00Z").getUTCDay() + 6) % 7)), hoy];
  if (tipo === "mes") return [hoy.slice(0, 8) + "01", hoy];
  const [y, m] = hoy.split("-").map(Number);
  return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)];
}

async function cargar() {
  const desde = $("#estDesde").value, hasta = $("#estHasta").value;
  $("#estError").textContent = "";
  if (!desde || !hasta || desde > hasta) { $("#estError").textContent = "Revisá las fechas: la de inicio tiene que ser anterior a la final."; return; }
  filas = [];
  for (let pag = 0; ; pag++) {
    const { data, error } = await db.from("comandas")
      .select("id, abierta_at, cerrada_at, total, comensales, medio_pago, comanda_items(nombre, cantidad, precio_unitario)")
      .eq("estado", "cerrada").is("anulada_at", null)
      .gte("cerrada_at", `${desde}T00:00:00-03:00`).lt("cerrada_at", `${sumarDias(hasta, 1)}T00:00:00-03:00`)
      .order("cerrada_at").range(pag * 1000, pag * 1000 + 999);
    if (error) { $("#estError").textContent = "No se pudieron leer las ventas: " + error.message; return; }
    filas = filas.concat(data);
    if (data.length < 1000) break;
  }
  dibujar();
}

function lista(el, filasHtml, vacio) {
  $(el).innerHTML = filasHtml.length ? filasHtml.join("") : `<p class="vacio">${vacio}</p>`;
}
const fila = (titulo, detalle, valor) =>
  `<div class="item"><div>${esc(titulo)}<small>${detalle}</small></div><div class="num">${valor}</div></div>`;

function dibujar() {
  const ventas = filas.reduce((s, f) => s + Number(f.total || 0), 0);
  const comen = filas.reduce((s, f) => s + (f.comensales || 0), 0);
  const sin = "No hay mesas cerradas en estas fechas.";

  lista("#estResumen", filas.length ? [
    fila("Ventas", "Total cobrado", plata(ventas)),
    fila("Mesas cerradas", filas.length === 1 ? "1 ticket" : filas.length + " tickets", num(filas.length)),
    fila("Comensales", "Personas que comieron", num(comen)),
    fila("Ticket promedio", "Por mesa", plata(ventas / filas.length)),
    fila("Gasto por comensal", "Ventas ÷ comensales", comen ? plata(ventas / comen) : "–"),
  ] : [], sin);

  const turnos = Object.fromEntries(TURNOS.map((t) => [t, { mesas: 0, com: 0, ventas: 0 }]));
  const dias = {}, medios = {}, prods = {};
  filas.forEach((f) => {
    const t = turnos[turnoDe(f.abierta_at)];
    t.mesas++; t.com += f.comensales || 0; t.ventas += Number(f.total || 0);
    const d = (dias[diaDe(f.cerrada_at)] ||= { com: 0, ventas: 0, t: {} });
    const tn = turnoDe(f.abierta_at);
    d.com += f.comensales || 0; d.ventas += Number(f.total || 0); d.t[tn] = (d.t[tn] || 0) + (f.comensales || 0);
    const m = (medios[f.medio_pago || "Sin dato"] ||= { mesas: 0, ventas: 0 });
    m.mesas++; m.ventas += Number(f.total || 0);
    (f.comanda_items || []).forEach((i) => {
      const p = (prods[i.nombre] ||= { cant: 0, ventas: 0 });
      p.cant += Number(i.cantidad); p.ventas += Number(i.cantidad) * Number(i.precio_unitario);
    });
  });

  agg = { desde: $("#estDesde").value, hasta: $("#estHasta").value, ventas, comen, n: filas.length, turnos, dias, medios, prods };
  $("#estPeriodoPrint").textContent = `Del ${fechaLinda(agg.desde)} al ${fechaLinda(agg.hasta)}`;

  lista("#estTurnos", filas.length ? TURNOS.map((t) =>
    fila(t, `${turnos[t].mesas} mesas · ${plata(turnos[t].ventas)}`, num(turnos[t].com))) : [], sin);

  lista("#estDias", Object.keys(dias).sort().map((d) =>
    fila(fechaLinda(d), TURNOS.filter((t) => dias[d].t[t]).map((t) => `${t} ${dias[d].t[t]}`).join(" · ") || "Sin comensales cargados", num(dias[d].com))), sin);

  lista("#estMedios", Object.entries(medios).sort((a, b) => b[1].ventas - a[1].ventas).map(([n, m]) =>
    fila(n, `${m.mesas} mesas`, plata(m.ventas))), sin);

  const q = sinTildes($("#estBuscar").value.trim());
  let ps = Object.entries(prods).sort((a, b) => b[1].cant - a[1].cant);
  if (q) ps = ps.filter(([n]) => sinTildes(n).includes(q));
  const totalCant = ps.reduce((s, [, p]) => s + p.cant, 0), totalPlata = ps.reduce((s, [, p]) => s + p.ventas, 0);
  $("#estBuscado").textContent = !filas.length ? "" : q
    ? `"${$("#estBuscar").value.trim()}": ${num(totalCant)} unidades · ${plata(totalPlata)}`
    : ps.length > 30 ? "Mostrando los 30 más vendidos. Buscá un producto para ver el resto." : "";
  lista("#estProductos", (q ? ps : ps.slice(0, 30)).map(([n, p]) => fila(n, plata(p.ventas), num(p.cant))),
    q ? "Ningún producto coincide con esa búsqueda." : sin);
}

function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 3500);
}

function excel() {
  if (!window.XLSX) return aviso("No se pudo cargar el generador de Excel. Revisá la conexión.");
  if (!agg || !agg.n) return aviso("No hay datos para descargar en este período.");
  const X = window.XLSX, wb = X.utils.book_new();
  const hoja = (nombre, datos, anchos) => {
    const ws = X.utils.aoa_to_sheet(datos);
    ws["!cols"] = anchos.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, nombre);
  };
  hoja("Resumen", [
    ["Período", `${fechaLinda(agg.desde)} al ${fechaLinda(agg.hasta)}`],
    ["Ventas", agg.ventas], ["Mesas cerradas", agg.n], ["Comensales", agg.comen],
    ["Ticket promedio", agg.ventas / agg.n], ["Gasto por comensal", agg.comen ? agg.ventas / agg.comen : ""],
  ], [22, 30]);
  hoja("Turnos", [["Turno", "Mesas", "Comensales", "Ventas"],
    ...TURNOS.map((t) => [t, agg.turnos[t].mesas, agg.turnos[t].com, agg.turnos[t].ventas])], [14, 10, 12, 14]);
  hoja("Días", [["Fecha", ...TURNOS, "Comensales", "Ventas"],
    ...Object.keys(agg.dias).sort().map((d) => [fechaLinda(d), ...TURNOS.map((t) => agg.dias[d].t[t] || 0), agg.dias[d].com, agg.dias[d].ventas])],
    [18, 12, 12, 12, 12, 12, 14]);
  hoja("Medios de pago", [["Medio", "Mesas", "Ventas"],
    ...Object.entries(agg.medios).sort((a, b) => b[1].ventas - a[1].ventas).map(([n, m]) => [n, m.mesas, m.ventas])], [22, 10, 14]);
  hoja("Productos", [["Producto", "Unidades", "Ventas"],
    ...Object.entries(agg.prods).sort((a, b) => b[1].cant - a[1].cant).map(([n, p]) => [n, p.cant, p.ventas])], [36, 10, 14]);
  X.writeFile(wb, `entretanto-estadisticas-${agg.desde}_a_${agg.hasta}.xlsx`);
}

function elegir(tipo) {
  const [d, h] = periodo(tipo);
  $("#estDesde").value = d; $("#estHasta").value = h;
  document.querySelectorAll("#estChips .chip").forEach((c) => c.classList.toggle("activa", c.dataset.per === tipo));
  cargar();
}

export function initEstadisticas() {
  if (!iniciado) {
    iniciado = true;
    $("#estChips").addEventListener("click", (e) => { const b = e.target.closest("[data-per]"); if (b) elegir(b.dataset.per); });
    ["#estDesde", "#estHasta"].forEach((s) => $(s).addEventListener("change", () => {
      document.querySelectorAll("#estChips .chip").forEach((c) => c.classList.remove("activa"));
      cargar();
    }));
    $("#estBuscar").addEventListener("input", dibujar);
    $("#estImprimir").addEventListener("click", () => window.print());
    $("#estExcel").addEventListener("click", excel);
  }
  elegir("mes");
}

import { db } from "./db.js";
import { periodo, sumarDias } from "./estadisticas.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const TZ = "America/Argentina/Buenos_Aires";
const MAX = 200;
const nro = (n) => String(n ?? 0).padStart(6, "0");
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dia = (iso) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: TZ });

let filas = [], mesas = {}, iniciado = false;

async function cargar() {
  const desde = $("#histDesde").value, hasta = $("#histHasta").value;
  $("#histError").textContent = "";
  if (!desde || !hasta || desde > hasta) { $("#histError").textContent = "Revisá las fechas: la de inicio tiene que ser anterior a la final."; return; }
  const [c, m] = await Promise.all([
    db.from("comandas")
      .select("id, mesa_id, numero_ticket, abierta_at, cerrada_at, total, comensales, medio_pago, comanda_items(nombre, cantidad, precio_unitario)")
      .eq("estado", "cerrada")
      .gte("cerrada_at", `${desde}T00:00:00-03:00`).lt("cerrada_at", `${sumarDias(hasta, 1)}T00:00:00-03:00`)
      .order("cerrada_at", { ascending: false }).limit(MAX),
    db.from("mesas").select("id, nombre"),
  ]);
  if (c.error) { $("#histError").textContent = "No se pudo leer el historial: " + c.error.message; return; }
  mesas = Object.fromEntries((m.data || []).map((x) => [x.id, x.nombre]));
  filas = c.data;
  $("#histTicket").hidden = true; $("#histVacio").hidden = false;
  dibujar();
}

function dibujar() {
  const q = $("#histBuscar").value.trim().toLowerCase();
  const ver = filas.filter((f) => !q || String(f.numero_ticket).includes(q.replace(/^0+/, "") || q) || (mesas[f.mesa_id] || "").toLowerCase().includes(q));
  $("#histNota").textContent = filas.length >= MAX ? `Mostrando los últimos ${MAX} tickets. Acotá las fechas para ver otros.` : "";
  $("#histLista").innerHTML = ver.length
    ? ver.map((f) => `<div class="item" data-ticket="${f.id}" role="button" tabindex="0">
        <div>Ticket ${nro(f.numero_ticket)}<small>${esc(mesas[f.mesa_id] || "Mesa")} · ${dia(f.cerrada_at)} ${hora(f.cerrada_at)} · ${f.comensales ?? "?"} com. · ${esc(f.medio_pago || "")}</small></div>
        <div class="num">${plata(f.total)}</div></div>`).join("")
    : '<p class="vacio">No hay tickets para esa búsqueda.</p>';
}

function verTicket(id) {
  const f = filas.find((x) => String(x.id) === String(id));
  if (!f) return;
  document.querySelectorAll("#histLista .item").forEach((e) => e.classList.toggle("sel", e.dataset.ticket === String(id)));
  $("#histTicket").innerHTML = `
    <img class="logo" src="img/logo.png" alt="Entretanto Café y Flores">
    <p class="t-num">Ticket N° ${nro(f.numero_ticket)}</p>
    <p class="t-centro">${dia(f.cerrada_at)} ${hora(f.cerrada_at)} · ${esc(mesas[f.mesa_id] || "Mesa")}</p>
    <div class="t-lineas">${(f.comanda_items || []).map((i) => `<div><span>${Number(i.cantidad)} × ${esc(i.nombre)}</span><span>${plata(i.cantidad * i.precio_unitario)}</span></div>`).join("")}</div>
    <div class="t-total"><span>Total</span><span>${plata(f.total)}</span></div>
    <p class="t-centro">${f.comensales ?? "?"} comensales · Pago: ${esc(f.medio_pago || "sin dato")}</p>
    <p class="t-legal">Reimpresión · Documento no válido como factura</p>
    <div class="fila no-print"><button class="principal" id="histImprimir">Imprimir ticket</button></div>`;
  $("#histVacio").hidden = true; $("#histTicket").hidden = false;
  $("#histDetalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

function elegir(tipo) {
  const [d, h] = periodo(tipo);
  $("#histDesde").value = d; $("#histHasta").value = h;
  document.querySelectorAll("#histChips .chip").forEach((c) => c.classList.toggle("activa", c.dataset.per === tipo));
  cargar();
}

export function initHistorial() {
  if (!iniciado) {
    iniciado = true;
    $("#histChips").addEventListener("click", (e) => { const b = e.target.closest("[data-per]"); if (b) elegir(b.dataset.per); });
    ["#histDesde", "#histHasta"].forEach((s) => $(s).addEventListener("change", () => {
      document.querySelectorAll("#histChips .chip").forEach((c) => c.classList.remove("activa"));
      cargar();
    }));
    $("#histBuscar").addEventListener("input", dibujar);
    $("#histLista").addEventListener("click", (e) => { const r = e.target.closest("[data-ticket]"); if (r) verTicket(r.dataset.ticket); });
    $("#histLista").addEventListener("keydown", (e) => { const r = e.target.closest("[data-ticket]"); if (r && e.key === "Enter") verTicket(r.dataset.ticket); });
    $("#histDetalle").addEventListener("click", (e) => { if (e.target.id === "histImprimir") window.print(); });
  }
  elegir("hoy");
}

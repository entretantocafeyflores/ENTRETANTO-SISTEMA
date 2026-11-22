import { db } from "./db.js";
import { imprimirTicket } from "./impresion.js";
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

function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 3500);
}

async function cargar() {
  const desde = $("#histDesde").value, hasta = $("#histHasta").value;
  $("#histError").textContent = "";
  if (!desde || !hasta || desde > hasta) { $("#histError").textContent = "Revisá las fechas: la de inicio tiene que ser anterior a la final."; return; }
  const consulta = (cols) => db.from("comandas")
    .select(cols)
    .eq("estado", "cerrada")
    .gte("cerrada_at", `${desde}T00:00:00-03:00`).lt("cerrada_at", `${sumarDias(hasta, 1)}T00:00:00-03:00`)
    .order("cerrada_at", { ascending: false }).limit(MAX);
  const COLS = "id, mesa_id, cliente, medio_original, numero_ticket, abierta_at, cerrada_at, total, descuento, comensales, medio_pago, anulada_at, motivo_anulacion, comanda_items(nombre, cantidad, precio_unitario)";
  let [c, m] = await Promise.all([consulta(COLS), db.from("mesas").select("id, nombre")]);
  // Si todavía no se corrió el script de nombres de mesa, el historial sigue andando sin nombres.
  // (también con medio_original y descuento, por si falta correr otro script)
  let cols = COLS;
  for (let i = 0; i < 3 && c.error; i++) {
    const col = (/comandas\.(\w+)/.exec(c.error.message) || [])[1];
    if (!["cliente", "medio_original", "descuento"].includes(col)) break;
    cols = cols.replace(`${col}, `, "");
    c = await consulta(cols);
  }
  if (c.error) { $("#histError").textContent = "No se pudo leer el historial: " + c.error.message; return; }
  mesas = Object.fromEntries((m.data || []).map((x) => [x.id, x.nombre]));
  filas = c.data;
  $("#histTicket").hidden = true; $("#histVacio").hidden = false;
  dibujar();
}

const etiqueta = (f) => `${f.cliente ? f.cliente + " · " : ""}${mesas[f.mesa_id] || "Mesa"}`;

function dibujar() {
  const q = $("#histBuscar").value.trim().toLowerCase();
  const ver = filas.filter((f) => !q || String(f.numero_ticket).includes(q.replace(/^0+/, "") || q) || etiqueta(f).toLowerCase().includes(q));
  $("#histNota").textContent = filas.length >= MAX ? `Mostrando los últimos ${MAX} tickets. Acotá las fechas para ver otros.` : "";
  $("#histLista").innerHTML = ver.length
    ? ver.map((f) => `<div class="item${f.anulada_at ? " anulado" : ""}" data-ticket="${f.id}" role="button" tabindex="0">
        <div>Ticket ${nro(f.numero_ticket)}<small>${esc(etiqueta(f))} · ${dia(f.cerrada_at)} ${hora(f.cerrada_at)} · ${f.comensales ?? "?"} com. · ${esc(f.medio_pago || "")}${f.anulada_at ? " · ANULADO" : ""}</small></div>
        <div class="num">${plata(f.total)}</div></div>`).join("")
    : '<p class="vacio">No hay tickets para esa búsqueda.</p>';
}

function verTicket(id) {
  const f = filas.find((x) => String(x.id) === String(id));
  if (!f) return;
  document.querySelectorAll("#histLista .item").forEach((e) => e.classList.toggle("sel", e.dataset.ticket === String(id)));
  $("#histTicket").innerHTML = `
    <img class="logo" src="img/logo-ticket.png" alt="Entretanto Café y Flores">
    <p class="t-num">Ticket N° ${nro(f.numero_ticket)}</p>
    ${f.anulada_at ? `<p class="t-anulado">Ticket anulado</p><p class="t-centro">${dia(f.anulada_at)} ${hora(f.anulada_at)} · ${esc(f.motivo_anulacion || "")}</p>` : ""}
    <p class="t-centro">${dia(f.cerrada_at)} ${hora(f.cerrada_at)} · ${esc(etiqueta(f))}</p>
    <div class="t-lineas">${(f.comanda_items || []).map((i) => `<div><span>${Number(i.cantidad)} × ${esc(i.nombre)}</span><span>${plata(i.cantidad * i.precio_unitario)}</span></div>`).join("")}</div>
    ${Number(f.descuento) > 0 ? `<div class="t-lineas"><div><span>Subtotal</span><span>${plata(Number(f.total) + Number(f.descuento))}</span></div><div><span>Descuento efectivo ${Math.round((Number(f.descuento) / (Number(f.total) + Number(f.descuento))) * 100)}%</span><span>− ${plata(f.descuento)}</span></div></div>` : ""}
    <div class="t-total"><span>Total</span><span>${plata(f.total)}</span></div>
    <p class="t-centro">${f.comensales ?? "?"} comensales · Pago: ${esc(f.medio_pago || "sin dato")}</p>
    <p class="t-legal">Reimpresión · Documento no válido como factura</p>
    ${f.medio_original && f.medio_original !== f.medio_pago ? `<p class="t-centro no-print">Forma de pago corregida (antes: ${esc(f.medio_original)})</p>` : ""}
    <div class="fila no-print">
      <button class="principal" id="histImprimir">Imprimir ticket</button>
      ${f.anulada_at ? "" : '<button id="histPagoCambiar">Cambiar forma de pago</button><button class="link" id="histAnular">Anular ticket</button>'}
    </div>
    <div id="histPagoBox" class="cierre no-print" hidden>
      <label>Nueva forma de pago <select id="histPagoNuevo">${MEDIOS.map((m) => `<option${m === f.medio_pago ? " selected" : ""}>${m}</option>`).join("")}</select></label>
      <p class="nota" style="margin-top:0">Si pasa a efectivo se aplica el 10% de descuento; si sale de efectivo, se quita. Solo lo puede hacer un administrador.</p>
      <div class="fila"><button class="principal" id="histPagoOk" data-id="${f.id}">Guardar cambio</button><button class="link" id="histPagoNo">Cancelar</button></div>
    </div>
    <div id="histAnularBox" class="cierre no-print" hidden>
      <label>Motivo de la anulación <input id="histMotivo" placeholder="Ej: error de carga, cobro duplicado"></label>
      <div class="fila">
        <button class="principal" id="histAnularOk" data-id="${f.id}">Confirmar anulación</button>
        <button class="link" id="histAnularNo">Cancelar</button>
      </div>
    </div>`;
  $("#histVacio").hidden = true; $("#histTicket").hidden = false;
  $("#histDetalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

const MEDIOS = ["Efectivo", "Débito", "Crédito", "Transferencia / QR"];

async function cambiarPago(id) {
  const nuevo = $("#histPagoNuevo").value;
  const { error } = await db.rpc("cambiar_medio_pago", { p_id: Number(id), p_medio: nuevo });
  if (error) return aviso(error.code === "PGRST202" ? "Falta ejecutar el script de cambio de pago en Supabase." : error.message, 5000);
  aviso("Forma de pago cambiada a " + nuevo);
  await cargar();
  verTicket(id);
}

async function anular(id) {
  const motivo = $("#histMotivo").value.trim();
  if (motivo.length < 3) return aviso("Escribí el motivo de la anulación.");
  const { error } = await db.rpc("anular_comanda", { p_id: Number(id), p_motivo: motivo });
  if (error) return aviso(error.message);
  aviso("Ticket anulado");
  await cargar();
  verTicket(id);
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
    $("#histDetalle").addEventListener("click", (e) => {
      const id = e.target.id;
      if (id === "histImprimir") imprimirTicket();
      else if (id === "histAnular") { $("#histAnularBox").hidden = false; $("#histAnular").hidden = true; $("#histMotivo").focus(); }
      else if (id === "histPagoCambiar") { $("#histPagoBox").hidden = false; e.target.hidden = true; }
      else if (id === "histPagoNo") { $("#histPagoBox").hidden = true; $("#histPagoCambiar").hidden = false; }
      else if (id === "histPagoOk") cambiarPago(e.target.dataset.id);
      else if (id === "histAnularNo") { $("#histAnularBox").hidden = true; $("#histAnular").hidden = false; }
      else if (id === "histAnularOk") anular(e.target.dataset.id);
    });
  }
  elegir("hoy");
}

import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const MEDIOS = ["Efectivo", "Débito", "Crédito", "Transferencia / QR"];

let mesas = [], cats = [], prods = [], abiertas = {}, items = [];
let mesa = null, comandaId = null, catSel = "", iniciado = false;
let moviendo = false, mov = {};

function partesTxt(total, n) {
  if (n < 2) return "";
  const base = Math.floor((total * 100) / n) / 100;
  const ultima = Math.round((total - base * (n - 1)) * 100) / 100;
  return ultima === base ? `${n} partes de ${plata(base)}` : `${n - 1} partes de ${plata(base)} y 1 de ${plata(ultima)}`;
}

function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 2500);
}

function panel(cual) {
  $("#comandaVacio").hidden = cual !== "vacio";
  $("#comandaEdit").hidden = cual !== "edit";
  $("#ticket").hidden = cual !== "ticket";
}

async function cargar() {
  const [m, c, p, a] = await Promise.all([
    db.from("mesas").select("*").eq("activa", true).order("orden"),
    db.from("categorias").select("*").order("orden").order("nombre"),
    db.from("productos").select("*").eq("activo", true).order("nombre"),
    db.from("comandas").select("id, mesa_id, comanda_items(precio, cantidad)").eq("estado", "abierta"),
  ]);
  if (m.error || c.error || p.error || a.error) return aviso("No se pudo cargar. Revisá la conexión.");
  mesas = m.data; cats = c.data; prods = p.data;
  abiertas = {};
  a.data.forEach((x) => {
    abiertas[x.mesa_id] = { id: x.id, total: x.comanda_items.reduce((s, i) => s + i.precio * i.cantidad, 0) };
  });
  dibujarMesas();
}

function dibujarMesas() {
  $("#mesasGrid").innerHTML = mesas.map((m) => {
    const ab = abiertas[m.id];
    return `<button class="mesa ${ab ? "ocupada" : ""} ${mesa && mesa.id === m.id ? "sel" : ""}" data-mesa="${m.id}">
      ${esc(m.nombre)}<small>${ab ? plata(ab.total) : "Libre"}</small></button>`;
  }).join("") || '<p class="vacio">Todavía no hay mesas cargadas.</p>';
}

async function abrirMesa(id) {
  mesa = mesas.find((m) => m.id === id);
  if (abiertas[id]) comandaId = abiertas[id].id;
  else {
    const { data, error } = await db.from("comandas").insert({ mesa_id: id }).select("id").single();
    if (error) return aviso("No se pudo abrir la mesa.");
    comandaId = data.id;
  }
  catSel = "";
  moviendo = false; mov = {};
  $("#comensales").value = ""; $("#partes").value = 1;
  await cargarItems();
  panel("edit");
  dibujarMesas();
  $("#comanda").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cargarItems() {
  const { data, error } = await db.from("comanda_items").select("*").eq("comanda_id", comandaId).order("creado_at");
  if (error) return aviso("No se pudo cargar la comanda.");
  items = data;
  abiertas[mesa.id] = { id: comandaId, total: items.reduce((s, i) => s + i.precio * i.cantidad, 0) };
  dibujarComanda();
  dibujarMesas();
}

function dibujarComanda() {
  const total = abiertas[mesa.id].total;
  $("#comandaTitulo").textContent = mesa.nombre;
  $("#chips").innerHTML = [{ id: "", nombre: "Todo" }, ...cats].map((c) =>
    `<button class="chip ${String(c.id) === catSel ? "activa" : ""}" data-cat="${c.id}">${esc(c.nombre)}</button>`).join("");
  $("#prods").innerHTML = prods.filter((p) => !catSel || String(p.categoria_id) === catSel).map((p) =>
    `<button class="prod" data-prod="${p.id}">${esc(p.nombre)}<small>${plata(p.precio)}</small></button>`).join("");
  $("#items").innerHTML = items.length
    ? items.map((i) => `<div class="item"><div>${esc(i.nombre)}<small>${plata(i.precio)} c/u</small></div>
        <div class="cant"><button data-menos="${i.id}" aria-label="Quitar uno">−</button><b>${i.cantidad}</b><button data-mas="${i.id}" aria-label="Sumar uno">+</button></div></div>`).join("")
    : '<p class="vacio">Tocá un producto para sumarlo a la mesa.</p>';
  $("#total").textContent = plata(total);
  $("#partesInfo").textContent = partesTxt(total, Number($("#partes").value) || 1);
  $("#items").hidden = moviendo;
  $("#pasar").hidden = !items.length || moviendo;
  $("#moverBox").hidden = !moviendo;
  $("#cerrarBox").hidden = !items.length || moviendo;
  $("#liberar").hidden = !!items.length;
  if (moviendo) dibujarMover();
}

function dibujarMover() {
  $("#moverItems").innerHTML = items.map((i) => `<div class="item"><div>${esc(i.nombre)}<small>De ${i.cantidad} en la mesa</small></div>
    <div class="cant"><button data-mmenos="${i.id}" aria-label="Pasar uno menos">−</button><b>${mov[i.id] || 0}</b><button data-mmas="${i.id}" aria-label="Pasar uno más">+</button></div></div>`).join("");
  $("#destino").innerHTML = mesas.filter((m) => m.id !== mesa.id)
    .map((m) => `<option value="${m.id}">${esc(m.nombre)}${abiertas[m.id] ? " (ocupada)" : ""}</option>`).join("");
}

function ajustarMover(id, delta) {
  const it = items.find((i) => i.id === id);
  mov[id] = Math.max(0, Math.min(it.cantidad, (mov[id] || 0) + delta));
  dibujarMover();
}

async function confirmarMover() {
  const lista = Object.entries(mov).filter(([, n]) => n > 0).map(([id, cantidad]) => ({ id, cantidad }));
  if (!lista.length) return aviso("Elegí qué productos pasar.");
  const destId = $("#destino").value;
  const { error } = await db.rpc("mover_items", { p_origen: comandaId, p_mesa_destino: destId, p_items: lista });
  if (error) return aviso("No se pudieron pasar los productos.");
  const nombre = mesas.find((m) => m.id === destId).nombre;
  await cargar();
  await abrirMesa(destId);
  aviso("Productos pasados a " + nombre);
}

async function sumar(prodId) {
  const p = prods.find((x) => String(x.id) === prodId);
  const ex = items.find((i) => i.producto_id === prodId);
  const r = ex
    ? await db.from("comanda_items").update({ cantidad: ex.cantidad + 1 }).eq("id", ex.id)
    : await db.from("comanda_items").insert({ comanda_id: comandaId, producto_id: prodId, nombre: p.nombre, precio: p.precio });
  if (r.error) return aviso("No se pudo agregar.");
  cargarItems();
}

async function cambiar(id, delta) {
  const it = items.find((i) => i.id === id);
  const r = it.cantidad + delta < 1
    ? await db.from("comanda_items").delete().eq("id", id)
    : await db.from("comanda_items").update({ cantidad: it.cantidad + delta }).eq("id", id);
  if (r.error) return aviso("No se pudo modificar.");
  cargarItems();
}

async function cerrar() {
  const comensales = parseInt($("#comensales").value, 10);
  if (!(comensales >= 1)) return aviso("Indicá cuántos comensales había.");
  const { data, error } = await db.rpc("cerrar_comanda", { p_id: comandaId, p_medio: $("#medio").value, p_comensales: comensales });
  if (error || !data) return aviso("No se pudo cerrar la mesa.");
  delete abiertas[mesa.id];
  dibujarMesas();
  verTicket(data, Math.max(1, parseInt($("#partes").value, 10) || 1));
}

function verTicket(c, partes) {
  const fecha = new Date(c.cerrada_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  $("#ticket").innerHTML = `
    <img class="logo" src="img/logo.png" alt="Entretanto Café y Flores">
    <p class="t-num">Ticket N° ${String(c.numero_ticket).padStart(6, "0")}</p>
    <p class="t-centro">${fecha} · ${esc(mesa.nombre)}</p>
    <div class="t-lineas">${items.map((i) => `<div><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${plata(i.precio * i.cantidad)}</span></div>`).join("")}</div>
    <div class="t-total"><span>Total</span><span>${plata(c.total)}</span></div>
    ${partes > 1 ? `<p class="t-centro">Dividido en ${partesTxt(c.total, partes)}</p>` : ""}
    <p class="t-centro">${c.comensales} ${c.comensales === 1 ? "comensal" : "comensales"} · Pago: ${esc(c.medio_pago)}</p>
    <p class="t-legal">Documento no válido como factura</p>
    <div class="fila no-print">
      <button class="principal" id="imprimir">Imprimir ticket</button>
      <button class="link" id="volver">Volver a las mesas</button>
    </div>`;
  panel("ticket");
}

export function initMesas() {
  $("#medio").innerHTML = MEDIOS.map((m) => `<option>${m}</option>`).join("");
  cargar();
  if (iniciado) return;
  iniciado = true;

  $("#mesasGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mesa]");
    if (b) abrirMesa(b.dataset.mesa);
  });

  $("#partes").addEventListener("input", () => {
    $("#partesInfo").textContent = partesTxt(abiertas[mesa.id].total, Number($("#partes").value) || 1);
  });

  $("#comanda").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cat !== undefined) { catSel = b.dataset.cat; dibujarComanda(); }
    else if (b.dataset.prod) sumar(b.dataset.prod);
    else if (b.dataset.mas) cambiar(b.dataset.mas, 1);
    else if (b.dataset.menos) cambiar(b.dataset.menos, -1);
    else if (b.dataset.mmas) ajustarMover(b.dataset.mmas, 1);
    else if (b.dataset.mmenos) ajustarMover(b.dataset.mmenos, -1);
    else if (b.id === "pasar") { moviendo = true; mov = {}; dibujarComanda(); }
    else if (b.id === "moverNo") { moviendo = false; mov = {}; dibujarComanda(); }
    else if (b.id === "moverOk") confirmarMover();
    else if (b.id === "cerrar") cerrar();
    else if (b.id === "imprimir") window.print();
    else if (b.id === "volver") { mesa = null; panel("vacio"); cargar(); }
    else if (b.id === "liberar") {
      const { error } = await db.from("comandas").delete().eq("id", comandaId);
      if (error) return aviso("No se pudo liberar la mesa.");
      delete abiertas[mesa.id]; mesa = null; panel("vacio"); dibujarMesas();
    }
  });
}

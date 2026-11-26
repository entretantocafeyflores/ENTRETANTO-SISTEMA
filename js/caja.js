import { db } from "./db.js";
import { confirmar, elegir } from "./dialogo.js";
import { TURNOS, ORDEN_MEDIOS, grupoMedio, ventanaTurno, turnoActual, diaDeTurno, hoyAR } from "./medios.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const monto = (txt) => {   // entiende "42000", "42.000" y "42.000,50"
  let t = String(txt ?? "").trim().replace(/[\s$]/g, "");
  t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const x = Number(t);
  return Number.isFinite(x) ? x : 0;
};
const redondo = (n) => Math.round(n * 100) / 100;
const fechaLinda = (f) => new Date(f + "T12:00:00Z").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const diaHora = (iso) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const nombreTurno = (id) => (TURNOS.find((t) => t.id === id) || {}).nombre || id;
const rangoTurno = (id) => { const t = TURNOS.find((x) => x.id === id); return `${t.desde} a ${t.hasta}`; };

let iniciado = false, sec = "cerrar", yo = { nombre: "", rol: "", turno: "" };
const esAdmin = () => yo.rol === "admin";
let datos = null;     // lo calculado para el turno que se está mirando
let cierre = null;    // el cierre ya guardado de ese turno (si existe)
let ultimoDeja = 0;   // lo que quedó en caja en el último cierre

function aviso(texto, ms = 3500) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), ms);
}

// "Justo" / "Falta $ X" / "Sobra $ X"
function difHtml(v) {
  const d = redondo(v);
  if (Math.abs(d) < 0.5) return '<span class="cj-dif cj-ok">Justo ✓</span>';
  return d < 0 ? `<span class="cj-dif cj-falta">Falta ${plata(-d)}</span>` : `<span class="cj-dif cj-sobra">Sobra ${plata(d)}</span>`;
}

function errorFalta(err) {
  const falta = /does not exist|schema cache|PGRST205|42P01/i.test(`${err.code} ${err.message}`);
  $("#cjError").textContent = falta
    ? "Todavía falta crear la tabla de Caja en Supabase. Pegá el archivo sql/10-caja.sql en el SQL Editor y ejecutalo."
    : "No se pudo cargar la caja: " + err.message;
}

// ====== CÁLCULO DEL TURNO ======
async function leerTickets(desde, hasta) {
  let cols = "id, mesa_id, cliente, numero_ticket, cerrada_at, total, descuento, medio_pago, medio_original, anulada_at";
  const consulta = (c) => db.from("comandas").select(c).eq("estado", "cerrada").gte("cerrada_at", desde).lt("cerrada_at", hasta).order("cerrada_at");
  let r = await consulta(cols);
  for (let i = 0; i < 3 && r.error; i++) {   // si falta correr algún script viejo, sigue andando sin esa columna
    const col = (/comandas\.(\w+)/.exec(r.error.message) || [])[1];
    if (!["cliente", "medio_original", "descuento"].includes(col)) break;
    cols = cols.replace(`, ${col}`, "").replace(`${col}, `, "");
    r = await consulta(cols);
  }
  return r;
}

async function cargarTurno() {
  const fecha = $("#cjFecha").value, turno = $("#cjTurno").value;
  $("#cjError").textContent = "";
  if (!fecha) { $("#cjCont").innerHTML = '<p class="vacio">Elegí la fecha del turno.</p>'; return; }
  $("#cjCont").innerHTML = '<p class="vacio">Calculando…</p>';
  const [desde, hasta] = ventanaTurno(fecha, turno);
  const [t, m, c, u] = await Promise.all([
    leerTickets(desde, hasta),
    db.from("mesas").select("id, nombre"),
    db.from("cierres_caja").select("*").eq("fecha", fecha).eq("turno", turno).maybeSingle(),
    db.rpc("fondo_sugerido"),
  ]);
  const err = t.error || c.error;
  if (err) { $("#cjCont").innerHTML = ""; return errorFalta(err); }
  const mesas = Object.fromEntries((m.data || []).map((x) => [x.id, x.nombre]));
  const tickets = t.data || [];
  const validos = tickets.filter((x) => !x.anulada_at);
  const porMedio = {};
  validos.forEach((x) => { const g = grupoMedio(x.medio_pago); (porMedio[g] ||= { mesas: 0, ventas: 0 }); porMedio[g].mesas++; porMedio[g].ventas += Number(x.total || 0); });
  datos = { fecha, turno, tickets, validos, anulados: tickets.length - validos.length, porMedio, mesas };
  cierre = c.data || null;
  ultimoDeja = u.error ? 0 : Number(u.data) || 0;
  pintarTurno();
}

const ventaDe = (g) => redondo((datos.porMedio[g] || { ventas: 0 }).ventas);

function ticketsHtml() {
  if (!datos.tickets.length) return '<p class="vacio">No hay mesas cerradas en este turno.</p>';
  return datos.tickets.map((x) => {
    const marcas = [];
    if (x.anulada_at) marcas.push("ANULADO");
    if (x.medio_original && x.medio_original !== x.medio_pago) marcas.push(`cambió de ${esc(x.medio_original)} a ${esc(x.medio_pago)}`);
    const mesa = esc(datos.mesas[x.mesa_id] || "Mesa") + (x.cliente ? " · " + esc(x.cliente) : "");
    return `<div class="item ${marcas.length ? "urgente" : ""}"><div>Ticket ${String(x.numero_ticket ?? "").padStart(4, "0")} · ${mesa}<small>${hora(x.cerrada_at)} · ${esc(grupoMedio(x.medio_pago))}${marcas.length ? " · " + marcas.join(" · ") : ""}</small></div>
      <div class="num"><span${x.anulada_at ? ' style="text-decoration:line-through"' : ""}>${plata(x.total)}</span>${!x.anulada_at && !cierre ? `<button data-cj-pago="${x.id}">Cambiar pago</button>` : ""}</div></div>`;
  }).join("");
}

function ventasHtml() {
  const otros = Object.keys(datos.porMedio).filter((n) => !ORDEN_MEDIOS.includes(n));
  const filas = [...ORDEN_MEDIOS, ...otros].map((n) => {
    const m = datos.porMedio[n] || { mesas: 0, ventas: 0 };
    return `<div class="item"><div>${esc(n)}<small>${m.mesas} ${m.mesas === 1 ? "mesa" : "mesas"}</small></div><div class="num"><span>${plata(m.ventas)}</span></div></div>`;
  }).join("");
  const total = datos.validos.reduce((s, x) => s + Number(x.total || 0), 0);
  return `<h3 class="sub">Ventas del turno</h3>
    <div class="lista-est co-lista">${filas}
      <div class="item destacado"><div>Total vendido<small>${datos.validos.length} ${datos.validos.length === 1 ? "mesa" : "mesas"}${datos.anulados ? ` · ${datos.anulados} anulada${datos.anulados === 1 ? "" : "s"} (no cuentan)` : ""}</small></div><div class="num"><span>${plata(total)}</span></div></div>
    </div>
    <details class="cj-detalle"><summary>Ver las mesas del turno</summary><div class="lista-est co-lista">${ticketsHtml()}</div></details>`;
}

// Corregir la forma de pago de una mesa del turno (mientras la caja del turno no esté cerrada)
async function cambiarPago(id) {
  const x = datos.tickets.find((t) => String(t.id) === String(id));
  if (!x) return;
  const actual = grupoMedio(x.medio_pago);
  const nuevo = await elegir("¿Con qué pagaron realmente?", {
    opciones: ORDEN_MEDIOS, valor: ORDEN_MEDIOS.includes(actual) ? actual : ORDEN_MEDIOS[0],
    detalle: `Ticket ${String(x.numero_ticket ?? "").padStart(4, "0")} · ${plata(x.total)}. Si pasa a efectivo se aplica el 10% de descuento; si sale de efectivo, se quita. Queda anotado quién hizo el cambio.`,
    aceptar: "Guardar cambio",
  });
  if (nuevo === null || nuevo === actual) return;
  const { error } = await db.rpc("cambiar_medio_pago", { p_id: x.id, p_medio: nuevo });
  if (error) return aviso(error.code === "PGRST202" ? "Falta ejecutar el script de cambio de pago en Supabase." : error.message, 6000);
  aviso("Forma de pago cambiada a " + nuevo);
  await cargarTurno();
}

// ====== PANTALLA DEL TURNO ======
function pintarTurno() {
  const cab = `<p class="t-centro">${esc(nombreTurno(datos.turno))} (${rangoTurno(datos.turno)}) · ${esc(fechaLinda(datos.fecha))}</p>`;
  if (cierre) return pintarCerrado(cab);

  const fondo = ultimoDeja ? String(ultimoDeja).replace(".", ",") : "";
  $("#cjCont").innerHTML = `${cab}
    ${ventasHtml()}
    <h3 class="sub">Contá la plata</h3>
    <div class="grilla2">
      <label>Efectivo con el que empezó la caja <input id="cjFondo" inputmode="decimal" value="${esc(fondo)}" placeholder="Ej: 20000"></label>
      <label>Plata que salió de la caja en el turno <input id="cjRetiros" inputmode="decimal" placeholder="Pagos, retiros, vuelto… (0 si ninguno)"></label>
    </div>
    <div class="cj-bloque">
      <p class="cj-esperado">Debería haber en efectivo: <b id="cjEsperadoEf"></b></p>
      <label>Efectivo que contás ahora en la caja <input id="cjContEf" inputmode="decimal" placeholder="Todo lo que hay en la caja"></label>
      <div id="cjDifEf"></div>
    </div>
    <div class="cj-bloque">
      <p class="cj-esperado">Posnet debería sumar: <b>${plata(ventaDe("Posnet"))}</b></p>
      <label>Total que dice el cierre del Posnet <input id="cjContPos" inputmode="decimal" placeholder="Ej: 85000"></label>
      <div id="cjDifPos"></div>
    </div>
    <div class="cj-bloque">
      <p class="cj-esperado">Transferencias deberían sumar: <b>${plata(ventaDe("Transferencia"))}</b></p>
      <label>Transferencias que entraron a la cuenta <input id="cjContTr" inputmode="decimal" placeholder="Ej: 30000"></label>
      <div id="cjDifTr"></div>
    </div>
    <div class="cj-total" id="cjTotalDif"></div>
    <div class="grilla2">
      <label>Efectivo que dejás en la caja para el próximo turno <input id="cjDeja" inputmode="decimal" placeholder="Ej: 20000"></label>
      <label>Quién cierra el turno <input id="cjResp" value="${esc(yo.nombre)}" placeholder="Tu nombre"></label>
      <label class="ancho">Notas (opcional) <input id="cjNotas" placeholder="Ej: se pagó al proveedor de lácteos"></label>
    </div>
    <p id="cjFormError" class="error" role="alert"></p>
    <div class="fila"><button class="principal" id="cjCerrar">Cerrar turno</button></div>`;
  pintarDif();
}

// Recalcula, mientras se escribe, lo que debería haber y la diferencia
function leerForm() {
  const v = (id) => monto(($(id) || {}).value);
  const lleno = (id) => String((($(id) || {}).value) ?? "").trim() !== "";
  return {
    fondo: v("#cjFondo"), retiros: v("#cjRetiros"),
    contEf: v("#cjContEf"), contPos: v("#cjContPos"), contTr: v("#cjContTr"),
    llenos: { ef: lleno("#cjContEf"), pos: lleno("#cjContPos"), tr: lleno("#cjContTr") },
  };
}
function pintarDif() {
  if (!$("#cjFondo")) return;
  const f = leerForm();
  const espEf = redondo(f.fondo + ventaDe("Efectivo") - f.retiros);
  $("#cjEsperadoEf").textContent = plata(espEf);
  const fila = (idDif, lleno, cont, esp) => { $(idDif).innerHTML = lleno ? difHtml(cont - esp) : ""; };
  fila("#cjDifEf", f.llenos.ef, f.contEf, espEf);
  fila("#cjDifPos", f.llenos.pos, f.contPos, ventaDe("Posnet"));
  fila("#cjDifTr", f.llenos.tr, f.contTr, ventaDe("Transferencia"));
  if (f.llenos.ef && f.llenos.pos && f.llenos.tr) {
    const total = redondo(f.contEf - espEf + f.contPos - ventaDe("Posnet") + f.contTr - ventaDe("Transferencia"));
    $("#cjTotalDif").innerHTML = `<p>Diferencia total del turno</p>${difHtml(total)}`;
  } else $("#cjTotalDif").innerHTML = "";
}

function pintarCerrado(cab) {
  const c = cierre;
  const espEf = Number(c.esperado_efectivo), espPos = Number(c.esperado_posnet), espTr = Number(c.esperado_transferencia);
  const dEf = Number(c.contado_efectivo) - espEf, dPos = Number(c.contado_posnet) - espPos, dTr = Number(c.contado_transferencia) - espTr;
  const fila = (n, esp, cont, d) => `<div class="item"><div>${n}<small>Debía haber ${plata(esp)} · se contó ${plata(cont)}</small></div><div class="num">${difHtml(d)}</div></div>`;
  $("#cjCont").innerHTML = `${cab}
    <div class="cj-cerrado">Turno cerrado por <b>${esc(c.responsable)}</b> el ${esc(diaHora(c.creado_at))}.</div>
    <div class="lista-est co-lista">
      ${fila("Efectivo", espEf, c.contado_efectivo, dEf)}
      ${fila("Posnet", espPos, c.contado_posnet, dPos)}
      ${fila("Transferencia", espTr, c.contado_transferencia, dTr)}
      <div class="item destacado"><div>Diferencia total</div><div class="num">${difHtml(dEf + dPos + dTr)}</div></div>
    </div>
    <p class="t-centro">Fondo inicial ${plata(c.fondo_inicial)} · Salió de la caja ${plata(c.retiros)} · Quedó en la caja ${plata(c.deja_en_caja)} · ${c.tickets} mesas${c.anulados ? ` (${c.anulados} anuladas)` : ""}</p>
    ${c.notas ? `<p class="t-centro">Nota: ${esc(c.notas)}</p>` : ""}
    ${ventasHtml()}
    ${esAdmin() ? `<div class="fila"><button class="link" id="cjReabrir">Borrar este cierre para volver a hacerlo</button></div>` : ""}`;
}

// ====== GUARDAR EL CIERRE ======
async function cerrarTurno() {
  const err = $("#cjFormError"), btn = $("#cjCerrar");
  err.textContent = "";
  const f = leerForm(), resp = $("#cjResp").value.trim();
  if (!f.llenos.ef || !f.llenos.pos || !f.llenos.tr) return (err.textContent = "Completá lo que contaste en efectivo, Posnet y transferencias (si no hubo, poné 0).");
  if (!resp) return (err.textContent = "Poné quién cierra el turno.");
  const espEf = redondo(f.fondo + ventaDe("Efectivo") - f.retiros), espPos = ventaDe("Posnet"), espTr = ventaDe("Transferencia");
  const dif = redondo(f.contEf - espEf + f.contPos - espPos + f.contTr - espTr);
  if (Math.abs(dif) >= 0.5) {
    const ok = await confirmar(dif < 0 ? `Falta ${plata(-dif)} en la caja` : `Sobra ${plata(dif)} en la caja`, {
      detalle: "Revisá la plata y las mesas del turno antes de cerrar. Si está bien contado, cerrá igual: la diferencia queda anotada.",
      aceptar: "Cerrar igual", cancelar: "Revisar", peligro: true,
    });
    if (!ok) return;
  }
  btn.disabled = true;
  const { error } = await db.from("cierres_caja").insert({
    fecha: datos.fecha, turno: datos.turno, fondo_inicial: f.fondo, retiros: f.retiros,
    esperado_efectivo: espEf, esperado_posnet: espPos, esperado_transferencia: espTr,
    contado_efectivo: f.contEf, contado_posnet: f.contPos, contado_transferencia: f.contTr,
    deja_en_caja: monto($("#cjDeja").value), tickets: datos.validos.length, anulados: datos.anulados,
    responsable: resp, notas: $("#cjNotas").value.trim() || null,
  });
  btn.disabled = false;
  if (error) return (err.textContent = /duplicate|unique/i.test(error.message) ? "Este turno ya fue cerrado por otra persona." : "No se pudo guardar el cierre: " + error.message);
  try { localStorage.setItem("cajaResponsable", resp); } catch { /* sin almacenamiento */ }
  yo.nombre = resp;
  aviso("Turno cerrado");
  await cargarTurno();
}

async function reabrir() {
  if (!cierre) return;
  const ok = await confirmar("¿Borrar este cierre?", { detalle: "Se pierde lo que se cargó y el turno queda abierto para cerrarlo de nuevo.", aceptar: "Borrar cierre", peligro: true });
  if (!ok) return;
  const { error } = await db.from("cierres_caja").delete().eq("id", cierre.id);
  if (error) return aviso("No se pudo borrar: " + error.message);
  aviso("Cierre borrado");
  await cargarTurno();
}

// ====== CIERRES ANTERIORES ======
async function cargarHistorial() {
  const { data, error } = await db.from("cierres_caja").select("*").order("fecha", { ascending: false }).order("creado_at", { ascending: false }).limit(90);
  if (error) return errorFalta(error);
  $("#cjError").textContent = "";
  const difs = (data || []).map((c) => Number(c.contado_efectivo) - Number(c.esperado_efectivo) + Number(c.contado_posnet) - Number(c.esperado_posnet) + Number(c.contado_transferencia) - Number(c.esperado_transferencia));
  const acum = redondo(difs.reduce((s, d) => s + d, 0));
  const resumen = (data || []).length ? `<p class="t-centro">Últimos ${data.length} cierres · diferencia acumulada: ${difHtml(acum)}</p>` : "";
  $("#cjLista").innerHTML = resumen + ((data || []).length
    ? data.map((c, i) => `<div class="item ${Math.abs(difs[i]) >= 0.5 ? "pronto" : ""}" data-cj-abrir="${c.fecha}|${c.turno}" role="button" tabindex="0">
        <div>${esc(fechaLinda(c.fecha))} · ${esc(nombreTurno(c.turno))}<small>Cerró ${esc(c.responsable)} · ${c.tickets} mesas${c.notas ? " · " + esc(c.notas) : ""}</small></div>
        <div class="num">${difHtml(difs[i])}</div></div>`).join("")
    : '<p class="vacio">Todavía no se cerró ningún turno.</p>');
}

function irA(s) {
  if (!esAdmin()) s = "cerrar";   // una moza solo ve el cierre de su turno
  sec = s;
  document.querySelectorAll("[data-cj]").forEach((x) => (x.hidden = x.dataset.cj !== s));
  document.querySelectorAll("[data-cj-btn]").forEach((b) => b.classList.toggle("activa", b.dataset.cjBtn === s));
  if (s === "historial") cargarHistorial();
  else if (s === "personal") cargarPersonal();
  else cargarTurno();
}

// ====== PERSONAL (solo administrador): quién cierra cada turno ======
async function cargarPersonal() {
  const { data, error } = await db.rpc("listar_personal");
  if (error) return errorFalta(error);
  $("#cjError").textContent = "";
  const gente = (data || []).filter((p) => p.rol !== "admin");
  const opciones = (actual) => [["", "Sin turno asignado"], ...TURNOS.map((t) => [t.id, `${t.nombre} (${t.desde} a ${t.hasta})`])]
    .map(([v, n]) => `<option value="${v}"${(actual || "") === v ? " selected" : ""}>${n}</option>`).join("");
  $("#cjPersonal").innerHTML = gente.length
    ? gente.map((p) => `<div class="item"><div>${esc(p.nombre || "Sin nombre")}<small>${esc(p.rol)}</small></div>
        <div><select data-cj-persona="${esc(p.id)}">${opciones(p.turno_caja)}</select></div></div>`).join("")
    : '<p class="vacio">No hay otras personas cargadas todavía.</p>';
}

async function asignarTurno(id, turno) {
  const { error } = await db.rpc("asignar_turno_caja", { p_usuario: id, p_turno: turno });
  if (error) return aviso("No se pudo guardar: " + error.message, 5000);
  aviso(turno ? `Asignado: ${nombreTurno(turno)}` : "Turno quitado");
}

// Ajusta la pantalla según quién entra
function aplicarPermisos() {
  const admin = esAdmin();
  document.querySelectorAll('[data-cj-btn="historial"], [data-cj-btn="personal"]').forEach((b) => (b.hidden = !admin));
  $("#cjFecha").disabled = !admin;
  $("#cjTurno").disabled = !admin;
  if (!admin && yo.turno) {
    $("#cjFecha").value = diaDeTurno(new Date().toISOString());
    $("#cjTurno").value = yo.turno;
  }
}

// ====== ARRANQUE ======
export async function initCaja() {
  if (!iniciado) {
    iniciado = true;
    $("#cjTurno").innerHTML = TURNOS.map((t) => `<option value="${t.id}">${t.nombre} (${t.desde} a ${t.hasta})</option>`).join("");
    $("#cjFecha").value = diaDeTurno(new Date().toISOString());
    $("#cjTurno").value = turnoActual();
    try { yo.nombre = localStorage.getItem("cajaResponsable") || ""; } catch { /* sin almacenamiento */ }
    enganchar();
    const { data: { user } } = await db.auth.getUser();
    if (user) {
      const { data: p } = await db.from("perfiles").select("nombre, rol, turno_caja").eq("id", user.id).maybeSingle();
      if (p) { yo.rol = p.rol; yo.turno = p.turno_caja || ""; if (!yo.nombre) yo.nombre = p.nombre || ""; }
    }
  }
  aplicarPermisos();
  if (!esAdmin() && !yo.turno) {
    $("#cjCont").innerHTML = '<p class="vacio">Todavía no tenés un turno de caja asignado. Pedile al administrador que te lo asigne.</p>';
    return;
  }
  irA(sec);
}

function enganchar() {
  const raiz = document.querySelector('[data-vista="caja"]');
  raiz.addEventListener("click", (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest("[data-cj-btn]"))) return irA(el.dataset.cjBtn);
    if (t.closest("#cjCerrar")) return cerrarTurno();
    if (t.closest("#cjReabrir")) return reabrir();
    if ((el = t.closest("[data-cj-pago]"))) return cambiarPago(el.dataset.cjPago);
    if ((el = t.closest("[data-cj-abrir]"))) {
      const [f, tn] = el.dataset.cjAbrir.split("|");
      $("#cjFecha").value = f; $("#cjTurno").value = tn;
      return irA("cerrar");
    }
  });
  raiz.addEventListener("keydown", (e) => {
    const el = e.target.closest("[data-cj-abrir]");
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); }
  });
  raiz.addEventListener("input", (e) => { if (e.target.closest("#cjCont")) pintarDif(); });
  raiz.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-cj-persona]");
    if (sel) asignarTurno(sel.dataset.cjPersona, sel.value);
  });
  $("#cjFecha").addEventListener("change", cargarTurno);
  $("#cjTurno").addEventListener("change", cargarTurno);
}

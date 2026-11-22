import { db } from "./db.js";
import { confirmar, preguntar } from "./dialogo.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const plata2 = (n) => "$ " + Number(n ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const num = (n) => Number(n ?? 0).toLocaleString("es-AR");
const n2 = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
// Para lo que se escribe a mano en un cuadro de texto: entiende "150000", "150.000" y "150.000,50"
const monto = (txt) => {
  let t = String(txt ?? "").trim().replace(/[\s$]/g, "");
  t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const x = Number(t);
  return Number.isFinite(x) ? x : 0;
};

const TZ = "America/Argentina/Buenos_Aires";
const hoyStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const dnum = (s) => Date.parse(s + "T00:00:00Z");
const sumarDias = (s, n) => new Date(dnum(s) + n * 86400000).toISOString().slice(0, 10);
const diasHasta = (s) => Math.round((dnum(s) - dnum(hoyStr())) / 86400000);
const fechaLinda = (s) => (s ? new Date(dnum(s)).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const mesActual = () => hoyStr().slice(0, 7);
const diasDelMes = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const mesSiguiente = (ym) => { let [y, m] = ym.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, "0")}`; };
const nombreMes = (ym) => new Date(Date.UTC(...ym.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)), 1)).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

let fijos = [], pagosMes = [], aj = {}, salidas = [];
let iniciado = false, filtroSal = "todas", avisoMostrado = false;

function aviso(texto, ms = 3500) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), ms);
}

const faltaTabla = (err) => /does not exist|schema cache|PGRST20[25]|42P01|42883/i.test(`${err.code} ${err.message}`);

async function cargarBase() {
  const mes = mesActual();
  const [f, p, a] = await Promise.all([
    db.from("gastos_fijos").select("*").order("categoria").order("concepto"),
    db.from("salidas").select("id, gasto_fijo_id, fecha, monto").eq("periodo", mes).not("gasto_fijo_id", "is", null),
    db.from("ajustes_gastos").select("clave, valor"),
  ]);
  const err = f.error || p.error || a.error;
  if (err) {
    $("#gError").textContent = faltaTabla(err)
      ? "Todavía falta crear las tablas de Gastos en Supabase. Pegá el archivo sql/05-gastos.sql en el SQL Editor y ejecutalo."
      : "No se pudo cargar Gastos: " + err.message;
    return false;
  }
  $("#gError").textContent = "";
  fijos = f.data; pagosMes = p.data;
  aj = Object.fromEntries(a.data.map((x) => [x.clave, Number(x.valor)]));
  return true;
}

// ====== AVISOS DE GASTOS FIJOS ======
const pagoDe = (id) => pagosMes.find((x) => String(x.gasto_fijo_id) === String(id));
function vencDe(g) {
  if (!g.dia_vencimiento) return null;
  const mes = mesActual();
  return `${mes}-${String(Math.min(g.dia_vencimiento, diasDelMes(mes))).padStart(2, "0")}`;
}
function estadoFijo(g) {
  const p = pagoDe(g.id);
  if (p) return { t: `Pagado el ${fechaLinda(p.fecha)}`, c: "", pagado: true };
  const v = vencDe(g);
  if (!v) return { t: "Pendiente este mes", c: "", pagado: false };
  const d = diasHasta(v);
  if (d < 0) return { t: `Venció hace ${-d} ${-d === 1 ? "día" : "días"}`, c: "urgente", pagado: false };
  if (d === 0) return { t: "Vence hoy", c: "urgente", pagado: false };
  if (d === 1) return { t: "Vence mañana", c: "pronto", pagado: false };
  return { t: `Vence el ${fechaLinda(v)}`, c: d <= 7 ? "pronto" : "", pagado: false };
}
const alertasFijos = () => fijos.filter((g) => g.activo && !pagoDe(g.id) && vencDe(g) && diasHasta(vencDe(g)) <= 7);

function ponerInsignia() {
  const btn = document.querySelector('#menu [data-modulo="gastos"]');
  if (!btn) return;
  const v = btn.querySelector(".insignia");
  if (v) v.remove();
  const n = alertasFijos().length;
  if (n) btn.insertAdjacentHTML("beforeend", `<span class="insignia" title="Pagos fijos por vencer">${n}</span>`);
}

// Se llama al ingresar a la app: número en la solapa y un aviso (una vez por sesión)
export async function actualizarAlertasGastos() {
  if (!(await cargarBase())) return;
  ponerInsignia();
  const n = alertasFijos().length;
  if (!n || avisoMostrado) return;
  avisoMostrado = true;
  setTimeout(() => aviso(`Gastos: ${n} ${n === 1 ? "pago fijo vencido o por vencer" : "pagos fijos vencidos o por vencer"}`, 6000), 7500);
}

// ====== EQUILIBRIO ======
const fila = (titulo, detalle, valor, clase = "") =>
  `<div class="item ${clase}"><div>${titulo}${detalle ? `<small>${detalle}</small>` : ""}</div><div class="num"><span>${valor}</span></div></div>`;

async function dibujarEquilibrio() {
  const caja = $("#gEq");
  caja.innerHTML = '<p class="t-centro">Calculando…</p>';
  const hoy = hoyStr(), mes = mesActual();
  const manana = `${sumarDias(hoy, 1)}T00:00:00-03:00`;
  const [vm, v9, s9] = await Promise.all([
    db.rpc("resumen_ventas", { p_desde: `${mes}-01T00:00:00-03:00`, p_hasta: manana }),
    db.rpc("resumen_ventas", { p_desde: `${sumarDias(hoy, -90)}T00:00:00-03:00`, p_hasta: manana }),
    db.rpc("resumen_salidas", { p_desde: sumarDias(hoy, -90), p_hasta: hoy }),
  ]);
  const err = vm.error || v9.error || s9.error;
  if (err) {
    caja.innerHTML = "";
    $("#gError").textContent = faltaTabla(err) ? "Falta ejecutar el script sql/05-gastos.sql en Supabase." : "No se pudieron leer las ventas: " + err.message;
    return;
  }
  const ventasMes = Number((vm.data[0] || {}).ventas_total || 0), comensalesMes = Number((vm.data[0] || {}).comensales_total || 0);
  const ventas90 = Number((v9.data[0] || {}).ventas_total || 0), comensales90 = Number((v9.data[0] || {}).comensales_total || 0), tickets90 = Number((v9.data[0] || {}).tickets_total || 0);
  const variables90 = (s9.data || []).filter((r) => r.tipo_salida === "variable").reduce((s, r) => s + Number(r.total_salidas), 0);

  const fijosMes = fijos.filter((g) => g.activo).reduce((s, g) => s + Number(g.monto), 0);
  const cvReal = ventas90 > 0 && variables90 > 0 ? (variables90 / ventas90) * 100 : null;
  const cv = aj.costo_variable_manual != null ? aj.costo_variable_manual : cvReal;
  const cvTxt = aj.costo_variable_manual != null ? "estimado por vos" : "según tus datos de los últimos 90 días";
  const gastoCom = aj.gasto_comensal_manual != null ? aj.gasto_comensal_manual : comensales90 > 0 ? ventas90 / comensales90 : null;
  const gastoComTxt = aj.gasto_comensal_manual != null ? "estimado por vos" : "según tus ventas de los últimos 90 días";
  const ticketMesa = tickets90 > 0 ? ventas90 / tickets90 : null;
  const dias = aj.dias_abierto_mes || 26;

  const partes = [];
  if (!fijosMes) {
    partes.push('<p class="vacio">Primero cargá tus gastos fijos en la sección «Gastos fijos».</p>');
  } else if (cv == null) {
    partes.push(fila("Gastos fijos por mes", "Suma de los gastos fijos activos", plata(fijosMes)));
    partes.push('<p class="vacio">Todavía no hay ventas y compras suficientes para calcular cuánto se va en mercadería. Poné un porcentaje estimado en «Supuestos» (por ejemplo 35).</p>');
  } else if (cv >= 100) {
    partes.push(fila("Gastos fijos por mes", "Suma de los gastos fijos activos", plata(fijosMes)));
    partes.push('<p class="vacio">Con estos números lo que gastás en mercadería y otros variables es igual o mayor a lo que vendés, así que no hay punto de equilibrio. Revisá el porcentaje en «Supuestos».</p>');
  } else {
    const margen = 1 - cv / 100, pe = fijosMes / margen;
    const avance = Math.min(100, (ventasMes / pe) * 100), falta = Math.max(0, pe - ventasMes);
    partes.push(fila("Gastos fijos por mes", "Suma de los gastos fijos activos", plata(fijosMes)));
    partes.push(fila("Mercadería y gastos variables", `${cv.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de lo que vendés (${cvTxt})`, `${cv.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`));
    partes.push(fila("Tenés que vender por mes", `Para cubrir todos los gastos. Te queda ${plata(margen * 100)} de cada $ 100 vendidos, después de la mercadería`, plata(pe), "destacado"));
    if (gastoCom) {
      const cm = Math.ceil(pe / gastoCom);
      partes.push(fila("Comensales por mes", `Con un gasto de ${plata(gastoCom)} por persona (${gastoComTxt})`, num(cm)));
      partes.push(fila("Comensales por día", `Abriendo ${dias} días por mes`, num(Math.ceil(cm / dias))));
    } else partes.push('<p class="vacio">Para traducirlo a cantidad de gente, cargá un gasto por persona estimado en «Supuestos» o esperá a tener ventas.</p>');
    if (ticketMesa) partes.push(fila("Mesas por mes", `Con un ticket promedio de ${plata(ticketMesa)} por mesa`, num(Math.ceil(pe / ticketMesa))));
    partes.push(`<div class="avance"><div class="barra" role="img" aria-label="Avance del mes: ${Math.round(avance)}%"><i style="width:${avance}%"></i></div>
      <p class="t-centro">${ventasMes >= pe ? "Ya cubriste los gastos de este mes." : `Llevás ${plata(ventasMes)} vendidos este mes (${Math.round(avance)}%). Te faltan ${plata(falta)}.`}${comensalesMes ? ` Hasta ahora entraron ${num(comensalesMes)} ${comensalesMes === 1 ? "comensal" : "comensales"}.` : ""}</p></div>`);
  }
  caja.innerHTML = partes.join("");

  $("#aDias").value = aj.dias_abierto_mes ?? "";
  $("#aCv").value = aj.costo_variable_manual ?? "";
  $("#aGasto").value = aj.gasto_comensal_manual ?? "";
  $("#aReal").textContent = cvReal != null ? `Con tus datos reales, hoy la mercadería y otros variables son el ${cvReal.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de las ventas.` : "Todavía no hay datos reales suficientes para calcular ese porcentaje.";
}

async function guardarAjustes() {
  const campos = [["dias_abierto_mes", "#aDias"], ["costo_variable_manual", "#aCv"], ["gasto_comensal_manual", "#aGasto"]];
  const poner = [], sacar = [];
  campos.forEach(([clave, sel]) => {
    const v = $(sel).value.trim();
    if (v === "" || n2(v) <= 0) sacar.push(clave); else poner.push({ clave, valor: n2(v) });
  });
  if (poner.some((x) => x.clave === "costo_variable_manual" && x.valor >= 100)) return aviso("El porcentaje de mercadería tiene que ser menor a 100.");
  const r1 = poner.length ? await db.from("ajustes_gastos").upsert(poner) : {};
  const r2 = sacar.length ? await db.from("ajustes_gastos").delete().in("clave", sacar) : {};
  if (r1.error || r2.error) return aviso("No se pudo guardar: " + (r1.error || r2.error).message);
  aviso("Supuestos guardados");
  await cargarBase(); dibujarEquilibrio();
}

// ====== GASTOS FIJOS ======
function dibujarFijos() {
  const total = fijos.filter((g) => g.activo).reduce((s, g) => s + Number(g.monto), 0);
  const pagado = fijos.filter((g) => g.activo && pagoDe(g.id)).length, activos = fijos.filter((g) => g.activo).length;
  $("#fTotal").textContent = activos ? `Total por mes: ${plata(total)} · pagados este mes: ${pagado} de ${activos}` : "";
  $("#fLista").innerHTML = fijos.length
    ? fijos.map((g) => {
        const e = g.activo ? estadoFijo(g) : { t: "Inactivo", c: "", pagado: false };
        return `<div class="item ${g.activo ? e.c : "off"}"><div>${esc(g.concepto)}<small>${esc(g.categoria)} · ${e.t}${g.dia_vencimiento ? " · vence el día " + g.dia_vencimiento : ""}</small></div>
          <div class="num"><span>${plata(g.monto)}</span>
          ${g.activo ? (e.pagado ? `<button data-fdeshacer="${g.id}">Deshacer</button>` : `<button data-fpagar="${g.id}">Pagué</button>`) : ""}
          <button data-fedit="${g.id}">Editar</button><button class="link" data-fdel="${g.id}">Borrar</button></div></div>`;
      }).join("")
    : '<p class="vacio">Todavía no cargaste gastos fijos. Empezá por los sueldos, el alquiler y la luz.</p>';
}

function limpiarFijo() {
  $("#fForm").reset(); $("#fId").value = ""; $("#fActivo").checked = true;
  $("#fTitulo").textContent = "Nuevo gasto fijo"; $("#fCancelar").hidden = true;
}

async function guardarFijo() {
  const fila = {
    concepto: $("#fConcepto").value.trim(), categoria: $("#fCategoria").value, monto: n2($("#fMonto").value),
    dia_vencimiento: $("#fDia").value.trim() ? Math.min(31, Math.max(1, Math.round(n2($("#fDia").value)))) : null, activo: $("#fActivo").checked,
  };
  if (!fila.concepto) return aviso("Poné el nombre del gasto, por ejemplo «Alquiler».");
  if (!(fila.monto > 0)) return aviso("Poné cuánto es por mes.");
  const id = $("#fId").value;
  const { error } = id ? await db.from("gastos_fijos").update(fila).eq("id", id) : await db.from("gastos_fijos").insert(fila);
  if (error) return aviso("No se pudo guardar: " + error.message);
  limpiarFijo(); aviso("Gasto fijo guardado"); await recargar("fijos");
}

function editarFijo(id) {
  const g = fijos.find((x) => String(x.id) === String(id));
  if (!g) return;
  $("#fId").value = g.id; $("#fConcepto").value = g.concepto; $("#fCategoria").value = g.categoria; $("#fMonto").value = g.monto;
  $("#fDia").value = g.dia_vencimiento ?? ""; $("#fActivo").checked = g.activo;
  $("#fTitulo").textContent = "Editar gasto fijo"; $("#fCancelar").hidden = false;
  $("#fConcepto").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function borrarFijo(id) {
  if (!(await confirmar("¿Borrar este gasto fijo?", { detalle: "Los pagos que ya anotaste en Salidas se conservan.", aceptar: "Borrar", peligro: true }))) return;
  const { error } = await db.from("gastos_fijos").delete().eq("id", id);
  if (error) return aviso("No se pudo borrar: " + error.message);
  aviso("Gasto fijo borrado"); await recargar("fijos");
}

async function pagarFijo(id) {
  const g = fijos.find((x) => String(x.id) === String(id));
  if (!g) return;
  const txt = await preguntar(`¿Cuánto pagaste de «${g.concepto}»?`, { valor: String(g.monto), inputmode: "decimal", aceptar: "Anotar pago" });
  if (txt === null) return;
  const m = monto(txt);
  if (!(m > 0)) return aviso("Escribí un monto válido.");
  const { error } = await db.from("salidas").insert({ fecha: hoyStr(), concepto: g.concepto, monto: m, tipo: "fijo", categoria: g.categoria, gasto_fijo_id: g.id, periodo: mesActual() });
  if (error) return aviso(/duplicate|unique/i.test(error.message) ? "Ya figura pagado este mes." : "No se pudo anotar el pago: " + error.message);
  aviso("Pago anotado en Salidas"); await recargar("fijos");
}

async function deshacerPago(id) {
  const p = pagoDe(id);
  if (!p || !(await confirmar("¿Deshacer el pago de este mes?", { detalle: "Se borra de Salidas.", aceptar: "Deshacer pago", peligro: true }))) return;
  const { error } = await db.from("salidas").delete().eq("id", p.id);
  if (error) return aviso("No se pudo deshacer: " + error.message);
  aviso("Pago deshecho"); await recargar("fijos");
}

// ====== SALIDAS ======
async function dibujarSalidas() {
  const mes = $("#sMes").value || mesActual();
  const { data, error } = await db.from("salidas").select("*")
    .gte("fecha", `${mes}-01`).lt("fecha", `${mesSiguiente(mes)}-01`)
    .order("fecha", { ascending: false }).order("id", { ascending: false }).limit(1000);
  if (error) { $("#gError").textContent = faltaTabla(error) ? "Falta ejecutar el script sql/05-gastos.sql en Supabase." : "No se pudieron leer las salidas: " + error.message; return; }
  salidas = data;
  document.querySelectorAll("#sChips [data-sf]").forEach((b) => b.classList.toggle("activa", b.dataset.sf === filtroSal));
  const suma = (t) => salidas.filter((s) => s.tipo === t).reduce((a, s) => a + Number(s.monto), 0);
  $("#sResumen").innerHTML = fila("Gastos fijos", nombreMes(mes), plata(suma("fijo"))) + fila("Gastos variables", "Mercadería y otros", plata(suma("variable"))) + fila("Total pagado", "", plata(suma("fijo") + suma("variable")), "destacado");
  const ver = salidas.filter((s) => filtroSal === "todas" || s.tipo === filtroSal);
  $("#sLista").innerHTML = ver.length
    ? ver.map((s) => {
        const auto = s.factura_id || s.gasto_fijo_id;
        return `<div class="item"><div>${esc(s.concepto)}<small>${fechaLinda(s.fecha)} · ${s.tipo === "fijo" ? "Fijo" : "Variable"}${s.categoria ? " · " + esc(s.categoria) : ""}${auto ? " · Automática" : ""}</small></div>
          <div class="num"><span>${plata2(s.monto)}</span>${auto ? "" : `<button class="link" data-sdel="${s.id}">Borrar</button>`}</div></div>`;
      }).join("")
    : '<p class="vacio">No hay salidas para mostrar en este mes.</p>';
}

async function guardarSalida() {
  const fila = { fecha: $("#sFecha").value, concepto: $("#sConcepto").value.trim(), monto: n2($("#sMonto").value), tipo: $("#sTipo").value, categoria: $("#sCategoria").value.trim() || null };
  if (!fila.fecha) return aviso("Poné la fecha.");
  if (!fila.concepto) return aviso("Poné qué pagaste.");
  if (!(fila.monto > 0)) return aviso("Poné el monto.");
  const { error } = await db.from("salidas").insert(fila);
  if (error) return aviso("No se pudo guardar: " + error.message);
  $("#sForm").reset(); $("#sFecha").value = hoyStr();
  aviso("Salida anotada"); await recargar("salidas");
}

async function borrarSalida(id) {
  if (!(await confirmar("¿Borrar esta salida?", { aceptar: "Borrar", peligro: true }))) return;
  const { error } = await db.from("salidas").delete().eq("id", id);
  if (error) return aviso("No se pudo borrar: " + error.message);
  aviso("Salida borrada"); await recargar("salidas");
}

// ====== NAVEGACIÓN Y ARRANQUE ======
function irA(sec) {
  document.querySelectorAll("[data-gs]").forEach((s) => (s.hidden = s.dataset.gs !== sec));
  document.querySelectorAll("[data-gs-btn]").forEach((b) => b.classList.toggle("activa", b.dataset.gsBtn === sec));
  if (sec === "equilibrio") dibujarEquilibrio();
  if (sec === "fijos") dibujarFijos();
  if (sec === "salidas") dibujarSalidas();
}
const seccionActual = () => ((document.querySelector("[data-gs-btn].activa") || {}).dataset || {}).gsBtn || "equilibrio";

async function recargar(sec) {
  if (await cargarBase()) { ponerInsignia(); irA(sec || seccionActual()); }
}

export async function initGastos() {
  if (!iniciado) {
    iniciado = true;
    $("#sMes").value = mesActual(); $("#sFecha").value = hoyStr();
    engancharEventos();
  }
  if (await cargarBase()) { ponerInsignia(); irA(seccionActual()); }
}

function engancharEventos() {
  const raiz = document.querySelector('[data-vista="gastos"]');
  raiz.addEventListener("click", (e) => {
    const t = e.target, d = (k) => t.closest(`[data-${k}]`);
    let el;
    if ((el = d("gs-btn"))) return irA(el.dataset.gsBtn);
    if ((el = d("fpagar"))) return pagarFijo(el.dataset.fpagar);
    if ((el = d("fdeshacer"))) return deshacerPago(el.dataset.fdeshacer);
    if ((el = d("fedit"))) return editarFijo(el.dataset.fedit);
    if ((el = d("fdel"))) return borrarFijo(el.dataset.fdel);
    if (t.closest("#fCancelar")) return limpiarFijo();
    if ((el = d("sf"))) { filtroSal = el.dataset.sf; return dibujarSalidas(); }
    if ((el = d("sdel"))) return borrarSalida(el.dataset.sdel);
  });
  $("#fForm").addEventListener("submit", (e) => { e.preventDefault(); guardarFijo(); });
  $("#sForm").addEventListener("submit", (e) => { e.preventDefault(); guardarSalida(); });
  $("#aForm").addEventListener("submit", (e) => { e.preventDefault(); guardarAjustes(); });
  $("#sMes").addEventListener("change", dibujarSalidas);
}

// Reglas compartidas por Estadísticas y Caja: medios de pago y turnos del café.

export const TZ = "America/Argentina/Buenos_Aires";
export const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---- Medios de pago: Efectivo, Transferencia y Posnet (Posnet = débito + crédito + QR, también en tickets viejos) ----
export const ORDEN_MEDIOS = ["Efectivo", "Transferencia", "Posnet"];
export const grupoMedio = (m) => {
  const t = sinTildes(m).trim();
  if (!t) return "Sin dato";
  if (t === "efectivo") return "Efectivo";
  if (t === "transferencia") return "Transferencia";
  if (/posnet|postnet|debito|credito|qr/.test(t)) return "Posnet";
  return m;
};

// ---- Turnos. Para cambiar un horario, se toca SOLO esta lista (formato HH:MM) ----
// El día del café empieza a las 8:30: lo que se cierra después de las 00:00 cuenta en la noche del día anterior.
export const INICIO_DIA = "08:30";
export const TURNOS = [
  { id: "manana", nombre: "Mañana", desde: "08:30", hasta: "16:30" },
  { id: "tarde",  nombre: "Tarde",  desde: "16:30", hasta: "21:30" },
  { id: "noche",  nombre: "Noche",  desde: "21:30", hasta: INICIO_DIA }, // llega hasta las 8:30 del día siguiente
];
const aMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export const sumarDias = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

// Minutos desde las 00:00 (hora de Argentina) de un instante
function minutosAR(iso) {
  const p = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: TZ }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
}

// Turno al que pertenece un instante (devuelve el objeto del turno)
export function turnoDeInstante(iso) {
  const m = minutosAR(iso);
  return TURNOS.find((t) => t.id !== "noche" && m >= aMin(t.desde) && m < aMin(t.hasta)) || TURNOS.find((t) => t.id === "noche");
}
export const turnoDe = (iso) => turnoDeInstante(iso).nombre;
export const turnoActual = () => turnoDeInstante(new Date().toISOString()).id;

// Día del café al que pertenece un instante (antes de las 8:30 todavía es la noche del día anterior)
export function diaDeTurno(iso) {
  const f = new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
  return minutosAR(iso) < aMin(INICIO_DIA) ? sumarDias(f, -1) : f;
}

// Ventana [desde, hasta) de un turno de una fecha, lista para consultar la base
export function ventanaTurno(fecha, turnoId) {
  const t = TURNOS.find((x) => x.id === turnoId);
  const hasta = t.id === "noche" ? sumarDias(fecha, 1) : fecha;
  return [`${fecha}T${t.desde}:00-03:00`, `${hasta}T${t.hasta}:00-03:00`];
}

import { db } from "./db.js";
import { initProductos } from "./productos.js";
import { initMesas } from "./mesas.js";
import { initEstadisticas } from "./estadisticas.js";
import { initHistorial } from "./historial.js";
import { initBackup } from "./backup.js";
import { initCompras, actualizarAlertas } from "./compras.js";
import { initGastos, actualizarAlertasGastos } from "./gastos.js";
import { initPresupuestos } from "./presupuestos.js";
import { initCaja } from "./caja.js";

const $ = (s) => document.querySelector(s);

// ====== LISTA DE SOLAPAS DE LA APP ======
// Para agregar una solapa nueva:
//   1) sumá una línea acá (id sin espacios ni tildes, nombre visible, y su init cuando esté lista)
//   2) sumá su <div class="principal-area" data-vista="ID"> en index.html
//   3) en Supabase: insert into roles_modulos (rol, modulo) values ('mozo','ID');
// Las que no tienen "init" aparecen como "Próximamente" (deshabilitadas).
// El admin ve TODAS las solapas de esta lista automáticamente.
const MODULOS = [
  { id: "productos",    nombre: "Productos",    init: initProductos },
  { id: "mesas",        nombre: "Mesas",        init: initMesas },
  { id: "historial",    nombre: "Historial",    init: initHistorial },
  { id: "caja",         nombre: "Caja",         init: initCaja },
  { id: "compras",      nombre: "Compras",      init: initCompras },
  { id: "gastos",       nombre: "Gastos",       init: initGastos },
  { id: "presupuestos", nombre: "Presupuestos", init: initPresupuestos },
  { id: "estadisticas", nombre: "Estadísticas", init: initEstadisticas },
  { id: "backup",       nombre: "Backup",       init: initBackup },
];

let usuarioActual = null;

function mostrarVista(id) {
  document.querySelectorAll("[data-vista]").forEach((v) => (v.hidden = v.dataset.vista !== id));
  document.querySelectorAll("#menu .tab").forEach((b) => b.classList.toggle("activa", b.dataset.modulo === id));
  const m = MODULOS.find((x) => x.id === id);
  if (m && m.init) m.init();
}

async function armarApp(session) {
  const { data: perfil, error } = await db
    .from("perfiles").select("nombre, rol, activo").eq("id", session.user.id).maybeSingle();

  if (error || !perfil || !perfil.activo) {
    $("#loginError").textContent = "Tu usuario no tiene acceso. Pedile a un administrador que lo habilite.";
    await db.auth.signOut();
    return;
  }

  let permitidos;
  if (perfil.rol === "admin") {
    permitidos = MODULOS.map((m) => m.id);
  } else {
    const { data } = await db.from("roles_modulos").select("modulo").eq("rol", perfil.rol);
    permitidos = (data || []).map((r) => r.modulo);
  }

  const visibles = MODULOS.filter((m) => permitidos.includes(m.id));
  $("#menu").innerHTML = visibles
    .map((m) => `<button class="tab" data-modulo="${m.id}"${m.init ? "" : ' disabled title="Próximamente"'}>${m.nombre}</button>`)
    .join("");

  $("#login").hidden = true;
  $("#app").hidden = false;

  if (permitidos.includes("compras")) actualizarAlertas(); // número de avisos en la solapa
  if (permitidos.includes("gastos")) actualizarAlertasGastos();

  const primera = visibles.find((m) => m.init);
  mostrarVista(primera ? primera.id : "sinacceso");
}

function mostrar(session) {
  if (!session) {
    usuarioActual = null;
    $("#menu").innerHTML = "";
    $("#app").hidden = true;
    $("#login").hidden = false;
    return;
  }
  if (session.user.id === usuarioActual) return; // evita repetir cuando se renueva la sesión
  usuarioActual = session.user.id;
  armarApp(session);
}

db.auth.getSession().then(({ data }) => mostrar(data.session));
// setTimeout: Supabase no permite llamadas a la base dentro de este aviso directamente
db.auth.onAuthStateChange((_evento, session) => setTimeout(() => mostrar(session), 0));

$("#menu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-modulo]");
  if (b && !b.disabled) mostrarVista(b.dataset.modulo);
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value,
  });
  if (error) $("#loginError").textContent = "Email o contraseña incorrectos.";
});

// Menú de la izquierda: se puede ocultar para tener más lugar (queda guardado en este dispositivo)
(function menuPlegable() {
  const app = $("#app"), btn = $("#menuToggle");
  let chico = false;
  try { chico = localStorage.getItem("menuChico") === "1"; } catch { /* sin almacenamiento: queda abierto */ }
  const aplicar = () => { app.classList.toggle("menu-chico", chico); btn.textContent = chico ? "☰" : "‹"; btn.setAttribute("aria-expanded", String(!chico)); };
  aplicar();
  btn.addEventListener("click", () => {
    chico = !chico; aplicar();
    try { localStorage.setItem("menuChico", chico ? "1" : "0"); } catch { /* idem */ }
  });
})();

$("#salir").addEventListener("click", () => {
  $("#password").value = "";
  db.auth.signOut();
});

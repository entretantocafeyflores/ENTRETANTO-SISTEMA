import { db } from "./db.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plata = (n) => "$ " + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const TIPOS = { carta: "Carta", almuerzo: "Almuerzo", menu_del_dia: "Menú del día" };

let cats = [], prods = [], iniciado = false;

function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 2500);
}

async function cargar() {
  const [c, p] = await Promise.all([
    db.from("categorias").select("*").order("orden").order("nombre"),
    db.from("productos").select("*").order("nombre"),
  ]);
  if (c.error || p.error) return aviso("No se pudo cargar. Revisá la conexión y la configuración.");
  cats = c.data; prods = p.data;
  dibujar();
}

function dibujar() {
  const sel = $("#prodCat"), actual = sel.value;
  sel.innerHTML = '<option value="">Sin categoría</option>' + cats.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  sel.value = actual;

  const grupos = [...cats, { id: null, nombre: "Sin categoría" }]
    .map((c) => ({ c, items: prods.filter((p) => p.categoria_id === c.id) }))
    .filter((g) => g.items.length);

  $("#lista").innerHTML = grupos.length
    ? grupos.map((g) => `<div class="grupo"><h3>${esc(g.c.nombre)}</h3>${g.items.map((p) => `
        <div class="item ${p.activo ? "" : "off"}">
          <div>${esc(p.nombre)}<small>${plata(p.precio)} · ${TIPOS[p.tipo]}${p.activo ? "" : " · fuera de venta"}</small></div>
          <div><button data-editar="${p.id}">Editar</button> <button class="link" data-borrar="${p.id}">Borrar</button></div>
        </div>`).join("")}</div>`).join("")
    : '<p class="vacio">Todavía no cargaste productos. Creá una categoría y agregá el primero.</p>';
}

function limpiar() {
  $("#prodForm").reset();
  $("#prodId").value = "";
  $("#formTitulo").textContent = "Nuevo producto";
  $("#cancelar").hidden = true;
}

export function initProductos() {
  cargar();
  if (iniciado) return;
  iniciado = true;

  $("#catForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("#catNombre").value.trim();
    const { error } = await db.from("categorias").insert({ nombre, orden: cats.length });
    if (error) return aviso("No se pudo guardar la categoría.");
    $("#catNombre").value = "";
    aviso("Categoría agregada"); cargar();
  });

  $("#prodForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fila = {
      nombre: $("#prodNombre").value.trim(),
      precio: Number($("#prodPrecio").value),
      categoria_id: $("#prodCat").value || null,
      tipo: $("#prodTipo").value,
      activo: $("#prodActivo").checked,
    };
    const id = $("#prodId").value;
    const { error } = id ? await db.from("productos").update(fila).eq("id", id) : await db.from("productos").insert(fila);
    if (error) return aviso("No se pudo guardar el producto.");
    limpiar(); aviso("Producto guardado"); cargar();
  });

  $("#cancelar").addEventListener("click", limpiar);

  $("#lista").addEventListener("click", async (e) => {
    const ed = e.target.dataset.editar, del = e.target.dataset.borrar;
    if (ed) {
      const p = prods.find((x) => x.id == ed);
      $("#prodId").value = p.id; $("#prodNombre").value = p.nombre; $("#prodPrecio").value = p.precio;
      $("#prodCat").value = p.categoria_id ?? ""; $("#prodTipo").value = p.tipo; $("#prodActivo").checked = p.activo;
      $("#formTitulo").textContent = "Editar producto"; $("#cancelar").hidden = false;
      $("#prodNombre").focus();
    }
    if (del && confirm("¿Borrar este producto? Las ventas ya hechas no se modifican.")) {
      const { error } = await db.from("productos").delete().eq("id", del);
      aviso(error ? "No se pudo borrar." : "Producto borrado"); cargar();
    }
  });
}

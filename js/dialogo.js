// Carteles de confirmación con la estética de la app (reemplazan a los feos del navegador).
//   if (await confirmar("¿Borrar este producto?", { detalle: "...", aceptar: "Borrar", peligro: true })) { ... }
//   const txt = await preguntar("¿Cuánto pagaste?", { valor: "1000" });   // devuelve el texto, o null si cancela

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function abrir({ titulo, detalle = "", aceptar = "Aceptar", cancelar = "Cancelar", peligro = false, campo = null }) {
  return new Promise((resolve) => {
    const anterior = document.activeElement;
    const fondo = document.createElement("div");
    fondo.className = "dialogo-fondo";
    fondo.innerHTML = `
      <div class="dialogo${peligro ? " peligro" : ""}" role="dialog" aria-modal="true" aria-labelledby="dlgTitulo">
        <h2 id="dlgTitulo">${esc(titulo)}</h2>
        ${detalle ? `<p>${esc(detalle)}</p>` : ""}
        ${campo && campo.opciones ? `<select id="dlgCampo">${campo.opciones.map((o) => `<option${o === campo.valor ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
        ${campo && !campo.opciones ? `<input id="dlgCampo" value="${esc(campo.valor ?? "")}" placeholder="${esc(campo.placeholder ?? "")}" inputmode="${esc(campo.inputmode ?? "text")}" autocomplete="off">` : ""}
        <div class="dialogo-botones">
          <button type="button" class="dlg-no">${esc(cancelar)}</button>
          <button type="button" class="principal dlg-si">${esc(aceptar)}</button>
        </div>
      </div>`;
    const si = fondo.querySelector(".dlg-si"), no = fondo.querySelector(".dlg-no"), input = fondo.querySelector("#dlgCampo");
    const estiloBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    let cerrado = false;
    const cerrar = (valor) => {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener("keydown", teclas, true);
      document.body.style.overflow = estiloBody;
      fondo.remove();
      if (anterior && anterior.focus) anterior.focus({ preventScroll: true });
      resolve(valor);
    };
    const aceptado = () => cerrar(campo ? input.value : true);
    const cancelado = () => cerrar(campo ? null : false);

    function teclas(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelado(); }
      else if (e.key === "Enter" && e.target === input) { e.preventDefault(); aceptado(); }
      else if (e.key === "Tab") {
        // El foco se queda dentro del cartel
        const orden = [input, no, si].filter(Boolean);
        const i = orden.indexOf(document.activeElement);
        const sig = orden[(i + (e.shiftKey ? orden.length - 1 : 1)) % orden.length];
        e.preventDefault(); sig.focus();
      }
    }

    si.addEventListener("click", aceptado);
    no.addEventListener("click", cancelado);
    fondo.addEventListener("click", (e) => { if (e.target === fondo) cancelado(); });
    document.addEventListener("keydown", teclas, true);
    document.body.appendChild(fondo);

    // Al borrar algo, el foco arranca en "Cancelar" para que un Enter distraído no borre.
    if (input) { input.focus(); if (input.select) input.select(); } else (peligro ? no : si).focus();
  });
}

export const confirmar = (titulo, opciones = {}) => abrir({ titulo, ...opciones });
// Para elegir una opción de una lista: devuelve la opción elegida, o null si cancela.
export const elegir = (titulo, { opciones = [], valor = "", ...resto } = {}) => abrir({ titulo, campo: { opciones, valor }, ...resto });
export const preguntar = (titulo, { valor = "", placeholder = "", inputmode = "text", ...resto } = {}) =>
  abrir({ titulo, campo: { valor, placeholder, inputmode }, ...resto });

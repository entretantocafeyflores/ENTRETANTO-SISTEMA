// Impresión de tickets en la térmica: cada copia sale en su propia hoja del tamaño del rollo,
// así la impresora corta entre una y otra. Si cambiás de papel, se cambia SOLO esta línea:
const PAPEL_TICKET = "80mm 210mm";   // ancho × largo

const ID = "paginaTicket";
const quitar = () => { const s = document.getElementById(ID); if (s) s.remove(); };

// Para tickets: el tamaño de hoja solo vale mientras se imprime el ticket (no afecta a presupuestos ni estadísticas).
export function imprimirTicket() {
  quitar();
  const st = document.createElement("style");
  st.id = ID;
  st.textContent = `@page { size: ${PAPEL_TICKET}; margin: 0; }`;
  document.head.appendChild(st);
  window.addEventListener("afterprint", quitar, { once: true });
  window.print();
}

// Para todo lo demás (presupuestos, estadísticas): hoja normal.
export function imprimirNormal() {
  quitar();
  window.print();
}

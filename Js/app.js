import { db } from "./db.js";
import { initProductos } from "./productos.js";

const $ = (s) => document.querySelector(s);

function mostrar(session) {
  $("#login").hidden = !!session;
  $("#app").hidden = !session;
  if (session) initProductos();
}

db.auth.getSession().then(({ data }) => mostrar(data.session));
db.auth.onAuthStateChange((_evento, session) => mostrar(session));

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value,
  });
  $("#loginError").textContent = error ? "Email o contraseña incorrectos." : "";
});

$("#salir").addEventListener("click", () => db.auth.signOut());

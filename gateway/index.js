// GATEWAY: única puerta de entrada. Sirve la PWA, valida la sesión y reenvía cada ruta al microservicio.
const express = require("express");
const path = require("path");

const USUARIOS = process.env.USUARIOS_URL || "http://localhost:3001";
const CATALOGO = process.env.CATALOGO_URL || "http://localhost:3002";
const ASIENTOS = process.env.ASIENTOS_URL || "http://localhost:3003";
const COMPRAS = process.env.COMPRAS_URL || "http://localhost:3004";

const app = express();
app.use(express.json({ limit: "10kb" }));

// Reenvía la petición a un servicio y devuelve su respuesta tal cual
async function reenviar(req, res, url) {
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: { "Content-Type": "application/json", ...req.internos },   // solo encabezados que pone el gateway
      body: req.method === "GET" ? undefined : JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(5000)
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    res.status(503).json({ error: "Servicio no disponible. Intenta de nuevo en unos segundos." });
  }
}

// Rutas protegidas: pregunta a Usuarios de quién es el token y pasa el id a los demás servicios
async function auth(req, res, next) {
  try {
    const r = await fetch(`${USUARIOS}/verificar`, { headers: { Authorization: req.headers.authorization || "" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(401).json({ error: "Sesión no válida. Inicia sesión de nuevo." });
    const u = await r.json();
    req.internos = { "X-Usuario-Id": String(u.id) };
    next();
  } catch (e) {
    res.status(503).json({ error: "Servicio no disponible. Intenta de nuevo en unos segundos." });
  }
}

app.post("/api/sesion", (req, res) => reenviar(req, res, `${USUARIOS}/sesion`));
app.get("/api/funciones", (req, res) => reenviar(req, res, `${CATALOGO}/funciones`));
app.get("/api/funciones/:id/asientos", (req, res) => reenviar(req, res, `${ASIENTOS}/funciones/${encodeURIComponent(req.params.id)}/asientos`));
app.post("/api/compras", auth, (req, res) => reenviar(req, res, `${COMPRAS}/compras`));
app.get("/api/mis-compras", auth, (req, res) => reenviar(req, res, `${COMPRAS}/mis-compras`));

app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: "Error del servidor." }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Gateway en http://localhost:${PORT}`));

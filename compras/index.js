// Microservicio de COMPRAS: coordina la compra y guarda los boletos. Base de datos propia.
// Para comprar llama por HTTP a Catálogo y a Asientos (ver el flujo en POST /compras).
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const CATALOGO = process.env.CATALOGO_URL || "http://localhost:3002";
const ASIENTOS = process.env.ASIENTOS_URL || "http://localhost:3003";
const FILAS = 8, COLS = 10, LETRAS = "ABCDEFGH", MAX_POR_COMPRA = 8;
const precio = r => (r < 3 ? 70 : r < 6 ? 90 : 110);   // el servicio calcula el total

const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "datos");
fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "compras.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, funcion_id INTEGER NOT NULL,
  peli TEXT NOT NULL, hora TEXT NOT NULL,        -- copia de los datos del catálogo al momento de comprar
  asientos TEXT NOT NULL,                        -- JSON, ej. ["A1","A2"]
  total INTEGER NOT NULL, fecha TEXT NOT NULL)`);
const insertar = db.prepare("INSERT INTO compras(usuario_id, funcion_id, peli, hora, asientos, total, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)");

// Llamada HTTP a otro servicio (con tiempo límite de 5 s)
async function llamar(url, body) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  return { ok: r.ok, status: r.status, datos: await r.json().catch(() => ({})) };
}

const app = express();
app.use(express.json({ limit: "10kb" }));

// El gateway ya validó el token y nos manda el usuario en el encabezado X-Usuario-Id
app.post("/compras", async (req, res) => {
  const uid = Number(req.headers["x-usuario-id"]);
  if (!uid) return res.status(401).json({ error: "Falta identificar al usuario." });

  const { funcionId, asientos } = req.body || {};
  const valido = Number.isInteger(funcionId) && Array.isArray(asientos) && asientos.length >= 1 && asientos.length <= MAX_POR_COMPRA &&
    asientos.every(a => Array.isArray(a) && Number.isInteger(a[0]) && Number.isInteger(a[1]) &&
      a[0] >= 0 && a[0] < FILAS && a[1] >= 0 && a[1] < COLS) &&
    new Set(asientos.map(a => a.join("-"))).size === asientos.length;
  if (!valido) return res.status(400).json({ error: `Elige de 1 a ${MAX_POR_COMPRA} asientos válidos.` });

  try {
    // Paso 1: ¿existe la función? (servicio Catálogo)
    const f = await llamar(`${CATALOGO}/funciones/${funcionId}`);
    if (f.status === 404) return res.status(404).json(f.datos);
    if (!f.ok) throw new Error("catalogo");

    // Paso 2: reservar los asientos, todos o ninguno (servicio Asientos)
    const r = await llamar(`${ASIENTOS}/reservar`, { funcionId, asientos });
    if (r.status === 409) return res.status(409).json(r.datos);
    if (!r.ok) throw new Error("asientos");

    // Paso 3: registrar el boleto. Si falla, se deshace la reserva (compensación)
    const nombres = asientos.map(([fi, c]) => LETRAS[fi] + (c + 1));
    const total = asientos.reduce((s, [fi]) => s + precio(fi), 0);
    let id;
    try {
      id = insertar.run(uid, funcionId, f.datos.peli, f.datos.hora, JSON.stringify(nombres), total, new Date().toISOString()).lastInsertRowid;
    } catch (e) {
      await llamar(`${ASIENTOS}/liberar`, { funcionId, asientos }).catch(() => {});
      throw e;
    }
    res.status(201).json({ folio: "T" + String(id).padStart(5, "0"), total, asientos: nombres });
  } catch (e) {
    res.status(503).json({ error: "No se pudo completar la compra. Intenta de nuevo." });
  }
});

app.get("/mis-compras", (req, res) => {
  const uid = Number(req.headers["x-usuario-id"]);
  if (!uid) return res.status(401).json({ error: "Falta identificar al usuario." });
  const filas = db.prepare("SELECT * FROM compras WHERE usuario_id = ? ORDER BY id DESC").all(uid);
  res.json({
    compras: filas.map(c => ({
      folio: "T" + String(c.id).padStart(5, "0"), peli: c.peli, hora: c.hora,
      total: c.total, fecha: c.fecha, asientos: JSON.parse(c.asientos)
    }))
  });
});

app.use((err, req, res, next) => res.status(500).json({ error: "Error del servidor." }));
const PORT = process.env.PORT_COMPRAS || 3004;
app.listen(PORT, () => console.log(`Compras escuchando en el puerto ${PORT}`));

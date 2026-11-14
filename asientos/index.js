// Microservicio de ASIENTOS: la matriz de cada sala y su disponibilidad. Base de datos propia.
// Aquí vive la parte atómica: reservar todos los asientos pedidos o ninguno.
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const FILAS = 8, COLS = 10, FUNCIONES = [1, 2, 3];   // ids de las funciones del catálogo
const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "datos");
fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "asientos.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS asientos (
  funcion_id INTEGER NOT NULL, fila INTEGER NOT NULL, col INTEGER NOT NULL,
  ocupado INTEGER NOT NULL DEFAULT 0,            -- 0 libre, 1 vendido
  PRIMARY KEY (funcion_id, fila, col))`);

if (!db.prepare("SELECT 1 FROM asientos").get()) {
  const ins = db.prepare("INSERT INTO asientos(funcion_id, fila, col, ocupado) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    FUNCIONES.forEach(f => { for (let r = 0; r < FILAS; r++) for (let c = 0; c < COLS; c++) ins.run(f, r, c, Math.random() < 0.2 ? 1 : 0); });
  })();
}

const marcar = db.prepare("UPDATE asientos SET ocupado = 1 WHERE funcion_id = ? AND fila = ? AND col = ? AND ocupado = 0");
const soltar = db.prepare("UPDATE asientos SET ocupado = 0 WHERE funcion_id = ? AND fila = ? AND col = ?");
const reservar = db.transaction((fid, seats) => {
  const ocupados = seats.filter(([r, c]) => marcar.run(fid, r, c).changes !== 1);
  if (ocupados.length) throw Object.assign(new Error("conflicto"), { ocupados });   // revierte todo
});
const datosValidos = (fid, a) => Number.isInteger(fid) && Array.isArray(a) && a.length > 0 &&
  a.every(x => Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]));

const app = express();
app.use(express.json({ limit: "10kb" }));

app.get("/funciones/:id/asientos", (req, res) => {
  const filas = db.prepare("SELECT fila, col, ocupado FROM asientos WHERE funcion_id = ?").all(req.params.id);
  if (!filas.length) return res.status(404).json({ error: "La función no existe." });
  const matriz = Array.from({ length: FILAS }, () => Array(COLS).fill(0));
  filas.forEach(a => (matriz[a.fila][a.col] = a.ocupado));
  res.json({ matriz });
});

// Lo llama COMPRAS: marca los asientos como vendidos, todos o ninguno
app.post("/reservar", (req, res) => {
  const { funcionId, asientos } = req.body || {};
  if (!datosValidos(funcionId, asientos)) return res.status(400).json({ error: "Datos inválidos." });
  try {
    reservar(funcionId, asientos);
    res.json({ ok: true });
  } catch (e) {
    if (e.ocupados) return res.status(409).json({ error: "Algún asiento ya no está disponible.", ocupados: e.ocupados });
    throw e;
  }
});

// Lo llama COMPRAS solo para deshacer una reserva si falló el registro del boleto (compensación)
app.post("/liberar", (req, res) => {
  const { funcionId, asientos } = req.body || {};
  if (!datosValidos(funcionId, asientos)) return res.status(400).json({ error: "Datos inválidos." });
  db.transaction(() => asientos.forEach(([r, c]) => soltar.run(funcionId, r, c)))();
  res.json({ ok: true });
});

app.use((err, req, res, next) => res.status(500).json({ error: "Error del servidor." }));
const PORT = process.env.PORT_ASIENTOS || 3003;
app.listen(PORT, () => console.log(`Asientos escuchando en el puerto ${PORT}`));

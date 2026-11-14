// Microservicio de CATÁLOGO: funciones (película y horario). Base de datos propia.
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "datos");
fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "catalogo.db"));
db.pragma("journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS funciones (id INTEGER PRIMARY KEY, peli TEXT NOT NULL, hora TEXT NOT NULL)");

if (!db.prepare("SELECT 1 FROM funciones").get()) {
  const ins = db.prepare("INSERT INTO funciones(peli, hora) VALUES (?, ?)");
  [["Noche en el Observatorio", "16:30"], ["El último tren", "19:00"], ["Aventura submarina", "21:15"]].forEach(f => ins.run(...f));
}

const app = express();
app.get("/funciones", (req, res) => {
  res.json({ funciones: db.prepare("SELECT id, peli, hora FROM funciones ORDER BY id").all() });
});
app.get("/funciones/:id", (req, res) => {
  const f = db.prepare("SELECT id, peli, hora FROM funciones WHERE id = ?").get(req.params.id);
  if (!f) return res.status(404).json({ error: "La función no existe." });
  res.json(f);
});

app.use((err, req, res, next) => res.status(500).json({ error: "Error del servidor." }));
const PORT = process.env.PORT_CATALOGO || 3002;
app.listen(PORT, () => console.log(`Catálogo escuchando en el puerto ${PORT}`));

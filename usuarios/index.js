// Microservicio de USUARIOS: cuentas, PIN y sesiones. Base de datos propia.
const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "datos");
fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "usuarios.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id));
`);

const hash = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString("hex");
const app = express();
app.use(express.json({ limit: "10kb" }));

// Entrar: si el nombre no existe se crea la cuenta; si existe se verifica el PIN
app.post("/sesion", (req, res) => {
  const nombre = String((req.body || {}).nombre || "").trim().slice(0, 40);
  const pin = String((req.body || {}).pin || "");
  if (!nombre || !/^\d{4}$/.test(pin))
    return res.status(400).json({ error: "Escribe tu nombre y un PIN de 4 dígitos." });

  let u = db.prepare("SELECT * FROM usuarios WHERE nombre = ?").get(nombre);
  if (!u) {
    const salt = crypto.randomBytes(16).toString("hex");
    const id = db.prepare("INSERT INTO usuarios(nombre, salt, pin_hash) VALUES (?, ?, ?)").run(nombre, salt, hash(pin, salt)).lastInsertRowid;
    u = { id, nombre };
  } else if (!crypto.timingSafeEqual(Buffer.from(hash(pin, u.salt)), Buffer.from(u.pin_hash))) {
    return res.status(401).json({ error: "PIN incorrecto para ese nombre." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sesiones(token, usuario_id) VALUES (?, ?)").run(token, u.id);
  res.json({ token, nombre: u.nombre });
});

// Lo llama el GATEWAY: dado un token, devuelve a qué usuario pertenece
app.get("/verificar", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const u = db.prepare("SELECT u.id, u.nombre FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?").get(token);
  if (!u) return res.status(401).json({ error: "Sesión no válida." });
  res.json(u);
});

app.use((err, req, res, next) => res.status(500).json({ error: "Error del servidor." }));
const PORT = process.env.PORT_USUARIOS || 3001;
app.listen(PORT, () => console.log(`Usuarios escuchando en el puerto ${PORT}`));

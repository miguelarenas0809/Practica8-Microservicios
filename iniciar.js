// Lanza los 5 procesos (cada microservicio corre por separado) con un solo comando.
const { spawn } = require("child_process");
const servicios = ["usuarios", "catalogo", "asientos", "compras", "gateway"];
const procesos = servicios.map(nombre => {
  const p = spawn(process.execPath, [`${nombre}/index.js`], { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });
  const log = d => d.toString().split("\n").filter(Boolean).forEach(l => console.log(`[${nombre}] ${l}`));
  p.stdout.on("data", log);
  p.stderr.on("data", log);
  p.on("exit", c => console.log(`[${nombre}] terminó (código ${c})`));
  return p;
});
const cerrar = () => process.exit(0);
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
process.on("exit", () => procesos.forEach(p => p.kill()));

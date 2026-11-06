import { readFile, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../server/config.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function encode(name, value) {
  const text = String(value);
  for (const quote of ["'", '"', "`"]) {
    const candidate = `${name}=${quote}${text}${quote}\n`;
    try {
      if (parseEnv(candidate)[name] === text) return candidate;
    } catch {}
  }
  throw Error(
    `Format de la variable ${name} incompatible. Configurer ce champ dans un environnement privé.`,
  );
}
/** Explicit local/VPS invocation only. Reads only the requested file and never overwrites a target. */
export async function configureEnvironment(
  source,
  target = path.join(root, ".env"),
) {
  if (!source)
    throw Error(
      "Indiquer le chemin du fichier environnement Cashpay existant.",
    );
  const original = parseEnv(await readFile(source, "utf8"));
  const values = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "8010",
    ADMIN_PUBLIC_ORIGIN: "https://admin.cashpay-all.com",
    ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url"),
    CASH_PAY_PUBLIC_ORIGIN: "https://app.cashpay-all.com",
  };
  for (const name of [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_SCHEMA",
    "DB_SSL",
    "DB_SSL_CA",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
  ])
    if (original[name] !== undefined) values[name] = original[name];
  values.DB_PORT ||= "5432";
  values.DB_SCHEMA ||= "public";
  values.DB_SSL ||= values.DB_SSL_CA ? "true" : "false";
  loadConfig(values);
  const contents = Object.entries(values)
    .map(([name, value]) => encode(name, value))
    .join("");
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  return { target, origin: values.ADMIN_PUBLIC_ORIGIN, port: values.PORT };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  configureEnvironment(process.argv[2])
    .then((result) =>
      console.log(
        `Environnement admin créé en mode privé pour ${result.origin}, port ${result.port}. Aucun secret affiché.`,
      ),
    )
    .catch((error) => {
      console.error(
        error.code === "EEXIST"
          ? "Le fichier .env existe déjà : aucune modification effectuée."
          : error.code === "ENOENT"
            ? "Fichier source introuvable. Vérifiez le chemin sur le VPS."
            : "Préparation impossible. Vérifier les variables PostgreSQL et leurs formats sans afficher leurs valeurs.",
      );
      process.exitCode = 1;
    });
}

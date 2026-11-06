import { readFile, open, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { encode } from "./configure-env.js";
export async function configureMail(source, target = path.resolve(".env")) {
  if (!source) throw Error("Indiquer le fichier environnement Cashpay source.");
  const original = parseEnv(await readFile(source, "utf8"));
  const contents = await readFile(target, "utf8");
  const existing = parseEnv(contents);
  const values = {};
  for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"]) {
    const value = original[key] || (key === "SMTP_PORT" ? "587" : "");
    if (!value) throw Error("Configuration SMTP source incomplète.");
    if (existing[key] && existing[key] !== value)
      throw Error(
        "Configuration SMTP différente déjà présente : aucune modification.",
      );
    values[key] = value;
  }
  if (
    !Number.isInteger(Number(values.SMTP_PORT)) ||
    Number(values.SMTP_PORT) < 1 ||
    Number(values.SMTP_PORT) > 65535
  )
    throw Error("Port SMTP invalide.");
  if (Object.keys(values).every((key) => existing[key] === values[key])) return;
  // Append only missing/empty SMTP settings. Node parseEnv uses the last definition.
  const updated =
    contents +
    "\n" +
    Object.entries(values)
      .filter(([key]) => !existing[key])
      .map(([key, value]) => encode(key, value))
      .join("");
  const parsed = parseEnv(updated);
  for (const [key, value] of Object.entries(existing))
    if (!key.startsWith("SMTP_") && parsed[key] !== value)
      throw Error("Préservation environnement impossible.");
  const backup = target + ".backup-" + randomUUID();
  const handle = await open(backup, "wx", 0o600);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  const temporary = target + ".tmp-" + randomUUID();
  const output = await open(temporary, "wx", 0o600);
  try {
    await output.writeFile(updated);
    await output.sync();
  } finally {
    await output.close();
  }
  await rename(temporary, target);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  configureMail(process.argv[2])
    .then(() =>
      console.log(
        "SMTP configuré. Base de données et secret de session conservés. Aucun secret affiché.",
      ),
    )
    .catch(() => {
      console.error(
        "Configuration SMTP refusée : vérifier les quatre variables SMTP du fichier source et les éventuels paramètres existants. Aucun autre paramètre modifié.",
      );
      process.exitCode = 1;
    });
}

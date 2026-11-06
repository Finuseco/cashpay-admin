import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { encode } from "./configure-env.js";
export async function configureAvatarStorage(
  directory,
  target = path.resolve(".env"),
) {
  if (!directory || !path.isAbsolute(directory))
    throw Error("Dossier absolu requis.");
  const avatar = path.resolve(directory);
  if (
    path.basename(avatar) !== "avatars" ||
    path.basename(path.dirname(avatar)) !== "images" ||
    path.basename(path.dirname(path.dirname(avatar))) !== "public"
  )
    throw Error("Indiquer le dossier public/images/avatars de Cashpay Web.");
  await fs.stat(path.dirname(avatar));
  const source = await fs.readFile(target, "utf8"),
    env = parseEnv(source);
  if (
    env.CASH_PAY_AVATAR_DIR &&
    path.resolve(env.CASH_PAY_AVATAR_DIR) !== avatar
  )
    throw Error("Un autre dossier est configuré ; aucune modification.");
  await fs.mkdir(avatar, { recursive: true, mode: 0o755 });
  await fs.chmod(avatar, 0o755);
  await fs.writeFile(target + ".backup-" + randomUUID(), source, {
    flag: "wx",
    mode: 0o600,
  });
  const temporary = target + ".tmp-" + randomUUID();
  await fs.writeFile(
    temporary,
    source + "\n" + encode("CASH_PAY_AVATAR_DIR", avatar),
    { flag: "wx", mode: 0o600 },
  );
  await fs.rename(temporary, target);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  configureAvatarStorage(process.argv[2])
    .then(() =>
      console.log(
        "Dossier des avatars partagé configuré. Autres paramètres conservés.",
      ),
    )
    .catch(() => {
      console.error(
        "Configuration refusée : vérifier le dossier public/images/avatars de Cashpay Web, les droits et les paramètres existants.",
      );
      process.exitCode = 1;
    });

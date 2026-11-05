import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const failure = (message) =>
  Object.assign(Error(message), { status: 400, expose: true });
export function createMediaStore(config) {
  const root = path.resolve(
    config.stateDir || ".runtime",
    "registration-media",
  );
  async function get(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw failure("Fichier invalide.");
    try {
      return JSON.parse(await readFile(path.join(root, id + ".json"), "utf8"));
    } catch {
      throw Object.assign(Error("Fichier introuvable."), {
        status: 404,
        expose: true,
      });
    }
  }
  async function save(actor, body) {
    const { purpose, data } = body || {};
    if (
      !["avatar", "signature", "id_front", "id_back"].includes(purpose) ||
      typeof data !== "string"
    )
      throw failure("Type de fichier invalide.");
    const match =
      /^data:(image\/(?:jpeg|png)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(
        data,
      );
    if (!match) throw failure("Importer une image JPEG/PNG ou une pièce PDF.");
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 5 * 1024 * 1024)
      throw failure("Fichier limité à 5 Mo.");
    let output, mime, extension;
    if (match[1] === "application/pdf") {
      if (
        !["id_front", "id_back"].includes(purpose) ||
        buffer.subarray(0, 5).toString() !== "%PDF-" ||
        !buffer.subarray(-2048).includes(Buffer.from("%%EOF"))
      )
        throw failure("Document PDF invalide.");
      output = buffer;
      mime = "application/pdf";
      extension = "pdf";
    } else {
      const jpeg =
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const png = buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (
        (match[1] === "image/jpeg" && !jpeg) ||
        (match[1] === "image/png" && !png)
      )
        throw failure("Le contenu ne correspond pas au type de l’image.");
      try {
        output = await sharp(buffer, {
          limitInputPixels: 40000000,
          animated: false,
        })
          .rotate()
          .resize({
            width: purpose === "avatar" ? 1200 : 2400,
            height: purpose === "avatar" ? 1200 : 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 90 })
          .toBuffer();
      } catch {
        throw failure("Image illisible ou dimensions excessives.");
      }
      mime = "image/jpeg";
      extension = "jpg";
    }
    if (purpose === "avatar" && config.production && !config.avatarRoot)
      throw Object.assign(
        Error(
          "Configurer CASH_PAY_AVATAR_DIR vers le dossier public/images/avatars de Cashpay Web.",
        ),
        { status: 503, expose: true },
      );
    await mkdir(root, { recursive: true, mode: 0o700 });
    const id = randomUUID(),
      file = id + "." + extension;
    const metadata = {
      id,
      file,
      mime,
      purpose,
      ownerId: Number(actor.id),
      createdAt: Date.now(),
    };
    metadata.url =
      purpose === "avatar"
        ? config.avatarRoot
          ? config.mediaOrigin + "/images/avatars/" + file
          : config.origin + "/media/avatars/" + id
        : config.origin + "/api/registration/media/" + id;
    if (purpose === "avatar" && config.avatarRoot) {
      await mkdir(config.avatarRoot, { recursive: true, mode: 0o755 });
      await writeFile(path.join(config.avatarRoot, file), output, {
        flag: "wx",
        mode: 0o644,
      });
      await chmod(path.join(config.avatarRoot,file),0o644);
    }
    await writeFile(path.join(root, file), output, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(root, id + ".json"), JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
    return { id, purpose, url: metadata.url };
  }
  async function resolve(actor, id, purpose) {
    const meta = await get(id);
    if (
      meta.ownerId !== Number(actor.id) ||
      meta.purpose !== purpose ||
      Date.now() - meta.createdAt > 24 * 60 * 60 * 1000
    )
      throw failure("Importer à nouveau les fichiers de cette inscription.");
    return { id, url: meta.url };
  }
  return { save, resolve, get, root };
}

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { deny } from "./staff-access.js";
export function createCommunicationAssets(config) {
  const root = path.resolve(config.stateDir, "communication-assets");
  function filename(actorId, id) {
    if (
      typeof id !== "string" ||
      !new RegExp("^" + Number(actorId) + "-[a-f0-9-]{36}$").test(id)
    )
      throw deny("Image non autorisée.", 403);
    return path.join(root, id + ".jpg");
  }
  return {
    async save(actor, body) {
      if (actor.role !== "Admin") throw deny();
      if (
        !Buffer.isBuffer(body) ||
        !body.length ||
        body.length > 6 * 1024 * 1024
      )
        throw deny("Image JPEG, PNG ou WebP de 6 Mo maximum requise.", 400);
      let image;
      try {
        const decoder = sharp(body, {
          limitInputPixels: 25000000,
          animated: false,
        });
        const meta = await decoder.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format))
          throw Error("format");
        image = await decoder
          .rotate()
          .resize({
            width: 1400,
            height: 1400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toBuffer();
        if (image.length > 2 * 1024 * 1024) throw Error("size");
      } catch {
        throw deny("Image invalide ou trop grande.", 400);
      }
      await mkdir(root, { recursive: true, mode: 0o700 });
      const uuid = crypto.randomUUID(),
        id = Number(actor.id) + "-" + uuid;
      await writeFile(filename(actor.id, id), image, {
        flag: "wx",
        mode: 0o600,
      });
      return {
        id,
        cid: "cid:cashpay-" + uuid,
        preview: "data:image/jpeg;base64," + image.toString("base64"),
      };
    },
    async attachments(actorId, ids) {
      const files = [];
      for (const id of ids) {
        const content = await readFile(filename(actorId, id));
        files.push({
          filename: "cashpay-image.jpg",
          content,
          cid: "cashpay-" + id.slice(String(actorId).length + 1),
          contentType: "image/jpeg",
        });
      }
      return files;
    },
  };
}

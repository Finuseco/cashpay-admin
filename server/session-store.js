import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const sign = (text, secret) =>
  crypto
    .createHmac("sha256", secret)
    .update("cashpay-admin-sessions-v1\n" + text)
    .digest("hex");
/** Persists session identifiers and deadlines only: never OTPs, PINs, JWTs or SMTP credentials. */
export class SessionStore {
  constructor({ file = null, secret, clock = Date.now } = {}) {
    this.file = file;
    this.secret = secret;
    this.clock = clock;
    this.entries = new Map();
    this.pending = Promise.resolve();
  }
  async load() {
    if (!this.file) return this;
    try {
      const wrapper = JSON.parse(await readFile(this.file, "utf8"));
      const expected = sign(wrapper.payload, this.secret);
      if (
        typeof wrapper.signature !== "string" ||
        wrapper.signature.length !== expected.length ||
        !crypto.timingSafeEqual(
          Buffer.from(wrapper.signature),
          Buffer.from(expected),
        )
      )
        throw Error("Invalid signature");
      const records = JSON.parse(wrapper.payload);
      if (!Array.isArray(records) || records.length > 10000)
        throw Error("Invalid records");
      for (const [id, record] of records) {
        if (
          typeof id === "string" &&
          record &&
          Number.isSafeInteger(record.userId) &&
          record.userId > 0 &&
          Number.isFinite(record.expiresAt) &&
          Number.isFinite(record.idleUntil) &&
          record.expiresAt > this.clock() &&
          record.idleUntil > this.clock() &&
          record.method === "email-otp-pin"
        )
          this.entries.set(id, record);
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        console.warn("[sessions] Ancien état non valide, reconnexion requise.");
      this.entries.clear();
    }
    return this;
  }
  get(id) {
    const value = this.entries.get(id);
    if (
      !value ||
      value.expiresAt <= this.clock() ||
      value.idleUntil <= this.clock()
    ) {
      this.entries.delete(id);
      return null;
    }
    return value;
  }
  async save() {
    if (!this.file) return;
    const write = async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const payload = JSON.stringify(
        [...this.entries].filter(
          ([, record]) =>
            record.expiresAt > this.clock() && record.idleUntil > this.clock(),
        ),
      );
      const file = this.file + "." + crypto.randomUUID() + ".tmp";
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ payload, signature: sign(payload, this.secret) }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(file, this.file);
      } catch (error) {
        await unlink(file).catch(() => {});
        throw error;
      }
    };
    this.pending = this.pending.catch(() => {}).then(write);
    return this.pending;
  }
  async create(userId, absoluteMs, idleMs) {
    for (const [id] of this.entries) this.get(id);
    if (this.entries.size >= 10000) throw Error("Trop de sessions actives.");
    const id = crypto.randomUUID(),
      now = this.clock();
    const record = {
      userId: Number(userId),
      expiresAt: now + absoluteMs,
      idleUntil: now + idleMs,
      lastSavedAt: now,
      method: "email-otp-pin",
    };
    this.entries.set(id, record);
    try {
      await this.save();
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
    return { id, ...record };
  }
  async touch(id, idleMs) {
    const record = this.get(id);
    if (!record) return false;
    record.idleUntil = Math.min(record.expiresAt, this.clock() + idleMs);
    if (this.clock() - record.lastSavedAt >= 60000) {
      record.lastSavedAt = this.clock();
      await this.save();
    }
    return true;
  }
  async revokeUser(userId) {
    for (const [id, record] of this.entries)
      if (record.userId === Number(userId)) this.entries.delete(id);
    await this.save();
  }
  async revoke(id) {
    this.entries.delete(id);
    await this.save();
  }
}

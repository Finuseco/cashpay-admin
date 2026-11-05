import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export function registrationProxy(source) {
  // Mask comments and quoted strings while retaining offsets for brace matching.
  let mask = "",
    quote = null,
    comment = false,
    escaped = false;
  for (const character of source) {
    if (comment) {
      mask += character === "\n" ? "\n" : " ";
      if (character === "\n") comment = false;
      continue;
    }
    if (quote) {
      mask += character === "\n" ? "\n" : " ";
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "#") {
      comment = true;
      mask += " ";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      mask += " ";
      continue;
    }
    mask += character;
  }
  const candidates = [];
  for (const match of mask.matchAll(/\bserver\s*\{/g)) {
    let level = 1,
      end = match.index + match[0].length;
    for (; end < mask.length && level; end++) {
      if (mask[end] === "{") level++;
      if (mask[end] === "}") level--;
    }
    if (level) throw Error("Bloc Nginx incomplet.");
    const body = mask.slice(match.index, end);
    if (
      /server_name\s+admin\.cashpay-all\.com\s*;/.test(body) &&
      /proxy_pass\s+http:\/\/127\.0\.0\.1:8010\s*;/.test(body)
    )
      candidates.push({ start: match.index, end });
  }
  if (candidates.length !== 1)
    throw Error("Un seul bloc admin sur le port 8010 doit être identifié.");
  const { start, end } = candidates[0];
  let block = source.slice(start, end);
  const maskedBlock = mask.slice(start, end),
    edits = [],
    additions = [];
  for (const [name, value] of [
    ["client_max_body_size", "8m"],
    ["proxy_read_timeout", "90s"],
  ]) {
    const matches = [
      ...maskedBlock.matchAll(new RegExp("\\b" + name + "\\s+[^;]+;", "g")),
    ];
    if (!matches.length) additions.push("    " + name + " " + value + ";");
    else
      for (const match of matches)
        edits.push({
          start: match.index,
          end: match.index + match[0].length,
          text: name + " " + value + ";",
        });
  }
  if (additions.length) {
    const index = block.indexOf("{") + 1;
    edits.push({ start: index, end: index, text: "\n" + additions.join("\n") });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    block = block.slice(0, edit.start) + edit.text + block.slice(edit.end);
  return source.slice(0, start) + block + source.slice(end);
}
async function configure(file) {
  if (!file) throw Error("Indiquer le fichier Nginx admin existant.");
  const target = await fs.realpath(file);
  const source = await fs.readFile(target, "utf8");
  const updated = registrationProxy(source);
  if (updated === source) {
    console.log("Limites proxy déjà configurées.");
    return;
  }
  const privateDir = path.resolve(".runtime", "nginx-backups");
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(privateDir, randomUUID() + ".conf"), source, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    await fs.writeFile(target, updated);
    execFileSync("nginx", ["-t"], { stdio: "inherit" });
    execFileSync("systemctl", ["reload", "nginx"], { stdio: "inherit" });
  } catch (error) {
    await fs.writeFile(target, source);
    throw error;
  }
  console.log(
    "Proxy admin ajusté : fichiers 8 Mo et attente 90 secondes. Autres blocs conservés.",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  configure(process.argv[2]).catch(() => {
    console.error(
      "Configuration proxy non appliquée. Vérifier le bloc admin 8010 et les droits ; en cas d’échec après écriture, le contenu initial est restauré.",
    );
    process.exitCode = 1;
  });

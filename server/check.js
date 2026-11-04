import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const files = [
  ...(await readdir(new URL("./", import.meta.url)))
    .filter((f) => f.endsWith(".js"))
    .map((f) => "server/" + f),
  ...(await readdir(new URL("../public/", import.meta.url)))
    .filter((f) => f.endsWith(".js"))
    .map((f) => "public/" + f),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(1);
  }
}
for (const file of ["src/backoffice/index.html", "src/backoffice/login.html"]) {
  const html = await readFile(file, "utf8");
  if (
    !html.includes("assets/css/style.css") ||
    /Henry Klein|Gold Member|Buy Now/.test(html)
  )
    throw Error("Template active invalide : " + file);
}
console.log("Syntaxe JavaScript et pages actives vérifiées.");

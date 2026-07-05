// Copies the built in-browser demo from the extension project into public/demo/.
// Run after `npm run build` in the extension repo.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const ext = "D:/Ai/work together/WebCode Sonification Engine";

mkdirSync(join(site, "public", "demo"), { recursive: true });
copyFileSync(join(ext, "demo", "demo.js"), join(site, "public", "demo", "demo.js"));

// Reuse the demo page, adding a back-link to the product site.
let html = readFileSync(join(ext, "demo", "demo.html"), "utf8");
html = html.replace(
  "<header>",
  '<header>\n    <p style="margin-bottom:10px"><a href="/" style="color:#7dd3fc;font-size:13px;text-decoration:none">← wse.evemisstechnology.com</a></p>'
);
writeFileSync(join(site, "public", "demo", "index.html"), html);

// Icons for favicon/og.
mkdirSync(join(site, "public", "assets"), { recursive: true });
for (const f of ["icon128.png", "icon48.png", "icon16.png"]) {
  copyFileSync(join(ext, "icons", f), join(site, "public", "assets", f));
}
console.log("demo + icons synced into public/");

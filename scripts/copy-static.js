// Копирует статические файлы рендерера (html, css) в dist/renderer
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "renderer");
const dest = path.join(__dirname, "..", "dist", "renderer");
fs.mkdirSync(dest, { recursive: true });

for (const file of fs.readdirSync(src)) {
  if (file.endsWith(".html") || file.endsWith(".css")) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

// Копирует статические файлы рендерера (html, css) в dist/renderer и иконку окна в dist
const fs = require("fs");
const path = require("path");

const build = path.join(__dirname, "..", "build");
fs.copyFileSync(path.join(build, "icon.png"), path.join(__dirname, "..", "dist", "icon.png"));

const src = path.join(__dirname, "..", "src", "renderer");
const dest = path.join(__dirname, "..", "dist", "renderer");
fs.mkdirSync(dest, { recursive: true });
// Иконка вкладки для веб-версии
fs.copyFileSync(path.join(build, "icon.ico"), path.join(dest, "favicon.ico"));

for (const file of fs.readdirSync(src)) {
  if (file.endsWith(".html") || file.endsWith(".css")) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

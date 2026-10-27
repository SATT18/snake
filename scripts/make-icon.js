// Растеризует build/icon.svg в build/icon.png (1024, нужен для macOS) и build/icon.ico (16–256) средствами Electron,
// без сторонних графических библиотек. Запуск: npm run icon
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SOURCE = 1024;

/** ICO-файл с PNG-изображениями внутри (поддерживается Windows Vista и новее). */
function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // зарезервировано
  header.writeUInt16LE(1, 2); // тип: иконка
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // 0 означает 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); // цветовые плоскости
    dir.writeUInt16LE(32, o + 6); // бит на пиксель
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((img) => img.png)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, "icon.svg"));
  const win = new BrowserWindow({
    width: SOURCE,
    height: SOURCE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${svg.toString("base64")}" width="${SOURCE}" height="${SOURCE}">
  </body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 300)); // даём отрисоваться

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SOURCE, height: SOURCE });
  const full = image.resize({ width: SOURCE, height: SOURCE, quality: "best" });
  fs.writeFileSync(path.join(BUILD, "icon.png"), full.toPNG());

  const images = ICO_SIZES.map((size) => ({ size, png: full.resize({ width: size, height: size, quality: "best" }).toPNG() }));
  fs.writeFileSync(path.join(BUILD, "icon.ico"), toIco(images));

  console.log(`icon.png ${SOURCE}px, icon.ico ${ICO_SIZES.join("/")}px`);
  app.quit();
});

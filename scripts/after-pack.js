// Встраивает иконку и сведения о версии в Snake.exe.
// Штатно это делает electron-builder через пакет winCodeSign, но его архив содержит симлинки
// и не распаковывается на Windows без прав администратора / режима разработчика —
// поэтому signAndEditExecutable выключен, а иконку ставим сами через rcedit.
const path = require("path");
const rcedit = require("rcedit");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const { productFilename, version, productName } = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    "file-version": version,
    "product-version": version,
    "version-string": {
      ProductName: productName,
      FileDescription: "Змейка 3D",
      CompanyName: "SATT18",
      LegalCopyright: "© SATT18",
      OriginalFilename: `${productFilename}.exe`,
    },
  });
  console.log(`  • icon embedded  file=${exe}`);
};

import { app, BrowserWindow, Menu } from "electron";
import * as path from "path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    useContentSize: true,
    resizable: false,
    title: "Snake",
    backgroundColor: "#7cc8ff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

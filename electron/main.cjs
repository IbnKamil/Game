const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/** Dev mode only when explicitly requested (desktop:dev). Packaged or `npm run desktop` loads dist/. */
const isDev = process.env.ELECTRON_DEV === '1';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Antiyoy Barracks',
    backgroundColor: '#143542',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    win.loadURL(url);
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) {
      console.error(`Missing ${indexHtml}. Run "npm run build" first.`);
      app.quit();
      return;
    }
    win.loadFile(indexHtml);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

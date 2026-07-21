const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/** Dev mode only when explicitly requested (desktop:dev). Packaged or `npm run desktop` loads dist/. */
const isDev = process.env.ELECTRON_DEV === '1' || process.env.ELECTRON_DEV === 'true';

function showError(title, detail) {
  console.error(title, detail);
  try {
    dialog.showErrorBox(title, String(detail));
  } catch {
    // ignore if dialog unavailable
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Antiyoy Barracks',
    backgroundColor: '#143542',
    show: true,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.focus();

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    showError('Не удалось открыть игру', `Код ${code}: ${desc}\n${url}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    win.loadURL(url).catch((err) => showError('Ошибка загрузки Vite', err));
    return;
  }

  const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    showError(
      'Нет сборки игры',
      `Не найден файл:\n${indexHtml}\n\nСначала выполните:\nnpm run build`,
    );
    app.quit();
    return;
  }

  win.loadFile(indexHtml).catch((err) => showError('Ошибка открытия dist/index.html', err));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  showError('Сбой Electron', err?.stack || err);
});

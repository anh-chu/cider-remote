const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // ALLOW MIXED CONTENT (HTTP localhost from HTTPS context if applicable)
        },
        autoHideMenuBar: true,
        frame: false, // Enable custom frame for dragging support
        titleBarStyle: 'hiddenInset', // Works with frame: false
        titleBarOverlay: {
            color: '#171717',
            symbolColor: '#ffffff'
        }
    });

    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;

    mainWindow.loadURL(startUrl);

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking-for-update');
});

autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('update-available', info);
});

autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus('update-not-available', info);
});

autoUpdater.on('error', (err) => {
    sendUpdateStatus('error', { message: err.message });
});

autoUpdater.on('download-progress', (progressObj) => {
    sendUpdateStatus('download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('update-downloaded', info);
});

// Helper function to send update status to renderer
function sendUpdateStatus(event, data = null) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-status', { event, data });
    }
}

// IPC handlers for update actions
ipcMain.on('check-for-updates', () => {
    if (!app.isPackaged) {
        sendUpdateStatus('error', { message: 'Updates only work in production build' });
        return;
    }
    autoUpdater.checkForUpdates();
});

ipcMain.on('download-update', () => {
    autoUpdater.downloadUpdate();
});

ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

app.on('ready', () => {
    createWindow();

    // Check for updates on startup (only in production)
    if (app.isPackaged) {
        setTimeout(() => {
            autoUpdater.checkForUpdates();
        }, 3000);
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

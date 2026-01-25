const { app, BrowserWindow, shell, ipcMain, Menu, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let tray;
let isQuitting = false;

// Ensure only one instance of the app runs at a time
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });
}

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function createTray() {
    // Create tray with app icon
    let iconPath = path.join(__dirname, 'assets/icon.ico');
    const fs = require('fs');

    const { nativeImage } = require('electron');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: 'Hide',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    // Show window when clicking tray icon (toggle behavior)
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'assets/icon.ico'),
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

    // Handle window close - hide to tray instead of closing
    mainWindow.on('close', function (event) {
        if (isQuitting) {
            // Allow closing if app is quitting
            mainWindow = null;
        } else {
            // Prevent default close and hide window instead
            event.preventDefault();
            mainWindow.hide();
        }
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

// Window control handlers
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        mainWindow.hide();
    }
});

app.on('ready', () => {
    isQuitting = false;
    createWindow();
    createTray();

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

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

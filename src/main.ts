import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { getCulture, ICulture } from './utils/CultureUtils';

const contextMenu = require('electron-context-menu');
const storage = require('electron-json-storage');

const appStorageField = 'SmartERP';

// Current culture
let culture: ICulture | null;

// Context menu dispose function
let contextMenuDispose: Function | null;

// Current start Url or router Url
let currentStartUrl: string | null | undefined;

// Initialization
function init() {
    // Update culture
    updateCulture(app.getLocale());
}

function updateCulture(locale: string) {
    const newCulture = getCulture(locale);
    if (culture && culture.id === newCulture.id) return;

    culture = newCulture;

    // Context menu, may dispose first and then recreate
    if (contextMenuDispose) contextMenuDispose();
    contextMenuDispose = contextMenu({
        showSearchWithGoogle: false,
        spellcheck: false,
        labels: culture.labels
    });
}

// Get app file
function getAppFile(name: string) {
    return require('url').format({
        protocol: 'file',
        slashes: true,
        pathname: path.join(__dirname, `./../public/${name}/index.html`)
    });
}

// Create main window
function createWindow() {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        icon: path.join(__dirname, '../public/favicon.ico'),
        show: false,
        title: culture?.labels.appName,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // and load the index.html of the app.
    // mainWindow.loadFile(path.join(__dirname, "../index.html"));
    const startApp = storage.getSync(appStorageField)?.name ?? 'core';
    mainWindow.loadURL(getAppFile(startApp));

    // Maximize window
    mainWindow.maximize();
    mainWindow.show();

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
}

// IPC messages
ipcMain.on('command', (event, name, param1, param2) => {
    if (name === 'changeCulture') {
        updateCulture(param1);
        return;
    }

    if (name === 'exit') {
        // exit() vs quit()
        app.quit();
        return;
    }

    if (name === 'getStartUrl') {
        // sendSync
        event.returnValue = currentStartUrl;
        return;
    }

    if (name === 'loadApp') {
        currentStartUrl = param2;

        const url = getAppFile(param1);
        const win = BrowserWindow.getFocusedWindow();
        win?.loadURL(url);

        storage.set(appStorageField, { name: param1 });

        return;
    }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    init();

    createWindow();

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

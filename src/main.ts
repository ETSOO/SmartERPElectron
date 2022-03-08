import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as storage from 'electron-json-storage';
import * as semver from 'semver';
import { getCulture, ICulture } from './utils/CultureUtils';
import StreamZip from 'node-stream-zip';
import { ISettings, IVerions, VersionName } from './Entities';

const contextMenu = require('electron-context-menu');

// launching multiple times during install or update
// https://www.electronforge.io/config/makers/squirrel.windows
if (require('electron-squirrel-startup')) app.quit();

// Auto update
// https://github.com/electron/update-electron-app
require('update-electron-app')({
    updateInterval: '2 hours'
});

const appStorageField = 'SmartERP';

// Current culture
let culture: ICulture | null;

// Context menu dispose function
let contextMenuDispose: Function | null;

// Current start Url or router Url
let currentStartUrl: string | null | undefined;

// Current settings
let settings: ISettings;

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
    return path.join(__dirname, `.\\..\\apps\\${name}\\index.html`);
}

// Load app
function loadApp(name: VersionName, win: BrowserWindow) {
    // App file
    const appFile = getAppFile(name);

    // Check the file
    if (!fs.existsSync(appFile)) {
        // Load the preloader
        win.loadFile(path.join(__dirname, '../public/preloader.htm'), {
            search: `title=${encodeURIComponent(
                culture?.labels.loading ?? 'Loading...'
            )}`
        });

        // Load the versions
        loadVersions(win, (versions) => {
            const version = versions[name];
            if (version == null) {
                dialog.showMessageBox(win, {
                    type: 'error',
                    title: 'Version Name',
                    message: `No app ${name} version defined`
                });
                return;
            }

            // Download the app
            autoUpgradeApp(
                win,
                name,
                (version) => loadAppBase(name, win, appFile, version),
                true,
                version
            );
        });
    } else {
        loadAppBase(name, win, appFile);

        // Auto upgrade
        autoUpgrade(win);
    }
}

// Load app base
function loadAppBase(
    name: VersionName,
    win: BrowserWindow,
    appFile: string,
    version?: string
) {
    win.loadFile(appFile);

    settings.current = name;
    settings.apps ??= {};
    if (version) settings.apps[name] = version;
    persistSettings(win);
}

// Persist settings
function persistSettings(win: BrowserWindow) {
    storage.set(appStorageField, settings, (error) => {
        if (error) {
            dialog.showMessageBox(win, {
                type: 'error',
                title: 'Storage Set',
                message: error
            });
        }
    });
}

// Load versions
function loadVersions(
    win: BrowserWindow,
    callback: (versions: IVerions) => void,
    errorHandling: boolean = true
) {
    // Get the version JSON file
    const request = https.get(
        `https://cn.etsoo.com/apps/versions.json`,
        function (res) {
            let body = '';

            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                try {
                    const versions = JSON.parse(body) as IVerions;
                    callback(versions);
                } catch (error) {
                    dialog.showMessageBox(win, {
                        type: 'error',
                        title: 'Versions JSON Parse',
                        message: `${error}`
                    });
                }
            });
        }
    );

    // Error handler
    request.on('error', function (err) {
        if (errorHandling) {
            dialog.showMessageBox(win, {
                type: 'error',
                title: 'Request Versions Error',
                message: err.message
            });
        }
    });
}

// Create main window
function createWindow() {
    // Settings
    settings = storage.getSync(appStorageField) as ISettings;

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
    const startApp = settings.current ?? 'core';
    loadApp(startApp, mainWindow);

    // Maximize window
    mainWindow.maximize();
    mainWindow.show();

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
}

// Auto upgrade
function autoUpgrade(win: BrowserWindow) {
    const apps = settings.apps;
    if (apps == null) return;

    loadVersions(
        win,
        (versions) => {
            let k: keyof IVerions;
            for (k in apps) {
                const currentVersion = apps[k];
                const newVersion = versions[k];
                if (
                    currentVersion == null ||
                    semver.gt(newVersion, currentVersion)
                ) {
                    autoUpgradeApp(
                        win,
                        k,
                        (version) => {
                            // Update version
                            apps[k] = version;
                            persistSettings(win);

                            // Notice
                            win.webContents.send('main-message', 'update', [
                                k,
                                version
                            ]);
                        },
                        false,
                        newVersion
                    );
                }
            }
        },
        false
    );
}

// Auto upgrade app
function autoUpgradeApp(
    win: BrowserWindow,
    app: VersionName,
    callback: (version: string) => void,
    loading: boolean = false,
    version: string
) {
    // Download the app
    const filePath = path.join(__dirname, `.\\..\\apps\\${app}.zip`);
    const appPath = path.join(
        __dirname,
        `.\\..\\apps\\${app + (loading ? '' : `-${version}`)}`
    );

    const file = fs.createWriteStream(filePath, { autoClose: true });
    file.on('finish', () => {
        // Extract
        const zip = new StreamZip({ file: filePath });
        zip.on('error', (err) => {
            if (loading) {
                dialog.showMessageBox(win, {
                    type: 'error',
                    title: 'Unzip Error',
                    message: `${err}`
                });
            }
        });
        zip.on('ready', () => {
            // Remove all content
            fs.rmSync(appPath, { recursive: true, force: true });

            // Create the directory
            fs.mkdirSync(appPath);

            // Extract
            zip.extract(null, appPath, (err) => {
                // Close
                zip.close();

                // Delete the zip file
                fs.rm(filePath, () => {
                    // Next step
                    if (err == null) {
                        callback(version);
                    } else {
                        // Delete the app path
                        fs.rmSync(appPath, { recursive: true, force: true });

                        if (loading) {
                            dialog.showMessageBox(win, {
                                type: 'error',
                                title: 'Extract App',
                                message: err
                            });
                        }
                    }
                });
            });
        });
    });

    // Get the zip file
    const request = https.get(
        `https://cn.etsoo.com/apps/${app}${version}.zip`,
        function (response) {
            // Save to file
            response.pipe(file);
        }
    );

    // Error handler
    request.on('error', function (err) {
        if (loading) {
            dialog.showMessageBox(win, {
                type: 'error',
                title: 'Request Error',
                message: err.message
            });
        }
    });
}

// IPC messages
ipcMain.on('command', (event, name, param1, param2, ...args) => {
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

        const win = BrowserWindow.getFocusedWindow();
        if (win != null) {
            loadApp(param1, win);
        }

        return;
    }
});

ipcMain.on('command-async', async (event, name, ...args) => {
    if (name === 'getLabels') {
        const init: Record<string, string> = {};
        const result = args.reduce(
            (a, v) => ({
                ...a,
                [v]: culture?.labels[v] ?? ''
            }),
            init
        );
        return Promise.resolve(result);
    }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    // Init
    init();

    // Create main window
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

// Emitted when all windows have been closed and the application will quit
app.on('will-quit', () => {
    // Check any updates are ready
    const apps = settings.apps;
    if (apps == null) return;

    let k: keyof IVerions;
    for (k in apps) {
        // Version
        const currentVersion = apps[k];
        if (currentVersion == null) continue;

        // App path
        const appPath = path.join(__dirname, `.\\..\\apps\\${k}`);

        const appUpgradePath = path.join(
            __dirname,
            `.\\..\\apps\\${k}-${currentVersion}`
        );

        if (fs.existsSync(appUpgradePath)) {
            // Remove current files
            fs.rmSync(appPath, { recursive: true, force: true });

            // Rename
            fs.renameSync(appUpgradePath, appPath);
        }
    }
});

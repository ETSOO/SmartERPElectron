import {
    app,
    BrowserView,
    BrowserWindow,
    dialog,
    globalShortcut,
    ipcMain
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as storage from 'electron-json-storage';
import { cultures, getCulture, ICulture } from './utils/CultureUtils';
import StreamZip from 'node-stream-zip';
import semver from 'semver';
import { ISettings, IVersions, VersionName } from './Entities';
import ContextMenu from 'electron-context-menu';

// launching multiple times during install or update
// https://www.electronforge.io/config/makers/squirrel.windows
if (require('electron-squirrel-startup')) app.quit();

// Logger
import log from 'electron-log';
log.transports.file.resolvePath = () => __dirname + '/SmartERP.log';

// Auto update
// https://github.com/electron/update-electron-app
require('update-electron-app')({
    updateInterval: '2 hours'
});

const appStorageField = 'SmartERP';
const coreApp = 'core';

// Current culture
let culture: ICulture = cultures[0];

// Current start Url or router Url
let currentStartUrl: string | null | undefined;

// Current settings
let settings: ISettings;

// Main window
let mainWindow: BrowserWindow;

// Browser views
// https://blog.51cto.com/u_15495832/5067293
const views: Record<VersionName, [number, Function] | undefined> = {};

// Initialization
function init() {
    // Update culture
    updateCulture(app.getLocale());
}

function updateCulture(locale: string) {
    const newCulture = getCulture(locale);
    if (culture.id === newCulture.id) return;

    culture = newCulture;

    // Context menu, may dispose first and then recreate
    /*
    const appViews = views[coreApp];
    if (appViews) {
        const [viewId, contextMenuDispose] = appViews;
        const view = getView(viewId);
        if (view) {
            if (contextMenuDispose) contextMenuDispose();
            createContextMenu(view);
        }
    }
    */
}

function createContextMenu(view: BrowserView) {
    return ContextMenu({
        window: view,
        showSearchWithGoogle: false,
        showLearnSpelling: false,
        labels: culture.labels
    });
}

// Get app file
function getAppFile(name: VersionName) {
    /*
    // Debug
    let port: number;
    switch (name) {
        case 's7':
            port = 3007;
            break;
        case 's2':
            port = 3004;
            break;
        default:
            port = 3003;
    }
    return `http://localhost:${port}`;
    */

    return path.join(__dirname, `.\\..\\apps\\${name}\\index.html`);
}

const tabsHeight = 36;
function setViewSize(view: BrowserView, size: number[]) {
    view.setBounds({
        x: 0,
        y: tabsHeight,
        width: size[0],
        height: size[1] - tabsHeight
    });
}

function getView(name: VersionName | number) {
    const viewId = typeof name === 'number' ? name : (views[name] ?? [])[0];
    if (viewId == null) return undefined;
    return mainWindow
        .getBrowserViews()
        .find((view) => view.webContents.id === viewId);
}

function setActiveTab(view: BrowserView, name?: VersionName) {
    mainWindow.setTopBrowserView(view);

    // Tabs UI
    if (name) mainWindow.webContents.send('main-message-active-tab', name);
}

function createView(name: VersionName) {
    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            webSecurity: true,
            additionalArguments: [`app=${name}`],
            preload: path.join(__dirname, 'appPreload.js') // Client identifier 'electron' setup
        }
    });
    view.setAutoResize({ width: true, height: true });
    setViewSize(view, mainWindow.getContentSize());
    mainWindow.addBrowserView(view);
    return view;
}

// Load app
function loadApp(name: VersionName, currentView?: VersionName) {
    // App file
    const appFile = getAppFile(name);

    // Log info
    log.info('loadApp', name, currentView, appFile);

    // View
    let view: BrowserView | undefined = undefined;
    if (currentView) {
        view = getView(currentView);
    }

    if (view == null) {
        // Current view
        const viewFound = getView(name);
        if (viewFound) {
            // Save reference
            view = viewFound;

            if (settings.current !== name) {
                // Bring to top
                setActiveTab(view, name);

                // Current
                settings.current = name;
                persistSettings();
            }
        } else {
            // New view
            view = createView(name);

            // Context menu
            const cd = createContextMenu(view);

            // Hold reference
            views[name] = [view.webContents.id, cd];

            // Tabs UI
            const label = culture.labels.tabLoading ?? '...';
            mainWindow.webContents.send('main-message-new-tab', name, label);
        }
    }

    // Check the file
    if (!appFile.includes('://') && !fs.existsSync(appFile)) {
        // Load the preloader
        view.webContents.loadFile(
            path.join(__dirname, '../public/preloader.htm'),
            {
                search: `title=${encodeURIComponent(
                    culture.labels.loading ?? 'Loading...'
                )}`
            }
        );

        const labels = culture.labels;

        // Load the versions
        loadVersions((versions) => {
            const version = versions ? versions[name] : null;
            if (version == null) {
                dialog
                    .showMessageBox(mainWindow, {
                        type: 'error',
                        title: labels.versionErrorTitle,
                        message: labels.versionErrorMessage
                    })
                    .then(() => quitView(name, view!));

                log.info(`Failed to load version data when load app ${name}`);

                return;
            }

            // Download app
            upgradeApp(name, version, (versionOrError) => {
                if (typeof versionOrError === 'string') {
                    loadAppBase(name, view!, appFile, versionOrError);
                } else {
                    const [error, source] = versionOrError;
                    log.error('upgradeApp', source, error);
                    dialog
                        .showMessageBox(mainWindow, {
                            type: 'error',
                            title: labels.versionErrorTitle,
                            message: labels.versionErrorMessage
                        })
                        .then(() => quitView(name, view!));
                }
            });
        });
    } else {
        loadAppBase(name, view, appFile);
    }
}

// Load app base
function loadAppBase(
    name: VersionName,
    view: BrowserView,
    appFile: string,
    version?: string
) {
    if (appFile.includes('://')) view.webContents.loadURL(appFile);
    else view.webContents.loadFile(appFile);

    if (settings.loadedApps == null) settings.loadedApps = [];
    if (!settings.loadedApps.includes(name)) settings.loadedApps.push(name);

    settings.current = name;
    settings.apps ??= {};

    if (version) settings.apps[name] = version;
    else if (settings.apps[name] == null && versions != null)
        settings.apps[name] = versions[name];

    persistSettings();

    log.info(`App ${name} is ready`, settings);
}

// Persist settings
function persistSettings() {
    storage.set(appStorageField, settings, (error) => {
        if (error) {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Storage Set',
                message: error
            });
        }
    });
}

let versions: IVersions | undefined;
const updatedApps: VersionName[] = [];

// Load versions
function loadVersions(callback: (versions: IVersions | undefined) => void) {
    if (versions) {
        callback(versions);
        return;
    }

    // Get the version JSON file
    const request = https.get(
        `https://cn.etsoo.com/apps/versions.json`,
        {
            timeout: 10000 //  10 seconds
        },
        function (res) {
            let body = '';

            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                try {
                    versions = JSON.parse(body) as IVersions;
                    log.info('Versions loaded', versions);
                    callback(versions);
                } catch (error) {
                    log.error('Versions JSON Parse', error);
                    callback(undefined);
                }
            });
        }
    );

    request.on('error', function (err) {
        log.error('Versions https.get', err);
        callback(undefined);
    });
}

function getCurrentView() {
    return settings.current
        ? getView(settings.current) ?? mainWindow
        : mainWindow;
}

// Create main window
function createWindow() {
    // Labels
    const labels = culture.labels;

    // Settings
    settings = storage.getSync(appStorageField) as ISettings;

    log.info('Application starts with settings', settings);

    // Create the browser window.
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, '../public/favicon.ico'),
        show: false,
        title: labels.appName,

        //frame: false,
        autoHideMenuBar: true,
        webPreferences: {
            // nodeIntegration: true,
            // webviewTag: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

    // and load the index.html of the app.
    // mainWindow.loadFile(path.join(__dirname, "../index.html"));
    //const startApp = settings.current ?? 'core';
    //loadApp(startApp);
    const current = settings.current;
    let apps = settings.loadedApps ?? [];
    if (apps.length === 0) apps = [current ?? coreApp];

    // Load versions
    loadVersions((versions) => {
        // Connection check
        if (versions == null) {
            dialog
                .showMessageBox(mainWindow, {
                    type: 'error',
                    title: labels.versionErrorTitle,
                    message: labels.versionErrorMessage
                })
                .then(() => app.quit());
            return;
        }

        // Upgrade check
        const versionApps = settings.apps;
        if (versionApps) {
            for (const k in versionApps) {
                const currentVersion = versionApps[k];
                const targetVersion = versions[k];
                if (
                    targetVersion == null ||
                    (currentVersion != null &&
                        semver.lte(targetVersion, currentVersion))
                ) {
                    continue;
                }

                upgradeApp(k, targetVersion, (versionOrError) => {
                    if (Array.isArray(versionOrError)) {
                        const [error, source] = versionOrError;
                        log.error(
                            `App ${k} upgrade failed with ${source}`,
                            error
                        );
                    } else {
                        versionApps[k] = versionOrError;
                        persistSettings();

                        updatedApps.push(k);

                        log.info(`App ${k} upgraded to ${versionOrError}`);
                    }
                });
            }
        }

        // Load app
        apps.forEach((app) => loadApp(app));

        if (current) {
            const view = getView(current);
            if (view) {
                setActiveTab(view, current);
            }
        }
    });

    // Maximize window
    mainWindow.maximize();
    mainWindow.show();

    mainWindow.webContents.on('did-finish-load', function () {
        mainWindow.title = culture.labels.appName;
    });
}

function quitView(
    app: VersionName,
    view: BrowserView,
    triggerEvent: boolean = true
) {
    mainWindow.removeBrowserView(view);

    const apps = settings.loadedApps;
    if (apps) {
        const index = apps.indexOf(app);
        if (index !== -1) apps.splice(index, 1);
        persistSettings();
    }

    if (triggerEvent) {
        mainWindow.webContents.send('main-message-remove-tab', app);
    }
}

// Upgrade app
async function upgradeApp(
    appName: VersionName,
    version: string,
    callback: (versionOrError: string | [error: any, source: string]) => void
) {
    // Download the app
    const fileFolder = path.join(__dirname, `.\\..\\apps`);
    const filePath = path.join(fileFolder, `\\${appName}.zip`);

    // App temp path
    const versionPath = path.join(
        __dirname,
        `.\\..\\apps\\${appName}-${version}`
    );

    log.info('upgradeApp', 'Files', filePath, versionPath);

    // Create directory (apps may removed) and remove file
    if (!fs.existsSync(fileFolder)) {
        // Make directory, otherwise createWriteStream would failed
        fs.mkdirSync(fileFolder, { recursive: true });
    } else if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
    }

    const file = fs.createWriteStream(filePath, { autoClose: true });
    file.on('error', (err) => {
        log.error('fs.createWriteStream', err);
        callback([err, 'fs.createWriteStream']);
    });
    file.on('finish', () => {
        log.info(`${filePath} is finished`);

        // Extract
        const zip = new StreamZip({
            file: filePath,
            skipEntryNameValidation: true
        });
        zip.on('error', (err) => {
            log.error('StreamZip', err);
            callback([err, 'StreamZip']);
        });
        zip.on('ready', () => {
            log.info(`zip file is ready for ${versionPath}`);

            // Remove all content
            fs.rmSync(versionPath, { recursive: true, force: true });

            // Create the directory
            fs.mkdirSync(versionPath);

            // Extract
            zip.extract(null, versionPath, (err) => {
                // Delete the zip file
                fs.rmSync(filePath, { recursive: true, force: true });

                // Close
                zip.close((zipError) => {
                    if (zipError == null) {
                        if (err == null) {
                            // When not opened
                            if (getView(appName) == null) {
                                try {
                                    // Remove current folder
                                    const appPath = fileFolder + '\\' + appName;
                                    fs.rmSync(appPath, {
                                        recursive: true,
                                        force: true
                                    });

                                    fs.renameSync(versionPath, appPath);
                                } catch (e) {
                                    log.error('Rename upgrade foder', e);
                                }
                            }
                            callback(version);
                            return;
                        }
                    }

                    // Delete the app path
                    fs.rmSync(versionPath, { recursive: true, force: true });

                    log.error('StreamZip.extract', zipError, err);
                    callback([err, 'StreamZip.extract']);
                });
            });
        });
    });

    // Get the zip file
    var versionFile = `https://cn.etsoo.com/apps/${appName}.${version}.zip`;
    const request = https.get(
        versionFile,
        {
            timeout: 120000
        },
        function (response) {
            // Save to file
            response.pipe(file, { end: true });
        }
    );

    // Error handler
    request.on('error', function (err) {
        log.error('App https.get', err);
        callback([err, 'App https.get']);
    });
}

// IPC messages
ipcMain.on('command', (event, name, param1, param2, param3) => {
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
        const app = param1;
        currentStartUrl = param2;
        const currentApp = param3;

        if (
            app === coreApp &&
            currentStartUrl != null &&
            currentApp != null &&
            currentApp != coreApp
        ) {
            loadApp(app, currentApp);
        } else {
            loadApp(app);
        }

        return;
    }

    if (name === 'activeTab') {
        const view = getView(param1);
        if (view) {
            setActiveTab(view);
            settings.current = param1;
            persistSettings();
        }
        return;
    }

    if (name === 'removeTab') {
        // const win = BrowserWindow.getFocusedWindow();
        const view = getView(param1);
        if (view) {
            quitView(param1, view, false);
        }
        return;
    }

    if (name === 'title') {
        // app and title
        const app = param1;
        const title =
            app === coreApp ? culture.labels.mainApp ?? param2 : param2;
        mainWindow.webContents.send('main-message-title', app, title);
        return;
    }
});

ipcMain.on('command-async', async (event, name, ...args) => {
    if (name === 'getLabels') {
        const init: Record<string, string> = {};
        const result = args.reduce(
            (a, v) => ({
                ...a,
                [v]: culture.labels[v] ?? ''
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

    globalShortcut.register('CommandOrControl+F12', () => {
        // Add debug support
        const view = getCurrentView();

        if (view.webContents.isDevToolsOpened()) {
            view.webContents.closeDevTools();
        } else {
            view.webContents.openDevTools();
        }
    });

    globalShortcut.register('F5', async () => {
        const labels = culture.labels;
        const value = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: labels.confirm,
            buttons: [labels.cancel, labels.ok],
            message: labels.f5Tip
        });
        if (value.response === 1) {
            const view = getCurrentView();
            await view.webContents.session.clearCache();
            await view.webContents.session.clearStorageData();
            view.webContents.reload();
        }
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

    for (const k in updatedApps) {
        // Version
        const currentVersion = apps[k];
        if (currentVersion == null) continue;

        const appUpgradePath = path.join(
            __dirname,
            `.\\..\\apps\\${k}-${currentVersion}`
        );

        if (fs.existsSync(appUpgradePath)) {
            // App path
            const appPath = path.join(__dirname, `.\\..\\apps\\${k}`);

            // Remove current files
            fs.rmSync(appPath, { recursive: true, force: true });

            // Rename
            fs.renameSync(appUpgradePath, appPath);
        }
    }
});

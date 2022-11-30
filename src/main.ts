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
import * as semver from 'semver';
import { getCulture, ICulture } from './utils/CultureUtils';
import StreamZip from 'node-stream-zip';
import { ISettings, IVerions, VersionName } from './Entities';
import ContextMenu from 'electron-context-menu';

// launching multiple times during install or update
// https://www.electronforge.io/config/makers/squirrel.windows
if (require('electron-squirrel-startup')) app.quit();

// Auto update
// https://github.com/electron/update-electron-app
require('update-electron-app')({
    updateInterval: '2 hours'
});

const appStorageField = 'SmartERP';
const coreApp = 'core';

// Current culture
let culture: ICulture | null;

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
    if (culture && culture.id === newCulture.id) return;

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
        labels: (culture ?? {}).labels
    });
}

// Get app file
function getAppFile(name: string) {
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

// Load app
function loadApp(name: VersionName, currentView?: VersionName) {
    // App file
    const appFile = getAppFile(name);

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
            view = new BrowserView({
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

            // Context menu
            const cd = createContextMenu(view);

            // Hold reference
            views[name] = [view.webContents.id, cd];

            // Tabs UI
            mainWindow.webContents.send('main-message-new-tab', name);
        }
    }

    // Check the file
    if (!fs.existsSync(appFile)) {
        // Load the preloader
        view.webContents.loadFile(
            path.join(__dirname, '../public/preloader.htm'),
            {
                search: `title=${encodeURIComponent(
                    culture?.labels.loading ?? 'Loading...'
                )}`
            }
        );

        // Load the versions
        loadVersions((versions) => {
            const version = versions[name];
            if (version == null) {
                dialog
                    .showMessageBox(mainWindow, {
                        type: 'error',
                        title: 'Version Name',
                        message: `No app ${name} version defined`
                    })
                    .then(() => app.quit());
                return;
            }

            // Download the app
            autoUpgradeApp(
                name,
                (version) => loadAppBase(name, view!, appFile, version),
                true,
                version
            );
        });
    } else {
        loadAppBase(name, view, appFile);

        // Auto upgrade
        autoUpgrade();
    }
}

// Load app base
function loadAppBase(
    name: VersionName,
    view: BrowserView,
    appFile: string,
    version?: string
) {
    view.webContents.loadFile(appFile);

    if (settings.loadedApps == null) settings.loadedApps = [];
    if (!settings.loadedApps.includes(name)) settings.loadedApps.push(name);

    settings.current = name;
    settings.apps ??= {};
    if (version) settings.apps[name] = version;

    persistSettings();
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

// Load versions
function loadVersions(
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
                    dialog.showMessageBox(mainWindow, {
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
            const labels = culture?.labels!;
            dialog
                .showMessageBox(mainWindow, {
                    type: 'error',
                    title: labels.versionErrorTitle,
                    buttons: [labels.retry, labels.close],
                    message:
                        labels.versionErrorMessage.replace(
                            '{0}',
                            err.message
                        ) ?? err.message
                })
                .then((value) => {
                    if (value.response === 0) {
                        // Retry
                        loadVersions(callback, errorHandling);
                    } else {
                        app.quit();
                    }
                });
        }
    });
}

// Create main window
function createWindow() {
    // Settings
    settings = storage.getSync(appStorageField) as ISettings;

    // Create the browser window.
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, '../public/favicon.ico'),
        show: false,
        title: culture?.labels.appName,

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
    if (apps.length === 0) apps = [settings.current ?? coreApp];

    apps.forEach((app) => loadApp(app));

    if (current) {
        const view = getView(current);
        if (view) {
            setActiveTab(view, current);
        }
    }

    // Maximize window
    mainWindow.maximize();
    mainWindow.show();

    mainWindow.webContents.on('did-finish-load', function () {
        mainWindow.title = culture?.labels.appName!;
    });

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
}

// Auto upgrade
function autoUpgrade() {
    const apps = settings.apps;
    if (apps == null) return;

    loadVersions((versions) => {
        let k: keyof IVerions;
        for (k in apps) {
            const currentVersion = apps[k];
            const newVersion = versions[k];
            if (
                currentVersion == null ||
                semver.gt(newVersion, currentVersion)
            ) {
                autoUpgradeApp(
                    k,
                    (version) => {
                        // Update version
                        apps[k] = version;

                        // Notice
                        mainWindow.webContents.send(
                            'main-message-update',
                            k,
                            version
                        );
                    },
                    false,
                    newVersion
                );
            }
        }
    }, false);
}

// Auto upgrade app
function autoUpgradeApp(
    appName: VersionName,
    callback: (version: string) => void,
    loading: boolean = false,
    version: string
) {
    // Download the app
    const fileFolder = path.join(__dirname, `.\\..\\apps`);
    const filePath = path.join(fileFolder, `\\${appName}.zip`);
    const appPath = path.join(
        __dirname,
        `.\\..\\apps\\${appName + (loading ? '' : `-${version}`)}`
    );

    // Labels
    const labels = culture?.labels!;

    // Create directory (apps may removed) and remove file
    if (!fs.existsSync(fileFolder)) {
        // Make directory, otherwise createWriteStream would failed
        fs.mkdirSync(fileFolder, { recursive: true });
    } else if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
    }

    const file = fs.createWriteStream(filePath, { autoClose: true });
    file.on('finish', () => {
        // Extract
        const zip = new StreamZip({
            file: filePath,
            skipEntryNameValidation: true
        });
        zip.on('error', (err) => {
            console.log('zip', err);
            if (loading) {
                dialog
                    .showMessageBox(mainWindow, {
                        type: 'error',
                        title: labels.unzipError,
                        message: `${err} - (${labels.restartAppTip})`
                    })
                    .then(() => {
                        // Remove the zip file
                        fs.rmSync(filePath, { recursive: true, force: true });

                        app.quit();
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
                            dialog
                                .showMessageBox(mainWindow, {
                                    type: 'error',
                                    title: 'Extract App',
                                    message: err
                                })
                                .then(() => app.quit());
                        }
                    }
                });
            });
        });
    });

    // Get the zip file
    var versionFile = `https://cn.etsoo.com/apps/${appName}.${version}.zip`;
    const request = https.get(versionFile, function (response) {
        // Save to file
        response.pipe(file);
    });

    // Error handler
    request.on('error', function (err) {
        if (loading) {
            const labels = culture?.labels!;
            dialog
                .showMessageBox(mainWindow, {
                    type: 'error',
                    title: labels.downloadErrorTitle,
                    buttons: [labels.retry, labels.close],
                    message:
                        labels.downloadErrorMessage.replace(
                            '{0}',
                            err.message
                        ) ?? err.message
                })
                .then((value) => {
                    if (value.response === 0) {
                        // Retry
                        autoUpgradeApp(appName, callback, loading, version);
                    } else {
                        app.quit();
                    }
                });
        }
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
            mainWindow.removeBrowserView(view);
            const apps = settings.loadedApps;
            if (apps) {
                const index = apps.indexOf(param1);
                if (index !== -1) apps.splice(index, 1);
                persistSettings();
            }
        }
        return;
    }

    if (name === 'title') {
        // app and title
        const app = param1;
        const title =
            app === coreApp ? culture?.labels.mainApp ?? param2 : param2;
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

    globalShortcut.register('Alt+CommandOrControl+D', () => {
        // Add debug support
        const view = settings.current
            ? getView(settings.current) ?? mainWindow
            : mainWindow;
        view?.webContents.openDevTools();
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

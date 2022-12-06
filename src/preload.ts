// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from 'electron';

const host = {
    activeTab(app: string) {
        ipcRenderer.send('command', 'activeTab', app);
    },
    closeTab(app: string) {
        ipcRenderer.send('command', 'removeTab', app);
    },
    onActiveTab(func: (app: string) => void) {
        ipcRenderer.on('main-message-active-tab', (_event, app: string) =>
            func(app)
        );
    },
    onNewTab(func: (app: string, label: string) => void) {
        ipcRenderer.on(
            'main-message-new-tab',
            (_event, app: string, label: string) => func(app, label)
        );
    },
    onRemoveTab(func: (app: string) => void) {
        ipcRenderer.on('main-message-remove-tab', (_event, app: string) =>
            func(app)
        );
    },
    onTitleChange(func: (app: string, title: string) => void) {
        ipcRenderer.on(
            'main-message-title',
            (_event, app: string, title: string) => func(app, title)
        );
    }
};

contextBridge.exposeInMainWorld('electron', host);

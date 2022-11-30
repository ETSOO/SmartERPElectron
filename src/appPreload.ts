// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from 'electron';
import { IBridgeHost } from './utils/IBridgeHost';

// Passed with additionalArguments in main.ts
const app = process.argv.find((a) => a.startsWith('app='))?.substring(4);

const host: IBridgeHost = {
    changeCulture(locale: string) {
        ipcRenderer.send('command', 'changeCulture', locale);
    },
    closable() {
        return true;
    },
    exit() {
        ipcRenderer.send('command', 'exit');
    },
    async getLabels<T extends string>(...keys: T[]) {
        const result: Record<string, unknown> =
            (await ipcRenderer.invoke('command-async', 'getLabels', ...keys)) ??
            {};

        const init: any = {};
        return keys.reduce(
            (a, v) => ({
                ...a,
                [v]: result[v] ?? ''
            }),
            init
        );
    },
    getStartUrl() {
        const url = ipcRenderer.sendSync('command', 'getStartUrl');
        return url;
    },
    loadApp(name: string, startUrl?: string) {
        ipcRenderer.send('command', 'loadApp', name, startUrl, app);
    },
    userAuthorization(authorized: boolean) {
        console.log(authorized);
    },
    onUpdate(func: (app: string, version: string) => void) {
        ipcRenderer.on(
            'main-message-update',
            (_event, app: string, version: string) => func(app, version)
        );
    },
    setTitle(title: string) {
        ipcRenderer.send('command', 'title', app, title);
    }
};

contextBridge.exposeInMainWorld('electron', host);

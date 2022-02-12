// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from 'electron';
import { IBridgeHost } from './utils/IBridgeHost';

const host: IBridgeHost = {
    changeCulture: function (locale: string) {
        ipcRenderer.send('command', 'changeCulture', locale);
    },
    exit: function () {
        ipcRenderer.send('command', 'exit');
    },
    getStartUrl: function () {
        const url = ipcRenderer.sendSync('command', 'getStartUrl');
        return url;
    },
    loadApp: function (name: string, startUrl?: string) {
        ipcRenderer.send('command', 'loadApp', name, startUrl);
    }
};

contextBridge.exposeInMainWorld('electron', host);

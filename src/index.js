import {program} from "commander";

import {app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell} from "electron";

import fs from "fs";

import Store from "electron-store";

 // npm start
import * as javaProxy from "./proxy/java/proxy.js";

import * as bedrockProxy from "./proxy/bedrock/proxy.js";

import * as packetHandler from "./packetHandler.js";

import * as setupDataFolder from "./setupDataFolder.js";

import * as electronLocalShortcut from "electron-localshortcut";

import * as windowStateKeeper from "electron-window-state";

import * as unhandled from "electron-unhandled";

program
  .option('-a, --autostart', 'Automatically starts the program without the start window (all below options must be set)')
  .option('-e, --platform <platform>', 'Platform (accepted values: java, bedrock)')
  .option('-v, --version <version>', 'The version to use (not needed for Bedrock)')
  .option('-c, --connect <address>', 'The address of the server to connect to')
  .option('-p, --connect-port  <port>', 'The port of the server to connect to')
  .option('-P, --listen-port  <port>', 'The port to listen on')

program.parse(process.argv)
const options = program.opts()

if (options.autostart) {
    if (!options.platform || !(options.version || options.platform !== 'java') || !options.connect || !options.connectPort || !options.listenPort) {
        console.log('Not all required options were passed.')
        program.help()
    }
}


app.allowRendererProcessReuse = true
const store = new Store()

let proxy // Defined later when an option is chosen
const resourcesPath = fs.existsSync(process.resourcesPath.concat('/app/'))
  ? process.resourcesPath.concat('/app/') // Packaged with electron-forge
  : './'
const osDataFolder = app.getPath('appData')

const dataFolder = setupDataFolder.setup(osDataFolder, resourcesPath)

var currentScriptFile = null

function makeMenu(direction, text, id, invalid, noData) {
    if (direction !== 'clientbound' && direction !== 'serverbound') {
        // This probably isn't a packet
        return
    }

    const menuData = [
        {
            icon: resourcesPath + `icons/${direction + (invalid ? '-invalid' : '')}.png`,
            label: text,
            enabled: false
        },
        {
            type: 'separator'
        },
        {
            label: 'Edit and resend',
            click: () => {
                BrowserWindow.getAllWindows()[0].send('editAndResend', JSON.stringify({
                    id: id
                }))
            },
            visible: proxy.capabilities.modifyPackets
        },
        {
            label: 'Hide all packets of this type',
            click: () => {
                BrowserWindow.getAllWindows()[0].send('hideAllOfType', JSON.stringify({
                    // Packet ID from link URL
                    id: id
                }))
            }
        }
    ]

    if (!noData) {
        menuData.splice(2, 0,
          {
              label: proxy.capabilities.jsonData ? 'Copy JSON data' : 'Copy data',
              click: () => {
                  BrowserWindow.getAllWindows()[0].send('copyPacketData', JSON.stringify({
                      id: id
                  }))
              }
          }
        )
    }

    if (!noData && text.split(' ')[1] === 'position' && direction === 'clientbound') {
        menuData.splice(3, 0,
          {
              label: 'Copy teleport as command',
              click: () => {
                  BrowserWindow.getAllWindows()[0].send('copyTeleportCommand', JSON.stringify({
                      id: id
                  }))
              }
          }
        )
    }

    if (proxy.capabilities.rawData) {
        menuData.splice(3, 0,
          {
              label: 'Copy hex data',
              click: () => {
                  BrowserWindow.getAllWindows()[0].send('copyHexData', JSON.stringify({
                      id: id
                  }))
              }
          }
        )
    }

    return Menu.buildFromTemplate(menuData)
}

function createWindow() {
    // Let us register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state

    // Create the browser window.
    const win = new BrowserWindow({
        height: store.get('authConsentGiven') ? 550 : 650,
        width: 480,
        // resizable: false,
        // frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: resourcesPath + 'icons/icon.png'
    })

    win.setMenuBarVisibility(false)

    // Open the DevTools.
    // win.webContents.openDevTools()
    electronLocalShortcut.register(win, 'F12', () => {
        win.openDevTools()
    })

    win.webContents.setWindowOpenHandler(function(details) {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    win.setMenu(null)
    // and load the index.html of the app.
    if (options.autostart) {
        startProxy({
            // TODO: make online-mode working in headless via command-line parameters
            consent: false,
            onlineMode: false,
            connectAddress: options.connect,
            connectPort: options.connectPort,
            listenPort: options.listenPort,
            platform: options.platform,
            version: options.version
        })
    } else {
        win.loadFile('html/startPage/index.html')
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        if (proxy) {
            proxy.end()
        }
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

ipcMain.on('startProxy', (event, arg) => {
    const ipcMessage = JSON.parse(arg)
    startProxy(ipcMessage)
})

function showAuthCode (data) {
    const win = BrowserWindow.getAllWindows()[0]
    win.send('showAuthCode', JSON.stringify(data))
}

function startProxy (args) {
    if (args.platform === 'java') {
        proxy = javaProxy
    } else {
        proxy = bedrockProxy
    }

    const win = BrowserWindow.getAllWindows()[0]

    packetHandler.init(BrowserWindow.getAllWindows()[0], ipcMain, proxy)
    proxy.startProxy(args.connectAddress, args.connectPort, args.listenPort, args.version, args.onlineMode,
      args.consent, packetHandler.packetHandler, packetHandler.messageHandler , dataFolder, () => {
          win.send('updateFiltering', '')
      }, showAuthCode)

    win.loadFile('html/mainPage/index.html')

    // Load the previous state with fallback to defaults
    const mainWindowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800
    });

    win.setResizable(true)
    win.setPosition(mainWindowState.x, mainWindowState.y)
    win.setSize(mainWindowState.width, mainWindowState.height)

    mainWindowState.manage(win)
}

ipcMain.on('proxyCapabilities', (event, arg) => {
    event.returnValue = JSON.stringify(proxy.capabilities)
})

ipcMain.on('copyToClipboard', (event, arg) => {
    clipboard.writeText(arg)
})

ipcMain.on('contextMenu', (event, arg) => {
    const ipcMessage = JSON.parse(arg)
    makeMenu(ipcMessage.direction, ipcMessage.text, ipcMessage.id, ipcMessage.invalid, ipcMessage.noData).popup(BrowserWindow.getAllWindows()[0])
})

ipcMain.on('relaunchApp', (event, arg) => {
    app.relaunch()
    app.exit()
})

ipcMain.on('saveLog', async (event, arg) => {
    const win = BrowserWindow.getAllWindows()[0]

    const result = await dialog.showSaveDialog(win, {
        filters: [
            { name: 'pakkit log files', extensions: ['pakkit-json'] },
            // { name: 'All Files', extensions: ['*'] }
        ]
    })

    if (!result.canceled) {
        const realPath = result.filePath.endsWith('.pakkit-json') ? result.filePath : result.filePath + '.pakkit-json'
        console.log('Saving log to', realPath)
        fs.writeFile(realPath, arg, function (err) {
            if (err) throw err;
            console.log('Saved!');
        })
    }
})

ipcMain.on('loadLog', async (event, arg) => {
    const win = BrowserWindow.getAllWindows()[0]

    const result = await dialog.showOpenDialog(win, {
        filters: [
            { name: 'pakkit log files', extensions: ['pakkit-json'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    })

    if (!result.canceled) {
        // It's an array, but we have multi-select off so it should only have one item
        console.log('Loading log from', result.filePaths[0])
        fs.readFile(result.filePaths[0], 'utf-8', function(err, data) {
            if (err) throw err;
            console.log('File has been read')
            win.send('loadLogData', data)
        })
    }
})

ipcMain.on('saveAsScript', async (event, arg) => {
    const win = BrowserWindow.getAllWindows()[0]

    const result = await dialog.showSaveDialog(win, {
        title: "Save user script",
        filters: [
            { name: 'javascript files', extensions: ['js'] }
        ]
    })

    if (!result.canceled) {
        const realPath = result.filePath.endsWith('.js') ? result.filePath : result.filePath + '.js'
        win.send('disableBtnScriptSave')
        console.log('Saving script to', realPath)
        fs.writeFile(realPath, arg, function (err) {
            if (err) throw err;
            console.log('Saved!');
            currentScriptFile = realPath
            win.send('enableBtnScriptSave', currentScriptFile)
        })
    }
})

ipcMain.on('saveScript', async (event, arg) => {
    const win = BrowserWindow.getAllWindows()[0]
    const validScriptPath = (currentScriptFile != null || fs.existsSync(currentScriptFile) )

    win.send('disableBtnScriptSave')

    if (validScriptPath) {
        console.log('Overwrite script to', currentScriptFile)
        fs.writeFile(currentScriptFile, arg, function (err) {
            if (err) throw err;
            console.log('Saved!');
            win.send('enableBtnScriptSave', currentScriptFile)
        })
    }
})

ipcMain.on('loadScript', async (event, arg) => {
    const win = BrowserWindow.getAllWindows()[0]

    const result = await dialog.showOpenDialog(win, {
        title: "Load user script",
        filters: [
            { name: 'javascript files', extensions: ['js'] }
        ],
        properties: ['openFile']
    })

    if (!result.canceled) {
        win.send('disableBtnScriptSave')

        // It's an array, but we have multi-select off so it should only have one item
        console.log('Loading script from', result.filePaths[0])
        fs.readFile(result.filePaths[0], 'utf-8', function(err, data) {
            if (err) throw err;
            console.log('File has been read')
            currentScriptFile = result.filePaths[0]
            win.send('loadScriptData', data)
            win.send('enableBtnScriptSave', currentScriptFile)
        })
    }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
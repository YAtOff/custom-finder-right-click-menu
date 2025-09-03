// Modules to control application life and create native browser window
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { spawn } = require('child_process')

let serviceProcess = null;

function spawnService() {
  // Determine the correct path to the service executable
  let servicePath;

  if (app.isPackaged) {
    // For built/packaged app, use process.resourcesPath
    servicePath = path.join(process.resourcesPath, 'service');
  } else {
    // For development, use resources/service relative to __dirname
    servicePath = path.join(__dirname, 'resources', 'service');
  }

  console.log(`Attempting to spawn service from: ${servicePath}`);

  try {
    // Spawn the service process
    serviceProcess = spawn(servicePath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    serviceProcess.stdout.on('data', (data) => {
      console.log(`Service stdout: ${data}`);
    });

    serviceProcess.stderr.on('data', (data) => {
      console.error(`Service stderr: ${data}`);
    });

    serviceProcess.on('close', (code) => {
      console.log(`Service process exited with code ${code}`);
      serviceProcess = null;
    });

    serviceProcess.on('error', (error) => {
      console.error(`Failed to spawn service: ${error.message}`);
      serviceProcess = null;
    });

    console.log(`Service spawned with PID: ${serviceProcess.pid}`);
  } catch (error) {
    console.error(`Error spawning service: ${error.message}`);
  }
}


function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  mainWindow.loadFile('index.html')

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Spawn the service first
  spawnService();

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// Clean up service process when app is about to quit
app.on('before-quit', () => {
  if (serviceProcess && !serviceProcess.killed) {
    console.log('Terminating service process...');
    serviceProcess.kill('SIGTERM');
  }
})

// Handle app quit
app.on('will-quit', (event) => {
  if (serviceProcess && !serviceProcess.killed) {
    console.log('Force killing service process...');
    serviceProcess.kill('SIGKILL');
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

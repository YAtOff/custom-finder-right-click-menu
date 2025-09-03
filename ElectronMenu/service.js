#!/usr/bin/env node

//
//  service.js
//  FinderMenuService (Node.js)
//
//  Converted from Swift by GitHub Copilot on 9/3/25.
//  Copyright © 2025 Samiyuru Senarathne.
//

const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');

// Constants
const APP_GROUP_ID = 'com.samiyuru.FinderMenu';
const SOCKET_FILE_NAME = 'finder-menu.sock';
const MENU_PROGRAMS_DIR_NAME = '.findermenu';

// Script types enum
const ScriptTypes = {
    APPLESCRIPT: 'applescript',
    SHELLSCRIPT: 'shellscript',
    EXECUTABLE: 'executable'
};

// Socket message types
const SocketMessageType = {
    REQUEST_MENU_ITEMS: 'REQUEST_MENU_ITEMS',
    MENU_ITEMS_RESPONSE: 'MENU_ITEMS_RESPONSE',
    MENU_ITEM_CLICKED: 'MENU_ITEM_CLICKED'
};

// Helper functions
function getSocketPath() {
    return path.join(os.homedir(), 'Library', 'Group Containers', APP_GROUP_ID, SOCKET_FILE_NAME);
}

function getProgramsDir() {
    return path.join(os.homedir(), MENU_PROGRAMS_DIR_NAME);
}

function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Script Info class
class ScriptInfo {
    constructor(title, filePath, type) {
        this.id = 0;
        this.title = title;
        this.path = filePath;
        this.type = type;
    }
}

// Menu Item Info class
class MenuItemInfo {
    constructor(id, title) {
        this.id = id;
        this.title = title;
    }

    static fromJson(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            log(`Failed to parse MenuItemInfo JSON: ${error.message}`);
            return null;
        }
    }

    static toJson(menuItemInfos) {
        try {
            return JSON.stringify(menuItemInfos);
        } catch (error) {
            log(`Failed to serialize MenuItemInfo: ${error.message}`);
            return null;
        }
    }
}

// Menu Item Click Info class
class MenuItemClickInfo {
    constructor(id, target) {
        this.id = id;
        this.target = target;
    }

    static fromJson(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            log(`Failed to parse MenuItemClickInfo JSON: ${error.message}`);
            return null;
        }
    }

    toJson() {
        try {
            return JSON.stringify({
                id: this.id,
                target: this.target
            });
        } catch (error) {
            log(`Failed to serialize MenuItemClickInfo: ${error.message}`);
            return null;
        }
    }
}

// Socket Message class
class SocketMessage {
    constructor(type, payload) {
        this.type = type;
        this.payload = payload;
    }

    toJSON() {
        try {
            return JSON.stringify({
                type: this.type,
                payload: this.payload
            });
        } catch (error) {
            log(`Failed to serialize SocketMessage: ${error.message}`);
            return null;
        }
    }

    static fromJSON(jsonString) {
        try {
            return Object.assign(new SocketMessage(), JSON.parse(jsonString));
        } catch (error) {
            log(`Failed to parse SocketMessage JSON: ${error.message}`);
            return null;
        }
    }
}

// Menu Item Manager class
class MenuItemManager {
    constructor() {
        this.scriptInfos = this.readScriptPaths();
    }

    readScriptPaths() {
        const menuProgramsDir = getProgramsDir();

        log(`Script dir located at ${menuProgramsDir}`);

        // Check if directory exists
        if (!fs.existsSync(menuProgramsDir)) {
            log(`Scripts directory does not exist at ${menuProgramsDir}`);
            return [];
        }

        // Check if it's actually a directory
        const stats = fs.statSync(menuProgramsDir);
        if (!stats.isDirectory()) {
            log(`Scripts path is not a directory at ${menuProgramsDir}`);
            return [];
        }

        let files;
        try {
            files = fs.readdirSync(menuProgramsDir);
        } catch (error) {
            log(`Failed to read files in ${menuProgramsDir}: ${error.message}`);
            return [];
        }

        // Filter out hidden files and create script info array
        const scriptInfoArray = [];
        files.forEach(fileName => {
            if (!fileName.startsWith('.')) {
                const filePath = path.join(menuProgramsDir, fileName);
                const scriptInfo = this.createScriptInfo(filePath);
                if (scriptInfo) {
                    scriptInfo.id = scriptInfoArray.length;
                    scriptInfoArray.push(scriptInfo);
                }
            }
        });

        return scriptInfoArray;
    }

    getScriptType(scriptPath) {
        const fileExtension = path.extname(scriptPath).toLowerCase().slice(1); // Remove the dot

        const appleScriptExts = ['scpt', 'scptd', 'applescript'];
        const shellScriptExts = ['sh'];

        if (appleScriptExts.includes(fileExtension)) {
            return ScriptTypes.APPLESCRIPT;
        } else if (shellScriptExts.includes(fileExtension)) {
            return ScriptTypes.SHELLSCRIPT;
        } else if (fileExtension === '') {
            return ScriptTypes.EXECUTABLE;
        } else {
            return null;
        }
    }

    createScriptInfo(scriptPath) {
        // Check if file exists and is accessible
        if (!fs.existsSync(scriptPath)) {
            log(`Script is not accessible at ${scriptPath}`);
            return null;
        }

        // Check if it's a file
        const stats = fs.statSync(scriptPath);
        if (!stats.isFile()) {
            log(`Script is not a file at ${scriptPath}`);
            return null;
        }

        // Check if the file type is supported
        const fileType = this.getScriptType(scriptPath);
        if (!fileType) {
            log(`Unsupported script type ${scriptPath}`);
            return null;
        }

        // Get the file name without extension
        const scriptName = path.basename(scriptPath, path.extname(scriptPath));
        if (!scriptName) {
            log('File name is not available');
            return null;
        }

        return new ScriptInfo(scriptName, scriptPath, fileType);
    }

    runScript(scriptInfo, target) {
        log(`Running script ${scriptInfo?.title || 'unknown'} for ${target}`);

        if (!scriptInfo) {
            log('Script info not available');
            return;
        }

        let command, args;

        // Initialize parameters according to script type
        switch (scriptInfo.type) {
            case ScriptTypes.APPLESCRIPT:
                command = '/usr/bin/osascript';
                args = [scriptInfo.path, target];
                break;
            case ScriptTypes.SHELLSCRIPT:
                command = '/bin/bash';
                args = [scriptInfo.path, target];
                break;
            case ScriptTypes.EXECUTABLE:
                command = scriptInfo.path;
                args = [target];
                break;
            default:
                log(`Unknown script type: ${scriptInfo.type}`);
                return;
        }

        // Run the process
        const process = spawn(command, args, {
            stdio: 'pipe',
            detached: false
        });

        process.on('exit', (code) => {
            log(`Script terminated with code ${code}`);
        });

        process.on('error', (error) => {
            log(`Failed to run script: ${error.message}`);
        });
    }
}

// Socket Server class
class SocketServer {
    constructor(menuItemManager) {
        this.menuItemManager = menuItemManager;
        this.server = null;
        this.isRunning = false;
    }

    startServer() {
        const socketPath = getSocketPath();

        // Remove existing socket file if it exists
        this.cleanupSocketFile();

        this.server = net.createServer((socket) => {
            log('Client connected');
            this.handleClient(socket);
        });

        this.server.on('error', (error) => {
            log(`Server error: ${error.message}`);
        });

        this.server.listen(socketPath, () => {
            log(`Socket server listening on: ${socketPath}`);
            this.isRunning = true;
        });
    }

    stopServer() {
        this.isRunning = false;
        if (this.server) {
            this.server.close(() => {
                log('Server closed');
                this.cleanupSocketFile();
            });
        }
    }

    handleClient(socket) {
        socket.on('data', (data) => {
            const messageString = data.toString('utf8');
            this.handleMessage(messageString, socket);
        });

        socket.on('end', () => {
            log('Client disconnected');
        });

        socket.on('error', (error) => {
            log(`Client error: ${error.message}`);
        });
    }

    handleMessage(messageString, socket) {
        const message = SocketMessage.fromJSON(messageString);
        if (!message) {
            log(`Failed to parse socket message: ${messageString}`);
            return;
        }

        log(`Received message type: ${message.type}`);

        switch (message.type) {
            case SocketMessageType.REQUEST_MENU_ITEMS:
                this.sendMenuItems(socket);
                break;
            case SocketMessageType.MENU_ITEM_CLICKED:
                this.handleMenuItemClick(message.payload);
                break;
            case SocketMessageType.MENU_ITEMS_RESPONSE:
                log(`Unexpected message type from client: ${message.type}`);
                break;
            default:
                log(`Unknown message type: ${message.type}`);
        }
    }

    sendMenuItems(socket) {
        const menuItemInfos = this.createMenuInfos(this.menuItemManager.scriptInfos);
        const menuItemsJson = MenuItemInfo.toJson(menuItemInfos);

        if (!menuItemsJson) {
            log('Failed to serialize menu items');
            return;
        }

        const responseMessage = new SocketMessage(SocketMessageType.MENU_ITEMS_RESPONSE, menuItemsJson);
        const responseJson = responseMessage.toJSON();

        if (!responseJson) {
            log('Failed to serialize response message');
            return;
        }

        socket.write(responseJson, (error) => {
            if (error) {
                log(`Failed to send response: ${error.message}`);
            } else {
                log('Sent menu items response');
            }
        });
    }

    handleMenuItemClick(payload) {
        const menuItemClickInfo = MenuItemClickInfo.fromJson(payload);
        if (!menuItemClickInfo) {
            log('Failed to parse menu item click info');
            return;
        }

        log(`Menu item clicked: id=${menuItemClickInfo.id}, target=${menuItemClickInfo.target}`);

        // Get ScriptInfo object
        const scriptInfo = this.menuItemManager.scriptInfos[menuItemClickInfo.id];

        // Run script
        this.menuItemManager.runScript(scriptInfo, menuItemClickInfo.target);
    }

    createMenuInfos(scriptInfos) {
        if (!scriptInfos) {
            return [];
        }

        return scriptInfos.map(scriptInfo => new MenuItemInfo(scriptInfo.id, scriptInfo.title));
    }

    cleanupSocketFile() {
        const socketPath = getSocketPath();
        try {
            if (fs.existsSync(socketPath)) {
                fs.unlinkSync(socketPath);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}

// Main execution
function startService() {
    log('Starting the service...');

    // Initialize menu item manager
    const menuItemManager = new MenuItemManager();

    // Initialize socket server
    const socketServer = new SocketServer(menuItemManager);

    // Start the socket server
    socketServer.startServer();

    // Set up signal handling for graceful shutdown
    process.on('SIGTERM', () => {
        log('Received SIGTERM, shutting down...');
        socketServer.stopServer();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        log('Received SIGINT, shutting down...');
        socketServer.stopServer();
        process.exit(0);
    });

    // Keep the process running
    process.on('exit', () => {
        socketServer.stopServer();
    });
}

// Run the service if this file is executed directly
if (require.main === module) {
    startService();
}

// Export classes for testing or external use
module.exports = {
    SocketServer,
    MenuItemManager,
    ScriptInfo,
    MenuItemInfo,
    MenuItemClickInfo,
    SocketMessage,
    SocketMessageType,
    ScriptTypes,
    startService
};

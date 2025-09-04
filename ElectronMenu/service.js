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

// JSON-RPC Error Codes
const JsonRpcErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
};

// JSON-RPC Message class
class JsonRpcMessage {
    constructor() {
        this.jsonrpc = "2.0";
    }

    static createRequest(method, params = null, id = null) {
        const message = new JsonRpcMessage();
        message.method = method;
        if (params !== null) message.params = params;
        if (id !== null) message.id = id;
        return message;
    }

    static createResponse(result, id) {
        const message = new JsonRpcMessage();
        message.result = result;
        message.id = id;
        return message;
    }

    static createError(code, message, data = null, id = null) {
        const response = new JsonRpcMessage();
        response.error = { code, message };
        if (data !== null) response.error.data = data;
        if (id !== null) response.id = id;
        return response;
    }

    static fromJSON(jsonString) {
        try {
            const obj = JSON.parse(jsonString);
            if (obj.jsonrpc !== "2.0") {
                return null;
            }
            return Object.assign(new JsonRpcMessage(), obj);
        } catch (error) {
            return null;
        }
    }

    toJSON() {
        // Return a plain object for JSON.stringify to serialize
        const obj = { jsonrpc: this.jsonrpc };

        if (this.method !== undefined) obj.method = this.method;
        if (this.params !== undefined) obj.params = this.params;
        if (this.id !== undefined) obj.id = this.id;
        if (this.result !== undefined) obj.result = this.result;
        if (this.error !== undefined) obj.error = this.error;

        return obj;
    }

    toString() {
        try {
            return JSON.stringify(this);
        } catch (error) {
            return null;
        }
    }

    isRequest() {
        return this.method !== undefined;
    }

    isNotification() {
        return this.isRequest() && this.id === undefined;
    }

    isResponse() {
        return this.result !== undefined || this.error !== undefined;
    }
}

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
        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString('utf8');

            // Process complete lines (messages)
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim().length > 0) {
                    this.handleMessage(line.trim(), socket);
                }
            }
        });

        socket.on('end', () => {
            log('Client disconnected');
        });

        socket.on('error', (error) => {
            log(`Client error: ${error.message}`);
        });
    }

    handleMessage(messageString, socket) {
        const message = JsonRpcMessage.fromJSON(messageString);
        if (!message) {
            const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.PARSE_ERROR, "Parse error");
            const errorJson = JSON.stringify(errorResponse);
            if (errorJson) {
                socket.write(errorJson + '\n');
            }
            return;
        }

        if (!message.isRequest()) {
            const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request", null, message.id);
            const errorJson = JSON.stringify(errorResponse);
            if (errorJson) {
                socket.write(errorJson + '\n');
            }
            return;
        }

        log(`Received JSON-RPC method: ${message.method}`);

        switch (message.method) {
            case 'getMenuItems':
                this.handleGetMenuItems(message, socket);
                break;
            case 'menuItemClicked':
                this.handleMenuItemClicked(message, socket);
                break;
            default:
                const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.METHOD_NOT_FOUND, "Method not found", null, message.id);
                const errorJson = JSON.stringify(errorResponse);
                if (errorJson) {
                    socket.write(errorJson + '\n');
                }
        }
    }

    handleGetMenuItems(request, socket) {
        try {
            const menuItemInfos = this.createMenuInfos(this.menuItemManager.scriptInfos);
            const responseData = { menuItems: menuItemInfos };
            const response = JsonRpcMessage.createResponse(responseData, request.id);
            const responseJson = JSON.stringify(response);

            if (!responseJson) {
                const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.INTERNAL_ERROR, "Failed to serialize response", null, request.id);
                const errorJson = JSON.stringify(errorResponse);
                if (errorJson) {
                    socket.write(errorJson + '\n');
                }
                return;
            }

            socket.write(responseJson + '\n', (error) => {
                if (error) {
                    log(`Failed to send response: ${error.message}`);
                } else {
                    log('Sent menu items response');
                }
            });
        } catch (error) {
            log(`Error in handleGetMenuItems: ${error.message}`);
            const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.INTERNAL_ERROR, "Internal error", error.message, request.id);
            const errorJson = JSON.stringify(errorResponse);
            if (errorJson) {
                socket.write(errorJson + '\n');
            }
        }
    }

    handleMenuItemClicked(request, socket) {
        try {
            if (!request.params || typeof request.params.id !== 'number' || typeof request.params.target !== 'string') {
                if (!request.isNotification()) {
                    const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.INVALID_PARAMS, "Invalid params", null, request.id);
                    const errorJson = JSON.stringify(errorResponse);
                    if (errorJson) {
                        socket.write(errorJson + '\n');
                    }
                }
                return;
            }

            log(`Menu item clicked: id=${request.params.id}, target=${request.params.target}`);

            const scriptInfo = this.menuItemManager.scriptInfos[request.params.id];
            this.menuItemManager.runScript(scriptInfo, request.params.target);

            // For notifications, we don't send a response
            if (!request.isNotification()) {
                const response = JsonRpcMessage.createResponse({}, request.id);
                const responseJson = JSON.stringify(response);
                if (responseJson) {
                    socket.write(responseJson + '\n');
                }
            }
        } catch (error) {
            if (!request.isNotification()) {
                const errorResponse = JsonRpcMessage.createError(JsonRpcErrorCodes.INTERNAL_ERROR, "Internal error", error.message, request.id);
                const errorJson = JSON.stringify(errorResponse);
                if (errorJson) {
                    socket.write(errorJson + '\n');
                }
            }
        }
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
    JsonRpcMessage,
    JsonRpcErrorCodes,
    ScriptTypes,
    startService
};

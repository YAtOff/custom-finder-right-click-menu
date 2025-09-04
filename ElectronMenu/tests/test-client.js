#!/usr/bin/env node

//
//  test-client.js
//  FinderMenuService Test Client
//
//  Test client for JSON-RPC socket communication with service.js
//  Created on 9/4/25.
//

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Constants
const APP_GROUP_ID = 'com.samiyuru.FinderMenu';
const SOCKET_FILE_NAME = 'finder-menu.sock';
const MENU_PROGRAMS_DIR_NAME = '.findermenu';

// Helper functions
function getSocketPath() {
    return path.join(os.homedir(), 'Library', 'Group Containers', APP_GROUP_ID, SOCKET_FILE_NAME);
}

function getProgramsDir() {
    return path.join(os.homedir(), MENU_PROGRAMS_DIR_NAME);
}

// JSON-RPC Socket Client Implementation
class JsonRpcSocketClient {
    constructor(socketPath) {
        this.socketPath = socketPath || getSocketPath();
        this.socket = null;
        this.connected = false;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.buffer = '';
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(this.socketPath);

            this.socket.on('connect', () => {
                console.log(`Connected to socket: ${this.socketPath}`);
                this.connected = true;
                resolve();
            });

            this.socket.on('error', (error) => {
                console.error(`Socket error: ${error.message}`);
                this.connected = false;
                reject(error);
            });

            this.socket.on('close', () => {
                console.log('Socket connection closed');
                this.connected = false;
            });

            this.socket.on('data', (data) => {
                this.buffer += data.toString('utf8');
                this.processBuffer();
            });
        });
    }

    processBuffer() {
        // Split by newlines and process complete messages
        const lines = this.buffer.split('\n');

        // Keep the last incomplete line in the buffer
        this.buffer = lines.pop() || '';

        // Process each complete line as a JSON message
        for (const line of lines) {
            if (line.trim().length > 0) {
                this.handleResponse(line.trim());
            }
        }
    }

    async disconnect() {
        return new Promise((resolve) => {
            if (this.socket) {
                this.socket.end(() => {
                    this.connected = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    handleResponse(responseString) {
        try {
            const response = JSON.parse(responseString);

            if (response.id && this.pendingRequests.has(response.id)) {
                const { resolve, reject } = this.pendingRequests.get(response.id);
                this.pendingRequests.delete(response.id);

                if (response.error) {
                    const error = new Error(response.error.message);
                    error.code = response.error.code;
                    error.data = response.error.data;
                    reject(error);
                } else {
                    resolve(response.result);
                }
            }
        } catch (error) {
            console.error(`Failed to parse response: ${error.message}`);
        }
    }

    async request(method, params = null, timeout = 5000) {
        if (!this.connected) {
            throw new Error('Not connected to socket');
        }

        const id = this.requestId++;
        const message = {
            jsonrpc: "2.0",
            method: method,
            id: id
        };

        if (params !== null) {
            message.params = params;
        }

        return new Promise((resolve, reject) => {
            // Set up timeout
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, timeout);

            // Store pending request
            this.pendingRequests.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            // Send request
            const messageString = JSON.stringify(message);
            this.socket.write(messageString + '\n', (error) => {
                if (error) {
                    this.pendingRequests.delete(id);
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
        });
    }

    // Send notification (no response expected)
    async notify(method, params = null) {
        if (!this.connected) {
            throw new Error('Not connected to socket');
        }

        const message = {
            jsonrpc: "2.0",
            method: method
        };

        if (params !== null) {
            message.params = params;
        }

        return new Promise((resolve, reject) => {
            const messageString = JSON.stringify(message);
            this.socket.write(messageString + '\n', (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
}

// Test Utilities
class TestRunner {
    constructor() {
        this.totalTests = 0;
        this.passedTests = 0;
        this.failedTests = 0;
    }

    async runTest(testName, testFunction) {
        this.totalTests++;
        console.log(`\n🧪 Running: ${testName}`);

        try {
            await testFunction();
            this.passedTests++;
            console.log(`✅ PASSED: ${testName}`);
        } catch (error) {
            this.failedTests++;
            console.log(`❌ FAILED: ${testName}`);
            console.log(`   Error: ${error.message}`);
            if (error.stack) {
                console.log(`   Stack: ${error.stack}`);
            }
        }
    }

    printSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('TEST SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total tests: ${this.totalTests}`);
        console.log(`Passed: ${this.passedTests}`);
        console.log(`Failed: ${this.failedTests}`);
        console.log(`Success rate: ${this.totalTests > 0 ? Math.round((this.passedTests / this.totalTests) * 100) : 0}%`);

        if (this.failedTests === 0) {
            console.log('\n🎉 All tests passed!');
        } else {
            console.log('\n⚠️  Some tests failed.');
        }
    }
}

// Test Helper Functions
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, but got ${actual}`);
    }
}

function assertArrayContains(array, item, message) {
    if (!Array.isArray(array) || !array.includes(item)) {
        throw new Error(message || `Array does not contain ${item}`);
    }
}

// Setup test environment
async function setupTestEnvironment() {
    const programsDir = getProgramsDir();

    // Create test scripts directory if it doesn't exist
    if (!fs.existsSync(programsDir)) {
        fs.mkdirSync(programsDir, { recursive: true });
    }

    // Create test shell script
    const testShellScript = path.join(programsDir, 'Test Shell Script.sh');
    const shellScriptContent = `#!/bin/bash
echo "Shell script executed with target: $1"
echo "Test script working correctly"
`;
    fs.writeFileSync(testShellScript, shellScriptContent);
    fs.chmodSync(testShellScript, 0o755);

    // Create test executable
    const testExecutable = path.join(programsDir, 'TestExecutable');
    const executableContent = `#!/bin/bash
echo "Executable ran with target: $1"
`;
    fs.writeFileSync(testExecutable, executableContent);
    fs.chmodSync(testExecutable, 0o755);

    console.log(`Test environment setup complete at: ${programsDir}`);
}

// Cleanup test environment
async function cleanupTestEnvironment() {
    const programsDir = getProgramsDir();

    if (fs.existsSync(programsDir)) {
        const files = fs.readdirSync(programsDir);
        files.forEach(file => {
            if (file.startsWith('Test') || file.startsWith('test')) {
                const filePath = path.join(programsDir, file);
                fs.unlinkSync(filePath);
            }
        });
    }

    console.log('Test environment cleaned up');
}

// Test Functions

async function testGetMenuItemsSuccess() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        const result = await client.request('getMenuItems');

        // Verify response structure
        assert(result && typeof result === 'object', 'Result should be an object');
        assert(Array.isArray(result.menuItems), 'Result should contain menuItems array');

        // Verify menu items structure
        result.menuItems.forEach(item => {
            assert(typeof item.id === 'number', 'Menu item should have numeric id');
            assert(typeof item.title === 'string', 'Menu item should have string title');
            assert(item.title.length > 0, 'Menu item title should not be empty');
        });

        console.log(`   Found ${result.menuItems.length} menu items`);
        result.menuItems.forEach(item => {
            console.log(`   - ID: ${item.id}, Title: "${item.title}"`);
        });

    } finally {
        await client.disconnect();
    }
}

async function testMenuItemClickedSuccess() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        // First get menu items to find a valid ID
        const menuResult = await client.request('getMenuItems');
        assert(menuResult.menuItems.length > 0, 'Need at least one menu item to test');

        const testMenuItem = menuResult.menuItems[0];
        const testTarget = '/tmp/test-target';

        // Test menu item click
        const clickResult = await client.request('menuItemClicked', {
            id: testMenuItem.id,
            target: testTarget
        });

        // Should return empty object for success
        assert(typeof clickResult === 'object', 'Click result should be an object');

        console.log(`   Successfully clicked menu item: "${testMenuItem.title}"`);

    } finally {
        await client.disconnect();
    }
}

async function testMenuItemClickedNotification() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        // First get menu items to find a valid ID
        const menuResult = await client.request('getMenuItems');
        assert(menuResult.menuItems.length > 0, 'Need at least one menu item to test');

        const testMenuItem = menuResult.menuItems[0];
        const testTarget = '/tmp/test-target-notification';

        // Test menu item click as notification (no response expected)
        await client.notify('menuItemClicked', {
            id: testMenuItem.id,
            target: testTarget
        });

        // Wait a bit to allow script execution
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`   Successfully sent notification for menu item: "${testMenuItem.title}"`);

    } finally {
        await client.disconnect();
    }
}

async function testInvalidMethod() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        await client.request('invalidMethod');
        throw new Error('Should have thrown an error for invalid method');
    } catch (error) {
        assertEquals(error.code, -32601, 'Should return METHOD_NOT_FOUND error');
        assert(error.message.includes('Method not found'), 'Should indicate method not found');
        console.log(`   Correctly handled invalid method with error: ${error.message}`);
    } finally {
        await client.disconnect();
    }
}

async function testInvalidParams() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        // Test with invalid parameters
        await client.request('menuItemClicked', {
            id: 'invalid',  // Should be number
            target: 123     // Should be string
        });
        throw new Error('Should have thrown an error for invalid params');
    } catch (error) {
        assertEquals(error.code, -32602, 'Should return INVALID_PARAMS error');
        console.log(`   Correctly handled invalid params with error: ${error.message}`);
    } finally {
        await client.disconnect();
    }
}

async function testConnectionError() {
    // Test with invalid socket path
    const client = new JsonRpcSocketClient('/invalid/socket/path');

    try {
        await client.connect();
        throw new Error('Should have failed to connect to invalid socket');
    } catch (error) {
        assert(error.message.includes('ENOENT') || error.message.includes('connect'),
               'Should fail with connection error');
        console.log(`   Correctly handled connection error: ${error.message}`);
    }
}

async function testShellScriptExecution() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        // Get menu items
        const menuResult = await client.request('getMenuItems');

        // Find the test shell script
        const shellScript = menuResult.menuItems.find(item =>
            item.title.includes('Test Shell Script') || item.title.includes('Shell')
        );

        if (shellScript) {
            const testTarget = '/tmp/shell-test-target';

            // Execute the shell script
            await client.request('menuItemClicked', {
                id: shellScript.id,
                target: testTarget
            });

            console.log(`   Successfully executed shell script: "${shellScript.title}"`);
        } else {
            console.log('   No shell script found in menu items (this is okay)');
        }

    } finally {
        await client.disconnect();
    }
}

async function testConcurrentRequests() {
    const client = new JsonRpcSocketClient();
    await client.connect();

    try {
        // Send multiple concurrent requests
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(client.request('getMenuItems'));
        }

        const results = await Promise.all(promises);

        // Verify all results are consistent
        results.forEach((result, index) => {
            assert(Array.isArray(result.menuItems), `Result ${index} should contain menuItems array`);
        });

        console.log(`   Successfully handled ${results.length} concurrent requests`);

    } finally {
        await client.disconnect();
    }
}

// Main test execution
async function runAllTests() {
    console.log('🚀 Starting FinderMenuService Test Client');
    console.log('='.repeat(50));

    const runner = new TestRunner();

    try {
        // Setup test environment
        await setupTestEnvironment();

        // Run all tests
        await runner.runTest('testGetMenuItemsSuccess', testGetMenuItemsSuccess);
        await runner.runTest('testMenuItemClickedSuccess', testMenuItemClickedSuccess);
        await runner.runTest('testMenuItemClickedNotification', testMenuItemClickedNotification);
        await runner.runTest('testInvalidMethod', testInvalidMethod);
        await runner.runTest('testInvalidParams', testInvalidParams);
        await runner.runTest('testConnectionError', testConnectionError);
        await runner.runTest('testShellScriptExecution', testShellScriptExecution);
        await runner.runTest('testConcurrentRequests', testConcurrentRequests);

    } finally {
        // Cleanup test environment
        await cleanupTestEnvironment();

        // Print test summary
        runner.printSummary();
    }
}

// Export for use as module or run directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = {
    JsonRpcSocketClient,
    TestRunner,
    runAllTests,
    testGetMenuItemsSuccess,
    testMenuItemClickedSuccess,
    testShellScriptExecution
};

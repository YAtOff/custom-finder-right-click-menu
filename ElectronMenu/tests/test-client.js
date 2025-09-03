#!/usr/bin/env node

//
//  test-client.js
//  Test client for FinderMenuService
//

const net = require('net');
const os = require('os');
const path = require('path');

const APP_GROUP_ID = 'com.samiyuru.FinderMenu';
const SOCKET_FILE_NAME = 'finder-menu.sock';

function getSocketPath() {
    return path.join(os.homedir(), 'Library', 'Group Containers', APP_GROUP_ID, SOCKET_FILE_NAME);
}

// Socket message types
const SocketMessageType = {
    REQUEST_MENU_ITEMS: 'REQUEST_MENU_ITEMS',
    MENU_ITEMS_RESPONSE: 'MENU_ITEMS_RESPONSE',
    MENU_ITEM_CLICKED: 'MENU_ITEM_CLICKED'
};

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
            console.log(`Failed to serialize SocketMessage: ${error.message}`);
            return null;
        }
    }

    static fromJSON(jsonString) {
        try {
            return Object.assign(new SocketMessage(), JSON.parse(jsonString));
        } catch (error) {
            console.log(`Failed to parse SocketMessage JSON: ${error.message}`);
            return null;
        }
    }
}

function testClient() {
    const socketPath = getSocketPath();

    console.log(`Connecting to socket: ${socketPath}`);

    const client = net.createConnection(socketPath, () => {
        console.log('Connected to server');

        // Request menu items
        const requestMessage = new SocketMessage(SocketMessageType.REQUEST_MENU_ITEMS, '');
        const requestJson = requestMessage.toJSON();

        if (requestJson) {
            console.log('Sending request for menu items...');
            client.write(requestJson);
        }
    });

    client.on('data', (data) => {
        const messageString = data.toString('utf8');
        console.log('Received response:', messageString);

        const message = SocketMessage.fromJSON(messageString);
        if (message && message.type === SocketMessageType.MENU_ITEMS_RESPONSE) {
            console.log('Menu items received:', message.payload);

            // Parse the menu items
            try {
                const menuItems = JSON.parse(message.payload);
                console.log('Parsed menu items:');
                menuItems.forEach(item => {
                    console.log(`  - ID: ${item.id}, Title: ${item.title}`);
                });

                // Test clicking a menu item if any exist
                if (menuItems.length > 0) {
                    const clickInfo = {
                        id: menuItems[0].id,
                        target: '/tmp/test-target'
                    };

                    const clickMessage = new SocketMessage(SocketMessageType.MENU_ITEM_CLICKED, JSON.stringify(clickInfo));
                    const clickJson = clickMessage.toJSON();

                    if (clickJson) {
                        console.log(`Testing click on menu item: ${menuItems[0].title}`);
                        client.write(clickJson);
                    }
                }
            } catch (error) {
                console.log(`Failed to parse menu items: ${error.message}`);
            }
        }

        // Close after a short delay
        setTimeout(() => {
            client.end();
        }, 1000);
    });

    client.on('end', () => {
        console.log('Disconnected from server');
    });

    client.on('error', (error) => {
        console.log(`Client error: ${error.message}`);
    });
}

// Run the test
testClient();
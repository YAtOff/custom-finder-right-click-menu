//
//  SocketServer.swift
//  FinderMenuService
//
//  Created by GitHub Copilot on 9/3/25.
//  Copyright © 2025 Samiyuru Senarathne.
//

import Foundation
import Commons

class SocketServer {
    private var socketFileDescriptor: Int32 = -1
    private let menuItemManager: MenuItemManager
    private var isRunning = false
    private let serverQueue = DispatchQueue(label: "com.samiyuru.findermenu.socketserver", qos: .userInitiated)
    private let clientQueue = DispatchQueue(label: "com.samiyuru.findermenu.socketclient", qos: .userInitiated, attributes: .concurrent)

    init(menuItemManager: MenuItemManager) {
        self.menuItemManager = menuItemManager
    }

    func startServer() {
        serverQueue.async {
            self.setupSocket()
        }
    }

    func stopServer() {
        isRunning = false
        if socketFileDescriptor != -1 {
            close(socketFileDescriptor)
            socketFileDescriptor = -1
        }
        cleanupSocketFile()
    }

    private func setupSocket() {
        guard let socketPath = AppGroupHelper.getSocketPath() else {
            NSLog("Failed to get socket path")
            return
        }

        // Remove existing socket file if it exists
        cleanupSocketFile()

        // Create socket
        socketFileDescriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        if socketFileDescriptor == -1 {
            NSLog("Failed to create socket: \(String(cString: strerror(errno)))")
            return
        }

        // Set up socket address
        var serverAddress = sockaddr_un()
        serverAddress.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = socketPath.utf8CString
        if pathBytes.count > MemoryLayout.size(ofValue: serverAddress.sun_path) {
            NSLog("Socket path is too long")
            close(socketFileDescriptor)
            return
        }

        _ = withUnsafeMutablePointer(to: &serverAddress.sun_path) {
            $0.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) {
                strcpy($0, socketPath)
            }
        }

        // Bind socket
        let bindResult = withUnsafePointer(to: &serverAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(socketFileDescriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }

        if bindResult == -1 {
            NSLog("Failed to bind socket: \(String(cString: strerror(errno)))")
            close(socketFileDescriptor)
            return
        }

        // Listen for connections
        if listen(socketFileDescriptor, 5) == -1 {
            NSLog("Failed to listen on socket: \(String(cString: strerror(errno)))")
            close(socketFileDescriptor)
            return
        }

        NSLog("Socket server listening on: \(socketPath)")
        isRunning = true

        // Accept connections
        acceptConnections()
    }

    private func acceptConnections() {
        while isRunning {
            let clientSocket = accept(socketFileDescriptor, nil, nil)
            if clientSocket == -1 {
                if isRunning {
                    NSLog("Failed to accept connection: \(String(cString: strerror(errno)))")
                }
                continue
            }

            NSLog("Client connected")

            // Handle client in separate queue
            clientQueue.async {
                self.handleClient(clientSocket: clientSocket)
            }
        }
    }

    private func handleClient(clientSocket: Int32) {
        defer {
            close(clientSocket)
            NSLog("Client disconnected")
        }

        var buffer = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = recv(clientSocket, &buffer, buffer.count, 0)

            if bytesRead <= 0 {
                break
            }

            guard let messageString = String(bytes: buffer[..<bytesRead], encoding: .utf8) else {
                NSLog("Failed to decode message")
                continue
            }

            handleMessage(messageString, clientSocket: clientSocket)
        }
    }

    private func handleMessage(_ messageString: String, clientSocket: Int32) {
        guard let message = SocketMessage.fromJSON(messageString) else {
            NSLog("Failed to parse socket message: \(messageString)")
            return
        }

        NSLog("Received message type: \(message.type.rawValue)")

        switch message.type {
        case .requestMenuItems:
            sendMenuItems(to: clientSocket)
        case .menuItemClicked:
            handleMenuItemClick(payload: message.payload)
        case .menuItemsResponse:
            // Not expected from client
            NSLog("Unexpected message type from client: \(message.type.rawValue)")
        }
    }

    private func sendMenuItems(to clientSocket: Int32) {
        let menuItemInfos = createMenuInfos(scriptInfos: menuItemManager.scriptInfos)

        guard let menuItemsJson = MenuItemInfo.json(menuItemInfos: menuItemInfos) else {
            NSLog("Failed to serialize menu items")
            return
        }

        let responseMessage = SocketMessage(type: .menuItemsResponse, payload: menuItemsJson)

        guard let responseJson = responseMessage.toJSON() else {
            NSLog("Failed to serialize response message")
            return
        }

        let data = Data(responseJson.utf8)
        let result = data.withUnsafeBytes { bytes in
            send(clientSocket, bytes.bindMemory(to: UInt8.self).baseAddress, data.count, 0)
        }

        if result == -1 {
            NSLog("Failed to send response: \(String(cString: strerror(errno)))")
        } else {
            NSLog("Sent menu items response")
        }
    }

    private func handleMenuItemClick(payload: String) {
        guard let menuItemClickInfo = MenuItemClickInfo.fromJson(str: payload) else {
            NSLog("Failed to parse menu item click info")
            return
        }

        NSLog("Menu item clicked: id=\(menuItemClickInfo.id), target=\(menuItemClickInfo.target)")

        // Get target URL
        let target = URL(fileURLWithPath: menuItemClickInfo.target)

        // Get ScriptInfo object
        let scriptInfo = menuItemManager.scriptInfos?[menuItemClickInfo.id]

        // Run script
        menuItemManager.runScript(scriptInfo: scriptInfo, target: target)
    }

    // Convert script info array to menu item info array
    private func createMenuInfos(scriptInfos: [ScriptInfo]?) -> [MenuItemInfo]? {
        guard let scriptInfos = scriptInfos else {
            return nil
        }

        var menuItemInfos = [MenuItemInfo]()
        for scriptInfo in scriptInfos {
            let menuItemInfo = MenuItemInfo(id: scriptInfo.id, title: scriptInfo.title)
            menuItemInfos.append(menuItemInfo)
        }

        return menuItemInfos
    }

    private func cleanupSocketFile() {
        guard let socketPath = AppGroupHelper.getSocketPath() else { return }
        let _ = unlink(socketPath)
    }

    deinit {
        stopServer()
    }
}

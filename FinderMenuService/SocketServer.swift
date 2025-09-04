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
        var messageBuffer = ""

        while true {
            let bytesRead = recv(clientSocket, &buffer, buffer.count, 0)

            if bytesRead <= 0 {
                break
            }

            guard let receivedString = String(bytes: buffer[..<bytesRead], encoding: .utf8) else {
                NSLog("Failed to decode message")
                continue
            }

            // Append to message buffer
            messageBuffer += receivedString

            // Process complete messages (delimited by newlines)
            let lines = messageBuffer.components(separatedBy: "\n")
            messageBuffer = lines.last ?? "" // Keep incomplete line in buffer

            // Process each complete line as a message
            for line in lines.dropLast() {
                if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                    handleMessage(line.trimmingCharacters(in: .whitespaces), clientSocket: clientSocket)
                }
            }
        }
    }

    private func handleMessage(_ messageString: String, clientSocket: Int32) {
        guard let message = JsonRpcMessage.fromJSON(messageString) else {
            NSLog("Failed to parse JSON-RPC message: \(messageString)")
            let errorResponse = JsonRpcMessage(error: JsonRpcError(code: .parseError, message: "Parse error"), id: nil)
            sendJsonRpcResponse(errorResponse, to: clientSocket)
            return
        }

        if !message.isRequest {
            let errorResponse = JsonRpcMessage(error: JsonRpcError(code: .invalidRequest, message: "Invalid Request"), id: message.id)
            sendJsonRpcResponse(errorResponse, to: clientSocket)
            return
        }

        NSLog("Received JSON-RPC method: \(message.method ?? "unknown")")

        switch message.method {
        case "getMenuItems":
            handleGetMenuItems(message, clientSocket: clientSocket)
        case "menuItemClicked":
            handleMenuItemClicked(message, clientSocket: clientSocket)
        default:
            let errorResponse = JsonRpcMessage(error: JsonRpcError(code: .methodNotFound, message: "Method not found"), id: message.id)
            sendJsonRpcResponse(errorResponse, to: clientSocket)
        }
    }

    private func handleGetMenuItems(_ request: JsonRpcMessage, clientSocket: Int32) {
        let menuItemInfos = createMenuInfos(scriptInfos: menuItemManager.scriptInfos)
        let responseData = ["menuItems": menuItemInfos?.map { ["id": $0.id, "title": $0.title] } ?? []]
        let response = JsonRpcMessage(result: responseData, id: request.id ?? 0)
        sendJsonRpcResponse(response, to: clientSocket)
    }

    private func handleMenuItemClicked(_ request: JsonRpcMessage, clientSocket: Int32) {
        guard let params = request.params,
              let id = params["id"] as? Int,
              let target = params["target"] as? String else {
            if !request.isNotification {
                let errorResponse = JsonRpcMessage(error: JsonRpcError(code: .invalidParams, message: "Invalid params"), id: request.id)
                sendJsonRpcResponse(errorResponse, to: clientSocket)
            }
            return
        }

        NSLog("Menu item clicked: id=\(id), target=\(target)")

        // Get target URL
        let targetURL = URL(fileURLWithPath: target)

        // Get ScriptInfo object
        let scriptInfo = menuItemManager.scriptInfos?[id]

        // Run script
        menuItemManager.runScript(scriptInfo: scriptInfo, target: targetURL)

        // For notifications, we don't send a response
        if !request.isNotification {
            let response = JsonRpcMessage(result: [:], id: request.id ?? 0)
            sendJsonRpcResponse(response, to: clientSocket)
        }
    }

    private func sendJsonRpcResponse(_ response: JsonRpcMessage, to clientSocket: Int32) {
        guard let responseJson = response.toJSON() else {
            NSLog("Failed to serialize JSON-RPC response")
            return
        }

        let messageWithNewline = responseJson + "\n"
        let data = Data(messageWithNewline.utf8)
        let result = data.withUnsafeBytes { bytes in
            send(clientSocket, bytes.bindMemory(to: UInt8.self).baseAddress, data.count, 0)
        }

        if result == -1 {
            NSLog("Failed to send response: \(String(cString: strerror(errno)))")
        } else {
            NSLog("Sent JSON-RPC response")
        }
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

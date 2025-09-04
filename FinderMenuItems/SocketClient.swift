//
//  SocketClient.swift
//  FinderMenuItems
//
//  Created by GitHub Copilot on 9/3/25.
//  Copyright © 2025 Samiyuru Senarathne.
//

import Foundation
import Commons

protocol SocketClientDelegate: AnyObject {
    func socketClient(_ client: SocketClient, didReceiveMenuItems menuItems: [MenuItemInfo])
    func socketClientDidDisconnect(_ client: SocketClient)
}

class SocketClient {
    private var socketFileDescriptor: Int32 = -1
    private var isConnected = false
    private let clientQueue = DispatchQueue(label: "com.samiyuru.findermenu.socketclient", qos: .userInitiated)
    private var reconnectTimer: Timer?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    private var cachedMenuItems: [MenuItemInfo] = []
    private var requestId = 0
    private var pendingRequests: [Int: (([MenuItemInfo]) -> Void)] = [:]

    weak var delegate: SocketClientDelegate?

    func connect() {
        clientQueue.async {
            self.establishConnection()
        }
    }

    func disconnect() {
        clientQueue.async {
            self.closeConnection()
        }
    }

    func requestMenuItems() {
        clientQueue.async {
            self.sendRequestMenuItems()
        }
    }

    func sendMenuItemClicked(id: Int, target: URL) {
        clientQueue.async {
            self.sendMenuItemClickedMessage(id: id, target: target)
        }
    }

    func getCachedMenuItems() -> [MenuItemInfo] {
        return cachedMenuItems
    }

    private func getNextRequestId() -> Int {
        requestId += 1
        return requestId
    }

    private func establishConnection() {
        guard let socketPath = AppGroupHelper.getSocketPath() else {
            NSLog("Failed to get socket path")
            scheduleReconnect()
            return
        }

        // Create socket
        socketFileDescriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        if socketFileDescriptor == -1 {
            NSLog("Failed to create socket: \(String(cString: strerror(errno)))")
            scheduleReconnect()
            return
        }

        // Set up socket address
        var serverAddress = sockaddr_un()
        serverAddress.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = socketPath.utf8CString
        if pathBytes.count > MemoryLayout.size(ofValue: serverAddress.sun_path) {
            NSLog("Socket path is too long")
            close(socketFileDescriptor)
            scheduleReconnect()
            return
        }

        _ = withUnsafeMutablePointer(to: &serverAddress.sun_path) {
            $0.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) {
                strcpy($0, socketPath)
            }
        }

        // Connect to server
        let connectResult = withUnsafePointer(to: &serverAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(socketFileDescriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }

        if connectResult == -1 {
            NSLog("Failed to connect to socket: \(String(cString: strerror(errno)))")
            close(socketFileDescriptor)
            scheduleReconnect()
            return
        }

        NSLog("Connected to socket server: \(socketPath)")
        isConnected = true
        reconnectAttempts = 0

        // Request initial menu items first
        sendRequestMenuItems()

        // Start listening for messages (asynchronously)
        startListeningForMessages()
    }

    private func startListeningForMessages() {
        // Start listening on a separate queue to avoid blocking
        DispatchQueue.global(qos: .userInitiated).async {
            self.listenForMessages()
        }
    }

    private func listenForMessages() {
        var buffer = [UInt8](repeating: 0, count: 4096)
        var messageBuffer = ""

        while isConnected {
            let bytesRead = recv(socketFileDescriptor, &buffer, buffer.count, 0)

            if bytesRead <= 0 {
                NSLog("Connection closed by server")
                handleDisconnection()
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
                    handleMessage(line.trimmingCharacters(in: .whitespaces))
                }
            }
        }
    }

    private func handleMessage(_ messageString: String) {
        guard let message = JsonRpcMessage.fromJSON(messageString) else {
            NSLog("Failed to parse JSON-RPC message: \(messageString)")
            return
        }

        if message.isResponse {
            handleResponse(message)
        } else if message.isRequest {
            NSLog("Unexpected request from server: \(message.method ?? "unknown")")
        }
    }

    private func handleResponse(_ message: JsonRpcMessage) {
        guard let id = message.id else {
            NSLog("Response without ID")
            return
        }

        if let error = message.error {
            NSLog("JSON-RPC error: \(error.code) - \(error.message)")
            return
        }

        guard let result = message.result,
              let menuItemsArray = result["menuItems"] as? [[String: Any]] else {
            NSLog("Invalid response format")
            return
        }

        let menuItems = menuItemsArray.compactMap { dict -> MenuItemInfo? in
            guard let id = dict["id"] as? Int,
                  let title = dict["title"] as? String else {
                return nil
            }
            return MenuItemInfo(id: id, title: title)
        }

        // Cache the menu items
        cachedMenuItems = menuItems

        // Execute pending callback
        if let callback = pendingRequests.removeValue(forKey: id) {
            callback(menuItems)
        }

        // Notify delegate on main queue
        DispatchQueue.main.async {
            self.delegate?.socketClient(self, didReceiveMenuItems: menuItems)
        }
    }

    private func sendRequestMenuItems() {
        guard isConnected else {
            NSLog("Not connected to server")
            return
        }

        let id = getNextRequestId()
        let message = JsonRpcMessage(method: "getMenuItems", id: id)

        sendMessage(message)
    }

    private func sendMenuItemClickedMessage(id: Int, target: URL) {
        guard isConnected else {
            NSLog("Not connected to server")
            return
        }

        let params = [
            "id": id,
            "target": target.path
        ] as [String: Any]

        // Send as notification (no response expected)
        let message = JsonRpcMessage(method: "menuItemClicked", params: params)
        sendMessage(message)
    }

    private func sendMessage(_ message: JsonRpcMessage) {
        guard let messageJson = message.toJSON() else {
            NSLog("Failed to serialize JSON-RPC message")
            return
        }

        let messageWithNewline = messageJson + "\n"
        let data = Data(messageWithNewline.utf8)
        let result = data.withUnsafeBytes { bytes in
            send(socketFileDescriptor, bytes.bindMemory(to: UInt8.self).baseAddress, data.count, 0)
        }

        if result == -1 {
            NSLog("Failed to send message: \(String(cString: strerror(errno)))")
            handleDisconnection()
        } else {
            NSLog("Sent JSON-RPC method: \(message.method ?? "response")")
        }
    }

    private func handleDisconnection() {
        closeConnection()

        DispatchQueue.main.async {
            self.delegate?.socketClientDidDisconnect(self)
        }

        scheduleReconnect()
    }

    private func closeConnection() {
        isConnected = false
        if socketFileDescriptor != -1 {
            close(socketFileDescriptor)
            socketFileDescriptor = -1
        }
    }

    private func scheduleReconnect() {
        guard reconnectAttempts < maxReconnectAttempts else {
            NSLog("Max reconnection attempts reached")
            return
        }

        reconnectAttempts += 1
        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0) // Exponential backoff, max 30 seconds

        NSLog("Scheduling reconnection attempt \(reconnectAttempts) in \(delay) seconds")

        DispatchQueue.main.async {
            self.reconnectTimer?.invalidate()
            self.reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
                self.connect()
            }
        }
    }

    deinit {
        disconnect()
        reconnectTimer?.invalidate()
    }
}

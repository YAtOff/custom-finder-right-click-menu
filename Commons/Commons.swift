//
//  Commons.swift
//  Commons
//
//  Created by Samiyuru Senarathne on 1/25/20.
//  Copyright © 2020 Samiyuru Senarathne.
//
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY
//  OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
//  LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//  FITNESS FOR A PARTICULAR PURPOSE AND
//  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
//  OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//  CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
//  OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
//  OTHER DEALINGS IN THE SOFTWARE.
//

import Foundation

public let MENU_ITEM_CLICKED_NOTIF = "menuItemClickedNotif"
public let MENU_ITEM_INFO_NOTIF = "menuItemInfoNotif"
public let MENU_ITEM_INFO_REQUEST_NOTIF = "menuItemInfoRequestNotif"

// MARK: - Socket Communication

// App Group helper for socket communication
public class AppGroupHelper {
    public static let appGroupID = "com.samiyuru.FinderMenu"
    public static let socketFileName = "finder-menu.sock"

    public static func getSocketPath() -> String? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            NSLog("Failed to get App Group container URL for \(appGroupID)")
            return nil
        }

        return containerURL.appendingPathComponent(socketFileName).path
    }

    public static func getAppGroupContainerURL() -> URL? {
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }
}

// MARK: - JSON-RPC Communication

// JSON-RPC Error codes
public enum JsonRpcErrorCode: Int {
    case parseError = -32700
    case invalidRequest = -32600
    case methodNotFound = -32601
    case invalidParams = -32602
    case internalError = -32603
}

// JSON-RPC Error structure
public struct JsonRpcError: Codable {
    public let code: Int
    public let message: String
    public let data: String?

    public init(code: JsonRpcErrorCode, message: String, data: String? = nil) {
        self.code = code.rawValue
        self.message = message
        self.data = data
    }
}

// JSON-RPC Message structure
public struct JsonRpcMessage: Codable {
    public let jsonrpc = "2.0"
    public let method: String?
    public let params: [String: Any]?
    public let id: Int?
    public let result: [String: Any]?
    public let error: JsonRpcError?

    private enum CodingKeys: String, CodingKey {
        case jsonrpc, method, id, error
    }

    // Request initializer
    public init(method: String, params: [String: Any]? = nil, id: Int? = nil) {
        self.method = method
        self.params = params
        self.id = id
        self.result = nil
        self.error = nil
    }

    // Response initializer
    public init(result: [String: Any], id: Int) {
        self.method = nil
        self.params = nil
        self.id = id
        self.result = result
        self.error = nil
    }

    // Error response initializer
    public init(error: JsonRpcError, id: Int?) {
        self.method = nil
        self.params = nil
        self.id = id
        self.result = nil
        self.error = error
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(jsonrpc, forKey: .jsonrpc)

        if let method = method {
            try container.encode(method, forKey: .method)
        }

        if let id = id {
            try container.encode(id, forKey: .id)
        }

        if let error = error {
            try container.encode(error, forKey: .error)
        }

        // Handle params and result as raw JSON
        if let params = params {
            let paramsData = try JSONSerialization.data(withJSONObject: params)
            let paramsJson = try JSONSerialization.jsonObject(with: paramsData)
            try container.encode(AnyCodable(paramsJson), forKey: CodingKeys(stringValue: "params")!)
        }

        if let result = result {
            let resultData = try JSONSerialization.data(withJSONObject: result)
            let resultJson = try JSONSerialization.jsonObject(with: resultData)
            try container.encode(AnyCodable(resultJson), forKey: CodingKeys(stringValue: "result")!)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)

        // Ensure jsonrpc version
        let version = try container.decode(String.self, forKey: DynamicCodingKey(stringValue: "jsonrpc")!)
        guard version == "2.0" else {
            throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: [], debugDescription: "Invalid JSON-RPC version"))
        }

        method = try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "method")!)
        id = try container.decodeIfPresent(Int.self, forKey: DynamicCodingKey(stringValue: "id")!)
        error = try container.decodeIfPresent(JsonRpcError.self, forKey: DynamicCodingKey(stringValue: "error")!)

        // Decode params and result as dictionaries
        if container.contains(DynamicCodingKey(stringValue: "params")!) {
            let paramsValue = try container.decode(AnyCodable.self, forKey: DynamicCodingKey(stringValue: "params")!)
            params = paramsValue.value as? [String: Any]
        } else {
            params = nil
        }

        if container.contains(DynamicCodingKey(stringValue: "result")!) {
            let resultValue = try container.decode(AnyCodable.self, forKey: DynamicCodingKey(stringValue: "result")!)
            result = resultValue.value as? [String: Any]
        } else {
            result = nil
        }
    }

    public func toJSON() -> String? {
        var dict: [String: Any] = ["jsonrpc": jsonrpc]

        if let method = method {
            dict["method"] = method
        }
        if let params = params {
            dict["params"] = params
        }
        if let id = id {
            dict["id"] = id
        }
        if let result = result {
            dict["result"] = result
        }
        if let error = error {
            dict["error"] = [
                "code": error.code,
                "message": error.message,
                "data": error.data as Any
            ]
        }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: dict),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return nil
        }

        return jsonString
    }

    public static func fromJSON(_ jsonString: String) -> JsonRpcMessage? {
        guard let jsonData = jsonString.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              dict["jsonrpc"] as? String == "2.0" else {
            return nil
        }

        let method = dict["method"] as? String
        let params = dict["params"] as? [String: Any]
        let id = dict["id"] as? Int
        let result = dict["result"] as? [String: Any]

        var error: JsonRpcError? = nil
        if let errorDict = dict["error"] as? [String: Any],
           let code = errorDict["code"] as? Int,
           let message = errorDict["message"] as? String {
            let data = errorDict["data"] as? String
            error = JsonRpcError(code: JsonRpcErrorCode(rawValue: code) ?? .internalError, message: message, data: data)
        }

        if let method = method {
            return JsonRpcMessage(method: method, params: params, id: id)
        } else if let result = result, let id = id {
            return JsonRpcMessage(result: result, id: id)
        } else if let error = error {
            return JsonRpcMessage(error: error, id: id)
        }

        return nil
    }

    public var isRequest: Bool { return method != nil }
    public var isNotification: Bool { return isRequest && id == nil }
    public var isResponse: Bool { return result != nil || error != nil }
}

// Helper structures for JSON encoding/decoding
public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let intValue = try? container.decode(Int.self) {
            value = intValue
        } else if let doubleValue = try? container.decode(Double.self) {
            value = doubleValue
        } else if let stringValue = try? container.decode(String.self) {
            value = stringValue
        } else if let boolValue = try? container.decode(Bool.self) {
            value = boolValue
        } else if let arrayValue = try? container.decode([AnyCodable].self) {
            value = arrayValue.map { $0.value }
        } else if let dictValue = try? container.decode([String: AnyCodable].self) {
            value = dictValue.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unsupported type"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        if let intValue = value as? Int {
            try container.encode(intValue)
        } else if let doubleValue = value as? Double {
            try container.encode(doubleValue)
        } else if let stringValue = value as? String {
            try container.encode(stringValue)
        } else if let boolValue = value as? Bool {
            try container.encode(boolValue)
        } else if let arrayValue = value as? [Any] {
            try container.encode(arrayValue.map { AnyCodable($0) })
        } else if let dictValue = value as? [String: Any] {
            try container.encode(dictValue.mapValues { AnyCodable($0) })
        } else {
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }
}

public struct DynamicCodingKey: CodingKey {
    public var stringValue: String
    public var intValue: Int?

    public init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    public init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

// Socket message types (kept for backward compatibility)
public enum SocketMessageType: String, Codable {
    case requestMenuItems = "REQUEST_MENU_ITEMS"
    case menuItemsResponse = "MENU_ITEMS_RESPONSE"
    case menuItemClicked = "MENU_ITEM_CLICKED"
}

// Socket message wrapper
public struct SocketMessage: Codable {
    public let type: SocketMessageType
    public let payload: String

    public init(type: SocketMessageType, payload: String) {
        self.type = type
        self.payload = payload
    }

    public func toJSON() -> String? {
        guard let jsonData = try? JSONEncoder().encode(self) else { return nil }
        return String(data: jsonData, encoding: .utf8)
    }

    public static func fromJSON(_ jsonString: String) -> SocketMessage? {
        guard let jsonData = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(SocketMessage.self, from: jsonData)
    }
}

// Get the directory for the menu item programs.
// The programs can be apple scripts, bash scripts or executables.
public func programsDir() -> URL {
    // Name of the menu programs directory.
    let menuProgramsDirName = ".findermenu"

    // Get the path to user home dir.
    let scriptParentDirURL = FileManager.default.homeDirectoryForCurrentUser

    // Get the URL for menu programs dir path.
    let menuProgramsDirURL = scriptParentDirURL.appendingPathComponent(menuProgramsDirName)

    return menuProgramsDirURL
}

// Class to represent an item in the right click menu.
public class MenuItemInfo: Encodable, Decodable {

    public var id: Int
    public var title: String

    public init(id: Int, title: String) {
        self.id = id
        self.title = title
    }

    public static func fromJson(menuItemInfosStr: String?) -> [MenuItemInfo]? {
        guard let jsonData = menuItemInfosStr?.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode([MenuItemInfo].self, from: jsonData)
    }

    public static func json(menuItemInfos: [MenuItemInfo]?) -> String? {
        guard let jsonData =  (try? JSONEncoder().encode(menuItemInfos)) else {
            return nil
        }
        return String(data: jsonData, encoding: .utf8)
    }

}

// Class to represent a click of a right click item.
public class MenuItemClickInfo: Encodable, Decodable {

    public var id: Int
    public var target: String

    public init(id: Int, target: String) {
        self.id = id
        self.target = target
    }

    public static func fromJson(str: String?) -> MenuItemClickInfo? {
        guard let jsonData = str?.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(MenuItemClickInfo.self, from: jsonData)
    }

    public func json() -> String? {
        guard let jsonData =  (try? JSONEncoder().encode(self)) else {
            return nil
        }
        return String(data: jsonData, encoding: .utf8)
    }

}

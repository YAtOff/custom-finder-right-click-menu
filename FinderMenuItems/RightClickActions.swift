//
//  FinderSync.swift
//  FinderMenuItems
//
//  Created by Samiyuru Senarathne on 1/22/20.
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

import Cocoa
import FinderSync
import Commons

// This class is the primary class that is referred to in the plist of the Finder Sync extension.
class RightClickActions: FIFinderSync {

    // Cached menu instance.
    var menu: NSMenu?

    // Socket client for communication
    private var socketClient: SocketClient?

    // Constructor of the class.
    override init() {
        super.init()

        // Log the nitialization.
        NSLog("RightClickActions() launched from %@", Bundle.main.bundlePath as NSString)

        // Set up the directory we are syncing.
        FIFinderSyncController.default().directoryURLs = [URL(fileURLWithPath: "/")]

        // Initialize socket client
        setupSocketClient()
    }

    // MARK: - Socket Client Setup

    private func setupSocketClient() {
        socketClient = SocketClient()
        socketClient?.delegate = self
        socketClient?.connect()
    }

    // MARK: - Menu Creation

    // Create a menu item with a given name and a URL association.
    func createMenuItem(menuItemInfo: MenuItemInfo) -> NSMenuItem {
        let menuItem = NSMenuItem(title: menuItemInfo.title, action: #selector(menuItemAction(_:)), keyEquivalent:"");
        // Associate script info with menu item using script info index.
        menuItem.tag = menuItemInfo.id
        return menuItem
    }

    // Create a menu by reading the menu item infos.
    func createMenu(menuItemInfos: [MenuItemInfo]?) -> NSMenu? {
        // Guared unwrap menu item info array.
        guard let menuItemInfos = menuItemInfos else {
            return nil
        }

        // Initialize menu object.
        let menu = NSMenu()

        // Create a menu item for each menu item info in the array.
        for menuItemInfo in menuItemInfos {
            let menuItem = createMenuItem(menuItemInfo: menuItemInfo)
            menu.addItem(menuItem)
        }

        return menu
    }

    // MARK: - Menu Actions

    // Action handler of each menu item.
    @objc func menuItemAction(_ sender: AnyObject?) {
        guard let target = FIFinderSyncController.default().targetedURL() else {
            NSLog("Failed to retrieve the target directory.")
            return
        }

        // Get menu item from the sender.
        guard let menuItem = sender as? NSMenuItem else {
            NSLog("Sender menu item is not retrievable.");
            return
        }

        // Send click event via socket
        socketClient?.sendMenuItemClicked(id: menuItem.tag, target: target)
    }

    // MARK: - FinderSync Override

    // Provide a list of menu items for the right click menu.
    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        // Identify finder open directory background click.
        if (menuKind == FIMenuKind.contextualMenuForContainer){
            NSLog("Directory background right click.")

            // If socket is not connected, try to use cached menu items
            if socketClient?.getCachedMenuItems().isEmpty == false {
                return self.menu ?? createMenu(menuItemInfos: socketClient?.getCachedMenuItems())
            }

            // Return the menu from the instance variable.
            return self.menu
        } else {
            NSLog("Not a directory background.")

            // Return no menu.
            return nil
        }
    }
}

// MARK: - SocketClientDelegate

extension RightClickActions: SocketClientDelegate {
    func socketClient(_ client: SocketClient, didReceiveMenuItems menuItems: [MenuItemInfo]) {
        NSLog("Received \(menuItems.count) menu items via socket")

        // Create and update the menu according to the new menu item infos.
        self.menu = createMenu(menuItemInfos: menuItems)
    }

    func socketClientDidDisconnect(_ client: SocketClient) {
        NSLog("Socket client disconnected - using cached menu items")
        // Menu will fall back to cached items automatically
    }

}


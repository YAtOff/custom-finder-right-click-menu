#!/bin/bash

codesign --force -s - --entitlements ../FinderMenuItems/FinderMenuItems.entitlements dist/ElectronMenu.app/Contents/PlugIns/FinderMenuItems.appex/Contents/Frameworks/Commons.framework
codesign --force -s - --entitlements ../FinderMenuItems/FinderMenuItems.entitlements dist/ElectronMenu.app/Contents/PlugIns/FinderMenuItems.appex/
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/ElectronMenu\ Helper\ \(GPU\).app
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/ElectronMenu\ Helper\ \(Plugin\).app
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/ElectronMenu\ Helper\ \(Renderer\).app
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/ElectronMenu\ Helper.app
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/Electron\ Framework.framework/Versions/Current/Helpers/chrome_crashpad_handler
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/Electron\ Framework.framework
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/ReactiveObjC.framework
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/Squirrel.framework
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Frameworks/Mantle.framework
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/Resources/service
codesign --force -s - --entitlements ElectronMenu.entitlements dist/ElectronMenu.app/Contents/MacOS/ElectronMenu
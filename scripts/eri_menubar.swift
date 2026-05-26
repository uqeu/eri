// eri_menubar — macOS menu-bar mini-app showing eri's listening state
// outside the IDE window. Trust affordance: the user sees the mic
// indicator even when focus is on a terminal or browser, so they
// know exactly when eri is + isn't capturing audio.
//
// Build: `swiftc scripts/eri_menubar.swift -o $ERI_RESOURCES/eri_menubar`
// Launch: the sidecar spawns this binary on `eri/voice/start` and
//         terminates it on `eri/voice/stop`.
//
// Protocol: stdin reads lines like `state:listening` /
// `state:thinking` / `state:idle` so the sidecar can push updates
// without IPC primitives.

import AppKit
import Foundation

enum VoiceState: String {
    case idle = "idle"
    case listening = "listening"
    case thinking = "thinking"
    case unavailable = "unavailable"

    var glyph: String {
        switch self {
        case .idle: return "○"
        case .listening: return "●"
        case .thinking: return "◐"
        case .unavailable: return "⊘"
        }
    }

    var label: String {
        switch self {
        case .idle: return "eri · idle"
        case .listening: return "eri · listening"
        case .thinking: return "eri · thinking"
        case .unavailable: return "eri · off"
        }
    }
}

final class MenuBarController: NSObject {
    private let item: NSStatusItem
    private var state: VoiceState = .idle

    override init() {
        self.item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        rebuildMenu()
        render()
    }

    func apply(_ newState: VoiceState) {
        self.state = newState
        DispatchQueue.main.async { self.render() }
    }

    private func render() {
        if let button = item.button {
            button.title = "🎙 " + state.glyph + " eri"
            button.toolTip = state.label
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let stateItem = NSMenuItem(title: "eri voice", action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        menu.addItem(stateItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(
            title: "Open eri.app",
            action: #selector(openApp),
            keyEquivalent: "o"
        ))
        menu.addItem(NSMenuItem(
            title: "Quit listener",
            action: #selector(quit),
            keyEquivalent: "q"
        ))
        for entry in menu.items where entry.action != nil { entry.target = self }
        item.menu = menu
    }

    @objc private func openApp() {
        let url = URL(fileURLWithPath: "/Applications/eri.app")
        NSWorkspace.shared.open(url)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

// stdin reader runs on a background queue so the AppKit main loop
// stays responsive. Each line is "state:<value>".
final class StdinReader {
    private let controller: MenuBarController
    init(_ controller: MenuBarController) { self.controller = controller }
    func run() {
        let controller = self.controller
        DispatchQueue.global(qos: .utility).async {
            let handle = FileHandle.standardInput
            handle.readabilityHandler = { fh in
                let data = fh.availableData
                if data.isEmpty { return }
                if let text = String(data: data, encoding: .utf8) {
                    for line in text.split(separator: "\n") {
                        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                        if let value = trimmed.split(separator: ":").last,
                           let state = VoiceState(rawValue: String(value)) {
                            controller.apply(state)
                        }
                    }
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
let controller = MenuBarController()
StdinReader(controller).run()
app.run()

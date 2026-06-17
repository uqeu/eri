// eri_agent_manager — standalone Eri workbench host.
//
// This is intentionally separate from the editor substrate. It owns the first
// screen, loads the Agent Manager web asset, and opens editor/terminal/preview
// surfaces as tools when Eri asks for them.

import AVFoundation
import Cocoa
import Foundation
import Speech
import WebKit

struct LaunchArgs {
    var intent: String = ""
    var workspace: String = LaunchArgs.defaultWorkspace()

    /// When launched from Finder/`open`, the process cwd is `/` (system root) —
    /// not a project. eri would then "work" in /Library, write builds nowhere
    /// useful, and starve the model of context. Fall back to a dedicated,
    /// writable workspace so builds land somewhere real and the file tree shows
    /// the project. A `--workspace` arg (or a real writable cwd) still wins.
    static func defaultWorkspace() -> String {
        let cwd = FileManager.default.currentDirectoryPath
        if cwd != "/" && !cwd.isEmpty && FileManager.default.isWritableFile(atPath: cwd) {
            return cwd
        }
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("eri-projects/default", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.path
    }
}

func parseLaunchArgs() -> LaunchArgs {
    var parsed = LaunchArgs()
    var iterator = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = iterator.next() {
        switch arg {
        case "--intent":
            if let value = iterator.next(), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parsed.intent = value
            }
        case "--workspace":
            if let value = iterator.next(), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parsed.workspace = value
            }
        default:
            if !arg.hasPrefix("-") {
                parsed.intent = arg
            }
        }
    }
    return parsed
}

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var controller: AgentManagerController?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "eri" else { return }
        let body = message.body as? [String: Any] ?? [:]
        let command = body["command"] as? String ?? "unknown"
        controller?.handle(command: command, payload: body)
    }
}

/// eri's always-on overlay companion — a transparent, non-activating floating
/// panel that sits over the screen without covering it (auto-sized to its
/// content). Extracted from the main controller so the overlay is its own deep
/// module: it owns its panel + summon hotkey and needs only the shared message
/// bridge and a way to resolve its HTML asset. `toggle()` returns the new
/// visibility so the caller can enter/leave voice→control mode.
final class OverlayController {
    private var panel: NSPanel?
    private var web: WKWebView?
    private let bridge: Bridge
    private let resolveAsset: ([String]) -> URL?

    init(bridge: Bridge, resolveAsset: @escaping ([String]) -> URL?) {
        self.bridge = bridge
        self.resolveAsset = resolveAsset
    }

    @discardableResult func toggle() -> Bool {
        if panel?.isVisible == true { panel?.orderOut(nil); return false }
        if panel == nil { build() }
        position()
        panel?.orderFrontRegardless()
        return true
    }

    private func build() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "eri") // same bridge → controller dispatch
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 120), configuration: config)
        web.setValue(false, forKey: "drawsBackground") // transparent — glass is in the CSS
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        if let html = resolveAsset(["apps", "eri-agent-manager", "overlay.html"]) {
            web.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
        }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 120),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false // the CSS panel draws its own float shadow
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = web
        self.web = web
        self.panel = panel
    }

    /// Snug-fit to the web content + re-anchor top-center (footprint == UI).
    func resize(width: Double, height: Double) {
        guard let panel = panel else { return }
        panel.setContentSize(NSSize(width: max(120, width), height: max(48, height)))
        position()
    }

    private func position() {
        guard let panel = panel, let screen = NSScreen.main else { return }
        let vis = screen.visibleFrame
        let size = panel.frame.size
        panel.setFrameOrigin(NSPoint(x: vis.midX - size.width / 2, y: vis.maxY - size.height - 8))
    }

    // MARK: - summon hotkey (default ⌘⌥E, user-rebindable, read live per keypress)

    func hotkeyMatches(_ event: NSEvent) -> Bool {
        let (keyCode, mods) = config()
        let pressed = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        return event.keyCode == keyCode && pressed == mods
    }

    func setHotkey(keyCode: Int?, command: Bool, option: Bool, shift: Bool, control: Bool) {
        let d = UserDefaults.standard
        if let kc = keyCode { d.set(kc, forKey: "overlayHotkeyKeyCode") }
        d.set(command, forKey: "overlayHotkeyCmd")
        d.set(option, forKey: "overlayHotkeyOpt")
        d.set(shift, forKey: "overlayHotkeyShift")
        d.set(control, forKey: "overlayHotkeyCtrl")
    }

    func label() -> String {
        let (keyCode, mods) = config()
        var s = ""
        if mods.contains(.control) { s += "⌃" }
        if mods.contains(.option) { s += "⌥" }
        if mods.contains(.shift) { s += "⇧" }
        if mods.contains(.command) { s += "⌘" }
        return s + Self.keyName(keyCode)
    }

    private func config() -> (UInt16, NSEvent.ModifierFlags) {
        let d = UserDefaults.standard
        guard d.object(forKey: "overlayHotkeyKeyCode") != nil else {
            return (14, [.command, .option]) // 14 = 'e'
        }
        var mods: NSEvent.ModifierFlags = []
        if d.bool(forKey: "overlayHotkeyCmd") { mods.insert(.command) }
        if d.bool(forKey: "overlayHotkeyOpt") { mods.insert(.option) }
        if d.bool(forKey: "overlayHotkeyShift") { mods.insert(.shift) }
        if d.bool(forKey: "overlayHotkeyCtrl") { mods.insert(.control) }
        if mods.isEmpty { return (14, [.command, .option]) } // refuse modifier-less
        return (UInt16(d.integer(forKey: "overlayHotkeyKeyCode")), mods)
    }

    private static func keyName(_ code: UInt16) -> String {
        let map: [UInt16: String] = [
            0: "A", 1: "S", 2: "D", 3: "F", 5: "G", 4: "H", 38: "J", 40: "K", 37: "L",
            13: "W", 14: "E", 15: "R", 17: "T", 16: "Y", 32: "U", 34: "I", 31: "O", 35: "P",
            12: "Q", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 45: "N", 46: "M",
            49: "Space", 36: "↩", 53: "⎋",
        ]
        return map[code] ?? "key\(code)"
    }
}

/// A transparent titlebar drag handle. With `.fullSizeContentView` the WKWebView
/// covers the titlebar and eats mouse events, so `isMovableByWindowBackground`
/// alone can't drag the window. This view sits over the NON-interactive center-top
/// strip and returns `mouseDownCanMoveWindow = true` — the authoritative AppKit way
/// to make a custom-chrome window draggable without blocking the traffic lights
/// (left) or the web header buttons (right).
final class WindowDragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        // Grab the event in our frame so the drag works; outside, pass through.
        return bounds.contains(convert(point, from: superview)) ? self : nil
    }
}

final class AgentManagerController: NSObject, NSWindowDelegate, WKNavigationDelegate {
    private let args: LaunchArgs
    private let bridge = Bridge()
    private let webView: WKWebView
    private let window: NSWindow
    private var runningProcesses: [Process] = []
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var voiceActive = false      // hands-free: keep listening across utterances
    private var didSpeak = false
    private var finishing = false
    private var lastVoiceAt = Date()
    // Computer control (P0): the loopback actuation server + its endpoint, and
    // a global panic-stop hotkey monitor that halts all actuation instantly.
    private var controlServer: Process?
    private var controlEndpoint: String?
    private var controlToken: String?
    private var panicMonitor: Any?
    // Hands-free voice → control. When on, recognized speech routes to
    // `eri voice` (actuate the computer) instead of the chat composer, and eri
    // speaks its reply back via native TTS. Off by default → the existing
    // voice→chat path is untouched.
    private var voiceControlMode = false
    private let speechSynth = AVSpeechSynthesizer()
    // Always-on overlay companion — its own module (OverlayController). The
    // controller just routes commands to it + owns the global summon-hotkey
    // monitor token.
    private lazy var overlay = OverlayController(
        bridge: bridge,
        resolveAsset: { [weak self] in self?.resolveRepoFile($0) })
    private var overlayHotkey: Any?

    init(args: LaunchArgs) {
        self.args = args

        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.websiteDataStore = .nonPersistent()
        let userContent = WKUserContentController()
        config.userContentController = userContent

        let rect = AgentManagerController.defaultWindowRect()
        self.webView = WKWebView(frame: rect, configuration: config)
        self.window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        super.init()

        bridge.controller = self
        userContent.add(bridge, name: "eri")

        // Inject the launch intent before any page script runs. A user script at
        // .atDocumentStart is guaranteed to execute before manager.js, which lets
        // us load the page with loadFileURL (real CSS/JS subresources) instead of
        // loadHTMLString (which WebKit blocks from reading sibling files).
        let workspaceName = self.workspaceURL().lastPathComponent.isEmpty
            ? self.workspaceURL().path
            : self.workspaceURL().lastPathComponent
        let bootstrap: [String: Any] = ["intent": args.intent, "workspace": workspaceName]
        let bootData = (try? JSONSerialization.data(withJSONObject: bootstrap, options: [])) ?? Data("{}".utf8)
        let bootJSON = String(data: bootData, encoding: .utf8) ?? "{}"
        let bootScript = WKUserScript(
            source: "window.ERI_BOOTSTRAP = \(bootJSON);",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        userContent.addUserScript(bootScript)

        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground") // transparent → the glass shows through

        // Real macOS glassmorphism: an NSVisualEffectView (system vibrancy/blur)
        // behind the transparent web UI. The CSS panels are translucent, so this
        // live blur of what's behind the window shows through = frosted glass,
        // NOT a flat dark fill. (The old setup put an opaque webView on an opaque
        // window — zero glass.)
        let glass = NSVisualEffectView(frame: rect)
        glass.material = .underWindowBackground
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.autoresizingMask = [.width, .height]
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 12
        glass.layer?.masksToBounds = true
        webView.frame = glass.bounds
        webView.autoresizingMask = [.width, .height]
        glass.addSubview(webView)

        // Native draggable titlebar strip over the center-top (between the traffic
        // lights and the web header's right-side buttons), since the WKWebView
        // covers the transparent titlebar under fullSizeContentView.
        let drag = WindowDragView()
        drag.translatesAutoresizingMaskIntoConstraints = false
        glass.addSubview(drag)
        NSLayoutConstraint.activate([
            drag.topAnchor.constraint(equalTo: glass.topAnchor),
            drag.leadingAnchor.constraint(equalTo: glass.leadingAnchor, constant: 92),
            drag.trailingAnchor.constraint(equalTo: glass.trailingAnchor, constant: -300),
            drag.heightAnchor.constraint(equalToConstant: 42),
        ])

        window.title = "Eri"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        // Drag the window from any non-interactive area (the WKWebView covers the
        // transparent titlebar under fullSizeContentView, so titlebar-drag alone
        // fails — this restores moving it).
        window.isMovableByWindowBackground = true
        window.contentView = glass
        window.delegate = self
        window.setFrameAutosaveName("eri.agent-manager.window")
    }

    func show() {
        loadManager()
        installPanicHotkey()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        if let m = panicMonitor { NSEvent.removeMonitor(m); panicMonitor = nil }
        if let m = overlayHotkey { NSEvent.removeMonitor(m); overlayHotkey = nil }
        controlServer?.terminate()
        runningProcesses.forEach { process in
            if process.isRunning { process.terminate() }
        }
        NSApplication.shared.terminate(nil)
    }

    /// Append a line to /tmp/eri_app.log so the app can be debugged without a
    /// visible webview console. Cheap, best-effort, never throws into the UI.
    func logLine(_ s: String) {
        // Per-user log dir (0700), owner-only file (0600), O_NOFOLLOW so a symlink
        // planted at the path can't redirect the write. Never a fixed /tmp path.
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/eri", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let path = dir.appendingPathComponent("app.log").path
        let line = "\(Date()) \(s)\n"
        guard let data = line.data(using: .utf8) else { return }
        let fd = open(path, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { return }
        _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
        close(fd)
    }

    func handle(command: String, payload: [String: Any]) {
        if command == "log" {
            logLine("JS \((payload["msg"] as? String) ?? "")")
            return
        }
        // Log only the command name, never raw payload values (may hold prompts).
        logLine("CMD \(command)")
        switch command {
        // Real agent run: stream `eri ship`/`build` events into the chat.
        case "runEri", "spawnAgent":
            let intent = (payload["intent"] as? String) ?? args.intent
            let mode = (payload["mode"] as? String) ?? "Plan"
            let sub = mode == "Fast" ? ["build", intent] : ["ship", intent, "--output", "artifact-json"]
            streamEriCommand(command: "runEri", subcommand: sub)
        case "runCli":
            let raw = (payload["cmd"] as? String) ?? ""
            streamEriCommand(command: "runCli", subcommand: tokenize(raw))
        case "askEri":
            let q = (payload["intent"] as? String) ?? (payload["cmd"] as? String) ?? ""
            streamEriCommand(command: "askEri", subcommand: ["ask", q])

        // Web research: stream `eri research <query>` (Claude web search) into chat.
        case "research":
            let query = (payload["query"] as? String) ?? (payload["intent"] as? String) ?? ""
            streamEriCommand(command: "research", subcommand: ["research", query])

        // Read-only CLI commands → text back into the chat.
        case "listAgents":
            runEriRead(command: command, sub: ["agent", "list"])
        case "listMemory":
            runEriRead(command: command, sub: ["memory", "recall", (payload["intent"] as? String) ?? "recent"])
        case "runDoctor":
            runEriRead(command: command, sub: ["doctor"])

        // In-app editor: real workspace files (no VSCodium).
        case "openEditor", "listFiles":
            listFiles(path: payload["path"] as? String)
        case "readFile":
            readFile(path: (payload["path"] as? String) ?? "")

        // Auth (device-code flow): stream the URL + code, then refresh status.
        case "authLogin":
            streamEriCommand(command: "authLogin", subcommand: ["auth", "login"])
        case "authStatus":
            authStatus()
        case "authLogout":
            runEriRead(command: "authLogout", sub: ["auth", "logout"])

        // Voice: native on-device dictation (Speech framework). Gaze: real sidecar.
        case "startVoice":
            startVoiceListening()
        case "stopVoice":
            stopVoiceListening()
            emitSignal("startVoice", json: "{\"type\":\"status\",\"message\":\"stopped\"}")
        case "startGaze":
            startSidecar(command: command, rel: ["scripts", "eri_gaze_sidecar"], display: "gaze")

        // Computer control: actuate the machine toward a goal. Spins up the
        // loopback actuation server, then streams `eri control --live <goal>`
        // with ERI_CONTROL_ENDPOINT pointed at it. panicStop halts everything.
        case "startControl":
            let goal = (payload["goal"] as? String) ?? (payload["intent"] as? String) ?? ""
            startControl(goal: goal)
        case "panicStop":
            panicStop()
        // Toggle hands-free voice → control. When on, recognized speech drives
        // `eri voice` (actuate) instead of the chat composer. The webview calls
        // this when entering/leaving Control mode.
        case "setVoiceControl":
            voiceControlMode = (payload["on"] as? Bool) ?? false
            reply(command: command, status: "ok", detail: voiceControlMode ? "on" : "off")
        // Always-on overlay companion (OverlayController owns the panel/hotkey).
        case "toggleOverlay":
            voiceControlMode = overlay.toggle() // visible → voice routes to control
        case "overlaySize":
            if let w = payload["width"] as? Double, let h = payload["height"] as? Double {
                overlay.resize(width: w, height: h)
            }
        case "overlayAsk":
            if let text = payload["text"] as? String, !text.isEmpty { startControl(goal: text) }
        case "overlayPanel":
            break // size is driven by overlaySize; nothing else to do
        // Rebind the summon hotkey. payload: {keyCode, command, option, shift,
        // control}. Takes effect immediately (read live per keypress).
        case "setOverlayHotkey":
            overlay.setHotkey(
                keyCode: payload["keyCode"] as? Int,
                command: (payload["command"] as? Bool) ?? false,
                option: (payload["option"] as? Bool) ?? false,
                shift: (payload["shift"] as? Bool) ?? false,
                control: (payload["control"] as? Bool) ?? false)
            eval("window.eriOverlayHotkey && window.eriOverlayHotkey(\(jsArg(overlay.label())));")
            reply(command: command, status: "ok", detail: overlay.label())
        case "getOverlayHotkey":
            eval("window.eriOverlayHotkey && window.eriOverlayHotkey(\(jsArg(overlay.label())));")

        // Indexed sources from the graphify knowledge graph.
        case "openSources", "attachContext":
            loadSources()

        // Native surfaces.
        case "openPreview":
            openPreview()
        case "openTerminal":
            openTerminal()
        case "openGit":
            runWorkspaceCommand(command: command, displayName: "git", args: ["git", "status", "--short"])
        case "runReview":
            runWorkspaceCommand(command: command, displayName: "review", args: checkerArgs(test: false))
        case "ship":
            runWorkspaceCommand(command: command, displayName: "ship", args: checkerArgs(test: true))
        case "createCheckpoint":
            createCheckpoint()
        case "openUrl":
            if let raw = payload["url"] as? String, let url = URL(string: raw) {
                NSWorkspace.shared.open(url)
            }
        case "openExternalEditor":
            openEditor()
        case "openExternalFiles":
            runDetached(command: command, displayName: "files", executable: "/usr/bin/open", args: [workspaceURL().path])

        // Dynamic morph: the webview asks the native window to resize per mode
        // (build expands toward a full editor + preview; eyes shrinks to a pill).
        // Anchored at the top-left so the card grows down/right, then clamped to
        // the visible screen. Presentation only — never implies an action ran.
        case "resizeWindow":
            resizeWindow(payload: payload)
            reply(command: command, status: "ok", detail: "")

        default:
            reply(command: command, status: "ok", detail: "")
        }
    }

    /// Resize the window toward a mode's target size, animated, keeping the
    /// top-left corner fixed and clamping the result onto the visible screen.
    /// Floors at a usable minimum so a bad payload can't collapse the window.
    private func resizeWindow(payload: [String: Any]) {
        let minW: CGFloat = 360
        let minH: CGFloat = 200
        let frame = window.frame
        let screen = window.screen?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? frame
        let reqW = CGFloat((payload["width"] as? NSNumber)?.doubleValue ?? Double(frame.width))
        let reqH = CGFloat((payload["height"] as? NSNumber)?.doubleValue ?? Double(frame.height))
        let w = min(max(minW, reqW), screen.width)
        let h = min(max(minH, reqH), screen.height)

        // Anchor the top edge (macOS origin is bottom-left, so top = maxY).
        let top = frame.maxY
        var x = frame.minX
        var y = top - h
        if x + w > screen.maxX { x = screen.maxX - w }
        if x < screen.minX { x = screen.minX }
        if y + h > screen.maxY { y = screen.maxY - h }
        if y < screen.minY { y = screen.minY }

        let target = NSRect(x: x, y: y, width: w, height: h)
        let animate = (payload["animate"] as? NSNumber)?.boolValue ?? true
        window.setFrame(target, display: true, animate: animate)
    }

    private func loadManager() {
        guard let htmlURL = resolveRepoFile(["apps", "eri-agent-manager", "index.html"]) else {
            webView.loadHTMLString("<main style='font:16px -apple-system;background:#090b0d;color:white;padding:24px'>Eri Agent Manager assets were not found.</main>", baseURL: nil)
            return
        }
        // Grant read access to the whole asset directory so manager.css, manager.js,
        // and any url(...) fonts/images resolve as real subresources.
        webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
    }

    private func workspaceURL() -> URL {
        URL(fileURLWithPath: args.workspace, isDirectory: true)
    }

    private static func defaultWindowRect() -> NSRect {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(max(screen.width * 0.88, 1180), 1680)
        let height = min(max(screen.height * 0.86, 760), 1060)
        let x = screen.origin.x + (screen.width - width) / 2
        let y = screen.origin.y + (screen.height - height) / 2
        return NSRect(x: x, y: y, width: width, height: height)
    }

    private func openEditor() {
        guard let app = resolveRepoFile(["ide", "VSCode-darwin-arm64", "eri.app"]) else {
            reply(command: "openEditor", status: "failed", detail: "Eri editor app was not found")
            return
        }
        runDetached(
            command: "openEditor",
            displayName: "editor",
            executable: "/usr/bin/open",
            args: ["-n", app.path, "--args", args.workspace]
        )
    }

    private func openPreview() {
        guard let preview = resolveRepoFile(["scripts", "eri_preview"]) else {
            reply(command: "openPreview", status: "failed", detail: "Eri preview sidecar was not found")
            return
        }
        runDetached(command: "openPreview", displayName: "preview", executable: preview.path, args: [])
    }

    private func openTerminal() {
        runDetached(
            command: "openTerminal",
            displayName: "terminal",
            executable: "/usr/bin/open",
            args: ["-a", "Terminal", workspaceURL().path]
        )
    }

    private func checkerArgs(test: Bool) -> [String] {
        let workspace = workspaceURL()
        if FileManager.default.fileExists(atPath: workspace.appendingPathComponent("Cargo.toml").path) {
            return test ? ["cargo", "test"] : ["cargo", "check"]
        }
        if FileManager.default.fileExists(atPath: workspace.appendingPathComponent("package.json").path) {
            return test ? ["npm", "test"] : ["npm", "run", "build"]
        }
        if FileManager.default.fileExists(atPath: workspace.appendingPathComponent(".git").path) {
            return ["git", "status", "--short"]
        }
        return ["/bin/echo", "No checker found for this workspace"]
    }

    private func createCheckpoint() {
        let workspace = workspaceURL()
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = workspace.appendingPathComponent(".eri/checkpoints/\(stamp)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let unstaged = capture(args: ["git", "diff", "--binary"]) ?? ""
            let staged = capture(args: ["git", "diff", "--cached", "--binary"]) ?? ""
            try unstaged.write(to: dir.appendingPathComponent("unstaged.patch"), atomically: true, encoding: .utf8)
            try staged.write(to: dir.appendingPathComponent("staged.patch"), atomically: true, encoding: .utf8)
            let manifest = """
            {
              "createdBy": "eri",
              "workspace": "\(workspace.path.replacingOccurrences(of: "\"", with: "\\\""))",
              "createdAt": "\(stamp)"
            }
            """
            try manifest.write(to: dir.appendingPathComponent("checkpoint.json"), atomically: true, encoding: .utf8)
            reply(command: "createCheckpoint", status: "saved", detail: "Saved \(dir.path)")
        } catch {
            reply(command: "createCheckpoint", status: "failed", detail: error.localizedDescription)
        }
    }

    private func runDetached(command: String, displayName: String, executable: String, args: [String]) {
        do {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = args
            process.currentDirectoryURL = workspaceURL()
            try process.run()
            runningProcesses.append(process)
            reply(command: command, status: "opened", detail: "\(displayName) opened")
        } catch {
            reply(command: command, status: "failed", detail: error.localizedDescription)
        }
    }

    private func runWorkspaceCommand(command: String, displayName: String, args: [String]) {
        guard let first = args.first else {
            reply(command: command, status: "failed", detail: "No command configured")
            return
        }
        do {
            let process = Process()
            let pipe = Pipe()
            process.executableURL = first.hasPrefix("/") ? URL(fileURLWithPath: first) : URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = first.hasPrefix("/") ? Array(args.dropFirst()) : args
            process.currentDirectoryURL = workspaceURL()
            process.standardOutput = pipe
            process.standardError = pipe
            process.terminationHandler = { [weak self] finished in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let clipped = output.count > 260 ? String(output.suffix(260)) : output
                DispatchQueue.main.async {
                    self?.reply(
                        command: command,
                        status: finished.terminationStatus == 0 ? "ok" : "failed",
                        detail: clipped.isEmpty ? "\(displayName) exited \(finished.terminationStatus)" : clipped
                    )
                }
            }
            try process.run()
            runningProcesses.append(process)
            reply(command: command, status: "running", detail: "\(displayName) started")
        } catch {
            reply(command: command, status: "failed", detail: error.localizedDescription)
        }
    }

    private func capture(args: [String]) -> String? {
        guard let first = args.first else { return nil }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = first.hasPrefix("/") ? URL(fileURLWithPath: first) : URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = first.hasPrefix("/") ? Array(args.dropFirst()) : args
        process.currentDirectoryURL = workspaceURL()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }

    // MARK: - eri CLI wiring

    private func eriBinaryURL() -> URL? {
        if let env = ProcessInfo.processInfo.environment["ERI_BIN"], !env.isEmpty {
            return URL(fileURLWithPath: env)
        }
        for rel in [["target", "release", "eri"], ["target", "debug", "eri"]] {
            if let url = resolveRepoFile(rel) { return url }
        }
        return nil
    }

    private func tokenize(_ s: String) -> [String] {
        s.split(whereSeparator: { $0 == " " }).map(String.init)
    }

    // JSON-encode a Swift string into a safe JS string literal (incl. surrounding quotes).
    private func jsArg(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        var str = String(data: data, encoding: .utf8) ?? "[\"\"]"
        if str.hasPrefix("[") { str.removeFirst() }
        if str.hasSuffix("]") { str.removeLast() }
        return str
    }

    private func eval(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func streamEriCommand(command: String, subcommand: [String]) {
        guard let eri = eriBinaryURL() else {
            emitStream(command: command, kind: "error", text: "eri binary not found — build it with: cargo build -p eri_cli")
            reply(command: command, status: "failed", detail: "eri not found")
            return
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = eri
        process.arguments = subcommand
        process.currentDirectoryURL = workspaceURL()
        process.standardOutput = pipe
        process.standardError = pipe
        logLine("RUN \(eri.path) \(subcommand.joined(separator: " ")) cwd=\(workspaceURL().path)")
        let handle = pipe.fileHandleForReading
        handle.readabilityHandler = { [weak self] h in
            let chunk = h.availableData
            guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
            for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) where !line.isEmpty {
                let s = String(line)
                DispatchQueue.main.async {
                    // Never log auth streams — they carry the device code / token.
                    if !command.hasPrefix("auth") {
                        self?.logLine("OUT[\(command)] \(s.prefix(180))")
                    }
                    self?.forwardStreamLine(command: command, line: s)
                }
            }
        }
        process.terminationHandler = { [weak self] p in
            handle.readabilityHandler = nil
            DispatchQueue.main.async {
                self?.logLine("EXIT[\(command)] status=\(p.terminationStatus)")
                self?.reply(command: command, status: p.terminationStatus == 0 ? "done" : "failed", detail: "")
            }
        }
        do {
            try process.run()
            runningProcesses.append(process)
            reply(command: command, status: "running", detail: "")
        } catch {
            reply(command: command, status: "failed", detail: error.localizedDescription)
        }
    }

    // MARK: Computer control

    private func controlServerURL() -> URL? {
        if let env = ProcessInfo.processInfo.environment["ERI_CONTROL_SERVER"], !env.isEmpty {
            return URL(fileURLWithPath: env)
        }
        return resolveRepoFile(["target", "eri_control_server"])
    }

    /// Ensure the actuation server is up, then invoke `then` with its endpoint
    /// (nil on failure). The server prints `ERI_CONTROL_ENDPOINT=...` on its
    /// first line; we capture that and keep the process running.
    private func ensureControlServer(then: @escaping (String?) -> Void) {
        if let ep = controlEndpoint, controlToken != nil, controlServer?.isRunning == true {
            then(ep)
            return
        }
        guard let server = controlServerURL() else {
            then(nil)
            return
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = server
        process.arguments = ["0"] // ephemeral port
        process.standardOutput = pipe
        let handle = pipe.fileHandleForReading
        var delivered = false
        var ep: String?
        var tok: String?
        handle.readabilityHandler = { [weak self] h in
            let chunk = h.availableData
            guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
            for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
                if line.hasPrefix("ERI_CONTROL_ENDPOINT=") {
                    ep = String(line.dropFirst("ERI_CONTROL_ENDPOINT=".count))
                } else if line.hasPrefix("ERI_CONTROL_TOKEN=") {
                    tok = String(line.dropFirst("ERI_CONTROL_TOKEN=".count))
                }
            }
            // Deliver only once BOTH endpoint + token are known (the server
            // requires the token on every request).
            if let e = ep, let t = tok, !delivered {
                delivered = true
                DispatchQueue.main.async {
                    self?.controlEndpoint = e
                    self?.controlToken = t
                    then(e)
                }
            }
        }
        do {
            try process.run()
            controlServer = process
            runningProcesses.append(process)
        } catch {
            then(nil)
        }
    }

    private func startControl(goal: String) {
        let trimmed = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reply(command: "startControl", status: "failed", detail: "no goal")
            return
        }
        guard let eri = eriBinaryURL() else {
            emitStream(command: "control", kind: "error", text: "eri binary not found — build it with: cargo build -p eri_cli")
            reply(command: "startControl", status: "failed", detail: "eri not found")
            return
        }
        ensureControlServer { [weak self] endpoint in
            guard let self = self else { return }
            guard let endpoint = endpoint else {
                self.emitStream(command: "control", kind: "error", text: "control server unavailable — build it with: swiftc -O scripts/eri_control_server.swift -o target/eri_control_server")
                self.reply(command: "startControl", status: "failed", detail: "no control server")
                return
            }
            let process = Process()
            let pipe = Pipe()
            process.executableURL = eri
            process.arguments = ["control", "--live", trimmed]
            process.currentDirectoryURL = self.workspaceURL()
            var env = ProcessInfo.processInfo.environment
            env["ERI_CONTROL_ENDPOINT"] = endpoint
            if let token = self.controlToken { env["ERI_CONTROL_TOKEN"] = token }
            // Where the `look` tool finds the local face-redaction sidecar.
            if let redact = self.resolveRepoFile(["scripts", "eri_redact.py"]) {
                env["ERI_REDACT_SCRIPT"] = redact.path
            }
            process.environment = env
            process.standardOutput = pipe
            process.standardError = pipe
            let handle = pipe.fileHandleForReading
            handle.readabilityHandler = { [weak self] h in
                let chunk = h.availableData
                guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
                for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) where !line.isEmpty {
                    let s = String(line)
                    DispatchQueue.main.async {
                        self?.eval("window.eriStreamEvent && window.eriStreamEvent(\("control".debugDescription), \(self?.jsArg(s) ?? "\"\""));")
                    }
                }
            }
            process.terminationHandler = { [weak self] p in
                handle.readabilityHandler = nil
                DispatchQueue.main.async {
                    self?.reply(command: "startControl", status: p.terminationStatus == 0 ? "done" : "failed", detail: "")
                }
            }
            do {
                try process.run()
                self.runningProcesses.append(process)
                self.reply(command: "startControl", status: "running", detail: "")
            } catch {
                self.reply(command: "startControl", status: "failed", detail: error.localizedDescription)
            }
        }
    }

    // MARK: - Always-on overlay

    /// Speak a short line via native macOS TTS (the `[eri:speak]` reply line).
    private func speak(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        if speechSynth.isSpeaking { speechSynth.stopSpeaking(at: .immediate) }
        speechSynth.speak(AVSpeechUtterance(string: t))
    }

    /// Hands-free voice → control: drive `eri voice <transcript>` (live when the
    /// control server is up, else dry-run), stream its output to the control
    /// view, and SPEAK the `[eri:speak]` reply line. Mirrors startControl's spawn
    /// + env so actuation, redaction, and the token are wired identically.
    private func runVoiceControl(_ transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let eri = eriBinaryURL() else { return }
        ensureControlServer { [weak self] endpoint in
            guard let self = self else { return }
            let process = Process()
            let pipe = Pipe()
            process.executableURL = eri
            var arguments = ["voice"]
            if endpoint != nil { arguments.append("--live") } // actuate only if the bridge is up
            arguments.append(trimmed)
            process.arguments = arguments
            process.currentDirectoryURL = self.workspaceURL()
            var env = ProcessInfo.processInfo.environment
            if let endpoint = endpoint { env["ERI_CONTROL_ENDPOINT"] = endpoint }
            if let token = self.controlToken { env["ERI_CONTROL_TOKEN"] = token }
            if let redact = self.resolveRepoFile(["scripts", "eri_redact.py"]) {
                env["ERI_REDACT_SCRIPT"] = redact.path
            }
            process.environment = env
            process.standardOutput = pipe
            process.standardError = pipe
            let handle = pipe.fileHandleForReading
            handle.readabilityHandler = { [weak self] h in
                let chunk = h.availableData
                guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
                for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) where !line.isEmpty {
                    let s = String(line)
                    DispatchQueue.main.async {
                        // The CLI marks its spoken reply with `[eri:speak] …`.
                        if let r = s.range(of: "[eri:speak]") {
                            self?.speak(String(s[r.upperBound...]))
                        }
                        self?.eval("window.eriStreamEvent && window.eriStreamEvent(\("control".debugDescription), \(self?.jsArg(s) ?? "\"\""));")
                    }
                }
            }
            process.terminationHandler = { [weak handle] _ in handle?.readabilityHandler = nil }
            do {
                try process.run()
                self.runningProcesses.append(process)
            } catch {
                self.emitStream(command: "control", kind: "error", text: "voice control failed: \(error.localizedDescription)")
            }
        }
    }

    /// Halt all actuation immediately: kill the control loop processes and the
    /// actuation server. Bound to a global hotkey (⌘⌥⎋) + the panicStop command.
    private func panicStop() {
        runningProcesses.forEach { if $0.isRunning { $0.terminate() } }
        runningProcesses.removeAll()
        controlServer?.terminate()
        controlServer = nil
        controlEndpoint = nil
        controlToken = nil
        emitSignal("control", json: "{\"type\":\"panic\",\"message\":\"all actuation stopped\"}")
    }

    /// Register the global panic-stop hotkey: ⌘⌥⎋ stops everything even while
    /// another app is focused (so a runaway action is always interruptible).
    private func installPanicHotkey() {
        panicMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            // ⌘⌥⎋ — panic-stop all actuation.
            if event.keyCode == 53 && mods.contains(.command) && mods.contains(.option) {
                DispatchQueue.main.async { self?.panicStop() }
            }
        }
        // Summon/dismiss the overlay. Default ⌘⌥E ("E" for eri — not a macOS
        // system shortcut, and in the same ⌘⌥ family as panic-stop). The user
        // can rebind it (setOverlayHotkey); the config is read per-event so a
        // change takes effect immediately without re-registering.
        overlayHotkey = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self, self.overlay.hotkeyMatches(event) else { return }
            DispatchQueue.main.async { self.voiceControlMode = self.overlay.toggle() }
        }
    }

    private func forwardStreamLine(command: String, line: String) {
        if command == "authLogin" {
            eval("window.eriAuthStream && window.eriAuthStream(\(jsArg(line)));")
            return
        }
        if command == "startGaze" || command == "startVoice" {
            eval("window.eriSignal && window.eriSignal(\(jsArg(command)), \(jsArg(line)));")
            return
        }
        eval("window.eriStreamEvent && window.eriStreamEvent(\(jsArg(command)), \(jsArg(line)));")
    }

    private func emitStream(command: String, kind: String, text: String) {
        let json = "{\"kind\":\"\(kind)\",\"text\":\(jsArg(text))}"
        eval("window.eriStreamEvent && window.eriStreamEvent(\(jsArg(command)), \(jsArg(json)));")
    }

    private func runEriRead(command: String, sub: [String]) {
        guard let eri = eriBinaryURL() else {
            eval("window.eriText && window.eriText(\(jsArg(command)), \(jsArg("eri binary not found")));")
            return
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = eri
        process.arguments = sub
        process.currentDirectoryURL = workspaceURL()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] _ in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let out = String(data: data, encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.eval("window.eriText && window.eriText(\(self.jsArg(command)), \(self.jsArg(out)));")
            }
        }
        do {
            try process.run()
            runningProcesses.append(process)
        } catch {
            eval("window.eriText && window.eriText(\(jsArg(command)), \(jsArg(error.localizedDescription)));")
        }
    }

    private func authStatus() {
        guard let eri = eriBinaryURL() else {
            eval("window.eriAuth && window.eriAuth(\(jsArg("Not signed in")));")
            return
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = eri
        process.arguments = ["auth", "status"]
        process.currentDirectoryURL = workspaceURL()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] _ in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let out = (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.eval("window.eriAuth && window.eriAuth(\(self.jsArg(out)));")
            }
        }
        do { try process.run(); runningProcesses.append(process) } catch {}
    }

    // MARK: - Voice / gaze sidecars

    private func startSidecar(command: String, rel: [String], display: String) {
        guard let url = resolveRepoFile(rel) else {
            emitStream(command: command, kind: "error", text: "\(display) sidecar not found at \(rel.joined(separator: "/"))")
            return
        }
        let isPython = url.pathExtension == "py"
        let exe = isPython ? URL(fileURLWithPath: "/usr/bin/env") : url
        let arguments = isPython ? ["python3", url.path] : []
        let process = Process()
        let pipe = Pipe()
        process.executableURL = exe
        process.arguments = arguments
        process.currentDirectoryURL = workspaceURL()
        process.standardOutput = pipe
        process.standardError = pipe
        let handle = pipe.fileHandleForReading
        handle.readabilityHandler = { [weak self] h in
            let chunk = h.availableData
            guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
            for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) where !line.isEmpty {
                let s = String(line)
                DispatchQueue.main.async { self?.forwardStreamLine(command: command, line: s) }
            }
        }
        process.terminationHandler = { [weak self] p in
            handle.readabilityHandler = nil
            DispatchQueue.main.async {
                self?.reply(command: command, status: p.terminationStatus == 0 ? "done" : "failed", detail: "\(display) sidecar exited")
            }
        }
        do {
            try process.run()
            runningProcesses.append(process)
            reply(command: command, status: "running", detail: "\(display) sidecar started")
        } catch {
            emitStream(command: command, kind: "error", text: "could not start \(display): \(error.localizedDescription)")
        }
    }

    // MARK: - Native voice (on-device Speech)

    private func emitSignal(_ command: String, json: String) {
        eval("window.eriSignal && window.eriSignal(\(jsArg(command)), \(jsArg(json)));")
    }

    private func startVoiceListening() {
        voiceActive = true
        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard authStatus == .authorized else {
                    self.voiceActive = false
                    self.emitSignal("startVoice", json: "{\"type\":\"error\",\"message\":\"speech permission not granted\"}")
                    return
                }
                self.beginRecognition()
            }
        }
    }

    private func beginRecognition() {
        teardownAudio()
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            emitSignal("startVoice", json: "{\"type\":\"error\",\"message\":\"speech recognizer unavailable\"}")
            return
        }
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = ["eri", "Eri"] // bias toward the assistant's name
        if #available(macOS 13.0, *) { request.addsPunctuation = true }

        didSpeak = false
        finishing = false
        lastVoiceAt = Date()

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            self.recognitionRequest?.append(buffer)
            // Endpointing: detect when the user stops speaking, then auto-finish.
            let level = Self.rms(buffer)
            if level > 0.011 { self.didSpeak = true; self.lastVoiceAt = Date() }
            if self.didSpeak && !self.finishing && Date().timeIntervalSince(self.lastVoiceAt) > 1.1 {
                self.finishing = true
                DispatchQueue.main.async { self.finishUtterance() }
            }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            emitSignal("startVoice", json: "{\"type\":\"error\",\"message\":\"microphone unavailable\"}")
            return
        }
        audioEngine = engine
        recognitionRequest = request
        emitSignal("startVoice", json: "{\"type\":\"status\",\"message\":\"listening\"}")
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                let final = result.isFinal
                if self.voiceControlMode {
                    // Control mode: surface the transcript as control input (a
                    // distinct type so the chat composer does NOT auto-send it),
                    // and on final, drive `eri voice` instead of chat.
                    self.emitSignal("startVoice", json: "{\"type\":\"control_partial\",\"text\":\(self.jsArg(text)),\"final\":\(final)}")
                    if final {
                        self.teardownAudio()
                        self.runVoiceControl(text)
                        if self.voiceActive { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.rearm() } }
                    }
                } else {
                    let payload = "{\"type\":\"partial\",\"text\":\(self.jsArg(text)),\"final\":\(final)}"
                    self.emitSignal("startVoice", json: payload)
                    if final {
                        self.teardownAudio()
                        // hands-free: re-arm for the next utterance unless the user turned voice off
                        if self.voiceActive { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.rearm() } }
                    }
                }
            }
            if error != nil { self.teardownAudio() }
        }
    }

    private func rearm() {
        guard voiceActive else { return }
        beginRecognition()
    }

    // End the current utterance (silence detected) → triggers a final result (auto-send in JS).
    private func finishUtterance() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        recognitionRequest?.endAudio() // lets the task deliver isFinal
    }

    // Full stop — user toggled voice off.
    private func stopVoiceListening() {
        voiceActive = false
        teardownAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
    }

    private func teardownAudio() {
        if let engine = audioEngine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        audioEngine = nil
        recognitionRequest = nil
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        if n == 0 { return 0 }
        var sum: Float = 0
        for i in 0..<n { let s = ch[i]; sum += s * s }
        return (sum / Float(n)).squareRoot()
    }

    // MARK: - Indexed sources (graphify graph.json)

    private func loadSources() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            guard let url = self.resolveRepoFile(["graphify-out", "graph.json"]),
                  let data = try? Data(contentsOf: url),
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let nodes = root["nodes"] as? [[String: Any]] else {
                DispatchQueue.main.async { self.emitSources(json: "{\"nodes\":0,\"links\":0,\"communities\":0,\"topFiles\":[]}") }
                return
            }
            var fileCounts: [String: Int] = [:]
            var communities = Set<Int>()
            for n in nodes {
                if let f = n["source_file"] as? String { fileCounts[f, default: 0] += 1 }
                if let c = n["community"] as? Int { communities.insert(c) }
            }
            let top = fileCounts.sorted { $0.value > $1.value }.prefix(8).map { ["file": $0.key, "symbols": $0.value] as [String: Any] }
            let summary: [String: Any] = [
                "nodes": nodes.count,
                "links": (root["links"] as? [Any])?.count ?? 0,
                "communities": communities.count,
                "topFiles": top,
            ]
            let jdata = (try? JSONSerialization.data(withJSONObject: summary)) ?? Data("{}".utf8)
            let json = String(data: jdata, encoding: .utf8) ?? "{}"
            DispatchQueue.main.async { self.emitSources(json: json) }
        }
    }

    private func emitSources(json: String) {
        eval("window.eriSources && window.eriSources(\(json));")
    }

    // MARK: - In-app file browser

    private func listFiles(path: String?) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let base = self.workspaceURL()
            let dir = (path?.isEmpty == false) ? base.appendingPathComponent(path!) : base
            let fm = FileManager.default
            let skip: Set<String> = ["node_modules", ".git", "target", ".next", "dist", "build", ".eri", "graphify-out", ".DS_Store"]
            var entries: [[String: Any]] = []
            if let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
                let sorted = items.sorted {
                    let ad = (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                    let bd = (try? $1.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                    if ad != bd { return ad && !bd }
                    return $0.lastPathComponent.lowercased() < $1.lastPathComponent.lowercased()
                }
                for u in sorted {
                    let name = u.lastPathComponent
                    if skip.contains(name) { continue }
                    let isDir = (try? u.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                    let rel = (path?.isEmpty == false) ? "\(path!)/\(name)" : name
                    entries.append(["path": rel, "name": name, "dir": isDir])
                }
            }
            let jdata = (try? JSONSerialization.data(withJSONObject: entries)) ?? Data("[]".utf8)
            let json = String(data: jdata, encoding: .utf8) ?? "[]"
            DispatchQueue.main.async { self.eval("window.eriFiles && window.eriFiles(\(json));") }
        }
    }

    private func readFile(path: String) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let base = self.workspaceURL().standardizedFileURL.path
            let url = self.workspaceURL().appendingPathComponent(path).standardizedFileURL
            guard url.path.hasPrefix(base) else {
                DispatchQueue.main.async { self.emitFile(path: path, content: "Access denied.") }
                return
            }
            var content = "(binary or unreadable file)"
            if let data = try? Data(contentsOf: url), data.count < 400_000, let s = String(data: data, encoding: .utf8) {
                content = s
            }
            DispatchQueue.main.async { self.emitFile(path: path, content: content) }
        }
    }

    private func emitFile(path: String, content: String) {
        eval("window.eriFile && window.eriFile(\(jsArg(path)), \(jsArg(content)));")
    }

    private func resolveRepoFile(_ components: [String]) -> URL? {
        // Distribution path: prefer the obfuscated frontend bundled INSIDE the
        // .app (Contents/Resources/web/). This makes a shipped copy
        // self-contained (no repo on disk) and means the only readable assets
        // are the minified+mangled ones, not the source. The repo-walking
        // fallbacks below are dev-only (they hit when running from the tree).
        if let last = components.last,
            ["index.html", "manager.js", "manager.css", "overlay.html", "overlay.css"].contains(last),
            let res = Bundle.main.resourceURL {
            let bundled = res.appendingPathComponent("web").appendingPathComponent(last)
            if FileManager.default.fileExists(atPath: bundled.path) {
                return bundled
            }
        }
        if let root = Bundle.main.environmentRepoRoot {
            let candidate = components.reduce(root) { $0.appendingPathComponent($1) }
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        if let root = Bundle.main.repoRootFromAppBundle {
            let candidate = components.reduce(root) { $0.appendingPathComponent($1) }
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        var cursor = workspaceURL()
        for _ in 0..<8 {
            let candidate = components.reduce(cursor) { $0.appendingPathComponent($1) }
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            let next = cursor.deletingLastPathComponent()
            if next.path == cursor.path { break }
            cursor = next
        }
        let scriptDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        let repoFromScript = scriptDir.deletingLastPathComponent()
        let candidate = components.reduce(repoFromScript) { $0.appendingPathComponent($1) }
        if FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        return nil
    }

    private func reply(command: String, status: String, detail: String) {
        let payload: [String: Any] = [
            "command": command,
            "status": status,
            "detail": detail
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript("window.eriBridgeResult(\(json));", completionHandler: nil)
    }
}

extension Bundle {
    var environmentRepoRoot: URL? {
        guard let raw = ProcessInfo.processInfo.environment["ERI_REPO_ROOT"], !raw.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: raw, isDirectory: true)
    }

    var repoRootFromAppBundle: URL? {
        let appURL = bundleURL
        guard appURL.pathExtension == "app" else { return nil }
        let appsDir = appURL.deletingLastPathComponent()
        let repo = appsDir.deletingLastPathComponent()
        return FileManager.default.fileExists(atPath: repo.appendingPathComponent("Cargo.toml").path)
            ? repo
            : nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let controller: AgentManagerController

    init(args: LaunchArgs) {
        self.controller = AgentManagerController(args: args)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        controller.show()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let args = parseLaunchArgs()
let app = NSApplication.shared
let delegate = AppDelegate(args: args)
app.delegate = delegate
app.run()

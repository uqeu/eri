#!/usr/bin/env swift

// eri preview window — borderless WKWebView that opens a local HTML file in a
// window positioned adjacent to the eri editor. Visually presents as a pane
// of the IDE rather than a separate browser tab.
//
// Auto-reloads when the watched file's modification time changes, so each
// Mercury iteration shows up live without any user action.
//
// Stdin protocol (legacy, still honored): newline-delimited JSON commands —
//   {"command":"set_width","width":0}    // 0 = fill (desktop)
//   {"command":"set_width","width":768}  // tablet
//   {"command":"set_width","width":375}  // phone
//
// UNIX-socket protocol (new): the binary also listens at ~/.eri/preview.sock
// for the sidecar to drive it. Each line is a JSON object:
//   {"type":"ping"}                       → {"type":"pong"}
//   {"type":"load","url":"file:///..."}   load a new URL into the WebView
//   {"type":"reload"}                     force a reload
//   {"type":"gaze","x":0.5,"y":0.4}       draw the gaze cursor at relative
//                                          coords (0..1, origin top-left)
// On startup we emit {"type":"ready"} to any connected socket clients; when
// the user closes the window we emit {"type":"closed"} and terminate.
//
// Usage:
//   eri_preview                        # open empty; load via socket
//   eri_preview <path-or-url>          # open at the given path/URL
//
// MUST NOT make network calls of its own. Only renders URLs explicitly
// provided by the user (or sidecar) — typically file:// URLs.

import Cocoa
import Darwin
import Foundation
import WebKit

// MARK: — CLI

let args = CommandLine.arguments
var initialURL: URL? = nil
if args.count >= 2 {
    let arg = args[1]
    if arg == "--help" || arg == "-h" {
        print("Usage: eri_preview [<path-or-url>]")
        exit(0)
    }
    if arg.hasPrefix("file://") || arg.hasPrefix("http://") || arg.hasPrefix("https://") {
        initialURL = URL(string: arg)
    } else {
        let path = (arg as NSString).expandingTildeInPath
        initialURL = URL(fileURLWithPath: path)
    }
}

// MARK: — Window delegate

class WindowDelegate: NSObject, NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        SocketServer.shared?.broadcast(["type": "closed"])
        NSApplication.shared.terminate(nil)
    }
}

// MARK: — File watcher (live-reload)

final class FileWatcher {
    let url: URL
    weak var webView: WKWebView?
    private var source: DispatchSourceFileSystemObject?
    private var fileDescriptor: CInt = -1
    private let reloadDebounceSeconds: TimeInterval = 0.08
    private var lastReloadAt: Date = .distantPast

    init(url: URL, webView: WKWebView) {
        self.url = url
        self.webView = webView
    }

    func start() { open() }

    private func open() {
        let fd = Darwin.open(url.path, O_EVTONLY)
        guard fd >= 0 else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.open()
            }
            return
        }
        fileDescriptor = fd
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename],
            queue: .main
        )
        src.setEventHandler { [weak self] in
            self?.handleEvent(src.data)
        }
        src.setCancelHandler { [weak self] in
            if let self, self.fileDescriptor >= 0 {
                Darwin.close(self.fileDescriptor)
                self.fileDescriptor = -1
            }
        }
        src.resume()
        self.source = src
    }

    private func handleEvent(_ mask: DispatchSource.FileSystemEvent) {
        if mask.contains(.delete) || mask.contains(.rename) {
            source?.cancel()
            source = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { [weak self] in
                self?.open()
                self?.reload()
            }
            return
        }
        if mask.contains(.write) || mask.contains(.extend) {
            reload()
        }
    }

    private func reload() {
        let now = Date()
        if now.timeIntervalSince(lastReloadAt) < reloadDebounceSeconds {
            return
        }
        lastReloadAt = now
        webView?.reload()
    }
}

// MARK: — Layout controller

final class PreviewLayoutController {
    let containerView: NSView
    let webView: WKWebView
    let labelView: NSTextField
    private var currentWidth: CGFloat = 0

    init(containerView: NSView, webView: WKWebView, labelView: NSTextField) {
        self.containerView = containerView
        self.webView = webView
        self.labelView = labelView
        containerView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(containerResized),
            name: NSView.frameDidChangeNotification,
            object: containerView
        )
    }

    @objc private func containerResized() { layout() }

    func setWidth(_ width: CGFloat, label: String) {
        currentWidth = max(0, width)
        labelView.stringValue = label
        labelView.isHidden = label.isEmpty
        layout()
    }

    private func layout() {
        let bounds = containerView.bounds
        let labelInset: CGFloat = labelView.isHidden ? 0 : 22
        let availableHeight = max(0, bounds.height - labelInset)
        let targetWidth: CGFloat = (currentWidth <= 0 || currentWidth >= bounds.width)
            ? bounds.width
            : currentWidth
        let originX = ((bounds.width - targetWidth) / 2.0).rounded()
        webView.frame = NSRect(
            x: originX, y: labelInset, width: targetWidth, height: availableHeight
        )
        if !labelView.isHidden {
            labelView.frame = NSRect(x: 0, y: 2, width: bounds.width, height: 18)
        }
    }

    func webViewSize() -> CGSize { webView.frame.size }
    func webViewOrigin() -> CGPoint { webView.frame.origin }
}

// MARK: — Gaze cursor overlay (12px translucent yellow dot)

final class GazeCursor {
    private let dot: NSView
    private weak var container: NSView?
    private weak var layout: PreviewLayoutController?
    private let size: CGFloat = 12

    init(container: NSView, layout: PreviewLayoutController) {
        self.container = container
        self.layout = layout
        let view = NSView(frame: NSRect(x: 0, y: 0, width: size, height: size))
        view.wantsLayer = true
        let layer = CALayer()
        layer.frame = view.bounds
        layer.cornerRadius = size / 2
        layer.backgroundColor = NSColor(calibratedRed: 1.0, green: 0.92, blue: 0.30, alpha: 0.55).cgColor
        layer.shadowColor = NSColor.black.cgColor
        layer.shadowOpacity = 0.4
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 0)
        view.layer = layer
        view.isHidden = true
        container.addSubview(view, positioned: .above, relativeTo: nil)
        self.dot = view
    }

    /// `x`, `y` are relative 0..1 with origin top-left of the WKWebView.
    func setRelative(x: CGFloat, y: CGFloat) {
        guard let layout else { return }
        let containerBounds = container?.bounds ?? .zero
        let webOrigin = layout.webViewOrigin()
        let webSize = layout.webViewSize()
        let clampedX = max(0, min(1, x))
        let clampedY = max(0, min(1, y))
        // WKWebView origin (in the dark container) is bottom-left in AppKit;
        // gaze relative (0..1) is conventionally top-left, so we flip Y.
        let absX = webOrigin.x + clampedX * webSize.width - (size / 2)
        let topY = webOrigin.y + webSize.height - clampedY * webSize.height
        let absY = topY - (size / 2)
        _ = containerBounds // suppress unused warning; bounds reserved for future clamping
        dot.frame = NSRect(x: absX, y: absY, width: size, height: size)
        dot.isHidden = false
    }

    func hide() { dot.isHidden = true }
}

// MARK: — Socket server (~/.eri/preview.sock)

final class SocketServer {
    static var shared: SocketServer?

    private let path: String
    private var serverFD: CInt = -1
    private var clientFDs: [CInt] = []
    private let acceptQueue = DispatchQueue(label: "dev.eri.preview.accept")
    private let clientsLock = NSLock()
    private weak var layout: PreviewLayoutController?
    private weak var webView: WKWebView?
    private weak var cursor: GazeCursor?

    init(path: String,
         webView: WKWebView,
         layout: PreviewLayoutController,
         cursor: GazeCursor) {
        self.path = path
        self.webView = webView
        self.layout = layout
        self.cursor = cursor
    }

    func start() {
        // Best-effort cleanup of stale socket file. Reading a stat error is
        // fine — the listen() call below will surface real problems.
        _ = Darwin.unlink(path)
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true
        )

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 {
            FileHandle.standardError.write(Data("eri_preview: socket() failed\n".utf8))
            return
        }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = path.utf8CString
        withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
            bytes.withUnsafeBufferPointer { buf in
                let n = min(buf.count, 104)
                _ = memcpy(ptr, buf.baseAddress, n)
            }
        }
        let addrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindResult = withUnsafePointer(to: &addr) { p -> Int32 in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, addrLen)
            }
        }
        if bindResult != 0 {
            Darwin.close(fd)
            FileHandle.standardError.write(Data("eri_preview: bind() failed\n".utf8))
            return
        }
        if Darwin.listen(fd, 4) != 0 {
            Darwin.close(fd)
            FileHandle.standardError.write(Data("eri_preview: listen() failed\n".utf8))
            return
        }
        serverFD = fd
        acceptQueue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        if serverFD >= 0 {
            Darwin.close(serverFD)
            serverFD = -1
        }
        _ = Darwin.unlink(path)
        clientsLock.lock()
        for c in clientFDs { Darwin.close(c) }
        clientFDs.removeAll()
        clientsLock.unlock()
    }

    func broadcast(_ payload: [String: Any]) {
        guard let line = encode(payload) else { return }
        clientsLock.lock()
        let snapshot = clientFDs
        clientsLock.unlock()
        for c in snapshot {
            _ = line.withUnsafeBytes { buf -> Int in
                Darwin.send(c, buf.baseAddress, buf.count, 0)
            }
        }
    }

    private func acceptLoop() {
        while serverFD >= 0 {
            let client = Darwin.accept(serverFD, nil, nil)
            if client < 0 {
                if serverFD < 0 { return }
                continue
            }
            clientsLock.lock()
            clientFDs.append(client)
            clientsLock.unlock()
            // Greet — lets the sidecar know the preview is up and accepting.
            if let ready = encode(["type": "ready"]) {
                _ = ready.withUnsafeBytes { buf -> Int in
                    Darwin.send(client, buf.baseAddress, buf.count, 0)
                }
            }
            DispatchQueue.global(qos: .utility).async { [weak self] in
                self?.readLoop(clientFD: client)
            }
        }
    }

    private func readLoop(clientFD: CInt) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = chunk.withUnsafeMutableBufferPointer { buf -> Int in
                Darwin.recv(clientFD, buf.baseAddress, buf.count, 0)
            }
            if n <= 0 { break }
            buffer.append(chunk, count: n)
            while let newlineIdx = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: 0..<newlineIdx)
                buffer.removeSubrange(0...newlineIdx)
                self.handle(line: lineData, clientFD: clientFD)
            }
        }
        Darwin.close(clientFD)
        clientsLock.lock()
        clientFDs.removeAll { $0 == clientFD }
        clientsLock.unlock()
    }

    private func handle(line: Data, clientFD: CInt) {
        guard !line.isEmpty else { return }
        guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { return }
        guard let type = obj["type"] as? String else { return }
        switch type {
        case "ping":
            if let pong = encode(["type": "pong"]) {
                _ = pong.withUnsafeBytes { buf -> Int in
                    Darwin.send(clientFD, buf.baseAddress, buf.count, 0)
                }
            }
        case "load":
            guard let urlStr = obj["url"] as? String, let url = URL(string: urlStr) else { return }
            DispatchQueue.main.async { [weak self] in
                if url.isFileURL {
                    let dir = url.deletingLastPathComponent()
                    self?.webView?.loadFileURL(url, allowingReadAccessTo: dir)
                } else {
                    self?.webView?.load(URLRequest(url: url))
                }
            }
        case "reload":
            DispatchQueue.main.async { [weak self] in self?.webView?.reload() }
        case "gaze":
            let xRaw = obj["x"]
            let yRaw = obj["y"]
            let x = toDouble(xRaw)
            let y = toDouble(yRaw)
            guard let xv = x, let yv = y else { return }
            DispatchQueue.main.async { [weak self] in
                self?.cursor?.setRelative(x: CGFloat(xv), y: CGFloat(yv))
            }
        default:
            return
        }
    }

    private func encode(_ payload: [String: Any]) -> Data? {
        guard JSONSerialization.isValidJSONObject(payload),
              var data = try? JSONSerialization.data(withJSONObject: payload) else {
            return nil
        }
        data.append(0x0A)
        return data
    }
}

private func toDouble(_ raw: Any?) -> Double? {
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    if let s = raw as? String { return Double(s) }
    return nil
}

// MARK: — Stdin command reader (legacy set_width protocol)

func startStdinCommandReader(controller: PreviewLayoutController) {
    DispatchQueue.global(qos: .utility).async {
        let handle = FileHandle.standardInput
        var buffer = Data()
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { return }
            buffer.append(chunk)
            while let newlineIndex = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: 0..<newlineIndex)
                buffer.removeSubrange(0...newlineIndex)
                handleCommandLine(lineData, controller: controller)
            }
        }
    }
}

private func handleCommandLine(_ data: Data, controller: PreviewLayoutController) {
    guard !data.isEmpty else { return }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    guard let command = json["command"] as? String else { return }
    switch command {
    case "set_width":
        let width: CGFloat
        if let intValue = json["width"] as? Int {
            width = CGFloat(intValue)
        } else if let doubleValue = json["width"] as? Double {
            width = CGFloat(doubleValue)
        } else {
            return
        }
        let label = (json["label"] as? String) ?? defaultLabel(forWidth: width)
        DispatchQueue.main.async { controller.setWidth(width, label: label) }
    default:
        return
    }
}

private func defaultLabel(forWidth width: CGFloat) -> String {
    if width <= 0 { return "Desktop" }
    return "\(Int(width))px"
}

// MARK: — Bootstrap

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let delegate = WindowDelegate()

let defaultWidth: CGFloat = 1024
let defaultHeight: CGFloat = 768
let screen = NSScreen.main?.visibleFrame
    ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
let originX = screen.origin.x + max(0, (screen.width - defaultWidth) / 2)
let originY = screen.origin.y + max(0, (screen.height - defaultHeight) / 2)
let rect = NSRect(x: originX, y: originY, width: defaultWidth, height: defaultHeight)

let window = NSWindow(
    contentRect: rect,
    styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
    backing: .buffered,
    defer: false
)
window.title = "eri preview"
window.delegate = delegate
window.isReleasedWhenClosed = false
window.titlebarAppearsTransparent = true
window.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 1.0)
window.level = .normal
window.setFrameAutosaveName("eri.preview.window")

let contentBounds = window.contentView?.bounds ?? rect
let containerView = NSView(frame: contentBounds)
containerView.autoresizingMask = [.width, .height]
containerView.wantsLayer = true
containerView.layer?.backgroundColor = NSColor(calibratedWhite: 0.04, alpha: 1.0).cgColor
window.contentView?.addSubview(containerView)

let config = WKWebViewConfiguration()
config.preferences.javaScriptEnabled = true
let webView = WKWebView(frame: containerView.bounds, configuration: config)
webView.allowsLinkPreview = false
webView.setValue(true, forKey: "drawsBackground")
containerView.addSubview(webView)

let labelView = NSTextField(labelWithString: "")
labelView.alignment = .center
labelView.font = NSFont.systemFont(ofSize: 10, weight: .medium)
labelView.textColor = NSColor(calibratedWhite: 0.65, alpha: 1.0)
labelView.backgroundColor = .clear
labelView.isBordered = false
labelView.isEditable = false
labelView.isHidden = true
labelView.autoresizingMask = [.width, .maxYMargin]
containerView.addSubview(labelView)

let layoutController = PreviewLayoutController(
    containerView: containerView, webView: webView, labelView: labelView
)
layoutController.setWidth(0, label: "")

let gazeCursor = GazeCursor(container: containerView, layout: layoutController)

if let initialURL {
    if initialURL.isFileURL,
       FileManager.default.fileExists(atPath: initialURL.path) {
        let directoryURL = initialURL.deletingLastPathComponent()
        webView.loadFileURL(initialURL, allowingReadAccessTo: directoryURL)
        let watcher = FileWatcher(url: initialURL, webView: webView)
        watcher.start()
    } else if !initialURL.isFileURL {
        webView.load(URLRequest(url: initialURL))
    }
}

let socketPath: String = {
    let home = NSHomeDirectory()
    return "\(home)/.eri/preview.sock"
}()
let socketServer = SocketServer(
    path: socketPath,
    webView: webView,
    layout: layoutController,
    cursor: gazeCursor
)
SocketServer.shared = socketServer
socketServer.start()

startStdinCommandReader(controller: layoutController)

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()

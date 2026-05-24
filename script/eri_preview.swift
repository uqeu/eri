// eri_preview — standalone Swift app that hosts a WKWebView preview window
// driven by the eri sidecar (Rust) over a UNIX socket.
//
// Renders ONLY local URLs:
//   * file://...
//   * http://localhost[:port]/...   (and http://127.0.0.1[:port]/...)
// Any other scheme is rejected with {"type":"error","message":"untrusted url scheme"}.
//
// Socket protocol (JSON-lines at ~/.eri/preview.sock):
//   inbound:  load|reload|gaze|close|ping|size
//   outbound: ready|pong|loaded|closed|error
//
// CLI:
//   eri_preview                            # open empty, wait for socket "load"
//   eri_preview file:///path/to/index.html # load immediately
//
// No outbound network calls. No telemetry. No third-party SDKs.

import Cocoa
import Darwin
import Foundation
import WebKit

// MARK: - URL trust policy

/// Reject anything that isn't a local-disk file:// or a localhost http:// URL.
/// Returned `nil` means the caller must emit an "untrusted url scheme" error.
func validateTrustedURL(_ raw: String) -> URL? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let url = URL(string: trimmed) else {
        return nil
    }
    guard let scheme = url.scheme?.lowercased() else {
        return nil
    }
    if scheme == "file" {
        return url
    }
    if scheme == "http" {
        if let host = url.host?.lowercased(),
           host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
            return url
        }
    }
    return nil
}

// MARK: - Forward declarations for cross-class references

protocol PreviewControl: AnyObject {
    func load(url: URL)
    func reload()
    func setGaze(x: Double, y: Double)
    func resize(width: Int, height: Int)
    func closeWindow(reason: String)
}

protocol SocketWriter: AnyObject {
    func send(_ payload: [String: Any])
}

// MARK: - Gaze overlay

final class GazeOverlayView: NSView {
    private var cursor = NSPoint(x: -100, y: -100)
    private var visible = false

    override var isFlipped: Bool { false }

    /// `point` is normalized 0..1 with origin top-left; we flip to AppKit coords.
    func move(to point: CGPoint) {
        let cx = bounds.width * max(0, min(1, point.x))
        let cy = bounds.height * (1.0 - max(0, min(1, point.y)))
        cursor = NSPoint(x: cx, y: cy)
        visible = true
        needsDisplay = true
    }

    func hide() {
        visible = false
        needsDisplay = true
    }

    override func draw(_ dirty: NSRect) {
        guard visible else { return }
        let r: CGFloat = 8
        NSColor.systemYellow.withAlphaComponent(0.55).setFill()
        let dot = NSRect(x: cursor.x - r, y: cursor.y - r, width: r * 2, height: r * 2)
        NSBezierPath(ovalIn: dot).fill()
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        // Never intercept clicks — let them fall through to the WKWebView.
        return nil
    }
}

// MARK: - Preview window

final class PreviewWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, PreviewControl {
    let window: NSWindow
    let web: WKWebView
    let overlay: GazeOverlayView
    private var lastUrl: URL?
    private var fsSource: DispatchSourceFileSystemObject?
    private var fsFD: CInt = -1
    private let reloadDebounce: TimeInterval = 0.08
    private var lastReloadAt = Date.distantPast
    weak var writer: SocketWriter?
    private var userClosed = true // set false when we close programmatically

    override init() {
        let defaultRect = NSRect(x: 0, y: 0, width: 1024, height: 768)
        let screen = NSScreen.main?.visibleFrame ?? defaultRect
        let originX = screen.origin.x + max(0, (screen.width - defaultRect.width) / 2)
        let originY = screen.origin.y + max(0, (screen.height - defaultRect.height) / 2)
        let frame = NSRect(x: originX, y: originY, width: defaultRect.width, height: defaultRect.height)

        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "eri preview"
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("eri.preview.window")
        window.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 1.0)

        let content = window.contentView ?? NSView(frame: frame)
        let config = WKWebViewConfiguration()
        // JavaScript is enabled by default in modern WKWebView (controlled
        // per-navigation via WKWebpagePreferences.allowsContentJavaScript).
        web = WKWebView(frame: content.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.setValue(true, forKey: "drawsBackground")

        overlay = GazeOverlayView(frame: content.bounds)
        overlay.autoresizingMask = [.width, .height]
        overlay.wantsLayer = true

        super.init()
        window.delegate = self
        web.navigationDelegate = self
        content.addSubview(web)
        content.addSubview(overlay, positioned: .above, relativeTo: web)
    }

    func showWindow() {
        window.makeKeyAndOrderFront(nil)
    }

    func load(url: URL) {
        lastUrl = url
        if url.isFileURL {
            let dir = url.deletingLastPathComponent()
            web.loadFileURL(url, allowingReadAccessTo: dir)
            rearmFSEvents(for: url)
        } else {
            web.load(URLRequest(url: url))
            tearDownFSEvents()
        }
    }

    func reload() {
        let now = Date()
        if now.timeIntervalSince(lastReloadAt) < reloadDebounce {
            return
        }
        lastReloadAt = now
        web.reload()
    }

    func setGaze(x: Double, y: Double) {
        overlay.move(to: CGPoint(x: x, y: y))
    }

    func resize(width: Int, height: Int) {
        guard width >= 200, height >= 150, width <= 8192, height <= 8192 else { return }
        var f = window.frame
        f.size.width = CGFloat(width)
        f.size.height = CGFloat(height)
        window.setFrame(f, display: true, animate: false)
    }

    func closeWindow(reason: String) {
        userClosed = false
        writer?.send(["type": "closed", "reason": reason])
        window.close()
        NSApplication.shared.terminate(nil)
    }

    // MARK: NSWindowDelegate
    func windowWillClose(_ notification: Notification) {
        if userClosed {
            writer?.send(["type": "closed", "reason": "user"])
        }
        NSApplication.shared.terminate(nil)
    }

    // MARK: WKNavigationDelegate
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let urlStr = webView.url?.absoluteString ?? lastUrl?.absoluteString ?? ""
        writer?.send(["type": "loaded", "url": urlStr])
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        writer?.send(["type": "error", "message": error.localizedDescription])
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        writer?.send(["type": "error", "message": error.localizedDescription])
    }

    // MARK: FSEvents
    private func rearmFSEvents(for url: URL) {
        tearDownFSEvents()
        let fd = Darwin.open(url.path, O_EVTONLY)
        guard fd >= 0 else {
            // Re-attempt shortly — file may not be flushed yet.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                guard let self, self.lastUrl == url else { return }
                self.rearmFSEvents(for: url)
            }
            return
        }
        fsFD = fd
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename],
            queue: .main
        )
        src.setEventHandler { [weak self] in
            guard let self else { return }
            let mask = src.data
            if mask.contains(.delete) || mask.contains(.rename) {
                self.tearDownFSEvents()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                    guard let self, let u = self.lastUrl else { return }
                    self.rearmFSEvents(for: u)
                    self.reload()
                }
                return
            }
            if mask.contains(.write) || mask.contains(.extend) {
                self.reload()
            }
        }
        src.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.fsFD >= 0 {
                Darwin.close(self.fsFD)
                self.fsFD = -1
            }
        }
        src.resume()
        fsSource = src
    }

    private func tearDownFSEvents() {
        fsSource?.cancel()
        fsSource = nil
    }
}

// MARK: - UNIX-domain socket channel

final class SocketChannel: SocketWriter {
    private let path: String
    private var serverFD: CInt = -1
    private let clientsLock = NSLock()
    private var clientFDs: [CInt] = []
    private let acceptQueue = DispatchQueue(label: "dev.eri.preview.accept")
    weak var control: PreviewControl?

    init(path: String) {
        self.path = path
    }

    func start() {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true)
        _ = Darwin.unlink(path)

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 {
            stderr("eri_preview: socket() failed")
            return
        }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let cpath = path.utf8CString
        withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
            cpath.withUnsafeBufferPointer { buf in
                let n = min(buf.count, 104)
                _ = memcpy(ptr, buf.baseAddress, n)
            }
        }
        let alen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &addr) { p -> Int32 in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, alen)
            }
        }
        if bound != 0 {
            Darwin.close(fd)
            stderr("eri_preview: bind() failed errno=\(errno)")
            return
        }
        if Darwin.listen(fd, 4) != 0 {
            Darwin.close(fd)
            stderr("eri_preview: listen() failed errno=\(errno)")
            return
        }
        serverFD = fd
        acceptQueue.async { [weak self] in self?.acceptLoop() }
    }

    func send(_ payload: [String: Any]) {
        guard let data = encode(payload) else { return }
        clientsLock.lock()
        let snapshot = clientFDs
        clientsLock.unlock()
        for c in snapshot {
            _ = data.withUnsafeBytes { buf -> Int in
                Darwin.send(c, buf.baseAddress, buf.count, 0)
            }
        }
    }

    // MARK: internals
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
            // Greet new clients.
            if let ready = encode(["type": "ready"]) {
                _ = ready.withUnsafeBytes { buf -> Int in
                    Darwin.send(client, buf.baseAddress, buf.count, 0)
                }
            }
            DispatchQueue.global(qos: .utility).async { [weak self] in
                self?.readLoop(client)
            }
        }
    }

    private func readLoop(_ client: CInt) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = chunk.withUnsafeMutableBufferPointer { buf -> Int in
                Darwin.recv(client, buf.baseAddress, buf.count, 0)
            }
            if n <= 0 { break }
            buffer.append(chunk, count: n)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: 0..<nl)
                buffer.removeSubrange(0...nl)
                dispatch(line: line, client: client)
            }
        }
        Darwin.close(client)
        clientsLock.lock()
        clientFDs.removeAll { $0 == client }
        clientsLock.unlock()
    }

    private func dispatch(line: Data, client: CInt) {
        guard !line.isEmpty,
              let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let type = obj["type"] as? String else { return }
        switch type {
        case "ping":
            sendDirect(client, ["type": "pong"])
        case "load":
            guard let raw = obj["url"] as? String else {
                send(["type": "error", "message": "load: missing url"])
                return
            }
            guard let url = validateTrustedURL(raw) else {
                send(["type": "error", "message": "untrusted url scheme"])
                return
            }
            DispatchQueue.main.async { [weak self] in self?.control?.load(url: url) }
        case "reload":
            DispatchQueue.main.async { [weak self] in self?.control?.reload() }
        case "gaze":
            let x = toDouble(obj["x"]) ?? 0
            let y = toDouble(obj["y"]) ?? 0
            DispatchQueue.main.async { [weak self] in self?.control?.setGaze(x: x, y: y) }
        case "size":
            let w = toInt(obj["width"]) ?? 0
            let h = toInt(obj["height"]) ?? 0
            DispatchQueue.main.async { [weak self] in self?.control?.resize(width: w, height: h) }
        case "close":
            DispatchQueue.main.async { [weak self] in self?.control?.closeWindow(reason: "command") }
        default:
            send(["type": "error", "message": "unknown command: \(type)"])
        }
    }

    private func sendDirect(_ client: CInt, _ payload: [String: Any]) {
        guard let data = encode(payload) else { return }
        _ = data.withUnsafeBytes { buf -> Int in
            Darwin.send(client, buf.baseAddress, buf.count, 0)
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

    private func stderr(_ msg: String) {
        FileHandle.standardError.write(Data((msg + "\n").utf8))
    }
}

// MARK: - Small numeric coercion helpers (JSON may produce Int or Double)

private func toDouble(_ raw: Any?) -> Double? {
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    if let n = raw as? NSNumber { return n.doubleValue }
    if let s = raw as? String { return Double(s) }
    return nil
}

private func toInt(_ raw: Any?) -> Int? {
    if let i = raw as? Int { return i }
    if let d = raw as? Double { return Int(d) }
    if let n = raw as? NSNumber { return n.intValue }
    if let s = raw as? String { return Int(s) }
    return nil
}

// MARK: - Bootstrap

let app = NSApplication.shared
app.setActivationPolicy(.regular)

// App icon — load eri.icns from the bundled Resources/ when running inside
// eri.app, or fall back to a couple of repo-relative dev paths. Standalone
// runs without a discoverable icon use the default Swift app glyph.
let binDir = (CommandLine.arguments.first as NSString?)?.deletingLastPathComponent ?? ""
for candidate in [
    "\(binDir)/../Resources/eri.icns",
    "\(binDir)/eri.icns",
    "\(binDir)/../../ide/icons/eri.icns",
] where FileManager.default.fileExists(atPath: candidate) {
    if let img = NSImage(contentsOfFile: candidate) {
        app.applicationIconImage = img
        break
    }
}

let preview = PreviewWindow()
let socketPath = "\(NSHomeDirectory())/.eri/preview.sock"
let channel = SocketChannel(path: socketPath)
preview.writer = channel
channel.control = preview
channel.start()
preview.showWindow()

// CLI arg: optional initial URL (must pass the trust policy).
if CommandLine.arguments.count >= 2 {
    let raw = CommandLine.arguments[1]
    if raw == "-h" || raw == "--help" {
        FileHandle.standardOutput.write(Data("Usage: eri_preview [<file://...|http://localhost/...>]\n".utf8))
        exit(0)
    }
    // Bare path → treat as file://
    let coerced: String
    if raw.hasPrefix("file://") || raw.hasPrefix("http://") || raw.hasPrefix("https://") {
        coerced = raw
    } else {
        let expanded = (raw as NSString).expandingTildeInPath
        coerced = URL(fileURLWithPath: expanded).absoluteString
    }
    if let url = validateTrustedURL(coerced) {
        preview.load(url: url)
    } else {
        channel.send(["type": "error", "message": "untrusted url scheme"])
    }
}

app.activate(ignoringOtherApps: true)
app.run()

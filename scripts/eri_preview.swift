#!/usr/bin/env swift

// eri preview window — borderless WKWebView that opens a local HTML file in a
// window positioned adjacent to the eri editor. Visually presents as a pane
// of the IDE rather than a separate browser tab.
//
// Auto-reloads when the watched file's modification time changes, so each
// Mercury iteration shows up live without any user action.
//
// Stdin protocol: the host writes newline-delimited JSON commands. The only
// command today is the responsive-preview toggle, which the panel emits when
// the user says "preview as phone" / "preview as tablet" / "preview as
// desktop":
//
//   {"command":"set_width","width":0}    // 0 = fill the window (desktop)
//   {"command":"set_width","width":768}  // tablet
//   {"command":"set_width","width":375}  // phone
//
// Unknown commands are ignored so the host can extend the protocol without
// breaking older sidecar builds.
//
// Usage: script/eri_preview <path-to-index.html>

import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("Usage: eri_preview <html-path>")
    exit(1)
}

let path = (args[1] as NSString).expandingTildeInPath
let fileURL = URL(fileURLWithPath: path)
guard FileManager.default.fileExists(atPath: fileURL.path) else {
    print("File not found: \(fileURL.path)")
    exit(1)
}

class WindowDelegate: NSObject, NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        NSApplication.shared.terminate(nil)
    }
}

/// Watch a file descriptor for write/extend/delete events via the kqueue-based
/// DispatchSource API. Fires within ~10ms of the writer's `close()` instead of
/// the 500ms polling cadence we used before — combined with eri's mid-stream
/// HTML writes (Phase 2 of the latency overhaul), the preview now paints
/// chunks as Mercury types them, not seconds later.
///
/// macOS will close the underlying file descriptor when the file is rewritten
/// (atomic `rename`). We re-open on `.delete` to follow the new inode.
class FileWatcher {
    let url: URL
    weak var webView: WKWebView?
    private var source: DispatchSourceFileSystemObject?
    private var fileDescriptor: CInt = -1
    /// FSEvents fires per-write — Mercury streams chunks every ~150ms; we
    /// coalesce reloads to at most one per `reloadDebounceSeconds` so the
    /// WKWebView isn't thrashed when the writer flushes many small chunks.
    private let reloadDebounceSeconds: TimeInterval = 0.08
    private var lastReloadAt: Date = .distantPast

    init(url: URL, webView: WKWebView) {
        self.url = url
        self.webView = webView
    }

    func start() {
        open()
    }

    private func open() {
        let fd = Darwin.open(url.path, O_EVTONLY)
        guard fd >= 0 else {
            // File missing on launch — retry shortly so we attach once the
            // first build lands.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.open()
            }
            return
        }
        fileDescriptor = fd
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename],
            queue: .main
        )
        source.setEventHandler { [weak self] in
            self?.handleEvent(source.data)
        }
        source.setCancelHandler { [weak self] in
            if let self, self.fileDescriptor >= 0 {
                Darwin.close(self.fileDescriptor)
                self.fileDescriptor = -1
            }
        }
        source.resume()
        self.source = source
    }

    private func handleEvent(_ mask: DispatchSource.FileSystemEvent) {
        if mask.contains(.delete) || mask.contains(.rename) {
            // Atomic rewrites swap the inode out from under us. Re-attach to
            // the new file at the same path.
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

/// Hosts the WKWebView at the requested viewport width. `width == 0` means
/// "fill the window" — the panel sends 0 for `Desktop`. Anything else is a
/// fixed-pixel device frame, centered horizontally so the surrounding dark
/// fill reads as a phone/tablet bezel rather than a layout gap.
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

    @objc private func containerResized() {
        layout()
    }

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

        let targetWidth: CGFloat
        if currentWidth <= 0 || currentWidth >= bounds.width {
            targetWidth = bounds.width
        } else {
            targetWidth = currentWidth
        }
        let originX = ((bounds.width - targetWidth) / 2.0).rounded()
        webView.frame = NSRect(
            x: originX,
            y: labelInset,
            width: targetWidth,
            height: availableHeight
        )

        if !labelView.isHidden {
            let labelHeight: CGFloat = 18
            labelView.frame = NSRect(
                x: 0,
                y: 2,
                width: bounds.width,
                height: labelHeight
            )
        }
    }
}

/// Read newline-delimited JSON commands from stdin on a background queue and
/// dispatch each one to the main queue. Stdin closes when the parent (eri
/// panel) exits — we simply stop reading at EOF.
func startStdinCommandReader(controller: PreviewLayoutController) {
    DispatchQueue.global(qos: .utility).async {
        let handle = FileHandle.standardInput
        var buffer = Data()
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty {
                return
            }
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
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return
    }
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
        DispatchQueue.main.async {
            controller.setWidth(width, label: label)
        }
    default:
        return
    }
}

private func defaultLabel(forWidth width: CGFloat) -> String {
    if width <= 0 { return "Desktop" }
    let pixels = Int(width)
    return "\(pixels)px"
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let delegate = WindowDelegate()

let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
let width = max(640.0, screen.width / 2.0 - 8.0)
let height = max(480.0, screen.height - 20.0)
let originX = screen.origin.x + screen.width - width
let originY = screen.origin.y + 10.0
let rect = NSRect(x: originX, y: originY, width: width, height: height)

let window = NSWindow(
    contentRect: rect,
    styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
    backing: .buffered,
    defer: false
)
window.title = "eri preview · \(fileURL.lastPathComponent)"
window.delegate = delegate
window.isReleasedWhenClosed = false
window.titlebarAppearsTransparent = true
window.backgroundColor = NSColor(calibratedWhite: 0.06, alpha: 1.0)
window.level = .normal
window.setFrameAutosaveName("eri.preview.window")

// Host view: dark background that surrounds the (possibly narrowed) WKWebView
// so a phone/tablet viewport reads as a device frame rather than a layout gap.
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
    containerView: containerView,
    webView: webView,
    labelView: labelView
)
layoutController.setWidth(0, label: "")

let directoryURL = fileURL.deletingLastPathComponent()
webView.loadFileURL(fileURL, allowingReadAccessTo: directoryURL)

let watcher = FileWatcher(url: fileURL, webView: webView)
watcher.start()

startStdinCommandReader(controller: layoutController)

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()

// eri control server — the macOS actuation backend behind `eri control --live`.
//
// Hosts a loopback HTTP endpoint that the Rust control loop (HttpBridge) POSTs
// actions to. Each request is one action; the server does the real work via the
// Accessibility API (read the on-screen UI tree, press elements), CGEvent
// (synthesize mouse/keyboard), and NSWorkspace (open/quit apps), then replies
// with JSON.
//
// Wire contract (must match crates/eri_cli/src/control_agent.rs):
//   POST { "kind": "snapshot" }                        -> { "screen": ScreenGraph }
//   POST { "kind": "click", "element": "e3" }          -> { "result": "..." }
//   POST { "kind": "click", "x": 120, "y": 240 }       -> { "result": "..." }
//   POST { "kind": "type",  "text": "lofi" }           -> { "result": "..." }
//   POST { "kind": "key",   "combo": "cmd+l" }         -> { "result": "..." }
//   POST { "kind": "open_app", "name": "Safari" }      -> { "result": "..." }
//   POST { "kind": "quit_app", "name": "TextEdit" }    -> { "result": "..." }
//   any failure                                        -> { "error": "..." }
//
// On startup it prints one line to stdout:
//   ERI_CONTROL_ENDPOINT=http://127.0.0.1:<port>
// so the parent (the eri app, or a shell) can export it when spawning the loop.
//
// Requires Accessibility permission (System Settings > Privacy & Security >
// Accessibility). Screen Recording is only needed for the pixel-vision fallback
// (not implemented here yet — accessibility-first).
//
// Build:  swiftc -O scripts/eri_control_server.swift -o target/eri_control_server
// Run:    ./target/eri_control_server [port]      (0/omitted = ephemeral port)

import Cocoa
import ApplicationServices
import CoreGraphics
import Network
import Foundation

// MARK: - Accessibility snapshot

/// Maps element ids from the most recent snapshot to live AX handles so a
/// follow-up `click {element}` can act on the same node.
final class ElementRegistry {
    static let shared = ElementRegistry()
    private var map: [String: AXUIElement] = [:]
    private let lock = NSLock()

    func reset() { lock.lock(); map.removeAll(); lock.unlock() }
    func put(_ id: String, _ el: AXUIElement) { lock.lock(); map[id] = el; lock.unlock() }
    func get(_ id: String) -> AXUIElement? { lock.lock(); defer { lock.unlock() }; return map[id] }
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &value) == .success else { return nil }
    return value as? String
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &value) == .success,
          let arr = value as? [AXUIElement] else { return [] }
    return arr
}

func axFrame(_ el: AXUIElement) -> [Float] {
    var posVal: AnyObject?
    var sizeVal: AnyObject?
    var point = CGPoint.zero
    var size = CGSize.zero
    if AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posVal) == .success,
       let pv = posVal, CFGetTypeID(pv) == AXValueGetTypeID() {
        AXValueGetValue(pv as! AXValue, .cgPoint, &point)
    }
    if AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeVal) == .success,
       let sv = sizeVal, CFGetTypeID(sv) == AXValueGetTypeID() {
        AXValueGetValue(sv as! AXValue, .cgSize, &size)
    }
    return [Float(point.x), Float(point.y), Float(size.width), Float(size.height)]
}

func axActionable(_ el: AXUIElement) -> Bool {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success,
          let actions = names as? [String] else { return false }
    // Anything pressable/confirmable counts as actionable.
    return actions.contains(kAXPressAction as String)
        || actions.contains("AXConfirm")
        || actions.contains("AXPick")
}

func bestLabel(_ el: AXUIElement) -> String {
    for attr in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        if let s = axString(el, attr as String), !s.isEmpty {
            return String(s.prefix(120))
        }
    }
    return ""
}

struct SnapElement {
    let id: String
    let role: String
    let label: String
    let actionable: Bool
    let frame: [Float]
}

/// Walk the frontmost app's focused window into a flat, capped element list.
/// Depth + count caps keep it cheap (the percept must be token-frugal).
func snapshot() -> [String: Any] {
    guard AXIsProcessTrusted() else {
        return ["error": "Accessibility permission not granted. Enable eri in System Settings > Privacy & Security > Accessibility."]
    }
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return ["error": "no frontmost application"]
    }
    let appName = app.localizedName ?? "unknown"
    let axApp = AXUIElementCreateApplication(app.processIdentifier)

    var windowVal: AnyObject?
    let root: AXUIElement
    if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &windowVal) == .success,
       let w = windowVal, CFGetTypeID(w) == AXUIElementGetTypeID() {
        root = (w as! AXUIElement)
    } else {
        root = axApp
    }
    let windowTitle = axString(root, kAXTitleAttribute as String) ?? ""

    ElementRegistry.shared.reset()
    var out: [SnapElement] = []
    var counter = 0
    let maxElements = 200
    let maxDepth = 18

    func walk(_ el: AXUIElement, _ depth: Int) {
        if out.count >= maxElements || depth > maxDepth { return }
        let role = axString(el, kAXRoleAttribute as String) ?? "AXUnknown"
        let actionable = axActionable(el)
        if actionable {
            counter += 1
            let id = "e\(counter)"
            ElementRegistry.shared.put(id, el)
            out.append(SnapElement(
                id: id, role: role, label: bestLabel(el),
                actionable: true, frame: axFrame(el)
            ))
        }
        for child in axChildren(el) { walk(child, depth + 1) }
    }
    walk(root, 0)

    let elements: [[String: Any]] = out.map {
        ["id": $0.id, "role": $0.role, "label": $0.label,
         "actionable": $0.actionable, "frame": $0.frame]
    }
    return ["screen": ["app": appName, "window": windowTitle, "elements": elements]]
}

// MARK: - Actuation (CGEvent / AX / NSWorkspace)

func clickElement(_ id: String) -> [String: Any] {
    guard let el = ElementRegistry.shared.get(id) else {
        return ["error": "unknown element \(id) — call snapshot first"]
    }
    let r = AXUIElementPerformAction(el, kAXPressAction as CFString)
    if r == .success { return ["result": "pressed \(id)"] }
    // Fall back to a synthetic click at the element's center.
    let f = axFrame(el)
    if f.count == 4 && (f[2] > 0 || f[3] > 0) {
        return clickCoord(Double(f[0] + f[2] / 2), Double(f[1] + f[3] / 2))
    }
    return ["error": "could not press \(id)"]
}

func clickCoord(_ x: Double, _ y: Double) -> [String: Any] {
    let pt = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left),
          let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left) else {
        return ["error": "failed to synthesize click"]
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["result": "clicked at (\(Int(x)), \(Int(y)))"]
}

func typeText(_ text: String) -> [String: Any] {
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) else {
        return ["error": "failed to synthesize keystrokes"]
    }
    let chars = Array(text.utf16)
    chars.withUnsafeBufferPointer { buf in
        if let base = buf.baseAddress {
            down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: base)
            up.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: base)
        }
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["result": "typed \(text.count) chars"]
}

/// Map a combo like "cmd+l" / "enter" / "esc" to a keycode + modifier flags.
func keyCombo(_ combo: String) -> [String: Any] {
    let parts = combo.lowercased().split(separator: "+").map { String($0).trimmingCharacters(in: .whitespaces) }
    var flags = CGEventFlags()
    var keyName = ""
    for p in parts {
        switch p {
        case "cmd", "command", "meta": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: keyName = p
        }
    }
    let keymap: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
        "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32,
        "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
        "esc": 53, "escape": 53, "left": 123, "right": 124, "down": 125, "up": 126,
    ]
    guard let code = keymap[keyName] else {
        return ["error": "unknown key \(keyName) in combo \(combo)"]
    }
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false) else {
        return ["error": "failed to synthesize key \(combo)"]
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["result": "pressed \(combo)"]
}

func openApp(_ name: String) -> [String: Any] {
    let ws = NSWorkspace.shared
    if let url = ws.urlForApplication(withBundleIdentifier: name)
        ?? appURL(byName: name) {
        let cfg = NSWorkspace.OpenConfiguration()
        ws.openApplication(at: url, configuration: cfg, completionHandler: nil)
        return ["result": "opening \(name)"]
    }
    return ["error": "could not find application \(name)"]
}

func appURL(byName name: String) -> URL? {
    let candidates = [
        "/Applications/\(name).app",
        "/System/Applications/\(name).app",
        "\(NSHomeDirectory())/Applications/\(name).app",
    ]
    for path in candidates where FileManager.default.fileExists(atPath: path) {
        return URL(fileURLWithPath: path)
    }
    return nil
}

func quitApp(_ name: String) -> [String: Any] {
    let running = NSWorkspace.shared.runningApplications.filter {
        ($0.localizedName ?? "").caseInsensitiveCompare(name) == .orderedSame
            || ($0.bundleIdentifier ?? "").caseInsensitiveCompare(name) == .orderedSame
    }
    if running.isEmpty { return ["error": "\(name) is not running"] }
    var any = false
    for app in running { any = app.terminate() || any }
    return any ? ["result": "quit \(name)"] : ["error": "failed to quit \(name)"]
}

// MARK: - Request dispatch

func handle(_ body: [String: Any]) -> [String: Any] {
    guard let kind = body["kind"] as? String else { return ["error": "missing kind"] }
    switch kind {
    case "snapshot": return snapshot()
    case "click":
        if let el = body["element"] as? String { return clickElement(el) }
        if let x = body["x"] as? Double, let y = body["y"] as? Double { return clickCoord(x, y) }
        if let x = body["x"] as? Int, let y = body["y"] as? Int { return clickCoord(Double(x), Double(y)) }
        return ["error": "click needs element or x,y"]
    case "type":
        guard let t = body["text"] as? String else { return ["error": "type needs text"] }
        return typeText(t)
    case "key":
        guard let c = body["combo"] as? String else { return ["error": "key needs combo"] }
        return keyCombo(c)
    case "open_app":
        guard let n = body["name"] as? String else { return ["error": "open_app needs name"] }
        return openApp(n)
    case "quit_app":
        guard let n = body["name"] as? String else { return ["error": "quit_app needs name"] }
        return quitApp(n)
    case "wait":
        return ["result": "ok"]
    default:
        return ["error": "unknown kind \(kind)"]
    }
}

// MARK: - Minimal loopback HTTP server (NWListener)
//
// SECURITY: this endpoint can drive the whole computer, so it is defended in
// depth: (1) bound to the loopback interface ONLY; (2) every request must carry
// a per-launch random bearer token (constant-time compared); (3) the Host
// header must be our loopback host:port and any request with an Origin header
// (i.e. from a web page — the DNS-rebinding vector) is rejected; (4) Content-
// Type must be application/json. The token is printed on the banner so the
// parent (the eri app) can hand it to `eri control` via ERI_CONTROL_TOKEN.

var gPort: UInt16 = 0
var gToken: String = ""

func jsonData(_ obj: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"error\":\"serialize\"}".utf8)
}

func httpResponse(_ payload: Data, status: String = "200 OK") -> Data {
    var header = "HTTP/1.1 \(status)\r\n"
    header += "Content-Type: application/json\r\n"
    header += "Content-Length: \(payload.count)\r\n"
    header += "Connection: close\r\n\r\n"
    var data = Data(header.utf8)
    data.append(payload)
    return data
}

struct ParsedRequest {
    let headers: [String: String]
    let body: [String: Any]
}

/// Parse a buffered HTTP request once fully received; `nil` means "need more
/// bytes". Header names are lowercased for case-insensitive lookup.
func parseRequest(_ buffer: Data) -> ParsedRequest? {
    guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(data: buffer.subdata(in: 0..<headerEnd.lowerBound), encoding: .utf8) ?? ""
    var headers: [String: String] = [:]
    var contentLength = 0
    for line in head.split(separator: "\r\n").dropFirst() { // drop the request-line
        guard let colon = line.firstIndex(of: ":") else { continue }
        let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
        let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        headers[name] = value
        if name == "content-length" { contentLength = Int(value) ?? 0 }
    }
    let bodyStart = headerEnd.upperBound
    if buffer.count - bodyStart < contentLength { return nil } // need more
    let bodyData = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
    let obj = (try? JSONSerialization.jsonObject(with: bodyData)) as? [String: Any] ?? [:]
    return ParsedRequest(headers: headers, body: obj)
}

/// Length-independent constant-time string compare (avoids token timing leaks).
func constantTimeEqual(_ a: String, _ b: String) -> Bool {
    let ab = Array(a.utf8)
    let bb = Array(b.utf8)
    if ab.count != bb.count { return false }
    var diff: UInt8 = 0
    for i in 0..<ab.count { diff |= ab[i] ^ bb[i] }
    return diff == 0
}

/// Reject anything that isn't a local, same-origin-less, authenticated, JSON
/// request. Returns an error reply when rejected, `nil` when the request is OK.
func rejectReason(_ req: ParsedRequest) -> [String: Any]? {
    // A browser request carries an Origin; legitimate local clients don't.
    if req.headers["origin"] != nil { return ["error": "forbidden: origin not allowed"] }
    let host = req.headers["host"] ?? ""
    if host != "127.0.0.1:\(gPort)" && host != "localhost:\(gPort)" {
        return ["error": "forbidden: bad host"]
    }
    if !(req.headers["content-type"] ?? "").lowercased().hasPrefix("application/json") {
        return ["error": "bad content-type"]
    }
    if !constantTimeEqual(req.headers["authorization"] ?? "", "Bearer \(gToken)") {
        return ["error": "unauthorized"]
    }
    return nil
}

func serve(connection: NWConnection) {
    connection.start(queue: .global())
    var buffer = Data()
    func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            if let data = data { buffer.append(data) }
            if let req = parseRequest(buffer) {
                let reply: [String: Any]
                let status: String
                if let rejected = rejectReason(req) {
                    reply = rejected
                    status = "403 Forbidden"
                } else {
                    reply = handle(req.body)
                    status = "200 OK"
                }
                let out = httpResponse(jsonData(reply), status: status)
                connection.send(content: out, completion: .contentProcessed { _ in
                    connection.cancel()
                })
                return
            }
            if isComplete || error != nil { connection.cancel(); return }
            receive()
        }
    }
    receive()
}

/// 32 random bytes (CSPRNG via SystemRandomNumberGenerator) as hex.
func makeToken() -> String {
    (0..<32).map { _ in String(format: "%02x", Int.random(in: 0...255)) }.joined()
}

func runServer(port requested: UInt16) {
    gToken = makeToken()
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    // Bind to the loopback ADDRESS ONLY (127.0.0.1), not the wildcard, so the
    // actuation socket is never reachable from the network at the kernel level.
    params.requiredInterfaceType = .loopback
    let nwPort = NWEndpoint.Port(rawValue: requested) ?? .any
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
    guard let listener = try? NWListener(using: params) else {
        FileHandle.standardError.write(Data("eri-control: failed to bind\n".utf8))
        exit(1)
    }
    listener.stateUpdateHandler = { state in
        if case .ready = state, let p = listener.port {
            gPort = p.rawValue
            // Banner: endpoint + the per-launch bearer token, one per line.
            print("ERI_CONTROL_ENDPOINT=http://127.0.0.1:\(p.rawValue)")
            print("ERI_CONTROL_TOKEN=\(gToken)")
            fflush(stdout)
        }
    }
    listener.newConnectionHandler = { serve(connection: $0) }
    listener.start(queue: .global())
    if !AXIsProcessTrusted() {
        FileHandle.standardError.write(Data("eri-control: warning — Accessibility not granted; snapshots/clicks will fail until enabled.\n".utf8))
    }
    RunLoop.main.run()
}

let portArg = CommandLine.arguments.count > 1 ? UInt16(CommandLine.arguments[1]) ?? 0 : 0
runServer(port: portArg)

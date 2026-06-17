// eri voice server — the native voice bridge behind `eri voice` / the app's mic.
//
// Hosts a loopback HTTP endpoint (same security model as eri_control_server) that
// does the three things the Rust voice loop + the WebView need:
//   POST { "kind": "transcribe" }            -> { "text": "..." }   (on-device STT)
//   POST { "kind": "speak", "text": "..." }  -> { "ok": true }      (TTS)
//   POST { "kind": "vocab_add", "word": "Eri" } -> { "ok": true, "count": N }
//   POST { "kind": "vocab_list" }            -> { "words": [...] }
//
// WHY IT BEATS WISPR FLOW:
//   * On-device recognition (SFSpeechRecognizer, requiresOnDeviceRecognition) —
//     private + offline, no upload.
//   * TEACH-BY-VOICE: a custom vocabulary the user grows ("Eri", names, jargon) is
//     loaded as `contextualStrings`, biasing recognition toward those exact words
//     so it stops mishearing them — no hand-typed dictionary, no cloud. Persisted
//     at ~/.config/eri/voice_vocab.json; the app's "Teach eri a word" button (and
//     an in-convo correction) call vocab_add.
//
// On startup prints, one per line, so the parent (app / shell) can wire it:
//   ERI_VOICE_ENDPOINT=http://127.0.0.1:<port>
//   ERI_VOICE_TOKEN=<per-launch bearer>
//
// Requires Microphone + Speech Recognition permission (Info.plist usage strings
// are authored by build_eri_agent_manager.sh; macOS prompts on first use).
//
// Build:  swiftc -O scripts/eri_voice_server.swift -o target/eri_voice_server
// Run:    ./target/eri_voice_server [port]      (0/omitted = ephemeral port)

import AVFoundation
import Foundation
import Network
import Speech

// MARK: - Teach-by-voice vocabulary (persisted custom words → recognizer bias)

func vocabPath() -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent(".config/eri/voice_vocab.json")
}

func loadVocab() -> [String] {
    guard let data = try? Data(contentsOf: vocabPath()),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [String] else { return [] }
    return arr
}

func addVocab(_ word: String) -> [String] {
    let w = word.trimmingCharacters(in: .whitespacesAndNewlines)
    var words = loadVocab()
    if !w.isEmpty && !words.contains(where: { $0.caseInsensitiveCompare(w) == .orderedSame }) {
        words.append(w)
        let url = vocabPath()
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: words, options: [.prettyPrinted]) {
            try? data.write(to: url)
        }
    }
    return words
}

// MARK: - Text-to-speech

let gSynth = AVSpeechSynthesizer()

func speak(_ text: String) {
    let utter = AVSpeechUtterance(string: text)
    utter.rate = AVSpeechUtteranceDefaultSpeechRate
    // Speak on the main thread (AVSpeechSynthesizer requires it).
    DispatchQueue.main.async { gSynth.speak(utter) }
}

// MARK: - On-device speech-to-text (one utterance, vocab-biased)

/// Capture the mic and return the best on-device transcription of one utterance,
/// ending on a ~1.2s pause or `maxSeconds`. Blocks the caller (the HTTP handler
/// runs on a background queue); audio is driven on the main queue. Returns the
/// transcript or an error string.
func transcribeOnce(maxSeconds: Double = 12.0) -> (text: String?, error: String?) {
    guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
        return (nil, "speech recognizer unavailable")
    }
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    request.contextualStrings = loadVocab() // teach-by-voice bias

    let sema = DispatchSemaphore(value: 0)
    var best = ""
    var errOut: String?
    var finished = false
    let lock = NSLock()
    var silenceTimer: DispatchSourceTimer?

    func finish(_ err: String?) {
        lock.lock(); defer { lock.unlock() }
        if finished { return }
        finished = true
        errOut = err
        silenceTimer?.cancel()
        DispatchQueue.main.async {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            request.endAudio()
        }
        sema.signal()
    }

    func bumpSilence() {
        silenceTimer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .global())
        t.schedule(deadline: .now() + 1.2)
        t.setEventHandler { finish(nil) } // a pause = end of utterance
        t.resume()
        silenceTimer = t
    }

    let task = recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
            lock.lock(); best = result.bestTranscription.formattedString; lock.unlock()
            bumpSilence()
            if result.isFinal { finish(nil) }
        }
        if error != nil { finish("recognition failed") }
    }
    _ = task

    DispatchQueue.main.async {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch { finish("mic start failed: \(error.localizedDescription)") }
        bumpSilence()
    }

    if sema.wait(timeout: .now() + maxSeconds) == .timedOut { finish(nil) }
    lock.lock(); let text = best; let e = errOut; lock.unlock()
    if let e = e, text.isEmpty { return (nil, e) }
    return (text.isEmpty ? nil : text, nil)
}

// MARK: - request handling

func handle(_ body: [String: Any]) -> [String: Any] {
    let kind = body["kind"] as? String ?? ""
    switch kind {
    case "speak":
        guard let text = body["text"] as? String, !text.isEmpty else { return ["error": "no text"] }
        speak(text)
        return ["ok": true]
    case "transcribe":
        let (text, err) = transcribeOnce()
        if let err = err { return ["error": err] }
        return ["text": text ?? ""]
    case "vocab_add":
        guard let word = body["word"] as? String else { return ["error": "no word"] }
        let words = addVocab(word)
        return ["ok": true, "count": words.count]
    case "vocab_list":
        return ["words": loadVocab()]
    default:
        return ["error": "unknown kind: \(kind)"]
    }
}

// MARK: - Minimal loopback HTTP server (mirrors eri_control_server)

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

func parseRequest(_ buffer: Data) -> ParsedRequest? {
    guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(data: buffer.subdata(in: 0..<headerEnd.lowerBound), encoding: .utf8) ?? ""
    var headers: [String: String] = [:]
    var contentLength = 0
    for line in head.split(separator: "\r\n").dropFirst() {
        guard let colon = line.firstIndex(of: ":") else { continue }
        let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
        let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        headers[name] = value
        if name == "content-length" { contentLength = Int(value) ?? 0 }
    }
    let bodyStart = headerEnd.upperBound
    if buffer.count - bodyStart < contentLength { return nil }
    let bodyData = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
    let obj = (try? JSONSerialization.jsonObject(with: bodyData)) as? [String: Any] ?? [:]
    return ParsedRequest(headers: headers, body: obj)
}

func constantTimeEqual(_ a: String, _ b: String) -> Bool {
    let ab = Array(a.utf8); let bb = Array(b.utf8)
    if ab.count != bb.count { return false }
    var diff: UInt8 = 0
    for i in 0..<ab.count { diff |= ab[i] ^ bb[i] }
    return diff == 0
}

func rejectReason(_ req: ParsedRequest) -> [String: Any]? {
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
                    reply = rejected; status = "403 Forbidden"
                } else {
                    reply = handle(req.body); status = "200 OK"
                }
                let out = httpResponse(jsonData(reply), status: status)
                connection.send(content: out, completion: .contentProcessed { _ in connection.cancel() })
                return
            }
            if isComplete || error != nil { connection.cancel(); return }
            receive()
        }
    }
    receive()
}

func makeToken() -> String {
    (0..<32).map { _ in String(format: "%02x", Int.random(in: 0...255)) }.joined()
}

func runServer(port requested: UInt16) {
    gToken = makeToken()
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    params.requiredInterfaceType = .loopback
    let nwPort = NWEndpoint.Port(rawValue: requested) ?? .any
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
    guard let listener = try? NWListener(using: params) else {
        FileHandle.standardError.write(Data("eri-voice: failed to bind\n".utf8)); exit(1)
    }
    listener.stateUpdateHandler = { state in
        if case .ready = state, let p = listener.port {
            gPort = p.rawValue
            print("ERI_VOICE_ENDPOINT=http://127.0.0.1:\(p.rawValue)")
            print("ERI_VOICE_TOKEN=\(gToken)")
            fflush(stdout)
        }
    }
    listener.newConnectionHandler = { serve(connection: $0) }
    listener.start(queue: .global())
    RunLoop.main.run()
}

// MARK: - entry

let requestedPort = UInt16(CommandLine.arguments.dropFirst().first ?? "") ?? 0
SFSpeechRecognizer.requestAuthorization { status in
    if status != .authorized {
        FileHandle.standardError.write(
            Data("eri-voice: speech recognition not authorized (grant in System Settings)\n".utf8))
    }
    runServer(port: requestedPort)
}
RunLoop.main.run()

#!/usr/bin/env swift

import AVFoundation
import Foundation
import Vision

struct Event: Encodable {
    let type: String
    let message: String?
    let target: String?
    let label: String?
    let x: Double?
    let y: Double?
    let confidence: Double?

    static func status(_ message: String) -> Event {
        Event(type: "status", message: message, target: nil, label: nil, x: nil, y: nil, confidence: nil)
    }

    static func error(_ message: String) -> Event {
        Event(type: "error", message: message, target: nil, label: nil, x: nil, y: nil, confidence: nil)
    }

    static func gaze(target: String, label: String?, x: Double, y: Double, confidence: Double) -> Event {
        Event(type: "gaze", message: nil, target: target, label: label, x: x, y: y, confidence: confidence)
    }
}

func emit(_ event: Event) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(event), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

final class CameraProbe: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private var frameCount = 0

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .low

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified) else {
            throw NSError(domain: "eri.gaze", code: 1, userInfo: [NSLocalizedDescriptionKey: "No camera device found"])
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "eri.gaze", code: 2, userInfo: [NSLocalizedDescriptionKey: "Camera input cannot be added"])
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "eri.gaze.frames"))
        guard session.canAddOutput(output) else {
            throw NSError(domain: "eri.gaze", code: 3, userInfo: [NSLocalizedDescriptionKey: "Camera output cannot be added"])
        }
        session.addOutput(output)

        session.commitConfiguration()
        session.startRunning()
        emit(.status("Camera active. Basic frame signal is live; calibrated gaze mapping comes next."))
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameCount += 1
        guard frameCount % 6 == 0 else {
            return
        }

        let request = VNDetectFaceLandmarksRequest { request, error in
            if let error {
                emit(.error(error.localizedDescription))
                return
            }

            guard let face = (request.results as? [VNFaceObservation])?.first else {
                emit(.status("Camera active. No face detected."))
                return
            }

            let faceCenter = CGPoint(x: face.boundingBox.midX, y: face.boundingBox.midY)
            guard
                let landmarks = face.landmarks,
                let leftEye = landmarks.leftEye,
                let rightEye = landmarks.rightEye
            else {
                emit(.gaze(
                    target: "camera",
                    label: "face detected",
                    x: Double(faceCenter.x),
                    y: Double(1.0 - faceCenter.y),
                    confidence: 0.42
                ))
                return
            }

            let leftCenter = self.center(of: leftEye, in: face.boundingBox)
            let rightCenter = self.center(of: rightEye, in: face.boundingBox)
            let eyeCenter = CGPoint(
                x: (leftCenter.x + rightCenter.x) / 2.0,
                y: (leftCenter.y + rightCenter.y) / 2.0
            )

            emit(.gaze(
                target: "camera",
                label: "eyes detected",
                x: Double(eyeCenter.x),
                y: Double(1.0 - eyeCenter.y),
                confidence: 0.68
            ))
        }

        let handler = VNImageRequestHandler(cmSampleBuffer: sampleBuffer, orientation: .up, options: [:])
        do {
            try handler.perform([request])
        } catch {
            emit(.error(error.localizedDescription))
        }
    }

    private func center(of landmark: VNFaceLandmarkRegion2D, in boundingBox: CGRect) -> CGPoint {
        let points = landmark.normalizedPoints
        guard !points.isEmpty else {
            return CGPoint(x: boundingBox.midX, y: boundingBox.midY)
        }

        let sum = points.reduce(CGPoint.zero) { partial, point in
            CGPoint(x: partial.x + point.x, y: partial.y + point.y)
        }
        let local = CGPoint(x: sum.x / CGFloat(points.count), y: sum.y / CGFloat(points.count))
        return CGPoint(
            x: boundingBox.minX + local.x * boundingBox.width,
            y: boundingBox.minY + local.y * boundingBox.height
        )
    }
}

func run() {
    emit(.status("Requesting camera access."))

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
        break
    case .notDetermined:
        let semaphore = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .video) { granted in
            emit(granted ? .status("Camera permission granted.") : .error("Camera permission denied."))
            semaphore.signal()
        }
        semaphore.wait()
    case .denied, .restricted:
        emit(.error("Camera permission is denied or restricted in macOS Privacy settings."))
        exit(1)
    @unknown default:
        emit(.error("Unknown camera authorization state."))
        exit(1)
    }

    do {
        let probe = CameraProbe()
        try probe.start()
        withExtendedLifetime(probe) {
            RunLoop.current.run()
        }
    } catch {
        emit(.error(error.localizedDescription))
        exit(1)
    }
}

if CommandLine.arguments.contains("--run") {
    run()
} else {
    emit(.status("Usage: script/eri_gaze_sidecar --run"))
}

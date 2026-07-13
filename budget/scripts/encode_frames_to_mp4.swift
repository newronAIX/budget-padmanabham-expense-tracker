import AVFoundation
import AppKit
import CoreVideo
import Foundation

if CommandLine.arguments.count < 8 {
  fputs("Usage: encode_frames_to_mp4.swift <frames-dir> <output.mp4> <fps> <width> <height> <bitrate> <frame-count>\n", stderr)
  exit(2)
}

let framesDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let fps = Int32(CommandLine.arguments[3]) ?? 12
let width = Int(CommandLine.arguments[4]) ?? 540
let height = Int(CommandLine.arguments[5]) ?? 960
let bitrate = Int(CommandLine.arguments[6]) ?? 900_000
let frameCount = Int(CommandLine.arguments[7]) ?? 0

try? FileManager.default.removeItem(at: outputURL)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true

let videoSettings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: bitrate,
    AVVideoMaxKeyFrameIntervalKey: Int(fps * 2),
    AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel
  ]
]

let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
input.expectsMediaDataInRealTime = false

let attributes: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
  kCVPixelBufferCGImageCompatibilityKey as String: true,
  kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
]

let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: attributes
)

guard writer.canAdd(input) else {
  fputs("Cannot add video input\n", stderr)
  exit(1)
}

writer.add(input)

guard writer.startWriting() else {
  fputs("Writer failed to start: \(writer.error?.localizedDescription ?? "unknown error")\n", stderr)
  exit(1)
}

writer.startSession(atSourceTime: .zero)

func makePixelBuffer(from imageURL: URL) -> CVPixelBuffer? {
  guard
    let image = NSImage(contentsOf: imageURL),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else {
    return nil
  }

  var pixelBuffer: CVPixelBuffer?
  let status = CVPixelBufferCreate(
    kCFAllocatorDefault,
    width,
    height,
    kCVPixelFormatType_32ARGB,
    attributes as CFDictionary,
    &pixelBuffer
  )
  guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
    return nil
  }

  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

  guard
    let base = CVPixelBufferGetBaseAddress(buffer),
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: base,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    )
  else {
    return nil
  }

  context.setFillColor(NSColor.black.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.interpolationQuality = .high
  context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
  return buffer
}

let frameDuration = CMTime(value: 1, timescale: fps)
let queue = DispatchQueue(label: "budget.padmanabham.video.encoder")
let group = DispatchGroup()
var frameIndex = 0
var failed = false

group.enter()
input.requestMediaDataWhenReady(on: queue) {
  while input.isReadyForMoreMediaData && frameIndex < frameCount {
    let frameURL = framesDir.appendingPathComponent(String(format: "frame-%05d.jpg", frameIndex))
    guard let buffer = makePixelBuffer(from: frameURL) else {
      fputs("Could not read frame \(frameURL.path)\n", stderr)
      failed = true
      input.markAsFinished()
      group.leave()
      return
    }

    let presentationTime = CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
    if !adaptor.append(buffer, withPresentationTime: presentationTime) {
      fputs("Append failed at frame \(frameIndex): \(writer.error?.localizedDescription ?? "unknown error")\n", stderr)
      failed = true
      input.markAsFinished()
      group.leave()
      return
    }

    frameIndex += 1
    if frameIndex % Int(fps * 10) == 0 {
      print("Encoded \(frameIndex)/\(frameCount) frames")
    }
  }

  if frameIndex >= frameCount {
    input.markAsFinished()
    group.leave()
  }
}

group.wait()

let finishGroup = DispatchGroup()
finishGroup.enter()
writer.finishWriting {
  finishGroup.leave()
}
finishGroup.wait()

if failed || writer.status != .completed {
  fputs("Encoding failed: \(writer.error?.localizedDescription ?? "unknown error")\n", stderr)
  exit(1)
}

print("Wrote \(outputURL.path)")

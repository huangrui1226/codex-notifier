import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct IconError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func renderIcon(logo: CGImage, pixels: Int, to file: URL) throws {
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let canvas = CGContext(data: nil, width: pixels, height: pixels,
                                 bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw IconError(message: "无法创建 \(pixels) 像素画布")
    }

    // Lay out each size in the same 1024-unit coordinate system.
    let scale = CGFloat(pixels) / 1024
    canvas.scaleBy(x: scale, y: scale)
    let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
    canvas.setFillColor(CGColor(gray: 1, alpha: 1))
    canvas.addPath(CGPath(roundedRect: tile, cornerWidth: 184, cornerHeight: 184, transform: nil))
    canvas.fillPath()

    let logoScale = 620 / CGFloat(max(logo.width, logo.height))
    let width = CGFloat(logo.width) * logoScale
    let height = CGFloat(logo.height) * logoScale
    canvas.interpolationQuality = .high
    canvas.draw(logo, in: CGRect(x: 512 - width / 2, y: 512 - height / 2, width: width, height: height))

    guard let image = canvas.makeImage(),
          let output = CGImageDestinationCreateWithURL(file as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw IconError(message: "无法创建 \(file.lastPathComponent)")
    }
    CGImageDestinationAddImage(output, image, nil)
    guard CGImageDestinationFinalize(output) else {
        throw IconError(message: "无法保存 \(file.lastPathComponent)")
    }
}

func generateIcon() throws {
    let build = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let arguments = CommandLine.arguments.dropFirst()
    guard arguments.count <= 1 else {
        throw IconError(message: "用法：npm run icon:mac -- [logo.png]")
    }
    let input = arguments.first.map { URL(fileURLWithPath: $0) } ?? build.appendingPathComponent("logo.png")
    guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
          CGImageSourceGetType(source) as String? == UTType.png.identifier,
          let logo = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw IconError(message: "无法读取 PNG 图标：\(input.path)")
    }

    let files = FileManager.default
    let temporary = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let iconset = temporary.appendingPathComponent("AppIcon.iconset")
    try files.createDirectory(at: iconset, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: temporary) }
    for size in [16, 32, 128, 256, 512] {
        let name = "icon_\(size)x\(size)"
        try renderIcon(logo: logo, pixels: size, to: iconset.appendingPathComponent("\(name).png"))
        try renderIcon(logo: logo, pixels: size * 2, to: iconset.appendingPathComponent("\(name)@2x.png"))
    }

    let compiled = temporary.appendingPathComponent("icon.icns")
    let iconutil = Process()
    iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
    iconutil.arguments = ["-c", "icns", "-o", compiled.path, iconset.path]
    try iconutil.run()
    iconutil.waitUntilExit()
    guard iconutil.terminationStatus == 0 else { throw IconError(message: "iconutil 生成图标失败") }

    try Data(contentsOf: compiled).write(to: build.appendingPathComponent("icon.icns"), options: .atomic)
    print("已生成 build/icon.icns")
}

do {
    try generateIcon()
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}

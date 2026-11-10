// Draws brand/icon/sizes.png: the iconset's small sizes as macOS shows them, at 1x and enlarged
// without smoothing, on a light and a dark ground. brand/icon/build.sh runs it.
//
// usage: swift preview.swift <Lo.iconset> <out.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: swift preview.swift <Lo.iconset> <out.png>\n".data(using: .utf8)!)
    exit(2)
}
let iconset = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])

func image(_ name: String) -> NSBitmapImageRep {
    let url = iconset.appendingPathComponent(name)
    guard let data = try? Data(contentsOf: url), let rep = NSBitmapImageRep(data: data) else {
        FileHandle.standardError.write("preview.swift: can't read \(url.path)\n".data(using: .utf8)!)
        exit(1)
    }
    return rep
}

// (file, pixels, drawn size): 128 to 16 px at 1x, then 32 and 16 px enlarged to 128.
let items: [(String, Int, Int)] = [
    ("icon_128x128.png", 128, 128), ("icon_32x32@2x.png", 64, 64), ("icon_32x32.png", 32, 32),
    ("icon_16x16.png", 16, 16), ("icon_32x32.png", 32, 128), ("icon_16x16.png", 16, 128),
]
let grounds: [NSColor] = [
    NSColor(srgbRed: 0.93, green: 0.93, blue: 0.93, alpha: 1),
    NSColor(srgbRed: 0.12, green: 0.12, blue: 0.12, alpha: 1),
]
let pad = 24, gap = 40, labelHeight = 20
let width = pad * 2 + items.map { $0.2 }.reduce(0, +) + gap * (items.count - 1)
let rowHeight = pad * 2 + 128 + labelHeight
let height = rowHeight * grounds.count

let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = context
context.imageInterpolation = .none

for (row, ground) in grounds.enumerated() {
    // AppKit's origin is the bottom left; the first row goes on top.
    let rowY = height - rowHeight * (row + 1)
    ground.setFill()
    NSRect(x: 0, y: rowY, width: width, height: rowHeight).fill()
    let ink: NSColor = row == 0 ? .black : .white
    var x = pad
    for (name, pixels, drawn) in items {
        let y = rowY + pad + labelHeight + (128 - drawn) / 2
        image(name).draw(
            in: NSRect(x: x, y: y, width: drawn, height: drawn), from: .zero, operation: .sourceOver,
            fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.none.rawValue])
        let label = (drawn == pixels ? "\(pixels) px" : "\(pixels) px, ×\(drawn / pixels)") as NSString
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12), .foregroundColor: ink.withAlphaComponent(0.6),
        ]
        let labelWidth = label.size(withAttributes: attributes).width
        let labelX = CGFloat(x) + (CGFloat(drawn) - labelWidth) / 2
        label.draw(at: NSPoint(x: labelX, y: CGFloat(rowY + pad - 4)), withAttributes: attributes)
        x += drawn + gap
    }
}
NSGraphicsContext.restoreGraphicsState()

let png = rep.converting(to: .sRGB, renderingIntent: .default)!.representation(using: .png, properties: [:])!
try png.write(to: out)

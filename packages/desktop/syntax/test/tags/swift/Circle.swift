import Foundation

let maxRadius = 100.0

/// Anything with an area.
protocol Shape {
    var name: String { get }
    func area() -> Double
}

/// A round shape.
struct Circle: Shape {
    var radius: Double
    let name = "circle"

    init(radius: Double) {
        self.radius = min(radius, maxRadius)
    }

    func area() -> Double {
        let squared = radius * radius
        return Double.pi * squared
    }
}

enum Kind {
    case round, oval
}

typealias Circles = [Circle]

extension Circle {
    static func unit() -> Circle {
        Circle(radius: 1)
    }
}

func largest(_ circles: Circles) -> Circle? {
    circles.max { $0.area() < $1.area() }
}

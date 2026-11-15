// Package shapes measures shapes.
package shapes

import (
	"fmt"
	"math"

	units "github.com/acme/geometry/internal/units"
)

// MaxRadius is the largest radius a circle may have.
const MaxRadius = 100

var (
	Default = Circle{Radius: 1}
	created int
)

// Shape is anything with an area.
type Shape interface {
	Area() float64
}

// Circle is a round shape.
type Circle struct {
	Radius float64
	Unit   units.Unit
}

// Area is the circle's area.
func (c *Circle) Area() float64 {
	return math.Pi * c.Radius * c.Radius
}

// New makes a circle no larger than MaxRadius.
func New(radius float64) *Circle {
	created++
	return &Circle{Radius: math.Min(radius, MaxRadius), Unit: units.Metre}
}

func describe(s Shape) string {
	return fmt.Sprintf("%v", s.Area())
}

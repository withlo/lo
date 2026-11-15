require "json"
require_relative "shape"

module Shapes
  MAX_RADIUS = 100

  # A round shape.
  class Circle < Shape
    attr_reader :radius

    def initialize(radius)
      @radius = [radius, MAX_RADIUS].min
    end

    def area
      squared = radius**2
      Math::PI * squared
    end

    def to_json(*args)
      { radius: radius, area: area }.to_json(*args)
    end

    def self.unit
      new(1)
    end
  end

  class << self
    def largest(circles)
      circles.max_by(&:area)
    end
  end
end

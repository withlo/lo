package com.acme.shapes;

import java.util.List;
import com.acme.units.*;
import static com.acme.units.Convert.toMetres;

/** A round shape. */
public class Circle extends Shape implements Area, Comparable<Circle> {
    public static final double MAX_RADIUS = 100, MIN_RADIUS = 0;
    private final double radius;

    public Circle(double radius) {
        this.radius = Math.min(radius, MAX_RADIUS);
    }

    @Override
    public double area() {
        double squared = radius * radius;
        return Math.PI * toMetres(squared, Unit.METRE);
    }

    @Override
    public int compareTo(Circle other) {
        return Double.compare(area(), other.area());
    }

    enum Kind { ROUND, OVAL }

    record Measured(Circle circle, double area) {}

    static List<Circle> sorted(List<Circle> circles) {
        return circles.stream().sorted(Circle::compareTo).toList();
    }
}

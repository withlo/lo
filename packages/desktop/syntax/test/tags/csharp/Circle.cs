using System;
using System.Collections.Generic;
using Acme.Units;

namespace Acme.Shapes
{
    /// <summary>A round shape.</summary>
    public class Circle : Shape, IArea
    {
        public const double MaxRadius = 100;
        private readonly double radius, created;

        public Circle(double radius)
        {
            this.radius = Math.Min(radius, MaxRadius);
        }

        public double Radius => radius;

        public event EventHandler Grown;

        public double Area()
        {
            var squared = radius * radius;
            return Math.PI * Convert.ToMetres(squared, Unit.Metre);
        }

        public static List<Circle> Sorted(IEnumerable<Circle> circles)
        {
            var list = new List<Circle>(circles);
            list.Sort((a, b) => a.Area().CompareTo(b.Area()));
            return list;
        }
    }

    public interface IArea
    {
        double Area();
    }

    public enum Kind { Round, Oval }

    public record struct Measured(Circle Circle, double Area);
}

<?php

namespace App\Shapes;

use App\Units\Metre;
use App\Units\{Convert, Unit as MeasureUnit};
use function App\Support\clamp;

const MAX_RADIUS = 100;

/** A round shape. */
class Circle extends Shape implements Area
{
    public const SIDES = 0;

    private float $radius;

    public function __construct(float $radius)
    {
        $this->radius = clamp($radius, 0, MAX_RADIUS);
    }

    public function area(): float
    {
        $squared = $this->radius ** 2;
        return M_PI * Convert::toMetres($squared, new Metre());
    }

    public static function unit(): self
    {
        return new static(1);
    }
}

interface Area
{
    public function area(): float;
}

enum Kind: string
{
    case Round = 'round';
    case Oval = 'oval';
}

function largest(Circle ...$circles): ?Circle
{
    usort($circles, fn ($a, $b) => $b->area() <=> $a->area());
    return $circles[0] ?? null;
}

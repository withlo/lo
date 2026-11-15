package com.acme.shapes

import com.acme.units.Unit
import com.acme.units.toMetres as metres
import com.acme.registry.*

const val MAX_RADIUS = 100.0
val unitCircle = Circle(1.0)

/** A round shape. */
class Circle(val radius: Double) : Shape(), Area {
    var label = "circle"

    override fun area(): Double {
        val squared = radius * radius
        return Math.PI * metres(squared, Unit.METRE)
    }

    companion object Factory {
        fun of(radius: Double) = Circle(minOf(radius, MAX_RADIUS))
    }
}

interface Area {
    fun area(): Double
}

enum class Kind { ROUND, OVAL }

typealias Circles = List<Circle>

fun Circles.total(): Double = sumOf { it.area() }

//! Shapes and their areas.

use std::fmt;

use crate::units::{Metre, convert as to_unit};
use super::base::Shape;

mod registry;

pub const MAX_RADIUS: f64 = 100.0;

pub struct Circle {
    pub radius: f64,
}

pub enum Kind {
    Round(Circle),
    Flat { sides: u32 },
}

pub trait Area {
    fn area(&self) -> f64;
}

impl Area for Circle {
    fn area(&self) -> f64 {
        std::f64::consts::PI * self.radius.powi(2)
    }
}

impl Circle {
    pub fn new(radius: f64) -> Self {
        registry::record(radius.min(MAX_RADIUS));
        Circle { radius: to_unit(radius, Metre) }
    }
}

impl fmt::Display for Circle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "circle of {}", self.radius)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_an_area() {
        assert!(Circle::new(1.0).area() > 3.0);
    }
}

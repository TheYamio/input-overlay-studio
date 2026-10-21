//! Integrate physical path length before any visual coalescing.
#[derive(Default, Debug)]
pub struct Motion {
    pub dx: i32,
    pub dy: i32,
    pub distance_counts: f64,
}
impl Motion {
    pub fn add(&mut self, dx: i32, dy: i32, min_delta: i32) {
        self.distance_counts += (dx as f64).hypot(dy as f64);
        if min_delta <= 0 || (dx as i64).abs() + (dy as i64).abs() >= min_delta as i64 {
            self.dx = self.dx.saturating_add(dx);
            self.dy = self.dy.saturating_add(dy);
        }
    }
    pub fn take(&mut self) -> Self { std::mem::take(self) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opposite_samples_preserve_distance() {
        let mut m = Motion::default(); m.add(3, 4, 0); m.add(-3, -4, 0);
        let batch = m.take(); assert_eq!((batch.dx, batch.dy), (0, 0));
        assert_eq!(batch.distance_counts, 10.0); assert_eq!(m.distance_counts, 0.0);
    }
    #[test]
    fn threshold_does_not_filter_physical_distance() {
        let mut m = Motion::default(); m.add(1, 0, 10);
        assert_eq!(m.dx, 0); assert_eq!(m.distance_counts, 1.0);
    }
}

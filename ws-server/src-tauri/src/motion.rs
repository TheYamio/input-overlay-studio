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

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
pub struct RelativeReport {
    dx: i32,
    dy: i32,
}

#[cfg(any(target_os = "linux", test))]
impl RelativeReport {
    pub fn add_x(&mut self, value: i32) { self.dx = self.dx.saturating_add(value); }
    pub fn add_y(&mut self, value: i32) { self.dy = self.dy.saturating_add(value); }
    pub fn finish(&mut self, motion: &mut Motion, min_delta: i32) {
        let report = std::mem::take(self);
        motion.add(report.dx, report.dy, min_delta);
    }
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

    #[test]
    fn evdev_axes_form_a_vector_per_report_before_coalescing() {
        let mut motion = Motion::default();
        let mut report = RelativeReport::default();
        report.add_x(1);
        report.add_x(2);
        report.add_y(4);
        assert_eq!(motion.distance_counts, 0.0);
        report.finish(&mut motion, 0);
        report.add_x(-3);
        report.add_y(-4);
        report.finish(&mut motion, 0);
        assert_eq!((motion.dx, motion.dy, motion.distance_counts), (0, 0, 10.0));
    }

    #[test]
    fn evdev_visual_threshold_keeps_the_physical_path() {
        let mut motion = Motion::default();
        let mut report = RelativeReport::default();
        report.add_x(-2);
        report.add_y(1);
        report.finish(&mut motion, 4);
        assert_eq!((motion.dx, motion.dy), (0, 0));
        assert_eq!(motion.distance_counts, 5_f64.sqrt());
    }
}

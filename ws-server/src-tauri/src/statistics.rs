use crate::input_state::HeldState;
use crate::studio_store::StudioStore;
use crate::ws_server::InputEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};

const ACTIONS: u64 = 1;
const MOVEMENT: u64 = 2;
const SAMPLE_LIMIT: usize = 1024;
const MAX_WINDOW_MS: u64 = 60_000;
const PUBLISH_MS: u64 = 100;
const SAVE_MS: u64 = 1_000;
const FLICK_GAP_MS: u64 = 80;
const MAX_FLICK_MS: u64 = 350;
const FLICK_HISTORY: usize = 2048;
// At most 50 profiles × 32 modules. Leave room for two escaped IDs per entry.
const COUNTER_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const MAX_COUNTERS: usize = 50 * 32;

type CounterId = (String, String);
type Totals = BTreeMap<CounterId, u32>;

enum Event {
    Key(u16),
    Click,
    Wheel,
    Move { dx: i32, dy: i32, counts: Option<f64> },
    Reset,
}
struct Sample {
    time: Instant,
    gate: u64,
    event: Event,
}

pub(crate) struct StatisticsInput {
    queue: mpsc::Sender<Sample>,
    gate: Arc<AtomicU64>,
    gap: Arc<AtomicBool>,
}
impl StatisticsInput {
    pub(crate) fn record(&self, input: &InputEvent, held: &HeldState) {
        let gate = self.gate.load(Ordering::Relaxed);
        if gate & (ACTIONS | MOVEMENT) == 0 {
            return;
        }
        let event = match *input {
            InputEvent::KeyPress { rawcode } if gate & ACTIONS != 0 && !held.key_down(rawcode) => Event::Key(rawcode),
            InputEvent::AnalogDepth { rawcode, depth }
                if gate & ACTIONS != 0 && depth > 0.0 && !held.key_down(rawcode) => Event::Key(rawcode),
            InputEvent::MouseButton { button, pressed: true } if gate & ACTIONS != 0 && !held.button_down(button) => Event::Click,
            InputEvent::MouseScroll { rotation } if gate & ACTIONS != 0 && rotation != 0 => Event::Wheel,
            InputEvent::MouseMove { dx, dy, distance_counts } if gate & MOVEMENT != 0 => {
                Event::Move { dx, dy, counts: distance_counts }
            }
            InputEvent::Reset => Event::Reset,
            _ => return,
        };
        if self.queue.try_send(Sample { time: Instant::now(), gate, event }).is_err() {
            self.gap.store(true, Ordering::Relaxed);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Clicks,
    Actions,
    Keys,
    Custom,
}
impl Mode {
    fn from_config(config: &Value) -> Self {
        match config["counterMode"].as_str() {
            Some("APM") => Self::Actions,
            Some("KPM") => Self::Keys,
            Some("Custom") => Self::Custom,
            _ => Self::Clicks,
        }
    }
}

struct Counter {
    id: CounterId,
    mode: Mode,
    window: u64,
    increment: u16,
    decrement: u16,
}
struct FlickMeter {
    id: String,
    window: u64,
    threshold: f64,
    minimum_cm: f64,
}
#[derive(Default)]
struct Plan {
    profile: String,
    cm_per_count: f64,
    counters: Vec<Counter>,
    flicks: Vec<FlickMeter>,
    custom: BTreeSet<CounterId>,
    persistent: BTreeSet<CounterId>,
}
fn number(value: &Value, field: &str, fallback: f64) -> f64 {
    value[field].as_f64().unwrap_or(fallback)
}
impl Plan {
    fn from_document(document: &Value) -> Self {
        let mut plan = Self { cm_per_count: 2.54 / 800., ..Self::default() };
        let Some(profile_id) = document["activeProfileId"].as_str() else { return plan };
        plan.profile = profile_id.to_owned();
        for profile in document["profiles"].as_array().into_iter().flatten() {
            let Some(id) = profile["id"].as_str() else { continue };
            let active = id == profile_id;
            if active {
                let linked = document["gameProfiles"].as_array().into_iter().flatten()
                    .find(|game| game["id"] == profile["gameProfileId"]);
                let dpi = linked.and_then(|game| game["dpi"].as_f64()).unwrap_or(800.);
                plan.cm_per_count = 2.54 / dpi.clamp(1., 1e9);
            }
            for module in profile["modules"].as_array().into_iter().flatten() {
                if module["schemaVersion"] != 1 {
                    continue;
                }
                let Some(module_id) = module["id"].as_str() else { continue };
                let config = &module["config"];
                let visible = active && module["enabled"] == true;
                match module["type"].as_str() {
                    Some("overlay.counter") => {
                        let mode = Mode::from_config(config);
                        let key = (id.to_owned(), module_id.to_owned());
                        if mode == Mode::Custom {
                            plan.custom.insert(key.clone());
                            if config["counterPersist"] == true {
                                plan.persistent.insert(key.clone());
                            }
                        }
                        if visible {
                            plan.counters.push(Counter {
                                id: key, mode,
                                window: number(config, "counterWindow", 5.) as u64 * 1000,
                                increment: number(config, "counterIncrement", 107.) as u16,
                                decrement: number(config, "counterDecrement", 109.) as u16,
                            });
                        }
                    }
                    Some("overlay.flicks") if visible => plan.flicks.push(FlickMeter {
                        id: module_id.to_owned(),
                        window: number(config, "flickWindow", 10.) as u64 * 1000,
                        threshold: number(config, "flickThreshold", 1.),
                        minimum_cm: number(config, "flickMinDistance", 0.5),
                    }),
                    _ => {}
                }
            }
        }
        plan
    }
    fn flags(&self) -> u64 {
        u64::from(!self.counters.is_empty()) * ACTIONS | u64::from(!self.flicks.is_empty()) * MOVEMENT
    }
}

#[derive(Default)]
struct Bucket {
    start: u64,
    actions: u32,
    keys: u32,
    clicks: u32,
}
struct Burst {
    start: u64,
    last: u64,
    dx: f64,
    dy: f64,
    distance_cm: f64,
    peak_mps: f64,
}
struct Flick {
    end: u64,
    distance_cm: f64,
    peak_mps: f64,
}
#[derive(Default, Serialize, PartialEq)]
struct FlickValues {
    count: usize,
    peak_mps: f64,
    distance_cm: f64,
}
#[derive(Serialize)]
struct Snapshot<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    profile_id: &'a str,
    counters: Vec<(&'a str, f64)>,
    flicks: Vec<(&'a str, FlickValues)>,
}

#[derive(Default)]
struct Statistics {
    plan: Plan,
    totals: Totals,
    buckets: VecDeque<Bucket>,
    flicks: VecDeque<Flick>,
    burst: Option<Burst>,
}

impl Statistics {
    fn configure(&mut self, next: Plan) {
        self.totals.retain(|id, _| next.custom.contains(id));
        if self.plan.profile != next.profile || next.counters.is_empty() {
            self.buckets.clear();
        }
        if self.plan.profile != next.profile || self.plan.cm_per_count != next.cm_per_count || next.flicks.is_empty() {
            self.burst = None;
            self.flicks.clear();
        }
        self.plan = next;
    }

    fn event(&mut self, event: Event, ms: u64) -> bool {
        match event {
            Event::Reset => { self.burst = None; return false; }
            Event::Move { dx, dy, counts } => {
                let (dx, dy) = (f64::from(dx), f64::from(dy));
                self.movement(ms, dx, dy, counts.unwrap_or_else(|| dx.hypot(dy)));
                return false;
            }
            _ => {}
        }
        let mut dirty = false;
        if let Event::Key(code) = event {
            for counter in self.plan.counters.iter().filter(|c| c.mode == Mode::Custom) {
                if code != counter.increment && code != counter.decrement {
                    continue;
                }
                let value = self.totals.entry(counter.id.clone()).or_default();
                let next = if code == counter.increment { value.saturating_add(1) } else { value.saturating_sub(1) };
                dirty |= *value != next && self.plan.persistent.contains(&counter.id);
                *value = next;
            }
        }
        if self.plan.counters.iter().any(|counter| counter.mode != Mode::Custom) {
            self.prune(ms);
            let start = ms - ms % PUBLISH_MS;
            if self.buckets.back().is_none_or(|b| b.start != start) {
                self.buckets.push_back(Bucket { start, ..Bucket::default() });
            }
            let bucket = self.buckets.back_mut().unwrap();
            bucket.actions += 1;
            bucket.keys += u32::from(matches!(event, Event::Key(_)));
            bucket.clicks += u32::from(matches!(event, Event::Click));
        }
        dirty
    }

    fn movement(&mut self, ms: u64, dx: f64, dy: f64, counts: f64) {
        if self.plan.flicks.is_empty() || !counts.is_finite() || counts <= 0.0 {
            return;
        }
        let distance_cm = (counts * self.plan.cm_per_count).min(1_000.);
        let end = self.burst.as_ref().is_some_and(|burst| {
            ms.saturating_sub(burst.last) >= FLICK_GAP_MS
                || burst.dx * dx + burst.dy * dy < -0.5 * burst.dx.hypot(burst.dy) * dx.hypot(dy)
        });
        if end {
            self.finish_burst();
        }
        let elapsed = self.burst.as_ref().map_or(8, |burst| ms.saturating_sub(burst.last).max(4)) as f64;
        let burst = self.burst.get_or_insert(Burst {
            start: ms, last: ms, dx, dy, distance_cm: 0., peak_mps: 0.,
        });
        // Capture emits coalesced samples at 125 Hz. Use 8 ms for a first
        // sample and limit sub-frame timing jitter for subsequent samples.
        let speed = (distance_cm * 10. / elapsed).min(100.);
        burst.distance_cm += distance_cm;
        burst.peak_mps = burst.peak_mps.max(speed);
        burst.last = ms;
        if dx != 0. || dy != 0. {
            burst.dx = dx;
            burst.dy = dy;
        }
    }

    fn finish_burst(&mut self) {
        let Some(burst) = self.burst.take() else { return };
        if burst.last - burst.start > MAX_FLICK_MS || burst.peak_mps < 0.1 || burst.distance_cm < 0.1 {
            return;
        }
        if self.flicks.len() == FLICK_HISTORY {
            self.flicks.pop_front();
        }
        self.flicks.push_back(Flick {
            end: burst.last, distance_cm: burst.distance_cm, peak_mps: burst.peak_mps,
        });
    }

    fn prune(&mut self, ms: u64) {
        while self.buckets.front().is_some_and(|b| ms.saturating_sub(b.start) >= MAX_WINDOW_MS + PUBLISH_MS) {
            self.buckets.pop_front();
        }
        while self.flicks.front().is_some_and(|f| ms.saturating_sub(f.end) >= MAX_WINDOW_MS) {
            self.flicks.pop_front();
        }
    }

    fn snapshot(&mut self, ms: u64) -> Snapshot<'_> {
        if self.burst.as_ref().is_some_and(|b| ms.saturating_sub(b.last) >= FLICK_GAP_MS) {
            self.finish_burst();
        }
        self.prune(ms);
        let counters = self.plan.counters.iter().map(|counter| {
            let value = if counter.mode == Mode::Custom {
                f64::from(*self.totals.get(&counter.id).unwrap_or(&0))
            } else {
                let total: u64 = self.buckets.iter().rev()
                    .take_while(|bucket| ms.saturating_sub(bucket.start) < counter.window + PUBLISH_MS)
                    .map(|bucket| u64::from(match counter.mode {
                        Mode::Clicks => bucket.clicks, Mode::Keys => bucket.keys, _ => bucket.actions,
                    })).sum();
                let factor = if counter.mode == Mode::Clicks { 1000. } else { 60_000. };
                (100. * total as f64 * factor / counter.window as f64).round() / 100.
            };
            (counter.id.1.as_str(), value)
        }).collect();
        let flicks = self.plan.flicks.iter().map(|meter| {
            let mut values = FlickValues::default();
            for flick in self.flicks.iter().rev().take_while(|f| ms.saturating_sub(f.end) < meter.window) {
                if flick.peak_mps >= meter.threshold && flick.distance_cm >= meter.minimum_cm {
                    values.count += 1;
                    values.peak_mps = values.peak_mps.max(flick.peak_mps);
                    values.distance_cm += flick.distance_cm;
                }
            }
            values.peak_mps = (values.peak_mps * 100.).round() / 100.;
            values.distance_cm = (values.distance_cm * 100.).round() / 100.;
            (meter.id.as_str(), values)
        }).collect();
        Snapshot { kind: "input_statistics", profile_id: &self.plan.profile, counters, flicks }
    }

    fn next_update(&self, ms: u64) -> Option<u64> {
        let rates = self.plan.counters.iter().filter(|counter| counter.mode != Mode::Custom)
            .filter_map(|counter| self.buckets.iter().map(|b| b.start + counter.window + PUBLISH_MS).find(|end| *end > ms));
        let flicks = self.plan.flicks.iter().filter_map(|meter| self.flicks.iter()
            .filter(|f| f.peak_mps >= meter.threshold && f.distance_cm >= meter.minimum_cm)
            .map(|f| f.end + meter.window).find(|end| *end > ms));
        rates.chain(flicks).chain(self.burst.as_ref().map(|burst| burst.last + FLICK_GAP_MS))
            .min().map(|deadline| deadline.max(ms + PUBLISH_MS))
    }

    fn persistent_totals(&self) -> Totals {
        self.totals.iter().filter(|(id, value)| **value > 0 && self.plan.persistent.contains(*id))
            .map(|(id, value)| (id.clone(), *value)).collect()
    }
}

#[derive(Serialize, Deserialize)]
struct CounterFile {
    version: u8,
    counters: Vec<(String, String, u32)>,
}
struct Storage {
    path: PathBuf,
    saved: Totals,
    writable: bool,
}
fn read_totals(path: &Path) -> io::Result<Totals> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Totals::new()),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    file.take(COUNTER_FILE_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > COUNTER_FILE_LIMIT { return Err(io::Error::other("counter file too large")); }
    let file: CounterFile = serde_json::from_slice(&bytes)?;
    if file.version != 1 || file.counters.len() > MAX_COUNTERS {
        return Err(io::Error::other("unsupported counter file"));
    }
    Ok(file.counters.into_iter().filter(|(profile, module, value)|
        !profile.is_empty() && profile.encode_utf16().count() <= 80 && !module.is_empty() && module.encode_utf16().count() <= 80 && *value > 0
    ).map(|(profile, module, value)| ((profile, module), value)).collect())
}
impl Storage {
    async fn load(path: PathBuf) -> Self {
        let source = path.clone();
        match tokio::task::spawn_blocking(move || read_totals(&source)).await {
            Ok(Ok(saved)) => Self { path, saved, writable: true },
            error => {
                tracing::warn!("counter totals could not be read; original file preserved: {error:?}");
                Self { path, saved: Totals::new(), writable: false }
            }
        }
    }

    async fn save(&mut self, totals: Totals) -> io::Result<bool> {
        if !self.writable || totals == self.saved {
            return Ok(false);
        }
        let path = self.path.clone();
        let counters: Vec<_> = totals.iter().map(|((profile, module), value)| (profile.clone(), module.clone(), *value)).collect();
        tokio::task::spawn_blocking(move || {
            if counters.is_empty() {
                return match std::fs::remove_file(&path) {
                    Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                    result => result,
                };
            }
            let bytes = serde_json::to_vec(&CounterFile { version: 1, counters })?;
            let temp = path.with_extension("tmp");
            std::fs::write(&temp, bytes)?;
            std::fs::rename(temp, path)
        }).await.map_err(io::Error::other)??;
        self.saved = totals;
        Ok(true)
    }
}

pub(crate) fn start(
    studio: Arc<StudioStore>,
    mut changes: watch::Receiver<u64>,
    snapshots: watch::Sender<Option<Arc<str>>>,
) -> (StatisticsInput, tokio::task::JoinHandle<()>) {
    let (queue, mut input) = mpsc::channel::<Sample>(SAMPLE_LIMIT);
    let gate = Arc::new(AtomicU64::new(0));
    let gap = Arc::new(AtomicBool::new(false));
    let tap = StatisticsInput { queue, gate: gate.clone(), gap: gap.clone() };
    let epoch = Instant::now();
    let task = tokio::spawn(async move {
        let mut state = Statistics::default();
        let mut storage = Storage::load(studio.counter_totals_path()).await;
        let mut generation = 0;
        let mut publish_at = Some(0);
        let mut save_at = None;
        let clock = || epoch.elapsed().as_millis() as u64;
        let configure = |state: &mut Statistics, generation: &mut u64| {
            let plan = Plan::from_document(&studio.current().document);
            if state.plan.profile != plan.profile || state.plan.flags() != plan.flags() {
                *generation += 4;
            }
            state.configure(plan);
            gate.store(*generation | state.plan.flags(), Ordering::Relaxed);
        };
        configure(&mut state, &mut generation);
        state.totals = storage.saved.iter().filter(|(id, _)| state.plan.persistent.contains(*id))
            .map(|(id, value)| (id.clone(), *value)).collect();
        // The timer stays disarmed until input or an actual persistence change.
        let mut changes_open = true;
        loop {
            let next = publish_at.into_iter().chain(save_at).min();
            let deadline = epoch + Duration::from_millis(next.unwrap_or(0));
            tokio::select! {
                biased;
                change = changes.changed(), if changes_open => {
                    changes_open = change.is_ok();
                    if changes_open {
                        configure(&mut state, &mut generation);
                        let now = clock();
                        publish_at.get_or_insert(now);
                        if state.persistent_totals() != storage.saved { save_at.get_or_insert(now + SAVE_MS); }
                    }
                }
                _ = tokio::time::sleep_until(deadline.into()), if next.is_some() => {
                    let now = clock();
                    if publish_at.is_some_and(|time| now >= time) {
                        let snapshot = state.snapshot(now);
                        if !snapshot.counters.is_empty() || !snapshot.flicks.is_empty() || snapshots.borrow().is_some() {
                            let packet = serde_json::to_string(&snapshot).expect("bounded statistics");
                            snapshots.send_if_modified(|previous| {
                                if previous.as_deref() == Some(packet.as_str()) { return false; }
                                *previous = Some(Arc::from(packet));
                                true
                            });
                        }
                        publish_at = state.next_update(now);
                    }
                    if save_at.is_some_and(|time| now >= time) {
                        save_at = None;
                        if let Err(error) = storage.save(state.persistent_totals()).await {
                            tracing::warn!("counter totals could not be saved: {error}");
                            save_at = Some(clock() + 5 * SAVE_MS);
                        }
                    }
                }
                sample = input.recv() => {
                    let Some(sample) = sample else { break };
                    if gap.swap(false, Ordering::Relaxed) {
                        // A dropped movement must not join two unrelated bursts.
                        while input.try_recv().is_ok() {}
                        state.burst = None;
                        continue;
                    }
                    if sample.gate != (generation | state.plan.flags()) { continue; }
                    let ms = sample.time.saturating_duration_since(epoch).as_millis() as u64;
                    if state.event(sample.event, ms) { save_at.get_or_insert(clock() + SAVE_MS); }
                    let next = clock() + PUBLISH_MS;
                    publish_at = Some(publish_at.map_or(next, |deadline| deadline.min(next)));
                }
            }
        }
        if save_at.is_some() {
            if let Err(error) = storage.save(state.persistent_totals()).await {
                tracing::warn!("counter totals could not be saved at shutdown: {error}");
            }
        }
    });
    (tap, task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn counter(id: &str, mode: Mode) -> Counter {
        Counter { id: ("profile".into(), id.into()), mode, window: 1000, increment: 65, decrement: 66 }
    }

    #[test]
    fn rate_windows_and_custom_tallies_share_only_the_relevant_input() {
        let mut state = Statistics::default();
        let custom = counter("tally", Mode::Custom);
        state.plan.counters = vec![counter("cps", Mode::Clicks), counter("apm", Mode::Actions), counter("kpm", Mode::Keys), custom];
        state.event(Event::Key(65), 200);
        state.event(Event::Click, 208);
        state.event(Event::Wheel, 210);
        state.event(Event::Key(65), 212);
        state.event(Event::Key(66), 220);
        assert_eq!(state.snapshot(300).counters, [("cps", 1.), ("apm", 300.), ("kpm", 180.), ("tally", 1.)]);
        assert_eq!(state.next_update(300), Some(1300));
        assert_eq!(state.snapshot(1300).counters, [("cps", 0.), ("apm", 0.), ("kpm", 0.), ("tally", 1.)]);
        assert_eq!(state.next_update(1300), None);
    }

    #[test]
    fn flicks_split_on_reversal_and_ignore_long_sweeps_and_resets() {
        let mut plan = Plan { cm_per_count: 0.01, ..Plan::default() };
        plan.flicks.push(FlickMeter {id: "flick".into(), window: 1000, threshold: 1., minimum_cm: 1.});
        let mut state = Statistics {plan, ..Statistics::default()};
        state.movement(100, 100., 0., 100.);
        state.movement(108, 100., 0., 100.);
        state.movement(116, -100., 0., 100.);
        assert_eq!(state.snapshot(220).flicks[0].1.count, 2);
        assert_eq!(state.snapshot(220).flicks[0].1.distance_cm, 3.);
        assert_eq!(state.snapshot(220).flicks[0].1.peak_mps, 1.25);
        assert_eq!(state.snapshot(1110).flicks[0].1.count, 1);
        assert_eq!(state.snapshot(1120).flicks[0].1.count, 0);

        for ms in (1200..1600).step_by(8) {
            state.movement(ms, 100., 0., 100.);
        }
        assert_eq!(state.snapshot(1700).flicks[0].1.count, 0);
        state.movement(1800, 100., 0., 100.);
        state.event(Event::Reset, 1810);
        assert_eq!(state.snapshot(1930).flicks[0].1.count, 0);
        assert_eq!(state.next_update(1930), None);
    }

    #[test]
    fn capture_side_is_dormant_when_disabled_and_bounded_when_busy() {
        let (queue, mut rx) = mpsc::channel::<Sample>(2);
        let tap = StatisticsInput {queue, gate: Arc::new(AtomicU64::new(0)), gap: Arc::new(AtomicBool::new(false))};
        let mut held = HeldState::default();
        let key = InputEvent::KeyPress {rawcode: 65};
        tap.record(&key, &held);
        assert!(rx.try_recv().is_err());
        tap.gate.store(ACTIONS, Ordering::Relaxed);
        tap.record(&key, &held);
        held.apply(&key);
        tap.record(&key, &held); // OS repeat
        tap.record(&InputEvent::AnalogDepth {rawcode: 65, depth: 0.7}, &held);
        assert!(matches!(rx.try_recv().unwrap().event, Event::Key(65)));
        assert!(rx.try_recv().is_err());
        for _ in 0..1000 {
            tap.record(&InputEvent::MouseScroll {rotation: 1}, &held);
        }
        assert_eq!(rx.len(), 2);
        assert!(tap.gap.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn persistence_only_writes_changed_opted_in_totals_and_restores_them() {
        let root = std::env::temp_dir().join(format!("input-overlay-statistics-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("counter-totals.json");
        let mut store = Storage::load(path.clone()).await;
        assert!(!store.save(Totals::new()).await.unwrap());
        assert!(!path.exists());
        let custom = counter("tally", Mode::Custom);
        let mut state = Statistics::default();
        state.plan.counters = vec![custom];
        assert!(!state.event(Event::Key(65), 100));
        assert!(!store.save(state.persistent_totals()).await.unwrap());
        assert!(!path.exists());

        let id = ("profile".into(), "tally".into());
        state.plan.persistent.insert(id.clone());
        assert!(state.event(Event::Key(65), 200));
        assert!(store.save(state.persistent_totals()).await.unwrap());
        assert_eq!(Storage::load(path.clone()).await.saved.get(&id), Some(&2));
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert!(!store.save(state.persistent_totals()).await.unwrap());
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), modified);

        state.event(Event::Key(66), 300);
        assert!(store.save(state.persistent_totals()).await.unwrap());
        assert_eq!(read_totals(&path).unwrap().get(&id), Some(&1));
        state.event(Event::Key(66), 400);
        assert!(store.save(state.persistent_totals()).await.unwrap());
        assert!(!path.exists());
        assert!(!store.save(state.persistent_totals()).await.unwrap());
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn plan_only_collects_visible_supported_modules_for_the_active_profile() {
        let meter = |id: &str, kind: &str, version: u32, enabled: bool| json!({
            "id": id, "type": kind, "schemaVersion": version, "enabled": enabled, "config": {
                "counterMode": "Custom", "counterPersist": true
            }
        });
        let document = json!({
            "activeProfileId": "profile",
            "gameProfiles": [{"id": "game", "dpi": 1600}],
            "profiles": [
                {"id":"profile", "gameProfileId":"game", "modules":[
                    meter("custom","overlay.counter",1,true), meter("flick","overlay.flicks",1,true),
                    meter("future","overlay.flicks",2,true), meter("hidden","overlay.flicks",1,false)
                ]},
                {"id":"second", "modules":[meter("custom","overlay.counter",1,true)]}
            ]
        });
        let plan = Plan::from_document(&document);
        assert_eq!(plan.flags(), ACTIONS | MOVEMENT);
        assert_eq!(plan.counters.len(), 1);
        assert_eq!(plan.flicks.len(), 1);
        assert_eq!(plan.persistent.len(), 2);
        assert_eq!(plan.cm_per_count, 2.54 / 1600.);
    }
}

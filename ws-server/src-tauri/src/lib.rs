mod input_state;
mod artwork;
mod motion;
mod studio_store;
mod studio_validation;
mod services;
mod ws_server;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tokio::sync::{watch, RwLock};

use services::config::Config;
use ws_server::{InputEvent, ServerStatus, WsState};

struct AppState {
    config: Arc<RwLock<Config>>,
    config_path: PathBuf,
    startup_warning: Option<String>,
    status: Arc<Mutex<ServerStatus>>,
    ws_state: Arc<WsState>,
    #[cfg(windows)]
    _raw_input: Mutex<Option<services::windows::raw_input::RawInputThread>>,
    update_cache: Mutex<Option<services::updater::UpdateInfo>>,
    post_update_version: Option<String>,
    #[cfg(target_os = "linux")]
    _evdev: Mutex<Option<services::linux::evdev_input::EvdevInputThread>>,
    analog: Mutex<Option<services::analog::AnalogThread>>,
    http: Mutex<Option<services::http_server::HttpServer>>,
}

#[tauri::command]
fn get_startup_warning(state: tauri::State<'_, AppState>) -> Option<String> { state.startup_warning.clone() }

#[derive(serde::Serialize)]
struct DeviceStatus { keyboard_count: usize, mouse_count: usize, capture_running: bool }
#[tauri::command]
fn get_device_status(state: tauri::State<'_, AppState>) -> Result<DeviceStatus, String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Input::{GetRawInputDeviceList, RAWINPUTDEVICELIST, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE};
        let size = std::mem::size_of::<RAWINPUTDEVICELIST>() as u32;
        let mut count = 0;
        if GetRawInputDeviceList(None, &mut count, size) == u32::MAX || count > 1024 { return Err("device enumeration failed".into()); }
        let mut devices = vec![RAWINPUTDEVICELIST::default(); count as usize];
        if count == 0 { return Ok(DeviceStatus { keyboard_count: 0, mouse_count: 0, capture_running: state._raw_input.lock().unwrap().as_ref().is_some_and(|r| r.is_alive()) }); }
        let read = GetRawInputDeviceList(Some(devices.as_mut_ptr()), &mut count, size);
        if read == u32::MAX { return Err("devices changed during enumeration".into()); }
        devices.truncate(read as usize);
        Ok(DeviceStatus { keyboard_count: devices.iter().filter(|d| d.dwType == RIM_TYPEKEYBOARD).count(), mouse_count: devices.iter().filter(|d| d.dwType == RIM_TYPEMOUSE).count(), capture_running: state._raw_input.lock().unwrap().as_ref().is_some_and(|r| r.is_alive()) })
    }
    #[cfg(not(windows))]
    { let _ = state; Err("device enumeration is currently Windows-only".into()) }
}

#[tauri::command]
fn get_http_status(state: tauri::State<'_, AppState>) -> Option<services::http_server::HttpStatus> {
    state.http.lock().unwrap().as_ref().map(|server| server.status())
}

//tairi io-----------------------------------------------------------------------
#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<Config, String> {
    Ok(state.config.read().await.clone())
}

#[tauri::command]
async fn save_config(new_cfg: Config, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let (need_rebind, need_analog_restart, need_http_restart, need_evdev_restart) = {
        let old = state.config.read().await;
        (
            old.host != new_cfg.host || old.port != new_cfg.port || old.auth_token != new_cfg.auth_token,
            old.analog_keyboard != new_cfg.analog_keyboard || old.capture_enabled != new_cfg.capture_enabled,
            old.http_enabled != new_cfg.http_enabled
                || old.http_port != new_cfg.http_port
                || old.host != new_cfg.host,
            old.linux_evdev_keyboard_device != new_cfg.linux_evdev_keyboard_device
                || old.linux_raw_mouse_device != new_cfg.linux_raw_mouse_device
                || old.raw_mouse_min_delta != new_cfg.raw_mouse_min_delta
                || old.capture_enabled != new_cfg.capture_enabled,
        )
    };

    services::config::save(&state.config_path, &new_cfg).map_err(|e| e.to_string())?;

    let new_analog_kb = new_cfg.analog_keyboard.clone();
    let capture_enabled = new_cfg.capture_enabled;
    let min_delta = new_cfg.raw_mouse_min_delta;
    let new_http_host = new_cfg.host.clone();
    let new_http_port = new_cfg.http_port;
    let new_http_on = new_cfg.http_enabled;
    #[cfg(target_os = "linux")]
    let (new_kbd_dev, new_mouse_dev, new_min_delta) = (
        new_cfg.linux_evdev_keyboard_device.clone(),
        new_cfg.linux_raw_mouse_device.clone(),
        new_cfg.raw_mouse_min_delta,
    );
    *state.config.write().await = new_cfg;
    let _ = state.ws_state.input_tx.send(InputEvent::Reset);

    if need_rebind {
        let _ = state.ws_state.rebind_tx.send(());
    }

    if need_analog_restart {
        let new_thread = if capture_enabled && !new_analog_kb.is_empty() {
            Some(services::analog::AnalogThread::start(
                state.ws_state.input_tx.clone(),
                &new_analog_kb,
            ))
        } else {
            None
        };
        *state.analog.lock().unwrap() = new_thread;
    }

    if need_http_restart {
        let old = { state.http.lock().unwrap().take() };
        if let Some(server) = old { server.stop().await; }
        let new_server = if new_http_on {
            services::http_server::HttpServer::start(&new_http_host, new_http_port)
        } else {
            None
        };
        *state.http.lock().unwrap() = new_server;
    }

    #[cfg(target_os = "linux")]
    if need_evdev_restart {
        let new_thread = services::linux::evdev_input::EvdevInputThread::start(
            state.ws_state.input_tx.clone(),
            &new_kbd_dev,
            &new_mouse_dev,
            new_min_delta,
        );
        *state._evdev.lock().unwrap() = Some(new_thread);
    }
    #[cfg(windows)]
    if need_evdev_restart {
        let mut raw = state._raw_input.lock().unwrap();
        raw.take(); // Drop unregisters and joins before creating another Raw Input window.
        if capture_enabled { *raw = Some(services::windows::raw_input::RawInputThread::start(state.ws_state.input_tx.clone(), min_delta)); }
    }
    #[cfg(not(windows))]
    let _ = min_delta;

    Ok(())
}

#[tauri::command]
async fn apply_bind(
    host: String,
    port: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut cfg = state.config.write().await;
    cfg.host = host;
    cfg.port = port;
    let _ = state.ws_state.rebind_tx.send(());
    Ok(())
}

#[tauri::command]
async fn toggle_http(
    enabled: bool,
    host: String,
    port: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let old = { state.http.lock().unwrap().take() };
    if let Some(server) = old { server.stop().await; }
    let new_server = if enabled {
        services::http_server::HttpServer::start(&host, port)
    } else {
        None
    };
    *state.http.lock().unwrap() = new_server;
    let mut cfg = state.config.write().await;
    cfg.http_enabled = enabled;
    cfg.http_port = port;
    services::config::save(&state.config_path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_status(state: tauri::State<'_, AppState>) -> Result<ServerStatus, String> {
    Ok(state.status.lock().unwrap().clone())
}

#[tauri::command]
fn get_autostart() -> bool {
    #[cfg(target_os = "linux")]
    {
        return services::linux::autostart::is_enabled();
    }
    #[cfg(windows)]
    services::windows::autostart::is_enabled()
}

#[tauri::command]
fn set_autostart(enabled: bool) -> bool {
    let exe = std::env::current_exe().unwrap_or_default();
    #[cfg(target_os = "linux")]
    {
        return services::linux::autostart::set_enabled(enabled, &exe);
    }
    #[cfg(windows)]
    services::windows::autostart::set_enabled(enabled, &exe)
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn is_admin() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elev = TOKEN_ELEVATION::default();
        let mut cb = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elev as *mut _ as *mut _),
            cb,
            &mut cb,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elev.TokenIsElevated != 0
    }
    #[cfg(target_os = "linux")]
    {
        true
    }
}

#[tauri::command]
async fn set_theme(theme: Option<String>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.write().await;
    cfg.theme = theme;
    services::config::save(&state.config_path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn enum_keyboards() -> Vec<(String, String)> {
    services::linux::evdev_input::enum_keyboards()
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn enum_mice() -> Vec<(String, String)> {
    services::linux::evdev_input::enum_mice()
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn check_linux_perms() -> Vec<String> {
    services::linux::evdev_input::check_permissions()
}

//updater-----------------------------------------------------------------------
#[tauri::command]
fn check_update(state: tauri::State<'_, AppState>) -> Option<services::updater::UpdateInfo> {
    state.update_cache.lock().unwrap().clone()
}

#[tauri::command]
async fn dismiss_update(version: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.write().await;
    if !cfg.dismissed_update_versions.contains(&version) {
        cfg.dismissed_update_versions.push(version);
        services::config::save(&state.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
async fn apply_update(
    download_url: String,
    version: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    services::windows::updater::download_and_apply(&download_url, &version, &current_exe, &app)
        .await?;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "linux")]
#[tauri::command]
async fn apply_update(
    download_url: String,
    version: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    services::linux::updater::download_and_apply(&download_url, &version, &app).await?;
    app.exit(0);
    Ok(())
}

//cpu affinity-----------------------------------------------------------------------
#[cfg(windows)]
fn apply_cpu_affinity(cores: &[u32]) {
    if cores.is_empty() {
        return;
    }
    use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessAffinityMask};
    let mask: usize = cores.iter().fold(0usize, |acc, &c| acc | (1 << c));
    unsafe {
        let proc = GetCurrentProcess();
        if let Err(e) = SetProcessAffinityMask(proc, mask) {
            tracing::warn!("SetProcessAffinityMask failed: {e}");
        } else {
            tracing::info!("cpu affinity set: cores {cores:?} mask=0x{mask:x}");
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_cpu_affinity(_cores: &[u32]) {}

#[tauri::command]
fn get_post_update_version(state: tauri::State<'_, AppState>) -> Option<String> {
    state.post_update_version.clone()
}

//app init-----------------------------------------------------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let post_update_version: Option<String> = {
        let args: Vec<String> = std::env::args().collect();
        args.iter()
            .position(|a| a == "--post-update")
            .and_then(|i| args.get(i + 1).cloned())
    };

    //webkit2gtk might fail gpu accel or dmabuf on fedora with nvidia-open.. im just gonna disable it entirely for now
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    let portable_dir = std::env::current_exe()
        .expect("failed to get exe path").parent().expect("exe has no parent dir").to_path_buf();
    let data_dir = if let Some(path) = std::env::var_os("INPUT_OVERLAY_STUDIO_DATA_DIR") {
        PathBuf::from(path)
    } else if portable_dir.join("config.json").exists() {
        portable_dir
    } else {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
            .unwrap_or(portable_dir).join("InputOverlayStudio")
    };
    std::fs::create_dir_all(&data_dir).expect("cannot create application data directory");

    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).ok();
    let log_filename = format!("{}.log", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
    let file_appender = tracing_appender::rolling::never(&log_dir, &log_filename);
    let (non_blocking_file, _log_guard) = tracing_appender::non_blocking(file_appender);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(non_blocking_file),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let config_path = data_dir.join("config.json");
            let startup_warning = if config_path.exists() && std::fs::read_to_string(&config_path).ok()
                .and_then(|text| serde_json::from_str::<Config>(&text).ok()).is_none() {
                Some("Server settings were damaged. The original is retained as config.invalid.json; restore config.backup.json or review defaults in Settings.".to_string())
            } else { None };
            let mut cfg = services::config::load(&config_path);
            if cfg.auth_token.is_empty() {
                use rand::Rng;
                cfg.auth_token = rand::thread_rng()
                    .sample_iter(rand::distributions::Alphanumeric)
                    .take(32)
                    .map(char::from)
                    .collect();
                let _ = services::config::save(&config_path, &cfg);
                tracing::info!("generated authentication token");
            }

            apply_cpu_affinity(&cfg.cpu_affinity.clone());

            let analog_kb = cfg.analog_keyboard.clone();
            let capture_enabled = cfg.capture_enabled;
            let http_enabled = cfg.http_enabled;
            let http_host = cfg.host.clone();
            let http_port = cfg.http_port;
            #[cfg(target_os = "linux")]
            let (evdev_kbd, evdev_mouse, evdev_min_delta) = (
                cfg.linux_evdev_keyboard_device.clone(),
                cfg.linux_raw_mouse_device.clone(),
                cfg.raw_mouse_min_delta,
            );
            let config = Arc::new(RwLock::new(cfg));
            let status = Arc::new(Mutex::new(ServerStatus::default()));
            let (rebind_tx, rebind_rx) = watch::channel(());
            let (input_tx, input_rx) = ws_server::input_channel();

            let ws_state = Arc::new(WsState {
                rebind_tx,
                input_tx: input_tx.clone(),
            });

            {
                let cfg = Arc::clone(&config);
                let st = Arc::clone(&status);
                let ah = app.handle().clone();
                let capture_tx = input_tx.clone();
                let studio = Arc::new(studio_store::StudioStore::new(data_dir.join("studio.json")));
                tauri::async_runtime::spawn(async move {
                    ws_server::run(cfg, input_rx, st, rebind_rx, ah, studio, capture_tx).await;
                });
            }

            #[cfg(windows)]
            let raw_input_handle = if capture_enabled {
                let min_delta = config
                    .try_read()
                    .map(|c| c.raw_mouse_min_delta)
                    .unwrap_or(0);
                Some(services::windows::raw_input::RawInputThread::start(
                    input_tx.clone(),
                    min_delta,
                ))
            } else { None };

            #[cfg(target_os = "linux")]
            let evdev_handle = Some(services::linux::evdev_input::EvdevInputThread::start(
                input_tx.clone(),
                &evdev_kbd,
                &evdev_mouse,
                evdev_min_delta,
            ));

            let analog_handle = if capture_enabled && !analog_kb.is_empty() {
                Some(services::analog::AnalogThread::start(input_tx, &analog_kb))
            } else {
                None
            };

            let http_handle = if http_enabled {
                services::http_server::HttpServer::start(&http_host, http_port)
            } else {
                None
            };

            app.manage(AppState {
                config,
                config_path,
                startup_warning,
                status,
                ws_state,
                #[cfg(windows)]
                _raw_input: Mutex::new(raw_input_handle),
                update_cache: Mutex::new(None),
                post_update_version: post_update_version.clone(),
                #[cfg(target_os = "linux")]
                _evdev: Mutex::new(evdev_handle),
                analog: Mutex::new(analog_handle),
                http: Mutex::new(http_handle),
            });

            build_tray(app)?;
            if !std::env::args().any(|arg| arg == "--tray") { open_main_window(app.handle())?; }
            if post_update_version.is_some() {
                let _ = open_post_update_window(app.handle());
            }
            Ok(())
        })
        .invoke_handler({
            #[cfg(windows)]
            {
                tauri::generate_handler![
                    get_config,
                    get_startup_warning,
                    get_device_status,
                    get_http_status,
                    save_config,
                    get_status,
                    get_autostart,
                    set_autostart,
                    toggle_http,
                    apply_bind,
                    minimize_window,
                    close_window,
                    open_url,
                    is_admin,
                    set_theme,
                    check_update,
                    dismiss_update,
                    apply_update,
                    get_post_update_version,
                ]
            }
            #[cfg(target_os = "linux")]
            {
                tauri::generate_handler![
                    get_config,
                    get_startup_warning,
                    get_device_status,
                    get_http_status,
                    save_config,
                    get_status,
                    get_autostart,
                    set_autostart,
                    toggle_http,
                    apply_bind,
                    minimize_window,
                    close_window,
                    open_url,
                    is_admin,
                    set_theme,
                    check_update,
                    dismiss_update,
                    apply_update,
                    get_post_update_version,
                    enum_keyboards,
                    enum_mice,
                    check_linux_perms,
                ]
            }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

    let Some(icon) = app.default_window_icon() else {
        tracing::warn!("no window icon available for tray");
        return Ok(());
    };

    let _tray = TrayIconBuilder::new()
        .icon(icon.clone())
        .tooltip("Input Overlay")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => toggle_window(app),
            "quit" => {
                tracing::info!("shutting down");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = open_main_window(app);
}

fn open_post_update_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "post-update",
        tauri::WebviewUrl::App("post-update.html".into()),
    )
    .title("Update Complete")
    .inner_size(380.0, 120.0)
    .decorations(false)
    .resizable(false)
    .center()
    .focused(true);

    #[cfg(windows)]
    {
        builder = builder.shadow(true);
    }

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone())?;
    }

    builder.build()?;
    tracing::info!("studio: native window opened");
    Ok(())
}

fn open_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("studio/index.html".into()))
            .title("Input Overlay Studio")
            .inner_size(1480.0, 920.0)
            .min_inner_size(1050.0, 680.0)
            .resizable(true)
            .decorations(true)
            .skip_taskbar(false)
            .center();

    #[cfg(windows)]
    {
        builder = builder.shadow(true);
    }

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone())?;
    }

    builder.build()?;
    tracing::info!("studio: native window opened");
    Ok(())
}

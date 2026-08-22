use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const HOST: &str = "127.0.0.1";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const SPLASH_MINIMUM_DURATION: Duration = Duration::from_millis(900);

#[cfg(windows)]
const DESKTOP_API_ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const DESKTOP_API_ORIGIN: &str = "tauri://localhost";

struct DesktopServer {
    child: Child,
}

struct ServerState(Mutex<Option<DesktopServer>>);

fn reserve_port() -> Result<u16, String> {
    let listener = TcpListener::bind((HOST, 0))
        .map_err(|error| format!("Could not reserve a local port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| error.to_string())
}

fn loopback_address(port: u16) -> SocketAddr {
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

fn log_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("pi-web"))
        .join("desktop.log")
}

fn open_log(path: &Path) -> Result<File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create log directory: {error}"))?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())
}

fn production_runtime(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, Vec<String>), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let node = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
    let server_dir = resources.join("server");
    let server = server_dir.join("server.js");
    if !node.is_file() || !server.is_file() {
        return Err(format!(
            "The bundled server runtime is incomplete at {}",
            resources.display()
        ));
    }
    Ok((
        node,
        server_dir,
        vec![server.to_string_lossy().into_owned()],
    ))
}

fn development_runtime(port: u16) -> Result<(PathBuf, PathBuf, Vec<String>), String> {
    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Could not locate the project directory".to_string())?
        .to_path_buf();
    let next = project_dir.join("node_modules/next/dist/bin/next");
    let supervisor = project_dir.join("scripts/desktop-dev-supervisor.mjs");
    if !next.is_file() {
        return Err("Next.js is not installed. Run `npm install` first.".to_string());
    }
    if !supervisor.is_file() {
        return Err("The desktop development supervisor is missing.".to_string());
    }
    let node = std::env::var_os("NODE_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    Ok((
        node,
        project_dir,
        vec![
            supervisor.to_string_lossy().into_owned(),
            "--parent-pid".into(),
            std::process::id().to_string(),
            "--next".into(),
            next.to_string_lossy().into_owned(),
            "--port".into(),
            port.to_string(),
        ],
    ))
}

fn spawn_server(
    app: &tauri::AppHandle,
    port: u16,
    log_path: &Path,
) -> Result<DesktopServer, String> {
    let (node, working_directory, arguments) = if cfg!(debug_assertions) {
        development_runtime(port)?
    } else {
        production_runtime(app)?
    };

    let stdout = open_log(log_path)?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(node);
    command
        .args(arguments)
        .current_dir(working_directory)
        .env("HOSTNAME", HOST)
        .env("PORT", port.to_string())
        .env("PI_WEB_HOSTNAME", HOST)
        .env("PI_WEB_DESKTOP_API_ORIGIN", DESKTOP_API_ORIGIN)
        .env("PI_WEB_NO_OPEN", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    configure_process_group(&mut command);
    command
        .spawn()
        .map(|child| DesktopServer { child })
        .map_err(|error| format!("Could not start the Pi Desktop server: {error}"))
}

fn probe_server<F>(port: u16, timeout: Duration, mut server_is_running: F) -> Result<(), String>
where
    F: FnMut() -> Result<bool, String>,
{
    let deadline = Instant::now() + timeout;
    let request = format!("GET / HTTP/1.1\r\nHost: {HOST}:{port}\r\nConnection: close\r\n\r\n");
    while Instant::now() < deadline {
        if !server_is_running()? {
            return Err("The Pi Desktop server exited before it became ready.".to_string());
        }
        if let Ok(mut stream) =
            TcpStream::connect_timeout(&loopback_address(port), Duration::from_millis(500))
        {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut response = [0_u8; 64];
                if let Ok(length) = stream.read(&mut response) {
                    let status = String::from_utf8_lossy(&response[..length]);
                    if status.starts_with("HTTP/1.1 2") || status.starts_with("HTTP/1.1 3") {
                        let _ = stream.shutdown(Shutdown::Both);
                        return Ok(());
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(format!(
        "The Pi Desktop server did not become ready within {} seconds.",
        timeout.as_secs()
    ))
}

fn show_startup_error(app: &tauri::AppHandle, message: &str, log_path: &Path) {
    let payload = format!("{}\n\nLog file:\n{}", message, log_path.display());
    let encoded = format!("{:?}", payload);
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(error) = WebviewWindowBuilder::new(
            &handle,
            "startup-error",
            WebviewUrl::App("desktop-startup-error.html".into()),
        )
        .initialization_script(format!("window.__PI_WEB_STARTUP_ERROR__ = {encoded};"))
        .title("Pi Desktop could not start")
        .inner_size(620.0, 360.0)
        .resizable(false)
        .build()
        {
            eprintln!("{payload}\n\nCould not create the error window: {error}");
            handle.exit(1);
        }
    }) {
        eprintln!("Could not schedule the startup error window: {error}");
        app.exit(1);
    }
}

fn create_main_window(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let handle = app.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    let (page_sender, page_receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result: Result<(), String> = (|| {
            let api_origin = format!("http://{HOST}:{port}");
            let initialization_script = format!(
                "window.__PI_WEB_API_ORIGIN__ = {}; window.__PI_WEB_DESKTOP__ = true;",
                serde_json::to_string(&api_origin).map_err(|error| error.to_string())?,
            );
            let window = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::App("desktop-splash.html".into()),
            )
            .initialization_script(initialization_script)
            .on_page_load(move |window, payload| {
                if payload.event() == PageLoadEvent::Finished
                    && payload.url().path().ends_with("desktop-splash.html")
                {
                    let result = window
                        .show()
                        .map_err(|error| format!("Could not show the application window: {error}"))
                        .and_then(|_| {
                            window.set_focus().map_err(|error| {
                                format!("Could not focus the application window: {error}")
                            })
                        });
                    let _ = page_sender.try_send(result);
                }
            })
            .title("Pi Desktop")
            .background_color(Color(26, 26, 26, 255))
            .inner_size(1280.0, 820.0)
            .min_inner_size(720.0, 520.0)
            .visible(false)
            .build()
            .map_err(|error| format!("Could not create the application window: {error}"))?;
            let _ = window;
            Ok(())
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Could not schedule the application window: {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while creating the application window.".to_string())??;
    page_receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while loading the application startup page.".to_string())?
}

fn start_application(app: tauri::AppHandle) {
    let log_path = log_path(&app);
    let result: Result<(), String> = (|| {
        let port = reserve_port()?;
        create_main_window(&app, port)?;
        let splash_started = Instant::now();
        let server = spawn_server(&app, port, &log_path)?;
        {
            let state = app.state::<ServerState>();
            *state
                .0
                .lock()
                .map_err(|_| "Server state is unavailable".to_string())? = Some(server);
        }
        probe_server(port, STARTUP_TIMEOUT, || {
            let state = app.state::<ServerState>();
            let mut guard = state
                .0
                .lock()
                .map_err(|_| "Server state is unavailable".to_string())?;
            let server = guard
                .as_mut()
                .ok_or_else(|| "The Pi Desktop server was stopped during startup.".to_string())?;
            server
                .child
                .try_wait()
                .map(|status| status.is_none())
                .map_err(|error| format!("Could not inspect the Pi Desktop server: {error}"))
        })?;
        if let Some(remaining) = SPLASH_MINIMUM_DURATION.checked_sub(splash_started.elapsed()) {
            thread::sleep(remaining);
        }
        if cfg!(debug_assertions) {
            let url = format!("http://{HOST}:{port}")
                .parse()
                .map_err(|error| format!("Invalid application URL: {error}"))?;
            app.get_webview_window("main")
                .ok_or_else(|| "The Pi Desktop startup window is unavailable.".to_string())?
                .navigate(url)
                .map_err(|error| format!("Could not load the Pi Desktop interface: {error}"))?;
        } else if let Some(window) = app.get_webview_window("main") {
            window
                .eval("window.location.replace('index.html')")
                .map_err(|error| format!("Could not load the Pi Desktop interface: {error}"))?;
        }
        Ok(())
    })();

    if let Err(error) = result {
        stop_server(&app);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.close();
        }
        show_startup_error(&app, &error, &log_path);
    }
}

fn stop_server(app: &tauri::AppHandle) {
    let state = app.state::<ServerState>();
    let server = state.0.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut server) = server {
        terminate_process(&mut server.child, SHUTDOWN_TIMEOUT);
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0000_0200);
}

#[cfg(unix)]
fn request_graceful_shutdown(child: &Child) {
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
}

#[cfg(windows)]
fn request_graceful_shutdown(child: &Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T"])
        .status();
}

fn terminate_process(child: &mut Child, timeout: Duration) {
    request_graceful_shutdown(child);
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    force_kill(child);
    let _ = child.wait();
}

#[cfg(unix)]
fn force_kill(child: &mut Child) {
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
}

#[cfg(windows)]
fn force_kill(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.kill();
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            thread::spawn(move || start_application(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                stop_server(&app);
                app.exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Pi Desktop desktop application");

    app.run(|handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_server(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_port_accepts_loopback_connections() {
        let port = reserve_port().unwrap();
        assert!(port > 0);
        TcpListener::bind((HOST, port)).unwrap();
    }

    #[test]
    fn readiness_probe_succeeds_for_http_server() {
        let listener = TcpListener::bind((HOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 128];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        assert!(probe_server(port, Duration::from_secs(1), || Ok(true)).is_ok());
    }

    #[test]
    fn readiness_probe_times_out() {
        let port = reserve_port().unwrap();
        let started = Instant::now();
        assert!(probe_server(port, Duration::from_millis(200), || Ok(true)).is_err());
        assert!(started.elapsed() >= Duration::from_millis(200));
    }

    #[test]
    fn readiness_probe_stops_when_the_server_exits() {
        let port = reserve_port().unwrap();
        let started = Instant::now();
        let error = probe_server(port, Duration::from_secs(5), || Ok(false)).unwrap_err();
        assert!(error.contains("exited"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_reaps_the_server_process_group() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]);
        configure_process_group(&mut command);
        let mut child = command.spawn().unwrap();
        terminate_process(&mut child, Duration::from_secs(1));
        assert!(child.try_wait().unwrap().is_some());
    }
}

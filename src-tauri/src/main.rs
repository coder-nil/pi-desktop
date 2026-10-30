// 发布版必须是 GUI 子系统（windows_subsystem = "windows"）：控制台子系统的 exe
// 由资源管理器/开始菜单启动时，Windows 会先给应用本身分配一个黑窗，
// 而随后 spawn 的 node.exe（Next server）会继承同一个窗口，看起来就像
// 「启动 Next server 弹了一个控制台」。开发版保留控制台，方便看 panic 输出。
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

fn main() {
    pi_web_desktop_lib::run();
}

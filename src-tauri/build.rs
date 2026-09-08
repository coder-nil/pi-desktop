fn main() {
    println!("cargo:rerun-if-changed=src/startup-overlay.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let object = out.join("startup-overlay.o");
        let archive = out.join("libstartup_overlay.a");
        let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
            "aarch64" => "arm64", "x86_64" => "x86_64", other => panic!("Unsupported macOS architecture: {other}"),
        };
        assert!(std::process::Command::new("xcrun").args(["clang", "-arch", arch, "-fobjc-arc", "-mmacosx-version-min=11.0", "-c", "src/startup-overlay.m", "-o"]).arg(&object).status().unwrap().success());
        assert!(std::process::Command::new("ar").arg("crs").arg(&archive).arg(&object).status().unwrap().success());
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=startup_overlay");
        println!("cargo:rustc-link-lib=framework=Cocoa");
    }
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "hide_startup_overlay",
                "open_release_url",
                "terminal_start",
                "terminal_write",
                "terminal_resize",
                "terminal_close",
            ]),
        ),
    ).expect("could not generate desktop command permissions")
}

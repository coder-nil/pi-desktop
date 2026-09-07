fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "open_release_url",
                "terminal_start",
                "terminal_write",
                "terminal_resize",
                "terminal_close",
            ]),
        ),
    ).expect("could not generate desktop command permissions")
}

mod storage;

use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

#[derive(Default)]
struct StorageLock(Arc<Mutex<()>>);

fn storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

// The frontend owns the board schema. Rust owns durable storage and managed media.
#[tauri::command]
async fn load_workspace(
    app: tauri::AppHandle,
    lock: State<'_, StorageLock>,
) -> Result<Value, String> {
    let root = storage_path(&app)?;
    let lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Storage is unavailable".to_string())?;
        storage::load_workspace(&root)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_workspace(
    app: tauri::AppHandle,
    lock: State<'_, StorageLock>,
    workspace: Value,
) -> Result<(), String> {
    let root = storage_path(&app)?;
    let lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Storage is unavailable".to_string())?;
        storage::save_workspace(&root, &workspace)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_media(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<storage::MediaAsset>, String> {
    let root = storage_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::import_media(&root, &paths))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_media_bytes(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<storage::MediaAsset, String> {
    let root = storage_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::import_media_bytes(&root, &name, &bytes))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(storage_path(&app)?.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(StorageLock::default())
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            import_media,
            import_media_bytes,
            get_storage_path
        ])
        .build(tauri::generate_context!())
        .expect("Unable to launch MyBoards")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    // Route application-menu Quit (including Cmd+Q) through the
                    // frontend's save-before-close handler. Once it destroys
                    // the last window, the next exit request proceeds normally.
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
        });
}

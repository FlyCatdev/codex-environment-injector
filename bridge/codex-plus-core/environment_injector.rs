use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const MAX_TEXT_BYTES: usize = 128 * 1024;
const BACKUP_DIR: &str = "backups/environment-injector";
const MEMORY_CORRECTION_RELATIVE: &str = "memories/extensions/ad_hoc/environment-injector.md";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DocumentKind {
    Agents,
    MemoryCorrection,
}

impl DocumentKind {
    fn id(self) -> &'static str {
        match self {
            Self::Agents => "agents",
            Self::MemoryCorrection => "memory-correction",
        }
    }

    fn target(self, home: &Path) -> PathBuf {
        match self {
            Self::Agents => home.join("AGENTS.md"),
            Self::MemoryCorrection => home.join(MEMORY_CORRECTION_RELATIVE),
        }
    }
}

pub fn handle(path: &str, payload: &Value) -> anyhow::Result<Value> {
    let home = crate::codex_home::default_codex_home_dir();
    match path {
        "/environment-injector/capabilities" => capabilities(&home),
        "/environment-injector/agents/get" => get_document(&home, DocumentKind::Agents),
        "/environment-injector/agents/preview" => {
            preview_document(&home, DocumentKind::Agents, payload)
        }
        "/environment-injector/agents/commit" => {
            commit_document(&home, DocumentKind::Agents, payload)
        }
        "/environment-injector/memory/get" => memory_snapshot(&home),
        "/environment-injector/memory/preview-correction" => {
            preview_document(&home, DocumentKind::MemoryCorrection, payload)
        }
        "/environment-injector/memory/commit-correction" => {
            commit_document(&home, DocumentKind::MemoryCorrection, payload)
        }
        "/environment-injector/backups/list" => list_backups(&home),
        "/environment-injector/backups/restore" => restore_backup(&home, payload),
        _ => bail!("unknown Environment Injector bridge path: {path}"),
    }
}

fn capabilities(home: &Path) -> anyhow::Result<Value> {
    Ok(json!({
        "status": "ok",
        "name": "environment-injector",
        "version": 1,
        "codexHome": home,
        "diskRead": true,
        "diskWrite": true,
        "atomicWrite": true,
        "hashConflict": true,
        "backupRestore": true,
        "targets": ["global-agents", "memory-correction-note"],
    }))
}

fn memory_snapshot(home: &Path) -> anyhow::Result<Value> {
    let summary = read_optional(home.join("memories/memory_summary.md"))?;
    let durable = read_optional(home.join("memories/MEMORY.md"))?;
    let correction = document_value(home, DocumentKind::MemoryCorrection)?;
    Ok(json!({
        "status": "ok",
        "summary": summary,
        "durable": durable,
        "correction": correction,
        "policy": "review-required",
    }))
}

fn get_document(home: &Path, kind: DocumentKind) -> anyhow::Result<Value> {
    let mut value = document_value(home, kind)?;
    value["status"] = json!("ok");
    Ok(value)
}

fn preview_document(home: &Path, kind: DocumentKind, payload: &Value) -> anyhow::Result<Value> {
    let content = payload_content(payload)?;
    let path = kind.target(home);
    let before = read_optional(path.clone())?;
    if let Some(conflict) = expected_hash_conflict(payload, &before) {
        return Ok(conflict_value(kind, &path, &before, conflict));
    }
    let after_hash = hash_text(&content);
    let (added_lines, removed_lines) = line_delta(&before.content, &content);
    Ok(json!({
        "status": "ok",
        "kind": kind.id(),
        "path": path,
        "before": before,
        "after": {
            "hash": after_hash,
            "size": content.len(),
            "lineCount": content.lines().count(),
        },
        "diff": {
            "addedLines": added_lines,
            "removedLines": removed_lines,
            "changed": before.hash.as_deref() != Some(after_hash.as_str()),
        },
        "content": content,
    }))
}

fn commit_document(home: &Path, kind: DocumentKind, payload: &Value) -> anyhow::Result<Value> {
    let content = payload_content(payload)?;
    let path = kind.target(home);
    let before = read_optional(path.clone())?;
    if let Some(conflict) = expected_hash_conflict(payload, &before) {
        return Ok(conflict_value(kind, &path, &before, conflict));
    }
    let backup = backup_existing(home, kind, &path)?;
    crate::settings::atomic_write(&path, content.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    let after = read_optional(path.clone())?;
    Ok(json!({
        "status": "ok",
        "kind": kind.id(),
        "path": path,
        "beforeHash": before.hash,
        "afterHash": after.hash,
        "backup": backup,
        "size": after.size,
    }))
}

fn list_backups(home: &Path) -> anyhow::Result<Value> {
    let root = home.join(BACKUP_DIR);
    let mut items = Vec::new();
    if root.exists() {
        for entry in fs::read_dir(&root).with_context(|| format!("failed to read {}", root.display()))? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata()?;
            items.push(json!({
                "name": name,
                "size": metadata.len(),
                "modifiedAt": modified_seconds(&metadata),
            }));
        }
    }
    items.sort_by(|left, right| {
        right
            .get("modifiedAt")
            .and_then(Value::as_u64)
            .cmp(&left.get("modifiedAt").and_then(Value::as_u64))
    });
    Ok(json!({ "status": "ok", "backups": items }))
}

fn restore_backup(home: &Path, payload: &Value) -> anyhow::Result<Value> {
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if name.is_empty() || Path::new(name).file_name().and_then(|value| value.to_str()) != Some(name) {
        bail!("backup name must be a plain file name");
    }
    let kind = if name.starts_with("agents-") {
        DocumentKind::Agents
    } else if name.starts_with("memory-correction-") {
        DocumentKind::MemoryCorrection
    } else {
        bail!("backup is not owned by Environment Injector");
    };
    let backup_path = home.join(BACKUP_DIR).join(name);
    if !backup_path.is_file() {
        bail!("backup does not exist: {name}");
    }
    let content = fs::read(&backup_path)
        .with_context(|| format!("failed to read {}", backup_path.display()))?;
    if content.len() > MAX_TEXT_BYTES {
        bail!("backup exceeds {MAX_TEXT_BYTES} bytes");
    }
    let target = kind.target(home);
    let current_backup = backup_existing(home, kind, &target)?;
    crate::settings::atomic_write(&target, &content)
        .with_context(|| format!("failed to restore {}", target.display()))?;
    Ok(json!({
        "status": "ok",
        "kind": kind.id(),
        "restoredFrom": name,
        "target": target,
        "currentBackup": current_backup,
        "hash": hash_bytes(&content),
    }))
}

fn payload_content(payload: &Value) -> anyhow::Result<String> {
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("content must be a UTF-8 string"))?;
    if content.len() > MAX_TEXT_BYTES {
        bail!("content exceeds {MAX_TEXT_BYTES} bytes");
    }
    if content.contains('\0') {
        bail!("content contains NUL bytes");
    }
    Ok(normalize_newline(content))
}

fn normalize_newline(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.is_empty() || normalized.ends_with('\n') {
        normalized
    } else {
        format!("{normalized}\n")
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OptionalDocument {
    exists: bool,
    content: String,
    hash: Option<String>,
    size: usize,
    modified_at: Option<u64>,
}

fn read_optional(path: PathBuf) -> anyhow::Result<OptionalDocument> {
    if !path.exists() {
        return Ok(OptionalDocument {
            exists: false,
            content: String::new(),
            hash: None,
            size: 0,
            modified_at: None,
        });
    }
    let bytes = fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
    if bytes.len() > MAX_TEXT_BYTES {
        bail!("{} exceeds {MAX_TEXT_BYTES} bytes", path.display());
    }
    let content = String::from_utf8(bytes.clone())
        .with_context(|| format!("{} is not UTF-8", path.display()))?;
    let metadata = fs::metadata(&path)?;
    Ok(OptionalDocument {
        exists: true,
        content,
        hash: Some(hash_bytes(&bytes)),
        size: bytes.len(),
        modified_at: modified_seconds(&metadata),
    })
}

fn document_value(home: &Path, kind: DocumentKind) -> anyhow::Result<Value> {
    let path = kind.target(home);
    let document = read_optional(path.clone())?;
    Ok(json!({
        "kind": kind.id(),
        "path": path,
        "exists": document.exists,
        "content": document.content,
        "hash": document.hash,
        "size": document.size,
        "modifiedAt": document.modified_at,
    }))
}

fn expected_hash_conflict(payload: &Value, before: &OptionalDocument) -> Option<String> {
    let expected = payload.get("expectedHash").and_then(Value::as_str)?;
    let current = before.hash.as_deref().unwrap_or("");
    (expected != current).then(|| expected.to_string())
}

fn conflict_value(
    kind: DocumentKind,
    path: &Path,
    before: &OptionalDocument,
    expected: String,
) -> Value {
    json!({
        "status": "conflict",
        "kind": kind.id(),
        "path": path,
        "expectedHash": expected,
        "currentHash": before.hash,
        "message": "source changed after it was loaded",
    })
}

fn backup_existing(home: &Path, kind: DocumentKind, path: &Path) -> anyhow::Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let root = home.join(BACKUP_DIR);
    fs::create_dir_all(&root).with_context(|| format!("failed to create {}", root.display()))?;
    let name = format!("{}-{}.bak", kind.id(), timestamp_token());
    let backup = root.join(&name);
    fs::copy(path, &backup).with_context(|| {
        format!("failed to back up {} to {}", path.display(), backup.display())
    })?;
    Ok(Some(name))
}

fn timestamp_token() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn modified_seconds(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn hash_text(content: &str) -> String {
    hash_bytes(content.as_bytes())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn line_delta(before: &str, after: &str) -> (usize, usize) {
    let before_lines = before.lines().collect::<Vec<_>>();
    let after_lines = after.lines().collect::<Vec<_>>();
    let common = before_lines
        .iter()
        .zip(after_lines.iter())
        .filter(|(left, right)| left == right)
        .count();
    (
        after_lines.len().saturating_sub(common),
        before_lines.len().saturating_sub(common),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn preview_commit_conflict_and_restore_are_bounded() {
        let home = tempdir().unwrap();
        let home = home.path();
        let initial = get_document(home, DocumentKind::Agents).unwrap();
        assert_eq!(initial["exists"], false);

        let preview = preview_document(
            home,
            DocumentKind::Agents,
            &json!({ "content": "Use Chinese." }),
        )
        .unwrap();
        assert_eq!(preview["status"], "ok");

        let committed = commit_document(
            home,
            DocumentKind::Agents,
            &json!({ "content": "Use Chinese." }),
        )
        .unwrap();
        assert_eq!(committed["status"], "ok");
        let hash = committed["afterHash"].as_str().unwrap().to_string();

        let conflict = commit_document(
            home,
            DocumentKind::Agents,
            &json!({ "content": "Changed", "expectedHash": "sha256:stale" }),
        )
        .unwrap();
        assert_eq!(conflict["status"], "conflict");

        let second = commit_document(
            home,
            DocumentKind::Agents,
            &json!({ "content": "Changed", "expectedHash": hash }),
        )
        .unwrap();
        let backup = second["backup"].as_str().unwrap();
        let restored = restore_backup(home, &json!({ "name": backup })).unwrap();
        assert_eq!(restored["status"], "ok");
        assert_eq!(fs::read_to_string(home.join("AGENTS.md")).unwrap(), "Use Chinese.\n");
    }

    #[test]
    fn memory_correction_is_scoped_to_ad_hoc_note() {
        let home = tempdir().unwrap();
        let home = home.path();
        let result = commit_document(
            home,
            DocumentKind::MemoryCorrection,
            &json!({ "content": "# Correction\n\n- Stable preference." }),
        )
        .unwrap();
        assert_eq!(result["status"], "ok");
        assert!(home.join(MEMORY_CORRECTION_RELATIVE).is_file());
        assert!(!home.join("memories/MEMORY.md").exists());
    }

    #[test]
    fn rejects_oversized_and_invalid_restore_names() {
        let home = tempdir().unwrap();
        let home = home.path();
        let oversized = "x".repeat(MAX_TEXT_BYTES + 1);
        assert!(payload_content(&json!({ "content": oversized })).is_err());
        assert!(restore_backup(home, &json!({ "name": "../escape" })).is_err());
    }
}

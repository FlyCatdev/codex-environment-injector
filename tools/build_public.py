#!/usr/bin/env python3
"""Build the redistributable userscript without reading a user Codex home."""
import json
from pathlib import Path

from sync_environment_injector import VERSION, render_userscript

ROOT = Path(__file__).resolve().parents[1]


def build_public() -> Path:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if package["version"] != VERSION:
        raise RuntimeError("package.json and generator versions differ")
    # Do not call discover_profiles or build_environment_snapshot here.
    text = render_userscript(
        (ROOT / "codexpp/environment-injector.template.js").read_text(encoding="utf-8"),
        (ROOT / "codexpp/environment-studio.js").read_text(encoding="utf-8"),
        [],
        [],
        {"capabilities": {"source": "public-bundle", "diskRead": False, "diskWrite": False, "bridge": False}},
        (ROOT / "build/react-ui.js").read_text(encoding="utf-8"),
        generated_at_value="",
    )
    output = ROOT / "dist/codex-environment-injector.js"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8", newline="\n")
    print(f"Public userscript built: {output.name} (no local profiles or snapshots)")
    return output


if __name__ == "__main__":
    build_public()

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "sync_environment_injector.py"
TEMPLATE = ROOT / "codexpp" / "environment-injector.template.js"
STUDIO = ROOT / "codexpp" / "environment-studio.js"
REACT_UI = ROOT / "build" / "react-ui.js"
SPEC = importlib.util.spec_from_file_location("sync_environment_injector", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
sync_profiles = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sync_profiles
SPEC.loader.exec_module(sync_profiles)


PROFILE_TEXT = '''
model = "work-model"
model_provider = "work-provider"
model_reasoning_effort = "high"
developer_instructions = "Work only in this thread."
base_instructions = "Environment base override."
model_instructions_file = "./not-embedded.md"

[memories]
use_memories = false
generate_memories = true

[desktop]
appearanceTheme = "dark"

[model_providers.work-provider]
base_url = "https://example.invalid/v1"
api_key = "SHOULD_NOT_APPEAR"
wire_api = "responses"

[plugins."demo@local"]
enabled = true
'''


class CodexPlusProfileSyncTests(unittest.TestCase):
    def test_profile_filter_removes_global_and_sensitive_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            codex_home = Path(temp_dir)
            profile_path = codex_home / "work.config.toml"
            profile_path.write_text(PROFILE_TEXT, encoding="utf-8")

            profiles, warnings = sync_profiles.discover_profiles(codex_home)
            self.assertEqual(len(profiles), 1)
            profile = profiles[0]
            self.assertEqual(profile["id"], "work")
            self.assertEqual(profile["source"], "file")
            self.assertEqual(profile["sourceFileName"], "work.config.toml")
            self.assertEqual(profile["model"], "work-model")
            self.assertEqual(profile["modelProvider"], "work-provider")
            self.assertEqual(
                profile["developerInstructions"], "Work only in this thread."
            )
            self.assertEqual(profile["baseInstructions"], "Environment base override.")
            self.assertEqual(profile["memoryPolicy"], {"use": "off", "generate": "on"})
            self.assertEqual(profile["config"]["model_reasoning_effort"], "high")
            self.assertNotIn("memories", profile["config"])
            self.assertNotIn("desktop", profile["config"])
            self.assertNotIn(
                "api_key", profile["config"]["model_providers"]["work-provider"]
            )
            self.assertIn(
                "model_instructions_file (unsupported per-thread)", "\n".join(warnings)
            )
            self.assertIn("api_key", "\n".join(warnings))

    def test_rendered_userscript_is_valid_and_contains_no_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            codex_home = Path(temp_dir)
            (codex_home / "work.config.toml").write_text(
                PROFILE_TEXT, encoding="utf-8"
            )
            profiles, warnings = sync_profiles.discover_profiles(codex_home)
            rendered = sync_profiles.render_userscript(
                TEMPLATE.read_text(encoding="utf-8"),
                STUDIO.read_text(encoding="utf-8"),
                profiles,
                warnings,
                sync_profiles.build_environment_snapshot(codex_home, warnings),
                REACT_UI.read_text(encoding="utf-8"),
            )
            self.assertNotIn("__CODEX_ENVIRONMENT_BUNDLE__", rendered)
            self.assertIn('"id":"work"', rendered)
            self.assertIn("Codex++ Environment Injector bundle", rendered)
            self.assertIn("__codexEnvironmentInjector", rendered)
            self.assertIn("__codexEnvironmentStudio", rendered)
            self.assertIn("viewTutorial", rendered)
            self.assertIn("使用教程", rendered)
            self.assertIn("Environment Injector React 19 UI", rendered)
            self.assertIn("codexpp-environment-react-host", rendered)
            self.assertIn("attachUiAdapter", rendered)
            self.assertNotIn("SHOULD_NOT_APPEAR", rendered)

            node = shutil.which("node")
            if node:
                output = codex_home / "selector.js"
                output.write_text(rendered, encoding="utf-8")
                completed = subprocess.run(
                    [node, "--check", str(output)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_profile_studio_contract_and_javascript_syntax(self):
        source = STUDIO.read_text(encoding="utf-8")
        self.assertIn('const STORAGE_KEY = "codexpp.environmentInjector.v2"', source)
        self.assertIn('"环境注入器"', source)
        self.assertIn('developerInstructions', source)
        self.assertIn('baseInstructions', source)
        self.assertIn('memoryPolicy', source)
        self.assertIn('codexpp-environment-injector-updated', source)
        self.assertIn('attachUiAdapter', source)
        self.assertIn('renderer: adapterStatus ? "react" : "vanilla"', source)
        self.assertIn('.config.toml', source)
        node = shutil.which("node")
        if node:
            completed = subprocess.run(
                [node, "--check", str(STUDIO)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_environment_snapshot_redacts_and_reports_memory_policy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            codex_home = Path(temp_dir)
            (codex_home / "config.toml").write_text(
                '[features]\nmemories = true\n\n[memories]\nuse_memories = true\ngenerate_memories = false\n',
                encoding="utf-8",
            )
            (codex_home / "AGENTS.md").write_text(
                "Use Chinese. token = abcdefghijklmnop\n",
                encoding="utf-8",
            )
            memories = codex_home / "memories"
            memories.mkdir()
            (memories / "memory_summary.md").write_text(
                "Bearer abcdefghijklmnopqrst user preference",
                encoding="utf-8",
            )
            warnings: list[str] = []
            snapshot = sync_profiles.build_environment_snapshot(codex_home, warnings)
            self.assertTrue(snapshot["memory"]["settings"]["enabled"])
            self.assertTrue(snapshot["memory"]["settings"]["use_memories"])
            self.assertFalse(snapshot["memory"]["settings"]["generate_memories"])
            self.assertIn("<redacted>", snapshot["globalAgents"]["content"])
            self.assertIn("<redacted>", snapshot["memory"]["summary"]["content"])
            self.assertFalse(snapshot["capabilities"]["diskWrite"])

    def test_sync_preserves_existing_userscript_registry_fields(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            codex_home = root / "codex"
            appdata = root / "appdata"
            codex_home.mkdir()
            (codex_home / "work.config.toml").write_text(
                PROFILE_TEXT, encoding="utf-8"
            )
            registry = appdata / "Codex++" / "user_scripts.json"
            registry.parent.mkdir(parents=True)
            registry.write_text(
                json.dumps(
                    {
                        "enabled": False,
                        "scripts": {
                            "user:existing.js": True,
                            "user:codex-profile-selector.js": True,
                            "user:codex-profile-studio.js": True,
                        },
                        "market": {"user:existing.js": {"id": "existing"}},
                    }
                ),
                encoding="utf-8",
            )

            exit_code = sync_profiles.sync_userscript(
                codex_home,
                appdata,
                TEMPLATE,
                includes=None,
                dry_run=False,
            )
            self.assertEqual(exit_code, 0)
            updated = json.loads(registry.read_text(encoding="utf-8"))
            self.assertTrue(updated["enabled"])
            self.assertTrue(updated["scripts"]["user:existing.js"])
            self.assertTrue(
                updated["scripts"]["user:codex-environment-injector.js"]
            )
            self.assertFalse(
                updated["scripts"]["user:codex-profile-selector.js"]
            )
            self.assertFalse(
                updated["scripts"]["user:codex-profile-studio.js"]
            )
            self.assertTrue(
                (appdata / "Codex++" / "user_scripts" / "codex-environment-injector.js").exists()
            )
            self.assertEqual(
                updated["market"]["user:existing.js"]["id"], "existing"
            )


if __name__ == "__main__":
    unittest.main()

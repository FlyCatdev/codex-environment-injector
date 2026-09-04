import copy
import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "codex-environment-injector"
    / "skills"
    / "environment-injector"
    / "scripts"
    / "environment_switch.py"
)
SPEC = importlib.util.spec_from_file_location("environment_switch", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
environment_switch = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = environment_switch
SPEC.loader.exec_module(environment_switch)


class EnvironmentSwitchTests(unittest.TestCase):
    def test_key_paths_quote_dotted_segments(self):
        self.assertEqual(
            environment_switch.format_key_path(("plugins", "demo.plugin@local", "enabled")),
            'plugins."demo.plugin@local".enabled',
        )
        self.assertEqual(
            environment_switch.format_key_path(("model_providers", "example-provider", "base_url")),
            "model_providers.example-provider.base_url",
        )

    def test_activation_and_restore_plan_preserve_unrelated_values(self):
        base = {
            "model": "base-model",
            "desktop": {"keep": True},
            "plugins": {"demo@local": {"enabled": False}},
        }
        profile = {
            "model": "work-model",
            "desktop": {"marker": "work"},
            "plugins": {"demo@local": {"enabled": True}},
        }
        request_edits, state_edits = environment_switch.build_activation_plan(base, profile)
        self.assertEqual(
            [edit["keyPath"] for edit in request_edits],
            ["model", "desktop.marker", "plugins.demo@local.enabled"],
        )

        current = {
            "model": "work-model",
            "desktop": {"keep": True, "marker": "work"},
            "plugins": {"demo@local": {"enabled": True}},
        }
        restore_edits, conflicts = environment_switch.build_restore_plan(
            current, base, state_edits, force=False
        )
        self.assertEqual(conflicts, [])
        self.assertEqual(
            restore_edits,
            [
                {"keyPath": "model", "value": "base-model", "mergeStrategy": "replace"},
                {"keyPath": "desktop.marker", "value": None, "mergeStrategy": "replace"},
                {
                    "keyPath": "plugins.demo@local.enabled",
                    "value": False,
                    "mergeStrategy": "replace",
                },
            ],
        )
        self.assertTrue(current["desktop"]["keep"])

    def test_restore_detects_post_activation_conflict(self):
        base = {"model": "base-model"}
        profile = {"model": "work-model"}
        _, state_edits = environment_switch.build_activation_plan(base, profile)
        current = copy.deepcopy(profile)
        current["model"] = "user-edited-model"

        restore_edits, conflicts = environment_switch.build_restore_plan(
            current, base, state_edits, force=False
        )
        self.assertEqual(restore_edits, [])
        self.assertEqual(conflicts, ["model"])

        forced_edits, forced_conflicts = environment_switch.build_restore_plan(
            current, base, state_edits, force=True
        )
        self.assertEqual(forced_conflicts, [])
        self.assertEqual(
            forced_edits,
            [{"keyPath": "model", "value": "base-model", "mergeStrategy": "replace"}],
        )


if __name__ == "__main__":
    unittest.main()

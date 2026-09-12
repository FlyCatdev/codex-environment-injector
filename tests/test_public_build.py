import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_public
import sync_environment_injector


class PublicBuildTests(unittest.TestCase):
    def test_quoted_secret_text_is_redacted_and_credential_urls_are_rejected(self):
        warnings = []
        text = sync_environment_injector.redact_embedded_text(
            '{"password": "SYNTHETIC_PRIVATE_VALUE"}', "fixture", warnings)
        self.assertNotIn("SYNTHETIC_PRIVATE_VALUE", text)
        sanitized = sync_environment_injector.sanitize_value(
            'api_key = SYNTHETIC_PRIVATE_VALUE', ("fixture",), [])
        self.assertNotIn("SYNTHETIC_PRIVATE_VALUE", sanitized)
        with self.assertRaises(sync_environment_injector.SyncError):
            sync_environment_injector.sanitize_value(
                "https://test-user:test-value@example.invalid", ("fixture",), [])

    def test_public_build_does_not_inspect_a_user_home_and_is_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "codexpp").mkdir()
            (root / "build").mkdir()
            (root / "package.json").write_text(json.dumps({"version": build_public.VERSION}), encoding="utf-8")
            (root / "codexpp/environment-injector.template.js").write_text(
                "const ENVIRONMENT_BUNDLE = __CODEX_ENVIRONMENT_BUNDLE__;\n", encoding="utf-8")
            (root / "codexpp/environment-studio.js").write_text("// studio\n", encoding="utf-8")
            (root / "build/react-ui.js").write_text("// react\n", encoding="utf-8")
            with patch.object(build_public, "ROOT", root), \
                 patch.object(sync_environment_injector, "discover_profiles", side_effect=AssertionError("Must not read user profiles")), \
                 patch.object(sync_environment_injector, "build_environment_snapshot", side_effect=AssertionError("Must not read user snapshots")):
                first = build_public.build_public().read_bytes()
                second = build_public.build_public().read_bytes()
            self.assertEqual(first, second)
            text = first.decode("utf-8")
            encoded = text.split("const ENVIRONMENT_BUNDLE = ", 1)[1].split(";\n", 1)[0]
            bundle = json.loads(encoded)
            self.assertEqual(bundle["profiles"], [])
            self.assertEqual(bundle["warnings"], [])
            self.assertEqual(bundle["generatedAt"], "")
            self.assertNotIn("globalAgents", bundle["environment"])
            self.assertNotIn("memory", bundle["environment"])
            self.assertFalse(bundle["environment"]["capabilities"]["diskWrite"])

    def test_dist_contains_only_public_environment_data(self):
        text = (ROOT / "dist/codex-environment-injector.js").read_text(encoding="utf-8")
        line = next(line for line in text.splitlines() if "const ENVIRONMENT_BUNDLE = " in line)
        bundle = json.loads(line.split("const ENVIRONMENT_BUNDLE = ", 1)[1].rstrip(";"))
        self.assertEqual(bundle["profiles"], [])
        self.assertEqual(bundle["environment"]["capabilities"]["source"], "public-bundle")
        for marker in ("bindingsByThread", "proofByThread", "globalAgents", "memory", "codexHome"):
            self.assertNotIn(marker, json.dumps(bundle))


if __name__ == "__main__":
    unittest.main()

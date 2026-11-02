"""Keyless deployment-policy checks; no containers, SSH or model requests."""

import json
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ASSETS = Path(__file__).resolve().parent
DUMMY_KEY = "offline-dedicated-test-key"
TEST_ENV = {name: os.environ[name] for name in ("PATH", "LANG", "LC_ALL", "TMPDIR") if name in os.environ}
TEST_ENV["DEEPSEEK_API_KEY"] = "shared-key-must-not-be-used"


def embedding_provider(model="bge-m3"):
    return {
        "id": "大肥鱼记忆-本机", "type": "openai_embedding", "provider": "openai",
        "provider_type": "embedding", "enable": True, "embedding_api_key": "ollama",
        "embedding_api_base": "http://ollama:11434/v1", "embedding_model": model,
        "embedding_dimensions": 1024, "embedding_dimensions_mode": "auto",
        "timeout": 20, "proxy": "",
    }


def edge_provider():
    return {
        "id": "大肥鱼语音-Edge", "type": "edge_tts", "provider": "microsoft",
        "provider_type": "text_to_speech", "enable": True,
        "edge-tts-voice": "zh-CN-XiaoxiaoNeural", "rate": "+0%", "volume": "+0%",
        "pitch": "+0Hz", "timeout": 20,
    }


def doubao_provider():
    return {
        "id": "大肥鱼语音-豆包", "type": "seed_audio_tts", "provider": "volcengine",
        "provider_type": "text_to_speech", "enable": True,
        "api_base": "https://openspeech.bytedance.com/api/v3/tts/create",
        "resource_id": "seed-audio-1.0", "model": "seed-audio-1.0", "credentials_file": "",
        "app_id": "fixture-doubao-app-id", "access_key": "fixture-doubao-independent-key",
    }


def native_doubao_provider():
    return {
        **doubao_provider(), "seed_audio_persona": "大肥鱼的自然中文语音",
        "seed_audio_prompt_template": "请按照{persona}的风格朗读：{text}",
        "seed_audio_format": "mp3", "seed_audio_sample_rate": 24000,
        "seed_audio_max_attempts": 2, "seed_audio_whole_reply": True,
        "seed_audio_reply_probability": 0.33, "timeout": 20,
    }


class PreparationTests(unittest.TestCase):
    def invoke(self, directory, payload, verify=False):
        command = ["python3", str(ASSETS / "prepare.py"), "--directory", str(directory)]
        command += ["--verify"] if verify else ["--model", "deepseek-flash"]
        return subprocess.run(command, input=json.dumps(payload), text=True, capture_output=True,
                              env=TEST_ENV)

    def test_fresh_instance_uses_only_explicit_key_and_owner_private_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            result = self.invoke(root, {"deepseekApiKey": DUMMY_KEY})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(DUMMY_KEY, result.stdout + result.stderr)
            config = json.loads((root / "private/astrbot-data/cmd_config.json").read_text())
            self.assertEqual(config["provider_sources"][0]["key"], [DUMMY_KEY])
            self.assertEqual(config["platform_settings"]["id_whitelist"], ["dafeiyu-qq:FriendMessage:3202619225"])
            self.assertFalse(config["platform_settings"]["wl_ignore_admin_on_group"])
            self.assertFalse(config["platform_settings"]["wl_ignore_admin_on_friend"])
            self.assertFalse(config["platform_settings"]["no_permission_reply"])
            self.assertEqual(config["agent_runner"]["config"]["model"]["provider_id"], "dafeiyu-chat")
            global_config = json.loads((root / "private/snowluma-data/config/onebot.json").read_text())
            self.assertFalse(any(global_config["networks"].values()))
            account = json.loads((root / "private/snowluma-data/config/onebot_872713341.json").read_text())
            self.assertEqual(account["networks"]["wsClients"][0]["accessToken"], config["platform"][0]["ws_reverse_token"])
            self.assertFalse(account["statusCommand"]["enabled"])
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            for path in (root / "private").rglob("*.json"):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(self.invoke(root, {}, verify=True).returncode, 0)
            fingerprint = hashlib.sha256(DUMMY_KEY.encode()).hexdigest()
            metadata = json.loads((root / "deployment.json").read_text())
            self.assertEqual(metadata["modelKeyFingerprint"], fingerprint)
            for expected, code in ((fingerprint, 0), ("0" * 64, 1)):
                recovery = subprocess.run(["python3", str(ASSETS / "prepare.py"), "--directory", str(root), "--verify", "--expected-key-sha256", expected], text=True, capture_output=True, env=TEST_ENV)
                self.assertEqual(recovery.returncode, code)

    def test_empty_or_environment_key_fails_without_creating_private_data(self):
        for payload in ({"deepseekApiKey": ""}, {"deepseekApiKey": "$DEEPSEEK_API_KEY"}, {"deepseekApiKey": "prefix$DEEPSEEK_API_KEY"}, {"deepseekApiKey": "invalid\x7fkey"}, {"unexpected": "x"}):
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / "deployment"
                result = self.invoke(root, payload)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(root.exists())
                self.assertNotIn("shared-key-must-not-be-used", result.stdout + result.stderr)

    def test_reinitialization_preserves_original_data_and_policy_drift_blocks_deploy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            self.assertEqual(self.invoke(root, {"deepseekApiKey": DUMMY_KEY}).returncode, 0)
            config_path = root / "private/astrbot-data/cmd_config.json"
            before = config_path.read_bytes()
            result = self.invoke(root, {"deepseekApiKey": "must-not-overwrite"})
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(before, config_path.read_bytes())
            config = json.loads(before)
            config["platform_settings"]["wl_ignore_admin_on_group"] = True
            config_path.write_text(json.dumps(config))
            self.assertNotEqual(self.invoke(root, {}, verify=True).returncode, 0)
            identity = subprocess.run(["python3", str(ASSETS / "prepare.py"), "--directory", str(root), "--verify", "--identity-only"], capture_output=True, text=True, env=TEST_ENV)
            self.assertEqual(identity.returncode, 0)

    def prepared_config(self, root):
        result = self.invoke(root, {"deepseekApiKey": DUMMY_KEY})
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((root / "private/astrbot-data/cmd_config.json").read_text())

    def verify_config(self, root, config, allowed):
        path = root / "private/astrbot-data/cmd_config.json"
        path.write_text(json.dumps(config, ensure_ascii=False))
        before = path.read_bytes()
        result = self.invoke(root, {}, verify=True)
        self.assertEqual(result.returncode, 0 if allowed else 1, result.stderr)
        self.assertNotIn(DUMMY_KEY, result.stdout + result.stderr)
        self.assertNotIn("injected-fixture-secret", result.stdout + result.stderr)
        self.assertNotIn("fixture-doubao-app-id", result.stdout + result.stderr)
        self.assertNotIn("fixture-doubao-independent-key", result.stdout + result.stderr)
        self.assertEqual(path.read_bytes(), before, "verification must not rewrite the configuration")

    def test_official_auxiliary_providers_allow_each_both_and_reordered_chat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            self.assertEqual([row["id"] for row in baseline["provider"]], ["dafeiyu-chat"])
            self.assertEqual([row["id"] for row in baseline["provider_sources"]], ["dafeiyu-deepseek"])
            original = json.dumps(baseline)
            chat = baseline["provider"][0]
            minimal_embedding = embedding_provider()
            del minimal_embedding["embedding_dimensions_mode"]
            del minimal_embedding["proxy"]
            empty_source_embedding = {**embedding_provider(), "provider_source_id": ""}
            cases = [
                ("chat-only", [chat]),
                ("embedding", [chat, embedding_provider()]),
                ("embedding-tagged-model", [chat, embedding_provider("bge-m3:567m-fp16")]),
                ("embedding-tuned-timeout", [chat, {**embedding_provider(), "timeout": 21}]),
                ("embedding-always-dimensions", [chat, {**embedding_provider(), "embedding_dimensions_mode": "always"}]),
                ("embedding-never-dimensions", [chat, {**embedding_provider(), "embedding_dimensions_mode": "never"}]),
                ("embedding-optional-fields-absent", [chat, minimal_embedding]),
                ("embedding-empty-source-reference", [chat, empty_source_embedding]),
                ("edge", [chat, edge_provider()]),
                ("edge-tuned-voice", [chat, {**edge_provider(), "edge-tts-voice": "en-US-AriaNeural", "rate": "+10%", "volume": "+10%", "pitch": "+1Hz", "timeout": 21}]),
                ("both", [chat, embedding_provider(), edge_provider()]),
                ("chat-in-middle", [edge_provider(), chat, embedding_provider()]),
                ("chat-last", [embedding_provider("bge-m3:567m-fp16"), edge_provider(), chat]),
                ("doubao", [chat, doubao_provider()]),
                ("doubao-with-embedding", [chat, embedding_provider(), doubao_provider()]),
                ("doubao-chat-in-middle", [doubao_provider(), chat, embedding_provider("bge-m3:567m-fp16")]),
                ("doubao-native-parameters", [chat, native_doubao_provider()]),
                ("doubao-native-with-embedding", [embedding_provider(), native_doubao_provider(), chat]),
                ("doubao-native-lower-bounds", [chat, {**native_doubao_provider(), "seed_audio_sample_rate": 8000, "seed_audio_max_attempts": 1, "seed_audio_reply_probability": 0, "seed_audio_whole_reply": False}]),
                ("doubao-native-upper-bounds", [chat, {**native_doubao_provider(), "seed_audio_sample_rate": 48000, "seed_audio_max_attempts": 5, "seed_audio_reply_probability": 1}]),
                ("doubao-native-literal-braces", [chat, {**native_doubao_provider(), "seed_audio_prompt_template": "{{朗读}}\n{text}"}]),
            ]
            for name, providers in cases:
                with self.subTest(case=name):
                    config = json.loads(original)
                    config["provider"] = providers
                    self.verify_config(root, config, allowed=True)
                    self.assertEqual(config["provider_sources"], baseline["provider_sources"])

    def test_auxiliary_provider_ids_are_unique_and_never_admit_additional_chat_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            original = json.dumps(baseline)
            chat = baseline["provider"][0]
            cases = [
                ("missing-chat", [embedding_provider(), edge_provider()]),
                ("empty-provider-list", []),
                ("unknown-embedding-id", [chat, {**embedding_provider(), "id": "unapproved-memory"}]),
                ("unknown-edge-id", [chat, {**edge_provider(), "id": "unapproved-speech"}]),
                ("duplicate-chat", [chat, dict(chat)]),
                ("duplicate-embedding", [chat, embedding_provider(), embedding_provider("bge-m3:567m-fp16")]),
                ("duplicate-edge", [chat, edge_provider(), edge_provider()]),
                ("duplicate-doubao", [chat, doubao_provider(), doubao_provider()]),
                ("unknown-doubao-id", [chat, {**doubao_provider(), "id": "unapproved-doubao"}]),
                ("extra-chat", [chat, {**chat, "id": "another-chat"}]),
                ("chat-disguised-as-embedding", [chat, {**chat, "id": "大肥鱼记忆-本机"}]),
                ("chat-disguised-as-edge", [chat, {**chat, "id": "大肥鱼语音-Edge"}]),
                ("chat-disguised-as-doubao", [chat, {**chat, "id": "大肥鱼语音-豆包"}]),
                ("malformed-provider-entry", [chat, None]),
            ]
            for name, providers in cases:
                with self.subTest(case=name):
                    config = json.loads(original)
                    config["provider"] = providers
                    self.verify_config(root, config, allowed=False)

    def test_embedding_accepts_only_the_local_ollama_storage_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            original = json.dumps(self.prepared_config(root))
            changes = [
                ("provider", "deepseek"), ("type", "openai_chat_completion"),
                ("provider_type", "chat_completion"), ("enable", "true"),
                ("embedding_api_key", "injected-fixture-secret"),
                ("embedding_api_base", "https://external.example.invalid/v1"),
                ("embedding_api_base", "http://127.0.0.1:11434/v1"),
                ("embedding_model", "unapproved-embedding-model"),
                ("embedding_dimensions", 768), ("embedding_dimensions", "1024"),
                ("embedding_dimensions_mode", "manual"),
                ("timeout", 0), ("timeout", "20"), ("timeout", 20.0), ("timeout", True),
                ("proxy", "http://external.example.invalid"),
                ("provider_source_id", "dafeiyu-deepseek"),
                ("key", []), ("api_key", ""), ("model", ""), ("api_base", ""),
                ("custom_headers", {}), ("unknown_option", False),
            ]
            for index, (field, value) in enumerate(changes):
                with self.subTest(case=index, field=field):
                    config = json.loads(original)
                    config["provider"].append({**embedding_provider(), field: value})
                    self.verify_config(root, config, allowed=False)

    def test_edge_keeps_voice_parameters_typed_and_rejects_keys_sources_or_endpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            original = json.dumps(self.prepared_config(root))
            changes = [
                ("provider", "openai"), ("type", "openai_chat_completion"),
                ("provider_type", "chat_completion"), ("enable", "true"),
                ("timeout", 0), ("timeout", "20"), ("timeout", True),
                ("provider_source_id", "dafeiyu-deepseek"),
                ("key", "injected-fixture-secret"), ("api_key", ""),
                ("embedding_api_key", "ollama"), ("token", "injected-fixture-secret"),
                ("api_base", "https://external.example.invalid/v1"),
                ("endpoint", "https://external.example.invalid"),
                ("proxy", ""), ("custom_headers", {}), ("unknown_option", False),
            ]
            changes += [(field, value) for field in ("edge-tts-voice", "rate", "volume", "pitch")
                        for value in ("", "fixture\ncontrol", 1, None)]
            changes += [("rate", "fast"), ("volume", "+10"), ("pitch", "+1%")]
            for index, (field, value) in enumerate(changes):
                with self.subTest(case=index, field=field):
                    config = json.loads(original)
                    config["provider"].append({**edge_provider(), field: value})
                    self.verify_config(root, config, allowed=False)

    def test_auxiliary_allowance_preserves_the_independent_chat_source_and_selectors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            baseline["provider"].extend([embedding_provider(), edge_provider()])
            original = json.dumps(baseline)
            changes = [
                (("provider_sources", 0, "id"), "other-source"),
                (("provider_sources", 0, "type"), "openai_embedding"),
                (("provider_sources", 0, "provider"), "openai"),
                (("provider_sources", 0, "provider_type"), "embedding"),
                (("provider_sources", 0, "api_base"), "https://external.example.invalid/v1"),
                (("provider_sources", 0, "enable"), False),
                (("provider_sources", 0, "key"), ["injected-fixture-secret"]),
                (("provider_sources", 0, "key"), [DUMMY_KEY, "injected-fixture-secret"]),
                (("provider_sources", 0, "api_key"), ""),
                (("provider_sources", 0, "access_key"), "injected-fixture-secret"),
                (("provider_sources", 0, "credentials_file"), ""),
                (("provider_sources", 0, "custom_headers"), {"Authorization": "injected-fixture-secret"}),
                (("provider_sources", 0, "proxy"), "http://external.example.invalid"),
                (("provider", 0, "provider_source_id"), "other-source"),
                (("provider", 0, "model"), "other-model"),
                (("provider", 0, "enable"), False),
                (("provider", 0, "key"), [DUMMY_KEY]),
                (("provider", 0, "api_key"), "injected-fixture-secret"),
                (("provider", 0, "access_key"), "injected-fixture-secret"),
                (("provider", 0, "credentials_file"), ""),
                (("provider", 0, "api_base"), "https://external.example.invalid/v1"),
                (("provider", 0, "proxy"), ""),
                (("provider", 0, "custom_headers"), {"Authorization": "injected-fixture-secret"}),
                (("agent_runner", "runner_type"), "remote"),
                (("agent_runner", "config", "model", "provider_id"), "other-chat"),
                (("agent_runner", "config", "model", "fallback_provider_ids"), ["other-chat"]),
                (("provider_settings", "provider_pool"), ["dafeiyu-chat", "other-chat"]),
            ]
            for index, (path, value) in enumerate(changes):
                with self.subTest(case=index, field=path[-1]):
                    config = json.loads(original)
                    target = config
                    for part in path[:-1]:
                        target = target[part]
                    target[path[-1]] = value
                    self.verify_config(root, config, allowed=False)
            config = json.loads(original)
            config["provider_sources"].append({**config["provider_sources"][0], "id": "extra-source"})
            self.verify_config(root, config, allowed=False)
            config = json.loads(original)
            metadata_path = root / "deployment.json"
            metadata = json.loads(metadata_path.read_text())
            metadata["modelKeyFingerprint"] = "0" * 64
            metadata_path.write_text(json.dumps(metadata))
            self.verify_config(root, config, allowed=False)

    def test_doubao_requires_independent_literal_credentials_and_the_pinned_official_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            original = json.dumps(self.prepared_config(root))
            changes = [
                ("provider", "openai"), ("type", "openai_chat_completion"),
                ("provider_type", "chat_completion"), ("enable", "true"),
                ("api_base", "https://external.example.invalid/api/v3/tts/create"),
                ("api_base", "http://openspeech.bytedance.com/api/v3/tts/create"),
                ("resource_id", "seed-audio-2.0"), ("model", "seed-audio-2.0"),
                ("credentials_file", "/fixture/private-credentials.json"),
                ("app_id", ""), ("access_key", ""),
                ("app_id", "$DOUBAO_APP_ID"), ("access_key", "$DOUBAO_ACCESS_KEY"),
                ("app_id", DUMMY_KEY), ("access_key", DUMMY_KEY),
                ("app_id", "fixture\napp"), ("access_key", "fixture\nkey"),
                ("access_key", ["fixture-doubao-independent-key"]),
                ("provider_source_id", "dafeiyu-deepseek"),
                ("key", ""), ("api_key", "injected-fixture-secret"),
                ("access_token", "injected-fixture-secret"), ("secret_key", "injected-fixture-secret"),
                ("custom_headers", {}), ("unknown_option", False),
            ]
            for index, (field, value) in enumerate(changes):
                with self.subTest(case=index, field=field):
                    config = json.loads(original)
                    config["provider"].append({**doubao_provider(), field: value})
                    self.verify_config(root, config, allowed=False)

    def test_doubao_reference_speaker_allows_only_empty_or_literal_icl_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            original = json.dumps(baseline)
            speaker = "ICL_uranus_zh_female_jiaoruoluoli_tob"
            for value in ("", speaker, "ICL_" + "a" * 156):
                with self.subTest(value=value):
                    config = json.loads(original)
                    config["provider"].append({**native_doubao_provider(), "seed_audio_reference_speaker": value})
                    self.verify_config(root, config, allowed=True)
                    self.assertEqual(config["provider_sources"], baseline["provider_sources"])
            invalid = (
                None, False, True, 0, 1, [], [speaker], {}, {"speaker": speaker},
                {"env": "REFERENCE_SPEAKER"}, {"url": "https://example.invalid/voice.wav"},
                "https://example.invalid/voice.wav", "file:///voice.wav", "/voice.wav",
                "../voice.wav", "~/voice.wav", "data:audio/wav;base64,AAAA",
                "$REFERENCE_SPEAKER", "${REFERENCE_SPEAKER}", "ICL_$REFERENCE_SPEAKER",
                "ICL_", "icl_example", "ICL_voice-name", "ICL_voice.name", "ICL_中文",
                " ICL_voice", "ICL_voice ", "ICL_voice\n", "ICL_voice\x00",
                "ICL_" + "a" * 157,
            )
            for value in invalid:
                with self.subTest(value=value):
                    config = json.loads(original)
                    config["provider"].append({**native_doubao_provider(), "seed_audio_reference_speaker": value})
                    self.verify_config(root, config, allowed=False)
            for field, value in (("references", [{"speaker": speaker}]),
                                 ("speaker", speaker), ("audio_data", "AAAA"),
                                 ("url", "https://example.invalid/voice.wav")):
                with self.subTest(field=field):
                    config = json.loads(original)
                    config["provider"].append({**native_doubao_provider(), field: value})
                    self.verify_config(root, config, allowed=False)

    def test_doubao_reference_speaker_cannot_reuse_even_a_syntactically_valid_chat_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            config = self.prepared_config(root)
            fixture_key = "ICL_offline_fixture_chat_key"
            config["provider_sources"][0]["key"] = [fixture_key]
            metadata_path = root / "deployment.json"
            metadata = json.loads(metadata_path.read_text())
            metadata["modelKeyFingerprint"] = hashlib.sha256(fixture_key.encode()).hexdigest()
            metadata_path.write_text(json.dumps(metadata))
            config["provider"].append({**native_doubao_provider(), "seed_audio_reference_speaker": fixture_key})
            self.verify_config(root, config, allowed=False)

    def test_auxiliary_allowance_keeps_owner_and_admin_whitelist_policy_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            baseline["provider"].extend([embedding_provider(), edge_provider()])
            original = json.dumps(baseline)
            changes = [
                (("admins_id",), ["11111111"]),
                (("admins_id",), ["3202619225", "11111111"]),
                (("platform_settings", "enable_id_white_list"), False),
                (("platform_settings", "enable_id_white_list"), 1),
                (("platform_settings", "no_permission_reply"), True),
                (("platform_settings", "id_whitelist"), ["dafeiyu-qq:FriendMessage:11111111"]),
                (("platform_settings", "id_whitelist"), ["dafeiyu-qq:FriendMessage:3202619225", "dafeiyu-qq:GroupMessage:11111111"]),
                (("platform_settings", "wl_ignore_admin_on_group"), True),
                (("platform_settings", "wl_ignore_admin_on_friend"), True),
            ]
            for index, (path, value) in enumerate(changes):
                with self.subTest(case=index, field=path[-1]):
                    config = json.loads(original)
                    target = config
                    for part in path[:-1]:
                        target = target[part]
                    target[path[-1]] = value
                    self.verify_config(root, config, allowed=False)

    def test_doubao_native_parameters_reject_unsafe_templates_and_invalid_types_or_ranges(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            original = json.dumps(self.prepared_config(root))
            changes = [
                ("seed_audio_persona", ""), ("seed_audio_persona", "   "),
                ("seed_audio_persona", 1), ("seed_audio_persona", "x" * 4001),
                ("seed_audio_prompt_template", ""), ("seed_audio_prompt_template", 1),
                ("seed_audio_prompt_template", "x" * 12001),
                ("seed_audio_format", "wav"),
                ("seed_audio_sample_rate", 7999), ("seed_audio_sample_rate", 48001),
                ("seed_audio_sample_rate", 24000.0), ("seed_audio_sample_rate", True),
                ("seed_audio_max_attempts", 0), ("seed_audio_max_attempts", 6),
                ("seed_audio_max_attempts", 2.0), ("seed_audio_max_attempts", True),
                ("seed_audio_whole_reply", "true"), ("seed_audio_whole_reply", 1),
                ("seed_audio_reply_probability", -0.01), ("seed_audio_reply_probability", 1.01),
                ("seed_audio_reply_probability", True), ("seed_audio_reply_probability", "0.33"),
                ("seed_audio_reply_probability", float("nan")),
                ("seed_audio_reply_probability", float("inf")),
                ("seed_audio_reply_probability", float("-inf")),
                ("seed_audio_voice", "unapproved-voice-field"),
            ]
            changes += [("seed_audio_prompt_template", template) for template in (
                "{persona}", "{{text}}", "{unknown} {text}", "{text.__class__}",
                "{text[0]}", "{text!r}", "{text:>10}", "{text", "{text}}", "{0}",
            )]
            for index, (field, value) in enumerate(changes):
                with self.subTest(case=index, field=field):
                    config = json.loads(original)
                    config["provider"].append({**native_doubao_provider(), field: value})
                    self.verify_config(root, config, allowed=False)

    def test_enabled_deepseek_search_uses_only_the_validated_companion_chat_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            self.assertIs(baseline["provider_settings"]["web_search"], False)
            baseline["provider_settings"].update({
                "web_search": True, "websearch_provider": "deepseek",
                "websearch_deepseek_key": [DUMMY_KEY],
            })
            original = json.dumps(baseline)
            self.verify_config(root, baseline, allowed=True)
            with_auxiliaries = json.loads(original)
            with_auxiliaries["provider"].extend([embedding_provider(), native_doubao_provider()])
            self.verify_config(root, with_auxiliaries, allowed=True)
            cases = [("websearch_provider", value) for value in (None, "", "other-search", "DeepSeek")]
            cases += [("websearch_deepseek_key", value) for value in (
                None, [], "", DUMMY_KEY, ["$DEEPSEEK_API_KEY"],
                ["injected-fixture-secret"], [DUMMY_KEY, "injected-fixture-secret"],
                [DUMMY_KEY, DUMMY_KEY],
            )]
            for index, (field, value) in enumerate(cases):
                with self.subTest(case=index, field=field):
                    config = json.loads(original)
                    config["provider_settings"][field] = value
                    self.verify_config(root, config, allowed=False)
            for field in ("websearch_provider", "websearch_deepseek_key"):
                with self.subTest(missing=field):
                    config = json.loads(original)
                    del config["provider_settings"][field]
                    self.verify_config(root, config, allowed=False)

    def test_inactive_search_ignores_absent_or_stale_provider_and_key_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "deployment"
            baseline = self.prepared_config(root)
            self.assertIs(baseline["provider_settings"]["web_search"], False)
            original = json.dumps(baseline)
            self.verify_config(root, baseline, allowed=True)
            for index, settings in enumerate((
                {"websearch_provider": "unrelated-search", "websearch_deepseek_key": ["injected-fixture-secret"]},
                {"websearch_provider": "deepseek", "websearch_deepseek_key": "$DEEPSEEK_API_KEY"},
                {"websearch_provider": None, "websearch_deepseek_key": None},
            )):
                with self.subTest(case=index):
                    config = json.loads(original)
                    config["provider_settings"].update(settings)
                    self.verify_config(root, config, allowed=True)
            config = json.loads(original)
            del config["provider_settings"]["web_search"]
            config["provider_settings"].update({"websearch_provider": "unrelated-search", "websearch_deepseek_key": ["injected-fixture-secret"]})
            self.verify_config(root, config, allowed=True)


if __name__ == "__main__":
    unittest.main()

"""Offline plugin integration: fake AstrBot, fake audio, and temporary config.

No AstrBot installation, credentials, API calls, or generated audio are needed.
The aiohttp replacement fails immediately if a test accidentally reaches HTTP.
"""

import asyncio
from dataclasses import dataclass
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch


OWNER = "dafeiyu-qq:FriendMessage:3202619225"
OWNER_ID = "3202619225"
PLUGIN_DIR = Path(__file__).resolve().parents[1] / "astrbot_plugin_seed_audio_tts"


@dataclass
class Plain:
    text: str


@dataclass
class Record:
    file: str = ""
    url: str = ""
    text: str = ""


@dataclass
class Reply:
    chain: list


@dataclass
class Forward:
    chain: list


@dataclass
class Node:
    chain: list


class FakeSessionServiceManager:
    state = {}

    @staticmethod
    async def set_tts_status_for_session(session_id, enabled):
        FakeSessionServiceManager.state[session_id] = enabled

    @staticmethod
    async def should_process_tts_request(event):
        return FakeSessionServiceManager.state.get(event.unified_msg_origin, True)


class FakeStar:
    def __init__(self, context):
        self.context = context


class FakeTTSProvider:
    pass


def _identity_decorator(*args, **kwargs):
    return lambda decorated: decorated


def _load_plugin():
    """Import the actual staging package while restoring sys.modules afterward."""
    modules = {}

    def module(name):
        if name in modules:
            return modules[name]
        item = types.ModuleType(name)
        item.__path__ = []
        modules[name] = item
        parent_name, _, child_name = name.rpartition(".")
        if parent_name:
            setattr(module(parent_name), child_name, item)
        return item

    module("astrbot").logger = types.SimpleNamespace(
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
        error=lambda *a, **k: None,
        debug=lambda *a, **k: None,
    )
    events = module("astrbot.api.event")
    events.AstrMessageEvent = object
    events.filter = types.SimpleNamespace(
        EventMessageType=types.SimpleNamespace(PRIVATE_MESSAGE="private"),
        event_message_type=_identity_decorator,
        on_llm_request=_identity_decorator,
        on_decorating_result=_identity_decorator,
        llm_tool=_identity_decorator,
    )
    components = module("astrbot.api.message_components")
    components.Plain = Plain
    components.Record = Record
    stars = module("astrbot.api.star")
    stars.Context = object
    stars.Star = FakeStar
    module("astrbot.core.star.session_llm_manager").SessionServiceManager = FakeSessionServiceManager
    registration = module("astrbot.core.provider.register")
    registration.provider_cls_map = {}
    registration.provider_registry = []
    registration.register_provider_adapter = _identity_decorator
    module("astrbot.core.provider.entities").ProviderType = types.SimpleNamespace(TEXT_TO_SPEECH="tts")
    module("astrbot.core.provider.provider").TTSProvider = FakeTTSProvider
    module("astrbot.core.utils.astrbot_path").get_astrbot_temp_path = lambda: "/offline/not-used"

    def forbid_http(*args, **kwargs):
        raise AssertionError("These offline tests must never create an HTTP session")

    module("aiohttp").ClientSession = forbid_http
    package_name = "_offline_seed_audio_plugin"
    package = module(package_name)
    package.__path__ = [str(PLUGIN_DIR)]
    module_name = package_name + ".main"
    spec = importlib.util.spec_from_file_location(module_name, PLUGIN_DIR / "main.py")
    loaded = importlib.util.module_from_spec(spec)
    modules[module_name] = loaded
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(loaded)
    return loaded


PLUGIN = _load_plugin()


class FakeConfig(dict):
    def __init__(self, path, values):
        super().__init__(values)
        self.path = path
        self.save_count = 0

    def save_config(self):
        self.path.write_text(json.dumps(dict(self)), encoding="utf-8")
        self.save_count += 1

    def reload(self):
        return FakeConfig(self.path, json.loads(self.path.read_text(encoding="utf-8")))


class FakeContext:
    def __init__(self, provider):
        self.provider = provider

    def get_all_tts_providers(self):
        return [self.provider]

    def get_config(self, umo=None):
        return {"provider_tts_settings": {"enable": False}}


class FakeResult:
    def __init__(self, text="这是普通的文字回复。", llm=True):
        self.chain = [Plain(text)]
        self.llm = llm

    def is_llm_result(self):
        return self.llm


class FakeEvent:
    def __init__(self, text="继续聊天", *, umo=OWNER, sender=OWNER_ID,
                 messages=None, result_text="这是普通的文字回复。", sender_error=False):
        self.unified_msg_origin = umo
        self.sender = sender
        self.sender_error = sender_error
        self.messages = [Plain(text)] if messages is None else messages
        self.extras = {}
        self.result = FakeResult(result_text)

    def get_sender_id(self):
        if self.sender_error:
            raise AttributeError("No incoming sender")
        return self.sender

    def get_messages(self):
        return self.messages

    def get_extra(self, key):
        return self.extras.get(key)

    def set_extra(self, key, value):
        self.extras[key] = value

    def get_result(self):
        return self.result

    @property
    def history(self):
        raise AssertionError("Voice controls must not read conversation history")


class PluginVoiceControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeSessionServiceManager.state = {}
        self.temp_dir = tempfile.TemporaryDirectory(prefix="voice-control-offline-")
        self.addCleanup(self.temp_dir.cleanup)
        self.counter = 0
        self.plugins = []

    async def asyncTearDown(self):
        for plugin in self.plugins:
            await plugin.terminate()

    async def make_plugin(self, mode=None, probability=0.33, config=None):
        if config is None:
            self.counter += 1
            values = {"owner_session": OWNER}
            if mode is not None:
                values["reply_mode"] = mode
            path = Path(self.temp_dir.name) / ("config-%s.json" % self.counter)
            config = FakeConfig(path, values)
        provider = PLUGIN.ProviderSeedAudioTTS.__new__(PLUGIN.ProviderSeedAudioTTS)
        provider.provider_config = {"type": PLUGIN.TYPE_NAME}
        provider.whole_reply = True
        provider.reply_probability = probability
        provider.get_audio = AsyncMock(return_value="/offline/generated.mp3")
        plugin = PLUGIN.SeedAudioTTSPlugin(FakeContext(provider), config)
        self.plugins.append(plugin)
        await plugin.initialize()
        return plugin, config, provider

    async def deliver(self, plugin, event, sample=0.0):
        await plugin.apply_voice_control(event)
        with patch.object(PLUGIN.random, "random", return_value=sample):
            await plugin.whole_reply_voice(event)

    def assert_plain_only(self, event):
        self.assertTrue(event.result.chain)
        self.assertTrue(all(isinstance(part, Plain) for part in event.result.chain))
        self.assertFalse(any(isinstance(part, Record) for part in event.result.chain))

    def assert_record(self, event):
        self.assertTrue(any(isinstance(part, Record) for part in event.result.chain))

    async def test_default_text_disables_native_gate_without_audio(self):
        plugin, config, provider = await self.make_plugin()
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        event = FakeEvent()
        await self.deliver(plugin, event)
        self.assert_plain_only(event)
        provider.get_audio.assert_not_awaited()
        self.assertEqual(config.save_count, 0)
        req = types.SimpleNamespace(system_prompt="原有人设")
        await plugin.inject_voice_policy(event, req)
        self.assertTrue(req.system_prompt.startswith("原有人设"))
        self.assertIn("文字", req.system_prompt)

    async def test_stop_persists_and_confirmation_stays_text(self):
        plugin, config, provider = await self.make_plugin("voice", probability=1.0)
        FakeSessionServiceManager.state[OWNER] = True
        event = FakeEvent("不要发语音", result_text="好，之后只发文字。")
        await self.deliver(plugin, event)
        self.assertEqual(config["reply_mode"], "text")
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        self.assertEqual(config.save_count, 1)
        self.assertEqual(config.reload()["reply_mode"], "text")
        self.assert_plain_only(event)
        provider.get_audio.assert_not_awaited()
        req = types.SimpleNamespace(system_prompt="")
        await plugin.inject_voice_policy(event, req)
        self.assertIn("只能发文字", req.system_prompt)
        reloaded, _, _ = await self.make_plugin(config=config.reload())
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        following = FakeEvent()
        await self.deliver(reloaded, following)
        self.assert_plain_only(following)

    async def test_once_is_one_event_and_repeated_hook_does_not_repeat_audio(self):
        plugin, config, provider = await self.make_plugin("text", probability=0.0)
        event = FakeEvent("这次用语音")
        await self.deliver(plugin, event, sample=0.99)
        self.assert_record(event)
        self.assertEqual(config["reply_mode"], "text")
        self.assertEqual(config.save_count, 0)
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        await plugin.whole_reply_voice(event)
        provider.get_audio.assert_awaited_once()
        following = FakeEvent()
        await self.deliver(plugin, following)
        self.assert_plain_only(following)
        provider.get_audio.assert_awaited_once()
        req = types.SimpleNamespace(system_prompt="")
        await plugin.inject_voice_policy(event, req)
        self.assertIn("持久模式没有改变", req.system_prompt)

    async def test_actual_qq_request_becomes_record_with_content_free_control_audit(self):
        plugin, config, provider = await self.make_plugin("text", probability=0.0)
        private_reply = "这是不应进入控制审计的私密回答"
        event = FakeEvent("发个语音", result_text=private_reply)
        with patch.object(PLUGIN.logger, "info") as info:
            await self.deliver(plugin, event, sample=0.99)
        self.assert_record(event)
        provider.get_audio.assert_awaited_once_with(private_reply)
        self.assertEqual(config["reply_mode"], "text")
        self.assertEqual(config.save_count, 0)
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        lines = [call.args[0] for call in info.call_args_list
                 if call.args[0].startswith("[SeedAudioControl] ")]
        self.assertEqual(len(lines), 3)
        records = [json.loads(line.split(" ", 1)[1]) for line in lines]
        self.assertEqual([r["reason"] for r in records],
                         ["command_received", "synthesis_selected", "record_ready"])
        for record in records:
            self.assertEqual(set(record), {"command", "mode", "once", "native_gate",
                                           "provider_loaded", "decision", "reason",
                                           "component_types", "direct_plain_count"})
            self.assertEqual(record["component_types"], ["Plain"])
            self.assertEqual(record["direct_plain_count"], 1)
            self.assertEqual(record["command"], "once")
            self.assertEqual(record["mode"], "text")
            self.assertTrue(record["once"])
            self.assertFalse(record["native_gate"])
            self.assertTrue(record["provider_loaded"])
        audit = "\n".join(lines)
        for excluded in ("发个语音", private_reply, OWNER, OWNER_ID, "/offline/generated.mp3"):
            self.assertNotIn(excluded, audit)
        following = FakeEvent("继续聊天", result_text="下一条仍用文字")
        with patch.object(PLUGIN.logger, "info") as info:
            await self.deliver(plugin, following)
        self.assert_plain_only(following)
        self.assertFalse(any(call.args[0].startswith("[SeedAudioControl] ")
                             for call in info.call_args_list))
        provider.get_audio.assert_awaited_once()

    async def test_control_audit_records_skip_and_failure_without_message_content(self):
        plugin, _, provider = await self.make_plugin("text")
        stop = FakeEvent("别发语音了")
        with patch.object(PLUGIN.logger, "info") as info:
            await self.deliver(plugin, stop)
        records = [json.loads(call.args[0].split(" ", 1)[1]) for call in info.call_args_list
                   if call.args[0].startswith("[SeedAudioControl] ")]
        self.assertEqual(records[-1]["reason"], "stop_or_force_text")
        self.assertEqual(records[-1]["decision"], "text")
        self.assertEqual(records[-1]["command"], "text")
        provider.get_audio.side_effect = RuntimeError("private-error-detail")
        once = FakeEvent("给我发个语音我听听", result_text="不进入审计的正文")
        with patch.object(PLUGIN.logger, "info") as info:
            await self.deliver(plugin, once)
        lines = [call.args[0] for call in info.call_args_list
                 if call.args[0].startswith("[SeedAudioControl] ")]
        records = [json.loads(line.split(" ", 1)[1]) for line in lines]
        self.assertEqual(records[-1]["reason"], "synthesis_failed")
        self.assertEqual(records[-1]["decision"], "text")
        self.assertNotIn("private-error-detail", "\n".join(lines))
        self.assertNotIn("不进入审计的正文", "\n".join(lines))
        self.assert_plain_only(once)

    async def test_voice_persists_and_survives_config_reload(self):
        plugin, config, provider = await self.make_plugin(probability=0.0)
        event = FakeEvent("以后都发语音")
        await self.deliver(plugin, event, sample=0.99)
        self.assertEqual(config["reply_mode"], "voice")
        self.assertTrue(FakeSessionServiceManager.state[OWNER])
        self.assertEqual(config.save_count, 1)
        self.assert_record(event)
        provider.get_audio.assert_awaited_once()
        reloaded, new_config, new_provider = await self.make_plugin(
            probability=0.0, config=config.reload()
        )
        following = FakeEvent()
        await self.deliver(reloaded, following, sample=0.99)
        self.assertEqual(new_config["reply_mode"], "voice")
        self.assert_record(following)
        new_provider.get_audio.assert_awaited_once()

    async def test_auto_probability_and_native_ui_gate(self):
        plugin, config, provider = await self.make_plugin()
        command = FakeEvent("恢复自动")
        await plugin.apply_voice_control(command)
        self.assertEqual(config["reply_mode"], "auto")
        self.assertEqual(config.reload()["reply_mode"], "auto")
        self.assertTrue(FakeSessionServiceManager.state[OWNER])
        for sample, expected in ((0.329, True), (0.33, False), (0.8, False)):
            with self.subTest(sample=sample):
                event = FakeEvent()
                await self.deliver(plugin, event, sample=sample)
                (self.assert_record if expected else self.assert_plain_only)(event)
        self.assertEqual(provider.get_audio.await_count, 1)
        FakeSessionServiceManager.state[OWNER] = False  # Native WebUI switch.
        event = FakeEvent()
        await self.deliver(plugin, event, sample=0.0)
        self.assert_plain_only(event)
        self.assertEqual(provider.get_audio.await_count, 1)
        await plugin.initialize()  # Reload must not reopen the user's native off.
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        FakeSessionServiceManager.state[OWNER] = True
        provider.reply_probability = 0.0
        event = FakeEvent()
        await self.deliver(plugin, event, sample=0.0)
        self.assert_plain_only(event)
        self.assertEqual(provider.get_audio.await_count, 1)

    async def test_wrong_sender_missing_sender_other_platform_and_group_are_rejected(self):
        cases = (
            {"sender": "111"}, {"sender": None}, {"sender_error": True},
            {"umo": "other-qq:FriendMessage:3202619225"},
            {"umo": "dafeiyu-qq:GroupMessage:3202619225"},
            {"umo": "dafeiyu-qq:FriendMessage:111", "sender": "111"},
        )
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                plugin, config, provider = await self.make_plugin()
                event = FakeEvent("以后都发语音", **kwargs)
                await self.deliver(plugin, event)
                self.assertNotIn("reply_mode", config)
                self.assertEqual(config.save_count, 0)
                self.assertIsNone(event.get_extra(plugin._ticket_key))
                self.assert_plain_only(event)
                provider.get_audio.assert_not_awaited()
                req = types.SimpleNamespace(system_prompt="未改的人设")
                await plugin.inject_voice_policy(event, req)
                self.assertEqual(req.system_prompt, "未改的人设")

    async def test_quoted_forwarded_code_history_and_model_text_are_not_commands(self):
        cases = (
            [Reply([Plain("以后都发语音")])],
            [Reply([Plain("以后都发语音")]), Plain("继续聊天")],
            [Forward([Plain("以后都发语音")]), Plain("以后都发语音")],
            [Node([Plain("以后都发语音")]), Plain("以后都发语音")],
            [Record(text="以后都发语音")],
            [Plain("```以后都发语音```")],
            [Plain("以后都发语音？")],
            [Plain("他说以后都发语音")],
            [Plain("“以后都发语音”")],
            [Plain("如果方便，以后都发语音")],
            [Plain("以后都发语音"), Plain("继续聊天")],
            [Plain("继续聊天")],
        )
        for messages in cases:
            with self.subTest(messages=messages):
                plugin, config, provider = await self.make_plugin()
                event = FakeEvent(messages=messages, result_text="以后都发语音")
                event.set_extra("history", "以后都发语音")
                await self.deliver(plugin, event)
                self.assertNotIn("reply_mode", config)
                self.assertEqual(config.save_count, 0)
                self.assertFalse(FakeSessionServiceManager.state[OWNER])
                self.assert_plain_only(event)
                provider.get_audio.assert_not_awaited()

    async def test_capability_question_keeps_text_and_reports_loaded_voice_service(self):
        plugin, config, provider = await self.make_plugin("text")
        event = FakeEvent("你现在可以发语音吗")
        await plugin.apply_voice_control(event)
        self.assertEqual(config["reply_mode"], "text")
        self.assertEqual(config.save_count, 0)
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        self.assertIsNone(event.get_extra(plugin._ticket_key)["command"])
        req = types.SimpleNamespace(system_prompt="原有人设")
        await plugin.inject_voice_policy(event, req)
        self.assertTrue(req.system_prompt.startswith("原有人设"))
        self.assertIn("整条语音提供商已启用并加载，语音功能已配置", req.system_prompt)
        self.assertIn("当前保存的普通回复偏好是文字", req.system_prompt)
        self.assertIn("能力问句本身不切换偏好", req.system_prompt)
        self.assertIn("不能承诺本条正在发送或已发送语音", req.system_prompt)
        self.assertIn("可回答能发、当前默认文字", req.system_prompt)
        self.assertIn("正常配置会关闭原生总开关", req.system_prompt)
        self.assertNotIn("已禁止本次语音", req.system_prompt)
        self.assertNotIn("当前未找到", req.system_prompt)
        rejected = await plugin.set_voice_reply_mode(event, "once")
        self.assertIn("未执行", rejected)
        self.assertIn("只是没有切换偏好", rejected)
        self.assertIn("语音功能已配置", rejected)
        self.assertEqual(config.save_count, 0)
        await plugin.whole_reply_voice(event)
        self.assert_plain_only(event)
        provider.get_audio.assert_not_awaited()

    async def test_once_status_separates_authorization_from_saved_text_and_native_off(self):
        plugin, config, provider = await self.make_plugin("text")
        event = FakeEvent("发条语音")
        await plugin.apply_voice_control(event)
        req = types.SimpleNamespace(system_prompt="")
        await plugin.inject_voice_policy(event, req)
        self.assertIn("语音功能已配置", req.system_prompt)
        self.assertIn("本次单条语音授权已生效", req.system_prompt)
        self.assertIn("可覆盖文字偏好和会话开关", req.system_prompt)
        self.assertNotIn("本条未获单次语音授权", req.system_prompt)
        self.assertNotIn("已禁止本次语音", req.system_prompt)
        self.assertEqual(config["reply_mode"], "text")
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        await plugin.whole_reply_voice(event)
        self.assert_record(event)
        provider.get_audio.assert_awaited_once()

    async def test_unloaded_provider_and_paused_session_have_distinct_status(self):
        plugin, config, provider = await self.make_plugin("voice")
        FakeSessionServiceManager.state[OWNER] = False
        event = FakeEvent("你现在可以发语音吗")
        await plugin.apply_voice_control(event)
        req = types.SimpleNamespace(system_prompt="")
        await plugin.inject_voice_policy(event, req)
        self.assertIn("语音功能已配置", req.system_prompt)
        self.assertIn("这是会话偏好", req.system_prompt)
        self.assertNotIn("当前未找到", req.system_prompt)
        plugin.context.provider = None
        req = types.SimpleNamespace(system_prompt="")
        await plugin.inject_voice_policy(event, req)
        self.assertIn("当前未找到已加载的整条语音提供商", req.system_prompt)
        self.assertNotIn("语音功能已配置", req.system_prompt)
        self.assertEqual(config["reply_mode"], "voice")
        self.assertEqual(config.save_count, 0)
        provider.get_audio.assert_not_awaited()

    async def test_reply_content_is_ignored_while_current_direct_command_controls_voice(self):
        plugin, config, provider = await self.make_plugin("text", probability=0.0)
        event = FakeEvent(messages=[Reply([Plain("以后都发语音")]), Plain("发个语音")])
        with patch.object(PLUGIN.logger, "info") as info:
            await self.deliver(plugin, event, sample=0.99)
        self.assert_record(event)
        self.assertEqual(event.get_extra(plugin._ticket_key)["command"], "once")
        self.assertEqual(config["reply_mode"], "text")
        self.assertEqual(config.save_count, 0)
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        records = [json.loads(call.args[0].split(" ", 1)[1]) for call in info.call_args_list
                   if call.args[0].startswith("[SeedAudioControl] ")]
        self.assertEqual(records[-1]["component_types"], ["Plain", "Reply"])
        self.assertEqual(records[-1]["direct_plain_count"], 1)
        self.assertEqual(records[-1]["command"], "once")
        for messages in (
            [Reply([Plain("发个语音")]), Plain("你现在可以发语音吗")],
            [Reply([Plain("以后都发语音")])],
            [Reply([Plain("以后都发语音")]), Plain("继续聊天")],
        ):
            with self.subTest(messages=messages):
                event = FakeEvent(messages=messages)
                await self.deliver(plugin, event)
                self.assertIsNone(event.get_extra(plugin._ticket_key)["command"])
                self.assert_plain_only(event)
                self.assertEqual(config["reply_mode"], "text")
                self.assertEqual(config.save_count, 0)
        provider.get_audio.assert_awaited_once()
        enabled = FakeEvent(messages=[Reply([Plain("不要发语音")]), Plain("以后都发语音")])
        await self.deliver(plugin, enabled)
        self.assert_record(enabled)
        self.assertEqual(config["reply_mode"], "voice")
        self.assertEqual(config.save_count, 1)
        stopped = FakeEvent(messages=[Reply([Plain("以后都发语音")]), Plain("不要发语音")])
        await self.deliver(plugin, stopped)
        self.assert_plain_only(stopped)
        self.assertEqual(config["reply_mode"], "text")
        self.assertEqual(config.save_count, 2)
        wrong_sender = FakeEvent(sender="111", messages=[Reply([Plain("不要发语音")]), Plain("发个语音")])
        await self.deliver(plugin, wrong_sender)
        self.assertIsNone(wrong_sender.get_extra(plugin._ticket_key))
        self.assert_plain_only(wrong_sender)
        self.assertEqual(config.save_count, 2)

    async def test_native_tool_reuses_direct_authorization_and_event_ticket(self):
        plugin, config, provider = await self.make_plugin()
        event = FakeEvent("以后都发语音")
        self.assertIn("未执行", await plugin.set_voice_reply_mode(event, "voice"))
        self.assertEqual(config.save_count, 0)
        await plugin.apply_voice_control(event)
        result = await plugin.set_voice_reply_mode(event, "voice")
        self.assertIn("已执行并保存", result)
        self.assertEqual(config["reply_mode"], "voice")
        self.assertEqual(config.save_count, 1)
        await plugin.set_voice_reply_mode(event, "voice")
        self.assertEqual(config.save_count, 1)
        for rejected in (
            FakeEvent("你会发语音吗"),
            FakeEvent("语音怎么收费"),
            FakeEvent("以后都发语音", sender="111"),
            FakeEvent(messages=[Reply([Plain("以后都发语音")])]),
            FakeEvent(messages=[Forward([Plain("以后都发语音")]), Plain("以后都发语音")]),
            FakeEvent("以后都发语音", sender=None),
            FakeEvent("以后都发语音", umo="dafeiyu-qq:GroupMessage:3202619225"),
        ):
            self.assertIn("未执行", await plugin.set_voice_reply_mode(rejected, "voice"))
        self.assertIn("未执行", await plugin.set_voice_reply_mode(FakeEvent("只用文字"), "voice"))
        self.assertEqual(config.save_count, 1)
        stop = FakeEvent("只用文字")
        await plugin.apply_voice_control(stop)
        self.assertIn("取消", await plugin.set_voice_reply_mode(event, "voice"))
        self.assertEqual(config["reply_mode"], "text")
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        provider.get_audio.assert_not_awaited()

    async def test_owner_scoped_cron_cannot_authorize_voice_control(self):
        plugin, config, provider = await self.make_plugin()
        for extra_name in ("cron_job", "cron_payload"):
            event = FakeEvent("以后都发语音")
            event.set_extra(extra_name, {"note": "以后都发语音"})
            await plugin.apply_voice_control(event)
            self.assertIsNone(event.get_extra(plugin._ticket_key)["command"])
            self.assertIn("未执行", await plugin.set_voice_reply_mode(event, "voice"))
        event = FakeEvent("以后都发语音")
        event.get_platform_name = lambda: "cron"
        await plugin.apply_voice_control(event)
        self.assertIsNone(event.get_extra(plugin._ticket_key)["command"])
        self.assertIn("未执行", await plugin.set_voice_reply_mode(event, "voice"))
        self.assertEqual(config.save_count, 0)
        self.assertEqual(plugin._mode(), "text")
        self.assertFalse(FakeSessionServiceManager.state[OWNER])
        provider.get_audio.assert_not_awaited()

    async def test_plugin_reload_keeps_compatible_existing_provider(self):
        plugin, config, _ = await self.make_plugin()

        class PreviousModuleProvider(FakeTTSProvider):
            provider_config = {"type": PLUGIN.TYPE_NAME}
            whole_reply = True
            reply_probability = 0.33
            get_audio = AsyncMock(return_value="/offline/old-provider.mp3")

        previous = PreviousModuleProvider()
        self.assertNotIsInstance(previous, PLUGIN.ProviderSeedAudioTTS)
        plugin.context.provider = previous
        event = FakeEvent("发条语音")
        await self.deliver(plugin, event)
        self.assert_record(event)
        previous.get_audio.assert_awaited_once()
        previous.provider_config = {"type": "another_tts"}
        following = FakeEvent("发条语音")
        await self.deliver(plugin, following)
        self.assert_plain_only(following)
        previous.get_audio.assert_awaited_once()

    async def test_explicit_once_and_voice_allow_one_character_but_not_empty(self):
        for command in ("发条语音", "以后都发语音"):
            plugin, _, provider = await self.make_plugin(probability=0.0)
            event = FakeEvent(command, result_text="好")
            await self.deliver(plugin, event)
            self.assert_record(event)
            provider.get_audio.assert_awaited_once_with("好")
        plugin, _, provider = await self.make_plugin("auto", probability=1.0)
        FakeSessionServiceManager.state[OWNER] = True
        event = FakeEvent(result_text="好")
        await self.deliver(plugin, event)
        self.assert_plain_only(event)
        provider.get_audio.assert_not_awaited()
        for text in ("", "！！！"):
            event = FakeEvent("发条语音", result_text=text)
            await self.deliver(plugin, event)
            self.assert_plain_only(event)
            provider.get_audio.assert_not_awaited()

    async def test_stop_then_auto_never_revives_blocked_old_audio(self):
        plugin, config, provider = await self.make_plugin("voice", probability=1.0)
        FakeSessionServiceManager.state[OWNER] = True
        started, release = asyncio.Event(), asyncio.Event()

        async def blocked_audio(text):
            started.set()
            await release.wait()
            return "/offline/old.mp3"

        provider.get_audio.side_effect = blocked_audio
        old = FakeEvent()
        await plugin.apply_voice_control(old)
        pending = asyncio.create_task(plugin.whole_reply_voice(old))
        try:
            await asyncio.wait_for(started.wait(), timeout=1.0)
            # The event was claimed before synthesis: concurrent hooks cannot
            # synthesize a second copy of this same reply.
            await asyncio.wait_for(plugin.whole_reply_voice(old), timeout=1.0)
            self.assertEqual(provider.get_audio.await_count, 1)

            await plugin._control_lock.acquire()
            stop = FakeEvent("不要发语音", result_text="好，关闭语音。")
            revision = plugin._stop_revision
            stopping = asyncio.create_task(plugin.apply_voice_control(stop))
            try:
                await asyncio.sleep(0)
                self.assertEqual(plugin._stop_revision, revision + 1)
                self.assertEqual(config["reply_mode"], "voice")
            finally:
                plugin._control_lock.release()
            await asyncio.wait_for(stopping, timeout=1.0)
            await plugin.whole_reply_voice(stop)
            self.assert_plain_only(stop)
            self.assertFalse(FakeSessionServiceManager.state[OWNER])

            auto = FakeEvent("恢复自动")
            await plugin.apply_voice_control(auto)
            self.assertEqual(config["reply_mode"], "auto")
            self.assertTrue(FakeSessionServiceManager.state[OWNER])
            release.set()
            await asyncio.wait_for(pending, timeout=1.0)
            self.assert_plain_only(old)
            self.assert_plain_only(stop)
            self.assertEqual(provider.get_audio.await_count, 1)
        finally:
            release.set()
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)

    async def test_terminate_suppresses_blocked_old_audio(self):
        plugin, _, provider = await self.make_plugin("voice", probability=1.0)
        FakeSessionServiceManager.state[OWNER] = True
        started, release = asyncio.Event(), asyncio.Event()

        async def blocked_audio(text):
            started.set()
            await release.wait()
            return "/offline/old.mp3"

        provider.get_audio.side_effect = blocked_audio
        event = FakeEvent()
        await plugin.apply_voice_control(event)
        pending = asyncio.create_task(plugin.whole_reply_voice(event))
        try:
            await asyncio.wait_for(started.wait(), timeout=1.0)
            await plugin.terminate()
            release.set()
            await asyncio.wait_for(pending, timeout=1.0)
            self.assert_plain_only(event)
            provider.get_audio.assert_awaited_once()
        finally:
            release.set()
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()

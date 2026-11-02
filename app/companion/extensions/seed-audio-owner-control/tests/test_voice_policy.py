"""Offline regressions for direct commands and voice probability boundaries."""

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "astrbot_plugin_seed_audio_tts"))
from voice_policy import VoiceCommand, parse_voice_command, should_speak


class VoiceCommandTests(unittest.TestCase):
    def test_required_direct_commands(self):
        cases = {
            "不要发语音": "text", "别发语音": "text", "只用文字": "text",
            "这句用语音": "once", "这次用语音": "once",
            "语音回复我": "once", "发条语音": "once", "发语音": "once",
            "以后都用语音": "voice", "以后都发语音": "voice",
            "恢复自动语音": "auto", "可以偶尔发语音": "auto",
            "恢复自动": "auto", "偶尔发语音": "auto",
        }
        for text, kind in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text), VoiceCommand(kind))

    def test_common_explicit_once_requests_include_actual_qq_utterance(self):
        for text in (
            "发个语音", "发一个语音", "给我发个语音", "给我发一个语音",
            "来个语音", "来一个语音", "发段语音", "发一段语音",
            "给我发段语音", "给我发一段语音", "来段语音", "来一段语音",
            "发个语音我听听", "给我发个语音我听听", "发条语音我听听",
            "给我发条语音我听听", "发段语音我听听", "给我发段语音我听听",
            "来个语音我听听", "来段语音我听听", "发个语音听听",
            "给我发个语音听听", "发个语音，我听听", "给我发个语音，我听听",
            "发条语音，我听听", "给我发条语音，我听听",
            "用语音说一句", "给我用语音说一句", "语音说一句", "用语音说一声",
            "请给我发个语音吧", "麻烦你，发段语音，谢谢！",
            "你发个语音", "你给我发个语音", "你发个语音我听听",
            "你发条语音我听听", "你用语音说一句",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text), VoiceCommand("once"))

    def test_new_once_aliases_do_not_match_questions_quotes_or_extra_intents(self):
        for text in (
            "发个语音？", "给我发个语音吗", "能不能发个语音", "可以来个语音吗",
            "你现在可以发语音吗", "为什么不发个语音", "“发个语音”",
            "他说发个语音", "`来段语音`", "转发：给我发个语音我听听",
            "如果方便就发段语音", "明天给我发个语音", "发个语音，然后改签名",
            "用语音说一句，再发个表情包", "给我发个语音我听听是什么意思",
            "不要发个语音", "发个语音识别结果", "发个语音，我听听，顺便唱歌",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_voice_command(text))

    def test_courtesy_and_edge_punctuation(self):
        cases = {
            "  请不要发语音。  ": "text",
            "麻烦你，只用文字，谢谢！": "text",
            "请你这次用语音，谢谢你。": "once",
            "拜托，以后都发语音！": "voice",
            "PLEASE 恢复自动语音。": "auto",
            "\n偶尔发语音\n": "auto",
        }
        for text, kind in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text).kind, kind)

    def test_natural_text_aliases_and_terminal_particles(self):
        for text in (
            "别发语音了", "不要发语音了", "不要语音", "只打字", "用文字就行",
            "别发语音啦", "只用文字吧", "不要发语音啊", "只打字呀",
            "用文字就行哦", "别发语音了吧", "请不要语音了，谢谢。",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text), VoiceCommand("text"))
        for text, kind in (
            ("这次用语音吧", "once"), ("以后都发语音啦", "voice"),
            ("恢复自动语音吧", "auto"),
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text), VoiceCommand(kind))

    def test_allowlisted_stop_reasons_and_polite_stop_requests(self):
        for text in (
            "别发语音了，我现在不方便听", "不要语音，现在不方便听",
            "只用文字，我在外面", "只打字，旁边有人", "用文字就行，不方便听",
            "请别发语音了，因为我现在不方便听，谢谢。",
            "别发语音了。我旁边有人。", "不要发语音；现在旁边有人",
            "能不能别发语音", "能不能别发语音了？", "请能不能只打字？",
            "能不能请你不要语音", "可不可以只用文字", "能否别发语音了",
            "能不能别发语音，我现在不方便听？",
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_command(text), VoiceCommand("text"))

    def test_expanded_grammar_rejects_other_questions_and_extra_intents(self):
        for text in (
            "你会发语音吗", "为什么不发语音", "为什么别发语音了",
            "你能不能别发语音", "能不能发语音", "可不可以恢复自动",
            "能不能以后都发语音？", "能不能别发语音吗还是文字？",
            "能不能别发语音？我现在不方便听", "只打字吗", "不要语音？",
            "别发语音了，我现在不方便听，快点回复", "别发语音，我在外面你来接我",
            "不要语音，因为我在外面，等会打电话", "只打字，顺便讲个故事",
            "别发语音了，我现在不方便听但是可以发一条", "只打字，别问了",
            "我现在不方便听，别发语音", "如果我现在不方便听就别发语音",
            "他说别发语音了，我现在不方便听", "“能不能别发语音了”",
            "别发语音了啦吧", "不要语音啊之后再说", "别发语音了我在外面",
            "只打字，为什么旁边有人", "只打字，不方便听吗",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_voice_command(text))

    def test_quoted_mentions_do_not_change_policy(self):
        for text in (
            '“不要发语音”', '「只用文字」', '"语音回复我"', "'发条语音'",
            "`以后都用语音`", "《恢复自动语音》", "他说：不要发语音",
            "刚才说了不要发语音", "我昨天让你只用文字",
            "不要发语音这句话是什么意思", "举例：这次用语音",
            "转发消息：以后都用语音", "[转发]不要发语音",
            "用户：不要发语音", "助手：恢复自动语音",
            "不要发语音\n发条语音", "[不要发语音]", "（不要发语音）",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_voice_command(text))

    def test_questions_conditions_and_mixed_messages_do_not_match(self):
        for text in (
            "不要发语音？", "只用文字?", "语音回复我好吗", "可以偶尔发语音吗",
            "能不能语音回复我", "为什么不要发语音", "如果方便就发条语音",
            "如果以后都用语音会怎样", "你不想发就不要发语音",
            "等明天恢复自动语音", "不要发语音，不过这句用语音",
            "不要发语音。只用文字", "发条语音，顺便讲个故事",
            "我喜欢你发语音", "你说过会语音回复我", "发语音识别结果",
            "这次别发语音", "请把不要发语音翻译成英文", "", "   ",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_voice_command(text))


class SpeechDecisionTests(unittest.TestCase):
    def test_explicit_mode_precedence(self):
        self.assertFalse(should_speak("text", False, 1.0, 0.0))
        self.assertTrue(should_speak("voice", False, 0.0, 0.9))
        self.assertTrue(should_speak("text", True, 0.0, 0.9))
        self.assertTrue(should_speak("auto", True, 0.0, 0.9))

    def test_auto_probability_zero_and_boundary(self):
        self.assertFalse(should_speak("auto", False, 0.0, 0.0))
        self.assertFalse(should_speak("auto", False, -1.0, 0.0))
        self.assertTrue(should_speak("auto", False, 0.33, 0.329))
        self.assertFalse(should_speak("auto", False, 0.33, 0.33))
        self.assertFalse(should_speak("auto", False, 0.33, 0.8))
        self.assertTrue(should_speak("auto", False, 1.0, 0.999999))
        self.assertTrue(should_speak("auto", False, 2.0, 0.999999))

    def test_invalid_sampling_values_fail_closed(self):
        for chance, sample in (
            (float("nan"), 0.0), (float("inf"), 0.0),
            (0.5, float("nan")), (0.5, float("inf")),
            (0.5, -0.1), (0.5, 1.0), (None, 0.0), (0.5, "bad"),
        ):
            with self.subTest(chance=chance, sample=sample):
                self.assertFalse(should_speak("auto", False, chance, sample))
        self.assertFalse(should_speak("unknown", False, 1.0, 0.0))


if __name__ == "__main__":
    unittest.main()

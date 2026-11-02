#!/usr/bin/env python3
"""Prepare official AstrBot/SnowLuma configuration without starting software.

Only stdin supplies the dedicated model key. No environment or existing app
credential store is consulted. Initialization refuses existing private data.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import string
import sys


BOT_QQ = "872713341"
OWNER_QQ = "3202619225"
PLATFORM_ID = "dafeiyu-qq"
SOURCE_ID = "dafeiyu-deepseek"
PROVIDER_ID = "dafeiyu-chat"
EMBEDDING_ID = "大肥鱼记忆-本机"
EDGE_TTS_ID = "大肥鱼语音-Edge"
DOUBAO_TTS_ID = "大肥鱼语音-豆包"
ASSET_FILES = ("compose.yaml", "deploy.sh", "prepare.py", "README.md")


def private_json(path, value):
    """Create a private JSON file exclusively; never print its contents."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def astrbot_config(api_key, model, onebot_token):
    """Return selected v4.29.3 fields; AstrBot fills remaining official defaults."""
    return {
        "config_version": 5,
        "admins_id": [OWNER_QQ],
        "platform_settings": {
            "enable_id_white_list": True,
            "id_whitelist": [f"{PLATFORM_ID}:FriendMessage:{OWNER_QQ}"],
            "wl_ignore_admin_on_group": False,
            "wl_ignore_admin_on_friend": False,
            "no_permission_reply": False,
            "ignore_bot_self_message": True,
        },
        "platform": [{
            "id": PLATFORM_ID,
            "type": "aiocqhttp",
            "enable": True,
            "ws_reverse_host": "0.0.0.0",
            "ws_reverse_port": 6199,
            "ws_reverse_token": onebot_token,
        }],
        "provider_sources": [{
            "id": SOURCE_ID,
            "provider": "deepseek",
            "type": "openai_chat_completion",
            "provider_type": "chat_completion",
            "enable": True,
            "key": [api_key],
            "api_base": "https://api.deepseek.com/v1",
            "timeout": 120,
            "proxy": "",
            "custom_headers": {},
        }],
        "provider": [{
            "id": PROVIDER_ID,
            "provider_source_id": SOURCE_ID,
            "enable": True,
            "model": model,
        }],
        "provider_settings": {
            "enable": True,
            "provider_pool": [PROVIDER_ID],
            "reachability_check": False,
            "web_search": False,
            "computer_use_runtime": "none",
        },
        # v4.29.3 reads this selector instead of the older default_provider_id.
        "agent_runner": {
            "runner_type": "local",
            "config": {
                "model": {"provider_id": PROVIDER_ID, "fallback_provider_ids": [], "request_max_retries": 5},
                "persona": {"persona_id": "default", "safety_mode": True, "safety_mode_strategy": "system_prompt"},
                "compression": {
                    "max_turns": -1, "trim_turns": 1, "overflow_strategy": "llm_compress",
                    "instruction": "", "keep_recent_ratio": 0.15, "provider_id": "", "fallback_max_tokens": 128000,
                },
                "misc": {"max_steps": 128, "tool_schema_mode": "full", "tool_call_timeout": 120, "sanitize_context_by_modalities": False},
            },
        },
        "dashboard": {"enable": True, "host": "0.0.0.0", "port": 6185},
    }


def snowluma_config(onebot_token, account):
    """Configure only the intended account's official reverse-WS adapter."""
    return {
        "mode": "snapshot",
        "networks": {
            "httpServers": [], "httpClients": [], "wsServers": [],
            "wsClients": [{
                "name": "dafeiyu-astrbot",
                "enabled": True,
                "url": "ws://astrbot:6199/ws",
                "role": "Universal",
                "accessToken": onebot_token,
                "reconnectIntervalMs": 5000,
                "messageFormat": "array",
                "reportSelfMessage": False,
            }] if account else [],
        },
        "statusCommand": {"enabled": False, "swallow": False, "cooldownSeconds": 5, "trigger": "#sl"},
        "historySync": {"enabled": False},
        "notifications": {"channelIds": []},
    }


def literal_credential(value):
    """Accept explicit credential strings without environment interpolation."""
    return (isinstance(value, str) and bool(value) and value == value.strip()
            and "$" not in value and not any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value))


def verify_auxiliary(provider, chat_key):
    """Allow only the selected legacy embedding and TTS configurations."""
    common = {"id", "type", "provider", "provider_type", "enable", "provider_source_id", "timeout"}
    if provider.get("provider_source_id") not in (None, ""):
        raise ValueError("辅助提供商不能引用聊天来源或其它模型来源。")
    if "enable" in provider and not isinstance(provider["enable"], bool):
        raise ValueError("辅助提供商启用状态必须是布尔值。")
    if "timeout" in provider and (type(provider["timeout"]) is not int or provider["timeout"] < 1):
        raise ValueError("辅助提供商超时配置无效。")
    identifier = provider["id"]
    if identifier == EMBEDDING_ID:
        allowed = common | {"embedding_api_key", "embedding_api_base", "embedding_model", "embedding_dimensions", "embedding_dimensions_mode", "proxy", "hint"}
        if set(provider) - allowed or provider.get("type") != "openai_embedding" or provider.get("provider") != "openai" or provider.get("provider_type") != "embedding":
            raise ValueError("本机记忆仅允许指定的原版 OpenAI Embedding 配置。")
        if provider.get("embedding_api_base") not in ("http://ollama:11434/v1", "http://ollama:11434/v1/") or provider.get("embedding_api_key") != "ollama" or provider.get("embedding_model") not in ("bge-m3", "bge-m3:567m-fp16"):
            raise ValueError("本机记忆只能使用私有 Ollama 地址、指定 bge-m3 模型和占位 Key。")
        if type(provider.get("embedding_dimensions")) is not int or provider["embedding_dimensions"] != 1024 or provider.get("embedding_dimensions_mode", "auto") not in ("auto", "always", "never") or provider.get("proxy", "") != "":
            raise ValueError("本机记忆必须使用 1024 维且不能配置额外代理。")
    elif identifier == EDGE_TTS_ID:
        allowed = common | {"edge-tts-voice", "rate", "volume", "pitch"}
        if set(provider) - allowed or provider.get("type") != "edge_tts" or provider.get("provider") != "microsoft" or provider.get("provider_type") != "text_to_speech":
            raise ValueError("Edge 语音仅允许指定的原版微软 TTS 配置，不能附加 Key 或接口。")
        for field in ("edge-tts-voice", "rate", "volume", "pitch"):
            if field in provider and (not isinstance(provider[field], str) or not provider[field] or len(provider[field]) > 200 or any(ord(char) < 32 for char in provider[field])):
                raise ValueError("Edge 语音参数格式无效。")
        for field, pattern in (("rate", r"[+-]\d+%"), ("volume", r"[+-]\d+%"), ("pitch", r"[+-]\d+Hz")):
            if field in provider and not re.fullmatch(pattern, provider[field]):
                raise ValueError("Edge 语速、音量或音高单位无效。")
    elif identifier == DOUBAO_TTS_ID:
        allowed = common | {"api_base", "resource_id", "model", "credentials_file", "app_id", "access_key", "seed_audio_persona", "seed_audio_prompt_template", "seed_audio_reference_speaker", "seed_audio_format", "seed_audio_sample_rate", "seed_audio_max_attempts", "seed_audio_whole_reply", "seed_audio_reply_probability"}
        if set(provider) - allowed or provider.get("type") != "seed_audio_tts" or provider.get("provider") != "volcengine" or provider.get("provider_type") != "text_to_speech":
            raise ValueError("豆包语音仅允许指定的作者包 TTS 配置。")
        if provider.get("api_base") != "https://openspeech.bytedance.com/api/v3/tts/create" or provider.get("resource_id") != "seed-audio-1.0" or provider.get("model") != "seed-audio-1.0" or provider.get("credentials_file") != "":
            raise ValueError("豆包语音接口、资源或凭据文件配置已变化。")
        credentials = (provider.get("app_id"), provider.get("access_key"))
        if not all(literal_credential(value) and value != chat_key for value in credentials):
            raise ValueError("豆包语音需要独立非空凭据，不能引用环境变量或复用聊天 Key。")
        reference_speaker = provider.get("seed_audio_reference_speaker", "")
        if (not isinstance(reference_speaker, str) or len(reference_speaker) > 160
                or reference_speaker != "" and (re.fullmatch(r"ICL_[A-Za-z0-9_]+", reference_speaker) is None or reference_speaker == chat_key)):
            raise ValueError("豆包参考音色必须为空或长度不超过160的字面 ICL 音色 ID，不能引用或复用聊天 Key。")
        for field, maximum in (("seed_audio_persona", 4000), ("seed_audio_prompt_template", 12000)):
            if field in provider and (not isinstance(provider[field], str) or not provider[field].strip() or len(provider[field]) > maximum):
                raise ValueError("豆包语音人设或提示模板格式无效。")
        if "seed_audio_prompt_template" in provider:
            try:
                fields = list(string.Formatter().parse(provider["seed_audio_prompt_template"]))
            except ValueError:
                raise ValueError("豆包语音提示模板占位符无效。") from None
            if not any(name == "text" for _, name, _, _ in fields) or any(name is not None and (name not in ("persona", "text") or spec or conversion) for _, name, spec, conversion in fields):
                raise ValueError("豆包语音提示模板只接受 persona 和 text 占位符，且必须包含 text。")
        if provider.get("seed_audio_format", "mp3") != "mp3":
            raise ValueError("本阶段豆包语音仅允许作者包的 mp3 输出格式。")
        sample_rate = provider.get("seed_audio_sample_rate", 24000)
        attempts = provider.get("seed_audio_max_attempts", 2)
        probability = provider.get("seed_audio_reply_probability", 0.33)
        if type(sample_rate) is not int or not 8000 <= sample_rate <= 48000 or type(attempts) is not int or not 1 <= attempts <= 5 or type(provider.get("seed_audio_whole_reply", True)) is not bool:
            raise ValueError("豆包语音采样率、重试次数或整条回复开关无效。")
        if type(probability) not in (int, float) or not 0 <= probability <= 1 or not math.isfinite(probability):
            raise ValueError("豆包语音触发概率必须是 0 到 1 的有限数值。")
    else:
        raise ValueError("存在未经允许的辅助提供商，不能自动恢复部署。")


def verify_providers(config, metadata, expected_key_sha256):
    """Keep chat and enabled search on the dedicated key, admitting only explicit auxiliaries."""
    runner = config.get("agent_runner", {})
    selection = runner.get("config", {}).get("model", {})
    if runner.get("runner_type") != "local" or selection.get("provider_id") != PROVIDER_ID or selection.get("fallback_provider_ids", []) != []:
        raise ValueError("AstrBot 默认模型或备用模型已变化；请先确认独立模型配置。")
    if config.get("provider_settings", {}).get("provider_pool") != [PROVIDER_ID]:
        raise ValueError("聊天模型池已变化，不能回退到其它模型或凭据。")
    sources = config.get("provider_sources", [])
    if not isinstance(sources, list) or len(sources) != 1 or not isinstance(sources[0], dict) or sources[0].get("id") != SOURCE_ID:
        raise ValueError("独立模型来源配置缺失或已变化。")
    source = sources[0]
    if source.get("type") != "openai_chat_completion" or source.get("provider") != "deepseek" or source.get("provider_type") != "chat_completion" or source.get("enable") is not True or source.get("api_base") not in ("https://api.deepseek.com/v1", "https://api.deepseek.com/v1/") or source.get("proxy", "") != "" or source.get("custom_headers", {}) != {}:
        raise ValueError("独立聊天来源的类型、接口或鉴权覆盖配置已变化。")
    if any(field in source for field in ("api_key", "access_key", "credentials_file", "provider_source_id")):
        raise ValueError("独立聊天来源不能附加其它凭据或来源引用。")
    keys = source.get("key")
    if not isinstance(keys, list) or len(keys) != 1 or not literal_credential(keys[0]):
        raise ValueError("需要独立的非空模型 Key，不能引用环境变量。")
    fingerprint = hashlib.sha256(keys[0].encode("utf-8")).hexdigest()
    if metadata.get("modelKeyFingerprint") != fingerprint or expected_key_sha256 is not None and fingerprint != expected_key_sha256:
        raise ValueError("专用模型 Key 指纹与此部署不匹配；不会覆盖已有配置。")
    search = config.get("provider_settings", {})
    if search.get("web_search") and (search.get("websearch_provider") != "deepseek" or search.get("websearch_deepseek_key") != [keys[0]]):
        raise ValueError("开启搜索时必须显式使用 DeepSeek 和同一份大肥鱼专用 Key，不能回退或附加其它凭据。")
    providers = config.get("provider", [])
    if not isinstance(providers, list) or not providers:
        raise ValueError("独立模型与来源的关联已变化。")
    identifiers = set()
    chat = None
    for provider in providers:
        if not isinstance(provider, dict) or not isinstance(provider.get("id"), str) or provider["id"] in identifiers:
            raise ValueError("提供商格式无效或标识重复。")
        identifiers.add(provider["id"])
        if provider["id"] == PROVIDER_ID:
            chat = provider
        else:
            verify_auxiliary(provider, keys[0])
    if not chat or chat.get("provider_source_id") != SOURCE_ID or chat.get("enable") is not True or chat.get("model") != metadata.get("model"):
        raise ValueError("独立模型与来源的关联已变化。")
    if any(field in chat for field in ("key", "api_key", "access_key", "credentials_file", "custom_headers", "api_base", "proxy")):
        raise ValueError("聊天模型不能覆盖独立来源的凭据、接口或代理。")
    for field in ("type", "provider", "provider_type"):
        if field in chat and chat[field] != source[field]:
            raise ValueError("聊天模型不能改写独立来源的提供商类型。")


def verify(directory, identity_only=False, expected_key_sha256=None):
    """Inspect expected identities and selectors without exposing credentials."""
    with (directory / "deployment.json").open(encoding="utf-8") as handle:
        metadata = json.load(handle)
    if metadata.get("project") != "aipm-dafeiyu" or metadata.get("botQQ") != BOT_QQ or metadata.get("ownerQQ") != OWNER_QQ:
        raise ValueError("部署身份不匹配；不会操作未知现有实例。")
    if identity_only:
        return
    with (directory / "private/astrbot-data/cmd_config.json").open(encoding="utf-8-sig") as handle:
        config = json.load(handle)
    settings = config["platform_settings"]
    if settings.get("id_whitelist") != [f"{PLATFORM_ID}:FriendMessage:{OWNER_QQ}"] or settings.get("enable_id_white_list") is not True or config.get("admins_id") != [OWNER_QQ] or settings.get("no_permission_reply") is not False:
        raise ValueError("AstrBot 私聊白名单已变化；请先在原版后台确认访问范围。")
    if settings.get("wl_ignore_admin_on_group") or settings.get("wl_ignore_admin_on_friend"):
        raise ValueError("管理员白名单绕过已开启；请先在原版后台关闭。")
    verify_providers(config, metadata, expected_key_sha256)
    with (directory / "private/snowluma-data/config/onebot.json").open(encoding="utf-8") as handle:
        global_onebot = json.load(handle)
    if any(global_onebot.get("networks", {}).get(kind) for kind in ("httpServers", "httpClients", "wsServers", "wsClients")):
        raise ValueError("SnowLuma 全局网络配置已变化；请确认只连接指定 QQ 账号。")
    with (directory / f"private/snowluma-data/config/onebot_{BOT_QQ}.json").open(encoding="utf-8") as handle:
        onebot = json.load(handle)
    networks = onebot.get("networks", {})
    clients = networks.get("wsClients", [])
    if any(networks.get(kind) for kind in ("httpServers", "httpClients", "wsServers")) or len(clients) != 1:
        raise ValueError("指定 QQ 账号的独立反向 WS 配置已变化。")
    if clients[0].get("url") != "ws://astrbot:6199/ws" or clients[0].get("accessToken") != config["platform"][0].get("ws_reverse_token"):
        raise ValueError("反向 WS 地址或内部鉴权配置不匹配。")
    if onebot.get("statusCommand", {}).get("enabled") or global_onebot.get("statusCommand", {}).get("enabled"):
        raise ValueError("SnowLuma 自带状态指令已开启；请先确认回复范围。")


def prepare(directory, model, payload):
    """Create a dedicated deployment from explicit, already validated input."""
    if not isinstance(payload, dict) or set(payload) != {"deepseekApiKey"}:
        raise ValueError("标准输入必须是仅含 deepseekApiKey 字符串的 JSON 对象。")
    api_key = payload["deepseekApiKey"]
    if not literal_credential(api_key):
        raise ValueError("需要非空、无空白的大肥鱼专用 Key；不接受环境变量引用。")
    if not model or len(model) > 120 or any(c.isspace() for c in model):
        raise ValueError("必须显式指定模型 ID。")
    if not directory.is_absolute() or directory.is_symlink():
        raise ValueError("部署目录必须是绝对路径且不能是符号链接。")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any((directory / name).exists() for name in ("private", "deployment.json")):
        raise ValueError("部署目录已有私有数据；初始化不会覆盖它。")
    asset_directory = Path(__file__).resolve().parent
    for name in ASSET_FILES:
        destination = directory / name
        source = asset_directory / name
        if destination.is_symlink():
            raise ValueError("部署资产不能是符号链接。")
        if destination.exists() and destination.resolve() != source.resolve() and destination.read_bytes() != source.read_bytes():
            raise ValueError("部署目录已有不同版本资产；初始化不会覆盖它。")
    os.chmod(directory, 0o700)
    for name in ASSET_FILES:
        source, destination = asset_directory / name, directory / name
        if source.resolve() != destination.resolve():
            shutil.copyfile(source, destination)
        os.chmod(destination, 0o700 if name.endswith(".sh") else 0o600)
    private = directory / "private"
    private.mkdir(mode=0o700)
    for name in ("astrbot-data", "snowluma-data", "qq-client-config", "qq-client-data"):
        (private / name).mkdir(mode=0o700)
    config_dir = private / "snowluma-data/config"
    config_dir.mkdir(mode=0o700)
    token = secrets.token_urlsafe(32)
    private_json(private / "astrbot-data/cmd_config.json", astrbot_config(api_key, model, token))
    private_json(config_dir / "onebot.json", snowluma_config(token, False))
    private_json(config_dir / f"onebot_{BOT_QQ}.json", snowluma_config(token, True))
    private_json(config_dir / "runtime.json", {"webuiHost": "0.0.0.0", "webuiPort": 5099, "hookAutoLoad": True})
    private_json(directory / "deployment.json", {
        "project": "aipm-dafeiyu", "astrbotVersion": "v4.29.3", "snowlumaVersion": "v2.2.0",
        "botQQ": BOT_QQ, "ownerQQ": OWNER_QQ, "model": model,
        "modelKeyFingerprint": hashlib.sha256(api_key.encode("utf-8")).hexdigest(),
        "remotePorts": {"astrbot": 6185, "snowluma": 5099, "novnc": 6081},
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--model")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--identity-only", action="store_true")
    parser.add_argument("--expected-key-sha256")
    args = parser.parse_args()
    try:
        if args.verify:
            verify(args.directory, identity_only=args.identity_only, expected_key_sha256=args.expected_key_sha256)
        else:
            if not args.model:
                raise ValueError("初始化必须指定 --model。")
            raw = sys.stdin.read(65537)
            if len(raw) > 65536:
                raise ValueError("标准输入过大。")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                raise ValueError("标准输入不是有效 JSON；不会输出其中内容。") from None
            prepare(args.directory, args.model, payload)
            verify(args.directory)
        print(json.dumps({"ok": True, "directory": str(args.directory), "botQQ": BOT_QQ, "ownerQQ": OWNER_QQ}, ensure_ascii=False))
    except ValueError as error:
        # Validation errors use fixed messages and never include stdin values.
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except (OSError, KeyError, TypeError, IndexError, AttributeError):
        print(json.dumps({"ok": False, "error": "部署文件无法读取或写入。请检查目录权限、配置文件格式，以及是否已有独立配置。"}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

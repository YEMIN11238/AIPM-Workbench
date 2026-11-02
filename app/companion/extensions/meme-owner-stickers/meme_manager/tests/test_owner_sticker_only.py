"""Offline tests of the real collection manager with external boundaries replaced.

Run with a Python that has Pillow: python -m unittest discover -s tests -p
 test_owner_sticker_only.py -v. No AstrBot server, network, or user files are used.
"""

import asyncio
import importlib.util
import json
import re
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from PIL import Image as PillowImage

PLUGIN_DIR = Path(__file__).resolve().parents[1]
OWNER_UMO = "dafeiyu-qq:FriendMessage:3202619225"


class BoundaryImage:
    """Image attachment whose download is observable and never uses a network."""

    def __init__(self, path=None, *, remote=False):
        self.file = str(path) if path else "https://invalid.example/private-image.png"
        self.url = self.file if remote else ""
        self.path = path
        self.downloads = 0

    async def convert_to_file_path(self):
        self.downloads += 1
        if self.path is None:
            raise AssertionError("Excluded images must not be downloaded")
        return str(self.path)


def module(name, **attrs):
    value = types.ModuleType(name)
    value.__dict__.update(attrs)
    return value


def load_manager():
    """Load the unchanged real manager methods, replacing only host interfaces."""
    prefix = "_meme_owner_sticker_tests"
    dependencies = {
        prefix: module(prefix, __path__=[str(PLUGIN_DIR)]),
        f"{prefix}.backend": module(f"{prefix}.backend", __path__=[str(PLUGIN_DIR / "backend")]),
        "astrbot": module("astrbot", __path__=[]),
        "astrbot.api": module("astrbot.api", logger=Mock()),
        "astrbot.core": module("astrbot.core", __path__=[]),
        "astrbot.core.message": module("astrbot.core.message", __path__=[]),
        "astrbot.core.message.components": module("astrbot.core.message.components", Image=BoundaryImage),
        f"{prefix}.config": module(f"{prefix}.config", PACKS_DIR=Path('/__unit_test_only__'), PLUGIN_DATA_DIR=Path('/__unit_test_only__'), TEMP_DIR=Path('/__unit_test_only__')),
        f"{prefix}.utils": module(f"{prefix}.utils", probability_hit=lambda probability: probability == 100),
        f"{prefix}.backend.packs.categories": module(f"{prefix}.backend.packs.categories", is_safe_category_name=lambda name: bool(re.fullmatch(r'[A-Za-z0-9_-]+', name))),
        f"{prefix}.backend.packs.protocol": module(f"{prefix}.backend.packs.protocol", validate_pack_id=lambda value, _label: value),
        f"{prefix}.backend.packs.resolver": module(f"{prefix}.backend.packs.resolver", get_pack_paths=lambda pack: {"memes_dir": auto_collect.PACKS_DIR / pack / "memes"}, load_pack_category_mapping=lambda _pack: {"happy": "庆祝或开心", "sad": "伤心或安慰"}),
        f"{prefix}.backend.semantic.caption": module(f"{prefix}.backend.semantic.caption", CAPTION_ANALYSIS_PROMPT='', _structured_output_is_unsupported=lambda _error: False, prepare_visual_inputs=lambda path: ([str(path)], [])),
        f"{prefix}.backend.semantic.models": module(f"{prefix}.backend.semantic.models", PROMPT_VERSION='test', REVIEW_CATEGORY='needs_review'),
        f"{prefix}.backend.semantic.storage": module(f"{prefix}.backend.semantic.storage", save_collected_image_semantic=Mock()),
    }
    with patch.dict(sys.modules, dependencies):
        for filename in ('auto_collect_index', 'auto_collect'):
            name = f"{prefix}.backend.{filename}"
            spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / 'backend' / f'{filename}.py')
            loaded = importlib.util.module_from_spec(spec)
            sys.modules[name] = loaded
            spec.loader.exec_module(loaded)
        return loaded


auto_collect = load_manager()


class Event:
    def __init__(self, images, raw_data=None, *, sender='3202619225', group=None, raw=None):
        self.sender = sender
        self.group = group
        self.unified_msg_origin = (f'dafeiyu-qq:GroupMessage:{group}' if group else f'dafeiyu-qq:FriendMessage:{sender}')
        self.message_obj = SimpleNamespace(message=images, message_id='test-message')
        if raw is not None:
            self.message_obj.raw_message = raw
        elif raw_data is not None:
            self.message_obj.raw_message = {'message': [{'type': 'image', 'data': item} for item in raw_data]}

    def is_private_chat(self):
        return self.group is None

    def get_sender_id(self):
        return self.sender

    def get_group_id(self):
        return self.group or ''

    def get_session_id(self):
        return self.group or self.sender


class OwnerStickerOnlyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, relative in {
            'PACKS_DIR': 'packs', 'AUTO_COLLECT_INBOX_DIR': 'inbox',
            'AUTO_COLLECT_INBOX_IMAGES_DIR': 'inbox/images',
            'AUTO_COLLECT_INBOX_METADATA_PATH': 'inbox/metadata.json',
            'AUTO_COLLECT_STATE_PATH': 'state.json', 'AUTO_COLLECT_TEMP_DIR': 'queue',
        }.items():
            self.stack.enter_context(patch.object(auto_collect, name, self.root / relative))
        (self.root / 'packs/private-owner/memes').mkdir(parents=True)
        self.decision = {'is_meme': True, 'meme_confidence': 0.99, 'category': 'happy', 'category_confidence': 0.99, 'caption': 'Celebrating', 'tags': ['happy'], 'visible_text': 'Yay'}
        self.vision = AsyncMock(side_effect=lambda **_request: SimpleNamespace(completion_text=json.dumps(self.decision)))
        provider = SimpleNamespace(provider_config={'modalities': ['image']})
        context = SimpleNamespace(get_provider_by_id=lambda _id: provider, llm_generate=self.vision)
        self.host = SimpleNamespace(context=context, semantic_enabled=False)
        self.manager = auto_collect.AutoCollectManager(self.host, {
            'enabled': True, 'only_platform_stickers': True, 'vision_provider_id': 'vision',
            'scope': [OWNER_UMO], 'target_pack_id': 'private-owner',
            'cooldown_seconds': 0, 'manual_review': True, 'sampling_probability': 100,
            'max_images_per_message': 10,
        })
        self.source = self.root / 'synthetic.png'
        PillowImage.new('RGB', (16, 16), 'blue').save(self.source)
        self.logger = Mock()
        self.stack.enter_context(patch.object(auto_collect, 'logger', self.logger))

    async def asyncSetUp(self):
        await self.manager.start()

    async def asyncTearDown(self):
        await self.manager.close()

    def assert_no_collection_effects(self, image):
        self.assertEqual(image.downloads, 0)
        self.vision.assert_not_awaited()
        self.assertEqual(self.manager.queue.qsize(), 0)
        self.assertEqual(self.manager._snapshot_tasks, set())
        self.assertNotIn('observations', self.manager._state)
        self.assertFalse((self.root / 'queue').exists())
        self.assertFalse((self.root / 'inbox').exists())
        self.assertFalse((self.root / 'state.json').exists())

    async def test_ordinary_photo_and_screenshot_repeat_eight_times_never_download(self):
        for name in ('photo.jpg', 'screenshot.png'):
            image = BoundaryImage()
            image.file = f'https://invalid.example/{name}'
            event = Event([image], [{'sub_type': 0, 'summary': '[图片]'}])
            for count in range(8):
                event.message_obj.message_id = f'{name}-{count}'
                self.assertFalse(await self.manager.submit(event))
            self.assert_no_collection_effects(image)
        self.assertEqual(self.manager.counters['unmarked_image'], 16)

    async def test_missing_unknown_or_mismatched_metadata_never_downloads(self):
        raw_cases = [None, {'message': []}, {'message': [{'type': 'image', 'data': {'sub_type': 1}}, {'type': 'image', 'data': {'sub_type': 1}}]}, {'message': [{'type': 'image', 'data': 'invalid'}]}, {'message': 'invalid'}, ['invalid']]
        for raw in raw_cases:
            image = BoundaryImage()
            event = Event([image], raw=raw)
            self.assertFalse(await self.manager.submit(event))
            self.assert_no_collection_effects(image)

    async def test_unmarked_gif_and_extension_do_not_authorize_collection(self):
        image = BoundaryImage()
        image.file = 'https://invalid.example/real-sticker.gif'
        self.assertFalse(await self.manager.submit(Event([image], [{}])))
        self.assert_no_collection_effects(image)

    async def test_other_sender_and_owner_in_group_are_rejected_before_download(self):
        for changes in ({'sender': '9999'}, {'group': '7777'}):
            image = BoundaryImage()
            self.assertFalse(await self.manager.submit(Event([image], [{'sub_type': 1}], **changes)))
            self.assert_no_collection_effects(image)
        self.assertEqual(self.manager.counters['scope'], 2)

    async def test_reply_nested_image_is_never_collected(self):
        image = BoundaryImage()
        reply = SimpleNamespace(chain=[image])
        self.assertFalse(await self.manager.submit(Event([reply], [{'sub_type': 1}])))
        self.assert_no_collection_effects(image)

    async def test_marked_owner_sticker_runs_original_snapshot_worker_and_classifier(self):
        image = BoundaryImage(self.source)
        self.assertTrue(await self.manager.submit(Event([image], [{'sub_type': 1}])))
        await asyncio.wait_for(self.manager.queue.join(), 5)
        self.assertEqual(image.downloads, 1)
        self.vision.assert_awaited_once()
        request = self.vision.await_args.kwargs
        self.assertEqual(request['chat_provider_id'], 'vision')
        self.assertTrue(request['image_urls'])
        metadata = json.loads((self.root / 'inbox/metadata.json').read_text())
        self.assertEqual(len(metadata['items']), 1)
        record = next(iter(metadata['items'].values()))
        self.assertEqual(record['target_pack_id'], 'private-owner')
        self.assertEqual(record['suggested_category'], 'happy')
        self.assertEqual(self.manager.counters['collected'], 1)
        self.assertNotIn('observations', self.manager._state)
        self.assertEqual(list((self.root / 'queue').iterdir()), [])

    async def test_marked_photo_rejected_by_existing_visual_classifier_is_not_saved(self):
        self.decision.update(is_meme=False, meme_confidence=0.0, category='')
        image = BoundaryImage(self.source)
        self.assertTrue(await self.manager.submit(Event([image], [{'sub_type': 1}])))
        await asyncio.wait_for(self.manager.queue.join(), 5)
        self.vision.assert_awaited_once()
        self.assertEqual(self.manager.counters['model_rejected'], 1)
        self.assertFalse((self.root / 'inbox').exists())
        self.assertEqual(list((self.root / 'queue').iterdir()), [])

    async def test_mixed_message_only_downloads_marked_image(self):
        ordinary = BoundaryImage()
        marked = BoundaryImage(self.source)
        event = Event([ordinary, marked], [{'sub_type': 0}, {'emoji_id': 'example-sticker'}])
        self.assertTrue(await self.manager.submit(event))
        await asyncio.wait_for(self.manager.queue.join(), 5)
        self.assertEqual(ordinary.downloads, 0)
        self.assertEqual(marked.downloads, 1)
        self.vision.assert_awaited_once()
        self.assertEqual(self.manager.counters['unmarked_image'], 1)

    async def test_all_existing_explicit_marker_forms_reach_snapshot(self):
        cases = [{'sub_type': '1'}, {'emoji_id': '123'}, {'emoji_package_id': '456'}, {'summary': '动画表情'}, {'summary': '[动画表情]'}, {'summary': '[表情]'}]
        for data in cases:
            image = BoundaryImage(self.source)
            with patch.object(self.manager, '_snapshot_message_images', AsyncMock(return_value=True)) as snapshot:
                self.assertTrue(await self.manager.submit(Event([image], [data])))
                self.assertEqual(snapshot.await_args.args[0], [(image, True)])

    async def test_default_false_preserves_upstream_progressive_observation(self):
        self.manager.only_platform_stickers = False
        image = BoundaryImage(self.source)
        self.assertFalse(await self.manager.submit(Event([image], [{'sub_type': 0}])))
        self.assertEqual(image.downloads, 1)
        self.assertEqual(self.manager.counters['first_observation'], 1)
        self.assertTrue(self.manager._state['observations'])
        self.vision.assert_not_awaited()

    async def test_strict_skip_audit_has_only_count_and_fixed_reason(self):
        image = BoundaryImage()
        self.assertFalse(await self.manager.submit(Event([image], [{}])))
        call = self.logger.info.call_args
        self.assertEqual(call.args[1:], (1,))
        text = str(call)
        for forbidden in ('3202619225', 'invalid.example', 'private-image', 'http', 'snapshot'):
            self.assertNotIn(forbidden, text)

    def test_schema_exposes_opt_in_setting_and_preserves_upstream_default(self):
        schema = json.loads((PLUGIN_DIR / '_conf_schema.json').read_text())
        setting = schema['auto_collect']['items']['only_platform_stickers']
        self.assertEqual(setting['type'], 'bool')
        self.assertIs(setting['default'], False)
        self.assertIn('下载', setting['hint'])

    def test_settings_center_other_edits_preserve_strict_filter_and_scope(self):
        spec = importlib.util.spec_from_file_location(
            '_meme_owner_settings_tests', PLUGIN_DIR / 'backend/plugin_settings.py'
        )
        settings = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(settings)
        schema = json.loads((PLUGIN_DIR / '_conf_schema.json').read_text())
        values = {'auto_collect': {
            'only_platform_stickers': True, 'scope': [OWNER_UMO],
            'cooldown_seconds': 20,
        }}
        path = self.root / 'plugin-config.json'
        path.write_text(json.dumps(values))
        snapshot, original = settings.describe_settings(
            SimpleNamespace(config_path=path, schema=schema)
        )
        self.assertTrue(next(
            field['value'] for field in snapshot['fields']
            if field['path'] == 'auto_collect.only_platform_stickers'
        ))
        updated = settings.validate_settings_changes(
            original, snapshot['fields'], {'auto_collect.cooldown_seconds': 30}, schema
        )
        self.assertIs(updated['auto_collect']['only_platform_stickers'], True)
        self.assertEqual(updated['auto_collect']['scope'], [OWNER_UMO])
        self.assertEqual(updated['auto_collect']['cooldown_seconds'], 30)


if __name__ == '__main__':
    unittest.main()

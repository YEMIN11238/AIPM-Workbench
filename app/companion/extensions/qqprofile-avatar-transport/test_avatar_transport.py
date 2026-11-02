"""Focused tests of the plugin's real avatar methods with a fake OneBot boundary."""
import ast
import asyncio
import base64
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

SOURCE = Path(__file__).parent / 'astrbot_plugin_qqprofile' / 'main.py'

class Image:
    def __init__(self, payload=b'avatar bytes'):
        self.payload = payload
        self.convert_to_base64 = AsyncMock(return_value=base64.b64encode(payload).decode())

    @staticmethod
    def fromFileSystem(path):
        return Image(Path(path).read_bytes())

class Reply:
    def __init__(self, chain): self.chain = chain

# Compile the production class (including actual method bodies); only replace
# framework imports/decorators, which are separately checked on the server.
tree = ast.parse(SOURCE.read_text())
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
cls.bases = []
for node in cls.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        node.decorator_list = []
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), cls], type_ignores=[])
namespace = dict(asyncio=asyncio, base64=base64, Comp=types.SimpleNamespace(Image=Image, Reply=Reply), logger=Mock(), get_nickname=AsyncMock(return_value='old'))
exec(compile(ast.fix_missing_locations(module), str(SOURCE), 'exec'), namespace)
Plugin = namespace['QQProfilePlugin']

class AvatarTransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.plugin = Plugin.__new__(Plugin)
        self.plugin.avatar_dir = Path(self.temp.name)
        self.plugin.get_curr_persona_id = AsyncMock(return_value='大肥鱼')
        self.event = types.SimpleNamespace(
            is_admin=Mock(return_value=True),
            get_messages=Mock(return_value=[]),
            plain_result=lambda text: text,
            bot=types.SimpleNamespace(set_qq_avatar=AsyncMock(return_value=None), set_qq_profile=AsyncMock()),
        )

    async def run_avatar(self):
        return await self.plugin.set_avatar(self.event)

    async def test_direct_image_transfers_bytes_and_caches_same_bytes(self):
        image = Image(b'original QQ upload')
        self.event.get_messages.return_value = [image]
        result = await self.run_avatar()
        self.event.bot.set_qq_avatar.assert_awaited_once_with(file='base64://' + base64.b64encode(image.payload).decode())
        self.assertEqual((self.plugin.avatar_dir / '大肥鱼.jpg').read_bytes(), image.payload)
        self.assertIn('QQ 网关已接受', result)
        image.convert_to_base64.assert_awaited_once()

    async def test_quoted_image(self):
        image = Image()
        self.event.get_messages.return_value = [Reply([object(), image])]
        self.assertIn('QQ 网关已接受', await self.run_avatar())
        self.event.bot.set_qq_avatar.assert_awaited_once()

    async def test_current_image_takes_precedence_over_quote(self):
        quoted, current = Image(b'old'), Image(b'new')
        self.event.get_messages.return_value = [Reply([quoted]), current]
        await self.run_avatar()
        current.convert_to_base64.assert_awaited_once()
        quoted.convert_to_base64.assert_not_awaited()

    async def test_no_image_does_not_call_gateway(self):
        self.event.get_messages.return_value = [object(), Reply([])]
        self.assertIn('未执行换头像：当前消息没有附图', await self.run_avatar())
        self.event.bot.set_qq_avatar.assert_not_awaited()

    async def test_non_admin_cannot_change_avatar(self):
        image = Image()
        self.event.is_admin.return_value = False
        self.event.get_messages.return_value = [image]
        self.assertIn('仅管理员', await self.run_avatar())
        self.event.bot.set_qq_avatar.assert_not_awaited()
        image.convert_to_base64.assert_not_awaited()

    async def test_gateway_failure_does_not_claim_success_or_save_avatar(self):
        self.event.get_messages.return_value = [Image()]
        self.event.bot.set_qq_avatar.side_effect = RuntimeError('QQ rejected avatar')
        result = await self.run_avatar()
        self.assertIn('换头像失败', result)
        self.assertNotIn('已接受', result)
        self.assertFalse(list(self.plugin.avatar_dir.iterdir()))

    async def test_resolution_failure_does_not_call_gateway(self):
        image = Image()
        image.convert_to_base64.side_effect = FileNotFoundError('missing')
        self.event.get_messages.return_value = [image]
        self.assertIn('读取失败', await self.run_avatar())
        self.event.bot.set_qq_avatar.assert_not_awaited()

    async def test_command_returns_same_explicit_outcome(self):
        self.assertIn('未执行换头像', [r async for r in self.plugin.set_avatar_command(self.event)][0])
        self.event.get_messages.return_value = [Image()]
        self.assertIn('QQ 网关已接受', [r async for r in self.plugin.set_avatar_command(self.event)][0])

    async def test_cache_failure_does_not_hide_gateway_acceptance(self):
        self.event.get_messages.return_value = [Image()]
        self.plugin.get_curr_persona_id.side_effect = RuntimeError('cache context failure')
        self.assertIn('QQ 网关已接受', await self.run_avatar())
        self.event.bot.set_qq_avatar.assert_awaited_once()

    async def test_cached_avatar_sync_also_uses_inline_bytes(self):
        payload = b'cached avatar'
        (self.plugin.avatar_dir / '大肥鱼.jpg').write_bytes(payload)
        self.plugin.curr_nickname = 'old'
        await self.plugin.sync_nickname_and_avatar(self.event, '大肥鱼')
        self.event.bot.set_qq_profile.assert_awaited_once_with(nickname='大肥鱼')
        self.event.bot.set_qq_avatar.assert_awaited_once_with(file='base64://' + base64.b64encode(payload).decode())

if __name__ == '__main__': unittest.main()

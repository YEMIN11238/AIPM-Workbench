"""Regression tests for generated-file transactions, using a deterministic model boundary."""
import importlib.util
from pathlib import Path
import json
import pytest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('desktop_product_bridge', ROOT / 'blueprint-product-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


@pytest.fixture
def product(tmp_path, monkeypatch):
    import sys
    monkeypatch.syspath_prepend(str(ROOT / 'integrations/agent-blueprint'))
    from blueprint.workspace import init_workspace
    ws = init_workspace(tmp_path, '测试产品', '学生输入一段笔记，得到复习要点。')
    (ws / 'plan.json').write_text(json.dumps({'components': []}))
    (ws / '方案.md').write_text('# 产品方案')
    (ws / 'skeleton/agent.py').write_text('# 用户手改\nprint("old")\n')
    return ws


class Runner:
    def __init__(self, ws, transform=lambda data: data):
        self.ws, self.transform = ws, transform

    def complete(self, *_):
        data = {'files': [{'path': 'agent.py', 'content': '# 用户手改\nprint("new")\n'},
                          {'path': 'README.md', 'content': '# 待验证'},
                          {'path': 'requirements.txt', 'content': 'anthropic\n'},
                          {'path': '.env.example', 'content': 'ANTHROPIC_API_KEY=\n'}],
                'prd': (self.ws / 'PRD.md').read_text(), 'summary': '已更新入口，等待人工验证。'}
        return self.transform(data)


def test_incremental_update_backs_up_original_user_files_and_keeps_other_files(product, tmp_path):
    (product / 'skeleton/user-notes.txt').write_text('用户自己的文件')
    result = bridge.build({}, Runner(product), ROOT / 'integrations/agent-blueprint', product, tmp_path)
    assert 'agent.py' in result['files']
    assert (product / '.build-history' / result['backup'] / 'skeleton/agent.py').read_text() == '# 用户手改\nprint("old")\n'
    assert (product / 'skeleton/user-notes.txt').read_text() == '用户自己的文件'
    assert '人工验证结论：（待填）' in (product / '迭代记录.md').read_text()


@pytest.mark.parametrize('path', ['../escape.py', '/tmp/escape.py', '.env', 'x/../../escape.py'])
def test_model_cannot_write_outside_skeleton_or_save_credentials(product, tmp_path, path):
    def bad(data):
        data['files'][0]['path'] = path
        return data
    with pytest.raises(ValueError):
        bridge.build({}, Runner(product, bad), ROOT / 'integrations/agent-blueprint', product, tmp_path)
    assert (product / 'skeleton/agent.py').read_text() == '# 用户手改\nprint("old")\n'


def test_intervening_external_edit_is_never_overwritten(product, tmp_path):
    def external(data):
        (product / 'skeleton/agent.py').write_text('# 用户正在改\n')
        return data
    with pytest.raises(ValueError, match='本地文件已被修改'):
        bridge.build({}, Runner(product, external), ROOT / 'integrations/agent-blueprint', product, tmp_path)
    assert (product / 'skeleton/agent.py').read_text() == '# 用户正在改\n'


def test_syntax_error_and_changed_prd_version_do_not_publish_files(product, tmp_path):
    def invalid(data):
        data['files'][0]['content'] = 'def broken(:'
        return data
    with pytest.raises(SyntaxError):
        bridge.build({}, Runner(product, invalid), ROOT / 'integrations/agent-blueprint', product, tmp_path)
    assert (product / 'skeleton/agent.py').read_text() == '# 用户手改\nprint("old")\n'
    def bumped(data):
        data['prd'] = data['prd'].replace('| V1 |', '| V2 |')
        return data
    with pytest.raises(ValueError, match='版本号'):
        bridge.build({}, Runner(product, bumped), ROOT / 'integrations/agent-blueprint', product, tmp_path)

"""Product-loop adapter. Upstream stays byte-identical; desktop additions live here."""
from __future__ import annotations
import builtins
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import sys
import threading
import uuid

WIRE = sys.stdout
INPUT = sys.stdin
SECRETS = []
LOCK = threading.RLock()


def clean(text):
    for secret in SECRETS:
        text = text.replace(secret, '[已隐藏]')
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)


def emit(kind, **fields):
    with LOCK:
        WIRE.write(json.dumps({'type': kind, **fields}, ensure_ascii=False) + '\n')
        WIRE.flush()


class Console(io.TextIOBase):
    def __init__(self, out):
        self.out = out

    def write(self, text):
        if text:
            text = clean(text)
            with LOCK:
                with (self.out / '运行记录.txt').open('a', encoding='utf-8') as handle:
                    handle.write(text)
            emit('console', text=text[:6000])
        return len(text)

    def flush(self):
        pass


def read_input(prompt=''):
    emit('waiting', prompt=clean(str(prompt)) or '请输入消息（q 结束）')
    line = INPUT.readline()
    if not line:
        raise EOFError()
    return json.loads(line)['text']


class DesktopInput(io.TextIOBase):
    """Keep select-based upstream CLI wakeups while translating desktop replies."""
    def __init__(self):
        self.waiting = False

    def fileno(self):
        return INPUT.fileno()

    def readable(self):
        return True

    def readline(self, *args):
        self.ensure_waiting()
        line = INPUT.readline()
        self.waiting = False
        return json.loads(line)['text'] + '\n' if line else ''

    def ensure_waiting(self):
        if not self.waiting:
            self.waiting = True
            emit('waiting', prompt='请输入消息（q 结束）')


def safe_file(base, name):
    if not isinstance(name, str) or not name or '\\' in name or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/')):
        raise ValueError('生成文件路径无效')
    if any(p.startswith('.') for p in name.split('/')) and name not in ('.env.example', '.gitignore'):
        raise ValueError('模型不能写隐藏文件或密钥')
    path = base / name
    cursor = path
    while cursor != base:
        if cursor.is_symlink():
            raise ValueError('生成文件不能经过符号链接')
        cursor = cursor.parent
    return path


def snapshot(base):
    result = {}
    if not base.exists():
        return result
    for path in base.rglob('*'):
        if path.is_symlink():
            raise ValueError('骨架包含符号链接，请移除后生成代码')
        if path.is_file() and not any(p in ('.venv', 'node_modules', '__pycache__', '.git', '.trajectories') for p in path.relative_to(base).parts):
            if path.name == '.env':
                continue
            result[path.relative_to(base).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def build(request, runner, root, ws, out):
    from blueprint.workspace import read_prd, current_version, append_log
    from blueprint.pipeline import atomic_write
    if not (ws / 'plan.json').is_file():
        raise ValueError('请先生成产品方案，再生成代码骨架')
    prd = read_prd(ws)
    plan = json.loads((ws / 'plan.json').read_text())
    skeleton = ws / 'skeleton'
    before = snapshot(skeleton)
    files = {}
    for name in before:
        path = skeleton / name
        if path.stat().st_size < 100000 and name != '.env.example':
            try:
                files[name] = path.read_text(encoding='utf-8')
            except UnicodeError:
                pass
    context = {'PRD': prd, '方案': (ws / '方案.md').read_text(), '现有文件': files,
               '迭代记录': (ws / '迭代记录.md').read_text(), '生产模板': (root / 'scaffold/agent.py').read_text()}
    for component in plan.get('components', []):
        if component.get('decision') == '必选':
            for path in root.glob(component['id'] + '_*/README.md'):
                context[path.parent.name] = path.read_text()
    prompt = json.dumps(context, ensure_ascii=False)
    if len(prompt.encode()) > 220000:
        raise ValueError('项目超过本轮生成容量，请拆小需求后更新')
    schema = {'type': 'object', 'required': ['files', 'prd', 'summary'], 'properties': {
        'files': {'type': 'array', 'minItems': 1, 'maxItems': 40, 'items': {'type': 'object', 'required': ['path', 'content'], 'properties': {'path': {'type': 'string'}, 'content': {'type': 'string'}}}},
        'prd': {'type': 'string'}, 'summary': {'type': 'string'}}}
    system = '''你是 Agent Blueprint 的产品开发适配器。只输出符合 schema 的 JSON，不使用 Markdown 围栏。
按 PRD 和方案生成可独立运行的最小产品代码；工具必须实现实际行为，不能以 pass、TODO 或固定返回值假装完工。
files 内 path 相对 skeleton/，content 是完整文件正文。已有文件只做必要的增量修改，保留用户手改；不删除文件。缺少外部服务信息用配置和显式错误保留边界。
必须有 README.md、requirements.txt、.env.example、agent.py。使用 Python 和现有 anthropic/python-dotenv/pyyaml，避免新依赖。README 写清运行方式、默认假设、待确认问题和人工验证步骤。
产品只能用单行用户输入启动。模型和接口从环境 ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL、MODEL_ID 读取。不要写真实密钥，不要安装或执行命令。
prd 返回消化本轮需求后的完整 PRD 文本，版本号不变，原始需求逐字保留；新增功能标注版本，未确认问题继续保留，只把已落地的新需求从“待消化”移入功能节。
生成内容是待人工验证草稿，不能伪造人工验证通过。summary 说明本轮新增/改动/未完成的部分。'''
    atomic_write(out / 'build-request.json', json.dumps({'system': system, 'schema': schema, 'context': context}, ensure_ascii=False, indent=2))
    try:
        data = runner.complete('build', system + '\nSchema: ' + json.dumps(schema), prompt, schema)
    finally:
        atomic_write(out / 'build-attempts.json', clean(json.dumps(getattr(runner, 'attempts', []), ensure_ascii=False, indent=2)))
    atomic_write(out / 'build-response.json', clean(json.dumps(data, ensure_ascii=False, indent=2)))
    if current_version(data['prd']) != current_version(prd):
        raise ValueError('模型试图直接改变 PRD 版本号，未写入代码')
    original = prd.split('## 1. 原始需求', 1)[-1].split('## 2.', 1)[0].strip()
    if original and original not in data['prd']:
        raise ValueError('模型改变了原始需求，未写入代码，请重试')
    changes = {}
    for entry in data['files']:
        safe_file(skeleton, entry['path'])
        if entry['path'] in changes or len(entry['content']) > 200000 or any(secret and secret in entry['content'] for secret in SECRETS):
            raise ValueError('模型文件重复、过大或含密钥，未写入')
        if entry['path'].endswith('.py'):
            compile(entry['content'], entry['path'], 'exec')
        changes[entry['path']] = entry['content']
    if not {'agent.py', 'README.md', 'requirements.txt', '.env.example'}.issubset(set(before) | set(changes)):
        raise ValueError('骨架缺少必需文件，未写入')
    if snapshot(skeleton) != before or read_prd(ws) != prd:
        raise ValueError('生成期间本地文件已被修改，未覆盖，请重新生成')
    backup = ws / '.build-history' / str(uuid.uuid4())
    backup.mkdir(parents=True, mode=0o700)
    old_files = {}
    for name in changes:
        target = safe_file(skeleton, name)
        old_files[name] = target.read_bytes() if target.exists() else None
        if target.exists():
            dest = backup / 'skeleton' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, dest)
    atomic_write(backup / 'PRD.md', prd)
    atomic_write(backup / 'changes.json', json.dumps(list(changes)))
    try:
        for name, content in changes.items():
            target = safe_file(skeleton, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(target, content)
        atomic_write(ws / 'PRD.md', data['prd'])
    except BaseException:
        for name, previous in old_files.items():
            target = safe_file(skeleton, name)
            if previous is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(previous)
        atomic_write(ws / 'PRD.md', prd)
        raise
    append_log(ws, f'V{current_version(prd)} · 生成/增量更新骨架', [data['summary'], '改动文件：' + '、'.join(changes), '人工验证结论：（待填）'])
    return {'files': list(changes), 'summary': data['summary'], 'backup': backup.name}


def main(request):
    root, out = Path(request['engineRoot']).resolve(), Path(request['out']).resolve()
    sys.path.insert(0, str(root))
    creds = request.get('credentials') or {}
    if creds.get('apiKey'):
        SECRETS.append(creds['apiKey'])
        os.environ['ANTHROPIC_API_KEY'] = creds['apiKey']
    os.environ.update({'ANTHROPIC_BASE_URL': creds.get('baseUrl') or 'https://api.deepseek.com/anthropic',
                       'MODEL_ID': creds.get('model') or 'deepseek-chat', 'BLUEPRINT_SKIP_DOTENV': '1'})
    os.environ.pop('ANTHROPIC_AUTH_TOKEN', None)
    import blueprint.llm as llm
    llm.load_config = lambda: None
    from blueprint.workspace import init_workspace, read_prd, revise_workspace, verify_workspace, append_log, current_version
    from blueprint.forward import run_plan
    from blueprint.pipeline import atomic_write
    budget = llm.Budget(max_calls=request['maxCalls'], max_tokens=request['maxTokens'])
    action, ws = request['action'], Path(request['workspace']) if request.get('workspace') else None
    runner = None
    requires_model = action in ('init', 'plan', 'verify', 'build', 'run', 'demo') or action == 'revise' and request['strategy'] != 'none' or action == 'eval' and request.get('real')
    if requires_model:
        if request.get('mock'):
            from blueprint.mock import MockRunner
            runner = MockRunner()
        else:
            runner = llm.AnthropicRunner(budget=budget)
        original = runner.complete

        def complete(stage, system, prompt, schema):
            emit('progress', message={'extract': '拆解需求', 'model': '领域建模', 'design': '设计架构', 'review': '审查方案', 'build': '生成或增量更新代码骨架'}.get(stage, stage))
            try:
                return original(stage, system, prompt, schema)
            finally:
                emit('usage', usage=budget.summary())
        runner.complete = complete
    log = lambda message: emit('progress', message=clean(str(message)))
    result, needs_review, report = {}, False, ''
    if action == 'init':
        initial = init_workspace(out / 'initialize', request['name'], request['idea'])
        for path in initial.iterdir():
            shutil.move(str(path), str(ws / path.name))
    if action in ('init', 'plan'):
        plan, doc = run_plan(read_prd(ws), runner, ws, resume=True, log=log)
        append_log(ws, f'V{current_version(read_prd(ws))} · 推导方案', ['方案已生成：方案.md', '人工验证结论：（待填）'])
        result = {'version': current_version(read_prd(ws)), 'unknowns': plan.extract.get('unknowns', [])}
        report = doc.read_text(); review = plan.review
        needs_review = review.get('ok') is not True or any(i.get('severity', '').lower() in ('high', 'critical', 'p0', 'p1') for i in review.get('issues', []))
    elif action == 'revise':
        result = revise_workspace(ws, request['requirement'], runner=runner, run_plan_flag=request['strategy'] != 'none', quick=request['strategy'] == 'quick', log=log)
        result['doc'] = str(result['doc']) if result.get('doc') else None
        report = (ws / '迭代记录.md').read_text()
        if request['strategy'] == 'full':
            review = json.loads((ws / 'plan.json').read_text()).get('review', {})
            needs_review = review.get('ok') is not True or any(i.get('severity', '').lower() in ('high', 'critical', 'p0', 'p1') for i in review.get('issues', []))
    elif action == 'verify':
        audit, doc = verify_workspace(ws, runner, log=log)
        report = doc.read_text(); result = {'completion': audit.completion, 'review': audit.review}
        needs_review = audit.review.get('ok') is not True or any(g.priority == 'P0' for g in audit.gaps)
    elif action == 'build':
        result = build(request, runner, root, ws, out)
        report = '# 代码骨架更新\n\n' + result['summary'] + '\n\n改动文件\n\n' + '\n'.join('- ' + name for name in result['files']) + '\n\n生成代码已经过 Python 语法检查；仍需运行和人工验证。\n'
        needs_review = True
    elif action == 'template':
        existing = [p for p in (ws / 'skeleton').iterdir() if p.name != 'README.md']
        if existing:
            raise ValueError('骨架已存在，模板不会覆盖已有代码。请使用“生成/更新骨架”。')
        module = runpy.run_path(str(root / 'skills/agent-builder/scripts/init_agent.py'))
        module['create_agent']('skeleton', request['level'], out / 'template')
        for path in (out / 'template/skeleton').iterdir():
            shutil.copy2(path, ws / 'skeleton' / path.name)
        result = {'level': request['level']}; report = f'# 原版模板\n\n已生成 L{request["level"]} 模板，尚未按你的领域需求定制。\n'
        append_log(ws, '创建原版模板', [f'L{request["level"]} 模板已写入 skeleton/', '人工验证结论：（待填）'])
    elif action == 'eval':
        from blueprint.evals import run_evals
        code = run_evals(real=bool(request.get('real')), runner_factory=lambda: runner)
        result = {'passed': code == 0, 'real': bool(request.get('real'))}
        report = '# 原版题库评估\n\n' + (out / '运行记录.txt').read_text()
        needs_review = code != 0
    elif action == 'package':
        module = runpy.run_path(str(root / 'tools/package_student.py'))
        count, size = module['package'](root, out / 'agent-blueprint-student.zip')
        result = {'files': count, 'bytes': size}; report = f'# 原版学生包\n\n{count} 个文件，{size} 字节。按原项目允许清单打包，不包含用户 API 或产品内容。\n'
    elif action in ('demo', 'run'):
        if action == 'demo':
            work = out / 'demo-workspace'; work.mkdir()
            entry = root / request['component'] / 'code.py'
        else:
            work, entry = ws / 'skeleton', ws / 'skeleton/agent.py'
            if not entry.is_file() or entry.is_symlink():
                raise ValueError('骨架没有可运行的 agent.py，请先生成代码')
        os.chdir(work)
        # Original demos stay interactive. Every input/permission question reaches the user.
        builtins.input = read_input
        desktop_input = DesktopInput()
        sys.stdin = desktop_input
        import select
        original_select = select.select

        def desktop_select(readers, writers, errors, timeout=None):
            if desktop_input in readers:
                desktop_input.ensure_waiting()
            return original_select(readers, writers, errors, timeout)
        select.select = desktop_select
        import dotenv
        dotenv.load_dotenv = lambda *args, **kwargs: False
        import anthropic
        original_init = anthropic.Anthropic.__init__

        def guarded_init(client, *args, **kwargs):
            kwargs.update(base_url=os.environ['ANTHROPIC_BASE_URL'], api_key=creds['apiKey'], timeout=120, max_retries=0)
            original_init(client, *args, **kwargs)
            create = client.messages.create

            def bounded(**call):
                with LOCK:
                    budget.check()
                    budget.calls += 1
                call['max_tokens'] = min(call.get('max_tokens', 8000), 8000)
                response = create(**call)
                with LOCK:
                    budget.input_tokens += response.usage.input_tokens
                    budget.output_tokens += response.usage.output_tokens
                emit('usage', usage=budget.summary())
                return response
            client.messages.create = bounded
        anthropic.Anthropic.__init__ = guarded_init
        import subprocess
        original_popen = subprocess.Popen

        class PrivatePopen(original_popen):
            def __init__(self, *args, **kwargs):
                env = kwargs.get('env') or dict(os.environ)
                kwargs['env'] = {key: value for key, value in env.items() if not any(marker in key.upper() for marker in ('KEY', 'SECRET', 'TOKEN', 'PASSWORD'))}
                super().__init__(*args, **kwargs)
        subprocess.Popen = PrivatePopen
        sys.argv = [str(entry)]
        try:
            runpy.run_path(str(entry), run_name='__main__')
        except SystemExit as exc:
            if exc.code not in (0, None):
                raise ValueError(f'示例退出码 {exc.code}')
        result = {'entry': entry.name, 'workspace': work.name}; report = '# 运行记录\n\n' + (out / '运行记录.txt').read_text()
    atomic_write(out / '结果.md', report)
    atomic_write(out / '结果.json', json.dumps(result, ensure_ascii=False, indent=2))
    emit('result', summary=result, needsReview=needs_review)


if __name__ == '__main__':
    try:
        request = json.loads(INPUT.readline())
        out = Path(request['out'])
        (out / '运行记录.txt').touch(mode=0o600)
        with contextlib.redirect_stdout(Console(out)), contextlib.redirect_stderr(Console(out)):
            main(request)
    except BaseException as exc:
        emit('error', message=clean(str(exc) or type(exc).__name__))
        sys.exit(1)

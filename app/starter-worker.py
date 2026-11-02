"""Bounded coding agent for the complete starter kit; all model/tool events are durable."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET

WIRE, INPUT = sys.stdout, sys.stdin
CONFIG = json.loads(INPUT.readline())
ROOT = Path(CONFIG['workspace']).resolve()
OUT = Path(CONFIG['out']).resolve()
KEY = CONFIG['api']['apiKey']
PHASE = CONFIG['phase']
ACTIVE_COMMAND = None


def clean(value):
    text = str(value)
    for secret in [KEY, *(CONFIG.get('cloudCredentials') or {}).values()]:
        if secret:
            text = text.replace(secret, '[已隐藏]')
    return text


def emit(event_type, **data):
    event = json.loads(clean(json.dumps({'type': event_type, **data}, ensure_ascii=False)))
    WIRE.write(json.dumps(event, ensure_ascii=False) + '\n')
    WIRE.flush()


def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.parent / ('.write-' + str(uuid.uuid4()))
    temp.write_text(text, encoding='utf-8')
    temp.chmod(0o600)
    os.replace(temp, path)


def safe(name, write=False):
    if not isinstance(name, str) or not name or '\\' in name:
        raise ValueError('文件名无效')
    path = ROOT / name
    cursor = path
    while cursor != ROOT and ROOT in cursor.parents:
        if cursor.is_symlink():
            raise ValueError('不读取或写入符号链接')
        cursor = cursor.parent
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('只能操作当前开发项目内的文件')
    if any(part in ('.env', '.git', '.harness', '.starter', 'node_modules', '.venv', '__pycache__') for part in path.relative_to(ROOT).parts):
        raise ValueError('此路径不通过文件工具读写；密钥使用工作台统一设置')
    name = path.relative_to(ROOT).as_posix()
    protected = ['AGENTS.md', 'CLAUDE.md', 'docs/项目状态.md', 'docs/样例评分.md']
    if write and (name in protected or name.startswith('docs/手册/')):
        raise ValueError('规则、手册、项目状态和评分文件由工作台维护；使用 record_decisions/record_rubric 更新决策和维度')
    if write and PHASE < 2 and not (name.startswith('docs/') or name in ('README.md', '.gitignore')):
        raise ValueError('当前为需求/适配阶段，只能写文档，不能提前开发代码')
    return path


def backup(path):
    if path.exists():
        dest = OUT / 'before' / path.relative_to(ROOT)
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)


def ask(kind, **fields):
    token = str(uuid.uuid4())
    emit('request', token=token, kind=kind, **fields)
    line = INPUT.readline()
    if not line:
        raise RuntimeError('操作已取消')
    answer = json.loads(line)
    if answer.get('token') != token:
        raise RuntimeError('操作回复不匹配')
    if answer.get('error'):
        raise ValueError(answer['error'])
    return answer.get('result')


def shell(command, cwd='.', timeout=180, use_api=False):
    global ACTIVE_COMMAND
    if not isinstance(command, str) or len(command) > 16000:
        raise ValueError('命令过长')
    if PHASE < 2:
        if not re.fullmatch(r'(?:python3? --version|node --version|git --version|npm --version|pwd)', command.strip()):
            raise ValueError('当前阶段仅检查环境；代码开发从阶段 2 开始')
    if PHASE >= 4 or re.search(r'\b(?:vefaas|volcengine|terraform|pulumi|kubectl|aws|gcloud|aliyun)\b', command, re.I):
        approved = ask('approval', command=command, reason='此命令涉及上线/云环境，请核对范围与费用后执行', phase=PHASE)
        if approved is not True:
            raise ValueError('你未批准这条操作，未执行')
    folder = safe(cwd) if cwd != '.' else ROOT
    env = {k: v for k, v in os.environ.items() if not any(x in k.upper() for x in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD'))}
    env.update({'PYTHONDONTWRITEBYTECODE': '1', 'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'npm_config_cache': str(ROOT / '.starter/npm-cache'), 'HOME': str(ROOT / '.starter/home')})
    Path(env['HOME']).mkdir(parents=True, exist_ok=True)
    if use_api:
        env.update({'DEEPSEEK_API_KEY': KEY, 'ANTHROPIC_API_KEY': KEY, 'ANTHROPIC_BASE_URL': CONFIG['api']['anthropicBaseUrl'], 'MODEL_ID': CONFIG['api']['model'], 'OPENAI_API_KEY': KEY, 'OPENAI_BASE_URL': CONFIG['api']['baseUrl']})
    if PHASE >= 4:
        env.update(CONFIG.get('cloudCredentials') or {})
    argv = ['/bin/bash', '-c', command]
    if sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').exists():
        profile = '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ' + json.dumps(str(ROOT)) + ') (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))'
        argv = ['/usr/bin/sandbox-exec', '-p', profile, *argv]
    started = time.monotonic()
    child = subprocess.Popen(argv, cwd=folder, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    ACTIVE_COMMAND = child
    emit('child', pid=child.pid)
    timed_out = False
    try:
        output, _ = child.communicate(timeout=min(max(float(timeout), 1), 300))
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGKILL)
        output, _ = child.communicate()
    finally:
        ACTIVE_COMMAND = None
    result = {'command': command, 'exitCode': child.returncode, 'timedOut': timed_out, 'seconds': round(time.monotonic() - started, 2), 'output': clean(output[-24000:]), 'usedSharedApi': bool(use_api)}
    emit('command', **result)
    return result


def tool(name, args):
    if name == 'list_files':
        found = []
        for path in ROOT.rglob(args.get('pattern', '*')):
            relative = path.relative_to(ROOT)
            if path.is_file() and not path.is_symlink() and not any(p.startswith('.') or p in ('node_modules', '__pycache__') for p in relative.parts):
                found.append(relative.as_posix())
            if len(found) >= 300:
                break
        return found
    if name == 'read_file':
        path = safe(args['path'])
        if path.stat().st_size > 150000:
            raise ValueError('文件过大，请只读一部分')
        return path.read_text(encoding='utf-8')
    if name in ('write_file', 'edit_file'):
        path = safe(args['path'], write=True)
        content = args.get('content', '')
        if name == 'edit_file':
            content = path.read_text(encoding='utf-8')
            if not args.get('old_text') or content.count(args['old_text']) != 1:
                raise ValueError('旧文本必须唯一匹配，先读取当前文件')
            content = content.replace(args['old_text'], args['new_text'], 1)
        if not isinstance(content, str) or len(content) > 200000 or KEY and KEY in content:
            raise ValueError('文件过大或含密钥，未写入')
        backup(path)
        atomic(path, content)
        emit('file', path=path.relative_to(ROOT).as_posix(), bytes=len(content.encode()))
        return '已保存 ' + path.relative_to(ROOT).as_posix()
    if name == 'run_command':
        return shell(**args)
    if name == 'start_preview':
        if PHASE < 2:
            raise ValueError('当前阶段还没有可运行代码')
        return ask('preview', **args)
    if name == 'capture_preview':
        return ask('capture', **args)
    if name == 'record_decisions':
        items = args['items']
        if not isinstance(items, list) or len(items) > 10 or any(not isinstance(x, dict) or not isinstance(x.get('question'), str) or not isinstance(x.get('answer'), str) or x.get('status') not in ('pending', 'confirmed', 'default', 'deferred') for x in items):
            raise ValueError('决策最多十项，状态为 pending/confirmed/default')
        if any(x.get('status') == 'deferred' and (not isinstance(x.get('revisitPhase'), int) or x['revisitPhase'] not in (2, 4)) for x in items):
            raise ValueError('延后决策必须指定 revisitPhase=2或4')
        emit('decisions', items=items)
        return '决策已记录，工作台已自动同步 docs/项目状态.md，不需要也不能直接改写此文件；默认建议仍需用户确认'
    if name == 'report_stage':
        if not isinstance(args.get('summary'), str) or not isinstance(args.get('nextStep'), str) or not isinstance(args.get('unresolved'), list) or any(not isinstance(v, str) for v in args['unresolved']) or not isinstance(args.get('checks'), list) or not args['checks'] or any(not isinstance(c, dict) or not isinstance(c.get('item'), str) or not isinstance(c.get('evidence'), str) or c.get('status') not in ('yes', 'no', 'na', 'pending') for c in args['checks']):
            raise ValueError('阶段报告字段无效，请提供非空是否表和未解决问题列表')
        emit('report', report=args)
        return '已保存阶段报告并自动生成 docs/evidence/阶段N/验收说明.md，项目状态由工作台同步。截图需实际捕获；阶段推进与人工验收由用户操作'
    if name == 'record_rubric':
        return ask('rubric', dimensions=args['dimensions'])
    if name == 'model_samples':
        prompts = args['prompts']
        if not 1 <= len(prompts) <= 10:
            raise ValueError('每次生成 1–10 个真实样例')
        samples = []
        for prompt in prompts:
            if usage['calls'] >= CONFIG.get('maxCalls', 24) or usage['input_tokens'] + usage['output_tokens'] >= CONFIG.get('maxTokens', 400000):
                raise RuntimeError('达到调用预算上限，已生成样例保留')
            response = client.messages.create(model=CONFIG['api']['model'], system=args['system'], messages=[{'role': 'user', 'content': prompt}], max_tokens=1500)
            record_usage(response)
            content = ''.join(getattr(b, 'text', '') for b in response.content if b.type == 'text')
            item = {'id': str(uuid.uuid4()), 'input': prompt, 'output': content, 'source': 'real_shared_api'}
            emit('sample', sample=item)
            samples.append(item)
        return samples
    if name == 'extract_document':
        path = safe(args['path'])
        if path.suffix.lower() == '.docx':
            with zipfile.ZipFile(path) as archive:
                raw = archive.read('word/document.xml')
                if len(raw) > 5000000:
                    raise ValueError('文档过大')
                tree = ET.fromstring(raw)
                return '\n'.join(''.join(p.itertext()) for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))[:100000]
        if path.suffix.lower() == '.pdf':
            from pypdf import PdfReader
            return '\n'.join(page.extract_text() or '' for page in PdfReader(path).pages)[:100000]
        return path.read_text()[:100000]
    raise ValueError('未知工具')


def definition(name, description, properties, required=()):
    return {'name': name, 'description': description, 'input_schema': {'type': 'object', 'properties': properties, 'required': list(required)}}


S = {'type': 'string'}
TOOLS = [
    definition('list_files', '列出当前开发项目的文件', {'pattern': S}),
    definition('read_file', '读取当前项目文本，路径相对开发工作区', {'path': S}, ['path']),
    definition('write_file', '新建或更新文件，覆盖前自动备份。不能写密钥', {'path': S, 'content': S}, ['path', 'content']),
    definition('edit_file', '唯一文本替换并自动备份', {'path': S, 'old_text': S, 'new_text': S}, ['path', 'old_text', 'new_text']),
    definition('run_command', '执行开发/安装依赖/测试命令。云操作会逐条等待用户确认；use_api 让后端测试复用统一API，不能打印环境', {'command': S, 'cwd': S, 'timeout': {'type': 'number'}, 'use_api': {'type': 'boolean'}}, ['command']),
    definition('start_preview', '启动由工作台持续管理的本地预览服务，进程不会随本轮结束而消失', {'command': S, 'cwd': S, 'port': {'type': 'integer'}, 'use_api': {'type': 'boolean'}}, ['command', 'port']),
    definition('capture_preview', '记录本地预览的真实截图和页面文本；视觉效果需用户核验', {'url': S, 'mobile': {'type': 'boolean'}}, ['url']),
    definition('record_decisions', '记录所有已定和待定决策，最多十项，不能把AI默认建议当成用户确认', {'items': {'type': 'array', 'items': {'type': 'object', 'required': ['question', 'answer', 'status'], 'properties': {'question': S, 'answer': S, 'status': {'type': 'string', 'enum': ['pending', 'confirmed', 'default', 'deferred']}, 'revisitPhase': {'type': 'integer', 'enum': [2, 4]}}}}}, ['items']),
    definition('report_stage', '提交本阶段总结、未解决项和建议验收项，不能自行跳阶段或伪造用户验收', {'summary': S, 'nextStep': S, 'unresolved': {'type': 'array', 'items': S}, 'checks': {'type': 'array', 'items': {'type': 'object', 'properties': {'item': S, 'status': {'type': 'string', 'enum': ['yes', 'no', 'na', 'pending']}, 'evidence': S}, 'required': ['item', 'status', 'evidence']}}}, ['summary', 'nextStep', 'unresolved', 'checks']),
    definition('record_rubric', '按产品类型设定1至5个评分维度，每项由真人打1至3分。已有评分后不可擅自修改维度', {'dimensions': {'type': 'array', 'items': S}}, ['dimensions']),
    definition('model_samples', '用同一API生成真实样例供用户打分；每项有来源和用量，不能当作待开发代码的端到端测试', {'system': S, 'prompts': {'type': 'array', 'items': S}}, ['system', 'prompts']),
    definition('extract_document', '提取已导入的 Word/PDF/文本 PRD', {'path': S}, ['path']),
]

usage = {'calls': 0, 'input_tokens': 0, 'output_tokens': 0}


def record_usage(response):
    usage['calls'] += 1
    usage['input_tokens'] += response.usage.input_tokens
    usage['output_tokens'] += response.usage.output_tokens
    emit('usage', usage=usage)


def stop(*_):
    if ACTIVE_COMMAND is not None:
        try:
            os.killpg(ACTIVE_COMMAND.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    raise SystemExit(130)


signal.signal(signal.SIGTERM, stop)


def main():
    global client
    from anthropic import Anthropic
    client = Anthropic(api_key=KEY, base_url=CONFIG['api']['anthropicBaseUrl'], timeout=120, max_retries=0)
    system = CONFIG['system']
    history_path = ROOT / '.starter/history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else []
    # Only complete tool exchanges are published, so restart never reuses a dangling tool call.
    # Trim only at complete human turns, never between tool-use and tool-result.
    starts = [i for i, message in enumerate(history) if message['role'] == 'user' and isinstance(message['content'], str)]
    if len(starts) > 4:
        history = history[starts[-4]:]
    history.append({'role': 'user', 'content': CONFIG['prompt']})
    atomic(OUT / 'model-input.json', clean(json.dumps({'system': system, 'messages': history, 'tools': TOOLS}, ensure_ascii=False)))
    limit = CONFIG.get('maxCalls', 24)
    for _ in range(limit):
        if usage['calls'] >= limit or usage['input_tokens'] + usage['output_tokens'] >= CONFIG.get('maxTokens', 400000):
            raise RuntimeError('本轮达到预算上限，文件和记录保留；请明确点击继续')
        emit('progress', message='正在思考与执行当前阶段')
        response = client.messages.create(model=CONFIG['api']['model'], system=system, messages=history, tools=TOOLS, max_tokens=10000)
        record_usage(response)
        blocks = [block.model_dump(exclude_none=True) for block in response.content]
        emit('model', blocks=blocks, stopReason=response.stop_reason)
        tool_calls = [block for block in response.content if block.type == 'tool_use']
        text = '\n'.join(block.text for block in response.content if block.type == 'text')
        if text:
            emit('text', text=text)
        history.append({'role': 'assistant', 'content': blocks})
        if not tool_calls:
            atomic(history_path, clean(json.dumps(history, ensure_ascii=False)))
            if response.stop_reason == 'max_tokens':
                raise ValueError('模型回复被截断，未当作完成；可以继续')
            emit('result', reply=text or '本轮操作结束，请查看当前文件与待确认事项。', usage=usage)
            return
        results = []
        for block in tool_calls:
            emit('tool', name=block.name, arguments=block.input)
            try:
                result = tool(block.name, block.input)
                content = clean(json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result)
                results.append({'type': 'tool_result', 'tool_use_id': block.id, 'content': content})
                emit('tool_result', name=block.name, content=content[:25000])
            except Exception as exc:
                content = clean(str(exc))
                results.append({'type': 'tool_result', 'tool_use_id': block.id, 'is_error': True, 'content': content})
                emit('tool_result', name=block.name, error=content)
        history.append({'role': 'user', 'content': results})
        atomic(history_path, clean(json.dumps(history, ensure_ascii=False)))
    raise RuntimeError('本轮达到调用上限，已保存进度。请点击继续，不会自动反复续跑')


if __name__ == '__main__':
    try:
        main()
    except BaseException as exc:
        emit('error', message=clean(str(exc) or type(exc).__name__))
        sys.exit(1)

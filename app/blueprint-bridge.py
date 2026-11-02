"""Private JSONL bridge; configuration and credentials never enter renderer events."""
from __future__ import annotations

import sys
sys.stdout.write('{"type":"diagnostic","phase":"python_started"}\n')
sys.stdout.flush()

import json
import os
from pathlib import Path
import re
import sys

SECRETS: list[str] = []


def clean(value: str) -> str:
    for secret in SECRETS:
        if secret:
            value = value.replace(secret, '[已隐藏]')
    return re.sub(r'(?i)(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|authorization|auth[_-]?token)\s*[:=]\s*[^\s,;]+)', '[已隐藏]', value)


def emit(kind: str, **fields) -> None:
    print(json.dumps({'type': kind, **fields}, ensure_ascii=False), flush=True)


def configured(request: dict) -> dict:
    emit('diagnostic', phase='dotenv_importing')
    from dotenv import dotenv_values
    emit('diagnostic', phase='dotenv_imported')
    values = dotenv_values(request['configPath']) if request.get('configPath') else {}
    emit('diagnostic', phase='config_read')
    credentials = request.get('credentials') or {}
    key = values.get('ANTHROPIC_API_KEY') or values.get('ANTHROPIC_AUTH_TOKEN') or ''
    if not key or any(marker in key.lower() for marker in ('xxx', 'your', 'placeholder')):
        key = credentials.get('apiKey') or ''
        values = {**values, 'ANTHROPIC_BASE_URL': credentials.get('baseUrl') or values.get('ANTHROPIC_BASE_URL'),
                  'MODEL_ID': credentials.get('model') or values.get('MODEL_ID')}
    SECRETS.append(key)
    if key:
        os.environ['ANTHROPIC_API_KEY'] = key
    for name in ('ANTHROPIC_BASE_URL', 'MODEL_ID'):
        if values.get(name):
            os.environ[name] = values[name]
    return {'configured': bool(key), 'model': os.getenv('MODEL_ID', 'claude-opus-5')}


def main() -> None:
    emit('diagnostic', phase='waiting_input')
    request = json.loads(sys.stdin.readline())
    emit('diagnostic', phase='input_received')
    sys.path.insert(0, request['engineRoot'])
    emit('diagnostic', phase='engine_importing')
    import blueprint.llm as llm
    emit('diagnostic', phase='engine_imported')
    # Prevent engine-local .env discovery: only the explicitly selected config may load.
    llm.load_config = lambda: None
    state = configured(request)
    emit('diagnostic', phase='anthropic_importing')
    import anthropic
    emit('diagnostic', phase='anthropic_imported')
    from blueprint.forward import run_plan
    from blueprint.reverse import run_audit
    if request.get('action') == 'probe':
        emit('status', available=True, **state)
        return
    out = Path(request['out']).resolve()
    if not out.is_dir():
        raise ValueError('任务输出目录不存在')
    if request.get('mock'):
        from blueprint.mock import MockRunner
        runner = MockRunner()
    else:
        if not state['configured']:
            raise ValueError('请先在设置中配置模型 API Key，或配置 Agent Blueprint 的 .env')
        class GuardedBudget(llm.Budget):
            def record(self, stage, input_tokens, output_tokens):
                super().record(stage, input_tokens, output_tokens)
                if self.input_tokens + self.output_tokens > self.max_tokens:
                    raise llm.BudgetExceeded(f'模型返回的实际用量超过 {self.max_tokens} token，已停止后续阶段')

        budget = GuardedBudget(max_calls=request['maxCalls'], max_tokens=request['maxTokens'])
        client = anthropic.Anthropic(base_url=os.getenv('ANTHROPIC_BASE_URL'), timeout=request.get('modelTimeout', 120), max_retries=0)
        original_create = client.messages.create

        def bounded_create(**kwargs):
            # UTF-8 bytes conservatively reserve input space without an extra network call.
            size = len(str(kwargs.get('system', '')).encode('utf-8'))
            size += sum(len(str(message.get('content', '')).encode('utf-8')) for message in kwargs['messages'])
            remaining = budget.max_tokens - budget.input_tokens - budget.output_tokens - size - 512
            if remaining < 256:
                raise llm.BudgetExceeded('剩余 token 预算不足以安全运行下一阶段，请缩短需求后重试')
            kwargs['max_tokens'] = min(kwargs['max_tokens'], remaining)
            return original_create(**kwargs)

        client.messages.create = bounded_create
        runner = llm.AnthropicRunner(model=state['model'], budget=budget, client=client)
    if hasattr(runner, 'complete'):
        original_complete = runner.complete

        def complete(stage, system, prompt, schema):
            emit('stage', stage=stage, message='正在生成')
            try:
                return original_complete(stage, system, prompt, schema)
            finally:
                budget = getattr(runner, 'budget', None)
                emit('usage', usage=budget.summary() if budget else {})
        runner.complete = complete

    def log(message):
        emit('progress', message=clean(str(message)))

    kwargs = {'resume': bool(request.get('resume')), 'log': log}
    if request['mode'] == 'plan':
        run_plan(request['input'], runner, out, **kwargs)
        name = 'plan.json'
    else:
        # Engine performs static scanning only and never imports or executes the audited project.
        run_audit(Path(request['projectPath']), runner, out, prd_text=request.get('prdText'), **kwargs)
        name = 'audit.json'
    data = json.loads((out / name).read_text(encoding='utf-8'))
    review = data.get('review') or {}
    critical = any(str(issue.get('severity', '')).lower() in ('high', 'critical', 'p0', 'p1') for issue in review.get('issues', []))
    needs_review = review.get('ok') is not True or critical
    if needs_review and review.get('ok') is True:
        # Preserve original review JSON while correcting the contradictory human-facing verdict.
        report = out / ('方案.md' if request['mode'] == 'plan' else '差距报告.md')
        text = report.read_text(encoding='utf-8')
        text = text.replace('- 结论：✅ 通过', '- 结论：⚠️ 待复核').replace('- 结论：✅ 复核通过', '- 结论：⚠️ 待复核')
        notice = '> 工作台复核提示：模型标记通过，但仍列出高严重度问题。本报告需要人工核对，不能视为验收通过。\n\n'
        from blueprint.pipeline import atomic_write
        atomic_write(report, notice + text)
    emit('result', status='needs_review' if needs_review else 'completed', title=data.get('title'),
         review=review, usage=data.get('budget') or {}, unknowns=data.get('unknowns') or [],
         completion=data.get('completion'), mock=bool(request.get('mock')))


if __name__ == '__main__':
    try:
        main()
    except BaseException as exc:
        emit('error', message=clean(str(exc) or type(exc).__name__))
        sys.exit(1)

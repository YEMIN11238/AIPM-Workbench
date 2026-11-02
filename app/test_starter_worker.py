"""Exercise real file and command tools without spending API calls."""
import io
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

class WorkerTools(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.out = self.root / '.starter/runs/check'
        self.out.mkdir(parents=True)
        config = {'workspace': str(self.root), 'out': str(self.out), 'phase': 2, 'api': {'apiKey':'private-test-key','model':'deepseek-chat','baseUrl':'https://api.deepseek.com','anthropicBaseUrl':'https://api.deepseek.com/anthropic'}}
        with patch.object(sys, 'stdin', io.StringIO(json.dumps(config)+'\n')), patch.object(sys, 'stdout', io.StringIO()):
            self.worker = runpy.run_path(str(Path(__file__).with_name('starter-worker.py')), run_name='worker_tools_test')
        self.addCleanup(self.temp.cleanup)
    def test_actual_write_edit_backup_and_command(self):
        tool = self.worker['tool']
        tool('write_file', {'path':'main.py','content':'print("hello")\n'})
        tool('edit_file', {'path':'main.py','old_text':'hello','new_text':'world'})
        self.assertIn('world',(self.root/'main.py').read_text())
        self.assertIn('hello',(self.out/'before/main.py').read_text())
        result=tool('run_command', {'command':'python3 main.py'})
        self.assertEqual(result['exitCode'],0)
        self.assertEqual(result['output'].strip(),'world')
        for name in ('../outside','.env','docs/手册/example.md','AGENTS.md'):
            with self.assertRaises(ValueError): tool('write_file',{'path':name,'content':'x'})
        with self.assertRaises(ValueError): tool('write_file',{'path':'bad.py','content':'private-test-key'})
    def test_all_host_request_kinds_roundtrip_without_emitter_conflict(self):
        tool = self.worker['tool']
        scope = self.worker['ask'].__globals__
        for name, args, response in [
            ('record_rubric', {'dimensions':['任务覆盖','不编造']}, ['任务覆盖','不编造']),
            ('start_preview', {'command':'python3 -m http.server 8923 --bind 127.0.0.1','port':8923}, {'url':'http://127.0.0.1:8923'}),
            ('capture_preview', {'url':'http://127.0.0.1:8923'}, {'file':'docs/evidence/阶段2/桌面.png'}),
        ]:
            scope['INPUT'] = io.StringIO(json.dumps({'token':'fixed-token','result':response})+'\n')
            with patch.object(self.worker['uuid'], 'uuid4', return_value='fixed-token'):
                self.assertEqual(tool(name,args),response)
        scope['PHASE'] = 4
        scope['INPUT'] = io.StringIO(json.dumps({'token':'fixed-token','result':False})+'\n')
        with patch.object(self.worker['uuid'], 'uuid4', return_value='fixed-token'):
            with self.assertRaisesRegex(ValueError,'未批准'):
                tool('run_command',{'command':'echo should-not-execute'})
        events = [json.loads(line) for line in scope['WIRE'].getvalue().splitlines()]
        self.assertEqual([e['kind'] for e in events if e['type']=='request'],['rubric','preview','capture','approval'])

    def test_model_json_requires_real_fields(self):
        for name,args in [('record_decisions',{'items':[{'status':'confirmed'}]}),('report_stage',{'summary':'yes','checks':[]})]:
            with self.assertRaises(ValueError): self.worker['tool'](name,args)

if __name__=='__main__': unittest.main()

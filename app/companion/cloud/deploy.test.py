"""Exercise optional memory deployment commands without Docker or SSH."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("deploy.sh")
HARNESS = r'''
function uname { if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi; }
function test {
  if [[ "$1" == -r && "${2-}" == /etc/os-release ]]; then return 0; fi
  builtin test "$@"
}
function . {
  if [[ "$1" == /etc/os-release ]]; then ID=ubuntu; VERSION_ID=22.04
  else builtin . "$@"; fi
}
function docker {
  python3 -c 'import json,sys; f=open(sys.argv[1],"a"); f.write(json.dumps(sys.argv[2:])+"\n"); f.close()' "$audit_log" "$@"
}
audit_log="$4"
builtin source "$1" "$2" "$3"
'''


class DeploymentCommandsTest(unittest.TestCase):
    def test_all_actions_include_memory_file_only_when_present(self):
        for memory in (False, True):
            for action in ("preflight", "check", "up", "stop", "status"):
                with self.subTest(memory=memory, action=action), tempfile.TemporaryDirectory() as tmp:
                    directory = Path(tmp) / "deployment with spaces"
                    config = directory / "private/astrbot-data"
                    config.mkdir(parents=True)
                    (config / "cmd_config.json").write_text("{}")
                    (directory / "deployment.json").write_text("{}")
                    (directory / "prepare.py").write_text("raise SystemExit(0)\n")
                    (directory / "compose.yaml").write_text("services: {}\n")
                    if memory:
                        (directory / "compose.memory.yaml").write_text("services: {}\n")
                    log = Path(tmp) / "docker-calls.jsonl"
                    result = subprocess.run(
                        ["bash", "-c", HARNESS, "deploy-test", str(SCRIPT), action, str(directory), str(log)],
                        capture_output=True, text=True,
                        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C"},
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    operations = [call for call in calls if call[:1] == ["compose"] and call[1:2] != ["version"]]
                    expected_files = [str(directory / "compose.yaml")]
                    if memory:
                        expected_files.append(str(directory / "compose.memory.yaml"))
                    for call in operations:
                        files = [call[i + 1] for i, value in enumerate(call) if value == "--file"]
                        self.assertEqual(files, expected_files)
                    suffixes = [call[-2:] for call in operations]
                    self.assertIn(["config", "--quiet"], suffixes)
                    if action == "up":
                        self.assertEqual(operations[-2][-1], "pull")
                        self.assertEqual(operations[-1][-2:], ["up", "-d"])
                    elif action == "stop":
                        self.assertEqual(operations[-1][-1], "stop")
                    elif action == "status":
                        self.assertEqual(operations[-1][-3:], ["ps", "--format", "json"])
                    else:
                        self.assertEqual(len(operations), 1)


if __name__ == "__main__":
    unittest.main()

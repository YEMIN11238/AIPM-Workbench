# Local companion control

[中文](CONTROL.zh.md) | English

The desktop app accepts explicit local companion actions through its existing Electron single-instance owner. It does not create an HTTP control port or expose arbitrary IPC, shell commands, or API-key updates. Restart the workbench once after updating this entry point; the installed launcher loads the source checkout.

## Submit a request

Call `~/工作台/AIPM工作台/AIPM工作台.app/Contents/MacOS/AIPMWorkbench` with `--companion-control` and one JSON argument. Each request needs a fresh lowercase UUID. For example, submit a status request:

```sh
python3 - <<'PY'
import json, subprocess, uuid
request = {"requestId": str(uuid.uuid4()), "action": "status"}
subprocess.run(["/Users/zhangjunhao/工作台/AIPM工作台/AIPM工作台.app/Contents/MacOS/AIPMWorkbench", "--companion-control", json.dumps(request)], check=True)
print(request["requestId"])
PY
```

The secondary process forwards validated data to the running workbench and exits. Its exit does not mean the action completed. Read `~/工作台/AIPM工作台/大肥鱼/control-requests/<requestId>/result.json` after it appears and contains complete JSON; check `ok`. The request directory is `0700`, its request/result files are `0600`, and an existing request ID is rejected without replacing prior files. Result destinations cannot be supplied by callers.

## Allowed actions

| Action | Additional input | Behavior |
| --- | --- | --- |
| `status` | None | Return filtered local management state |
| `save-connection` | `connection: {host, port, user, identityFile}` | Save the non-secret server fields using existing connection validation; `port` is an integer and `identityFile` is an absolute private-key path |
| `deploy` | None | Explicitly run the existing dedicated deployment procedure |
| `connect` | None | Open the workbench-owned SSH management tunnel |
| `disconnect` | None | Close only the local tunnel; cloud services remain running |
| `open-companion` | None | Navigate to the companion console and wait for the renderer to confirm; it does not deploy or connect automatically |

Only `save-connection` accepts a `connection` object. Unknown properties, actions, credential fields and command fields are rejected. Save a connection, deploy, connect, and open the companion as separate requests, checking each result before continuing. A server that is already initialized is governed by the existing deployment recovery rules.

## Credentials and interface state

The existing companion service uses its own encrypted `大肥鱼/credentials.bin` internally. The control entry point never accepts, returns, copies, or prints an API key and does not use workbench model credentials. Results contain selected state fields, excluding server details, identity paths, key fingerprints and raw server errors. API-key changes remain in the workbench's dedicated companion settings.

The app keeps the SSH process, so a short-lived command does not take ownership of the tunnel. `open-companion` preserves the workbench's unsaved-page navigation guards. With no connection it shows the setup page; with a ready connection it displays the original AstrBot console in the existing isolated native view. Backend reachability does not establish QQ login or model delivery.

## Verification

`node --test apps/aipm-desktop/companion/control.test.mjs apps/aipm-desktop/v2/companion.test.mjs` exercises the control protocol with simulated app/service objects and keyless desktop interactions. It does not invoke the installed app, decrypt credentials, connect SSH, or deploy cloud services.

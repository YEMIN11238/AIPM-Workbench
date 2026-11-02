# 大肥鱼本机控制入口

中文 | [English](CONTROL.md)

桌面应用通过现有 Electron 单实例主进程接收明确的本机大肥鱼操作。该入口不创建 HTTP 控制端口，不提供任意 IPC、命令执行或 API Key 修改能力。更新入口后需重启一次工作台；已安装的启动器直接加载源码目录。

## 提交请求

调用 `~/工作台/AIPM工作台/AIPM工作台.app/Contents/MacOS/AIPMWorkbench`，传入 `--companion-control` 和一个 JSON 参数。每次请求都需要新的小写 UUID。例如提交状态请求：

```sh
python3 - <<'PY'
import json, subprocess, uuid
request = {"requestId": str(uuid.uuid4()), "action": "status"}
subprocess.run(["/Users/zhangjunhao/工作台/AIPM工作台/AIPM工作台.app/Contents/MacOS/AIPMWorkbench", "--companion-control", json.dumps(request)], check=True)
print(request["requestId"])
PY
```

第二个进程把已校验数据转交给正在运行的工作台，然后退出。该进程退出不代表操作完成。等待 `~/工作台/AIPM工作台/大肥鱼/control-requests/<requestId>/result.json` 出现且包含完整 JSON，再检查 `ok`。请求目录权限为 `0700`，请求与结果文件为 `0600`；已有请求 ID 会被拒绝，不替换历史文件。调用者不能指定结果写入路径。

## 允许的动作

| 动作 | 额外输入 | 行为 |
| --- | --- | --- |
| `status` | 无 | 返回经过筛选的本机管理状态 |
| `save-connection` | `connection: {host, port, user, identityFile}` | 使用既有连接校验保存非秘密服务器字段；`port` 为整数，`identityFile` 为私钥绝对路径 |
| `deploy` | 无 | 显式调用既有的专用部署流程 |
| `connect` | 无 | 建立由工作台持有的 SSH 管理隧道 |
| `disconnect` | 无 | 只关闭本机隧道，云端服务继续运行 |
| `open-companion` | 无 | 切到大肥鱼控制台并等待界面确认，不自动部署或连接 |

仅 `save-connection` 接受 `connection` 对象。未知字段、动作、凭据和命令字段均会被拒绝。保存连接、部署、连接后台和打开大肥鱼应分别提交请求，核对每一步结果后继续。服务器已有初始化数据时，沿用现有部署恢复规则。

## 凭据与界面状态

现有大肥鱼服务在内部使用自己的加密 `大肥鱼/credentials.bin`。控制入口不接收、返回、复制或打印 API Key，也不使用工作台模型凭据。结果只保留指定状态字段，不含服务器详情、私钥路径、密钥指纹和服务器原始报错。API Key 的更改仍通过工作台的大肥鱼独立设置完成。

SSH 进程由工作台持有，短命命令进程不会接管隧道。`open-companion` 保留工作台对未保存页面的导航保护。未连接时显示配置入口，连接就绪时在现有隔离原生视图中显示 AstrBot 原版后台。后台可访问不代表 QQ 已登录或模型回复已经送达。

## 检查

`node --test apps/aipm-desktop/companion/control.test.mjs apps/aipm-desktop/v2/companion.test.mjs` 使用模拟应用和服务对象及无密钥桌面交互验证控制协议，不启动真实应用、不解密凭据、不建立 SSH 连接，也不部署云端服务。

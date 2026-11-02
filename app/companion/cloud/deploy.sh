#!/usr/bin/env bash
# Operates an already prepared, dedicated deployment; never installs host tools.
set -euo pipefail

action="${1:-check}"
directory="${2:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"

fail() { printf '%s\n' "$1" >&2; exit 1; }
case "$action" in preflight|check|up|stop|status) ;; *) fail '用法: deploy.sh preflight|check|up|stop|status [部署目录]' ;; esac
test "$(uname -s)" = Linux || fail '云端部署需要 Ubuntu Linux；本脚本不会在 macOS 启动容器。'
test "$(uname -m)" = x86_64 || fail '此部署文件固定为 x86_64/amd64。'
test -r /etc/os-release || fail '无法确认云端系统版本。'
# /etc/os-release is an operating-system-owned file, not deployment input.
. /etc/os-release
test "${ID:-}" = ubuntu || fail '此部署文件针对 Ubuntu 22.04/24.04。'
case "${VERSION_ID:-}" in 22.04|24.04) ;; *) fail '此部署文件针对 Ubuntu 22.04/24.04。' ;; esac
command -v python3 >/dev/null || fail '缺少 Python 3。请先通过 Ubuntu 软件包安装 python3。'
command -v docker >/dev/null || fail '缺少 Docker。请按 Docker 官方 Ubuntu 文档安装 Engine 和 Compose 插件。'
docker compose version >/dev/null 2>&1 || fail '缺少 Docker Compose 插件。请先完成 Docker 官方安装。'
docker info >/dev/null 2>&1 || fail 'Docker 引擎未运行，或当前 SSH 用户没有访问权限。'
test -f "$directory/compose.yaml" || fail '部署目录内缺少 compose.yaml。'
compose_args=(--project-directory "$directory" --file "$directory/compose.yaml")
if test -f "$directory/compose.memory.yaml"; then
  compose_args+=(--file "$directory/compose.memory.yaml")
fi
docker compose "${compose_args[@]}" config --quiet
if test "$action" = preflight; then
  printf '%s\n' 'Ubuntu、架构、Python、Docker、Compose 权限和部署语法检查通过；未写入 Key、未拉取镜像或启动容器。'
  exit 0
fi
test -f "$directory/deployment.json" || fail '部署元数据缺失；不会操作未知现有容器。'

case "$action" in
  check|up)
    test -f "$directory/private/astrbot-data/cmd_config.json" || fail '尚未初始化独立配置。请先调用 prepare.py，并通过标准输入提供大肥鱼专用 Key。'
    python3 "$directory/prepare.py" --directory "$directory" --verify >/dev/null
    ;;
  stop|status)
    # Changed application settings must never prevent stopping this deployment.
    python3 "$directory/prepare.py" --directory "$directory" --verify --identity-only >/dev/null
    ;;
esac
case "$action" in
  check) printf '%s\n' '部署文件和依赖检查通过；未启动容器。' ;;
  up)
    docker compose "${compose_args[@]}" pull
    docker compose "${compose_args[@]}" up -d
    printf '%s\n' '容器已提交启动；仍需在官方界面确认协议、首次设密和 QQ 扫码。QQ 收发及模型调用尚未验证。'
    ;;
  stop) docker compose "${compose_args[@]}" stop ;;
  status) docker compose "${compose_args[@]}" ps --format json ;;
esac

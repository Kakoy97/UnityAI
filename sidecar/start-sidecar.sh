#!/bin/bash
# Unity Sidecar 一键启动脚本 (macOS/Linux)
# 自动设置环境变量并启动 Sidecar

echo "启动 Unity Sidecar (启用 MCP Adapter)..."

# 设置环境变量
export ENABLE_MCP_ADAPTER=true
export ENABLE_MCP_EYES=true
export MCP_MAX_QUEUE=1
export MCP_STREAM_MAX_EVENTS=500
export MCP_STREAM_MAX_SUBSCRIBERS=32
export MCP_STREAM_RECOVERY_JOBS_MAX=20

echo "环境变量已设置:"
echo "  ENABLE_MCP_ADAPTER=$ENABLE_MCP_ADAPTER"
echo "  ENABLE_MCP_EYES=$ENABLE_MCP_EYES"
echo "  MCP_MAX_QUEUE=$MCP_MAX_QUEUE"
echo ""

# 启动 Sidecar
echo "正在启动 Sidecar..."
npm start

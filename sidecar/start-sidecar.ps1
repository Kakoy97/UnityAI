# Unity Sidecar 一键启动脚本 (Windows PowerShell)
# 自动设置环境变量并启动 Sidecar

# 设置控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Write-Host "Starting Unity Sidecar (MCP Adapter enabled)..." -ForegroundColor Green

# 设置环境变量
$env:ENABLE_MCP_ADAPTER = "true"
$env:MCP_MAX_QUEUE = "1"
$env:MCP_STREAM_MAX_EVENTS = "500"
$env:MCP_STREAM_MAX_SUBSCRIBERS = "32"
$env:MCP_STREAM_RECOVERY_JOBS_MAX = "20"

Write-Host "Environment variables set:" -ForegroundColor Yellow
Write-Host "  ENABLE_MCP_ADAPTER=$env:ENABLE_MCP_ADAPTER" -ForegroundColor Gray
Write-Host "  MCP_MAX_QUEUE=$env:MCP_MAX_QUEUE" -ForegroundColor Gray
Write-Host ""

# 启动 Sidecar
Write-Host "Starting Sidecar..." -ForegroundColor Green
npm start

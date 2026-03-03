# Unity HF专项测试运行脚本
# 请修改下面的Unity路径为你的实际安装路径

# 方式1: 如果Unity通过Unity Hub安装，取消下面的注释并修改版本号
# $env:UNITY_EXE = "C:\Program Files\Unity\Hub\Editor\2021.3.45f2c1\Editor\Unity.exe"

# 方式2: 如果Unity直接安装，取消下面的注释并修改路径
# $env:UNITY_EXE = "C:\Program Files\Unity\Editor\Unity.exe"

# 方式3: 如果Unity在其他位置，请手动设置路径
# $env:UNITY_EXE = "<你的Unity.exe完整路径>"

# 检查Unity.exe是否存在
if (-not $env:UNITY_EXE -or -not (Test-Path $env:UNITY_EXE)) {
    Write-Host "错误: 请先设置正确的Unity.exe路径" -ForegroundColor Red
    Write-Host "当前项目使用的Unity版本: 2021.3.45f2c1" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请选择以下方式之一:" -ForegroundColor Cyan
    Write-Host "1. 如果Unity通过Unity Hub安装，路径格式通常是:" -ForegroundColor Cyan
    Write-Host "   C:\Program Files\Unity\Hub\Editor\<版本号>\Editor\Unity.exe" -ForegroundColor Cyan
    Write-Host "2. 如果Unity直接安装，路径格式通常是:" -ForegroundColor Cyan
    Write-Host "   C:\Program Files\Unity\Editor\Unity.exe" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "找到Unity.exe后，请修改本脚本中的 `$env:UNITY_EXE` 变量" -ForegroundColor Yellow
    exit 1
}

Write-Host "使用Unity路径: $env:UNITY_EXE" -ForegroundColor Green
Write-Host "开始运行Unity EditMode测试..." -ForegroundColor Green
Write-Host ""

# 运行测试
& $env:UNITY_EXE `
  -batchmode -nographics -quit `
  -projectPath "D:\csgo\csgoToolV02\UnityAI" `
  -runTests -testPlatform EditMode `
  -testFilter "UnityAI.Editor.Codex.Tests.EditMode.UnityRuntimeRecoveryTests" `
  -testResults "Assets/Docs/evidence/phase20/2026-03-03/case-f-unity-editmode-results.xml"

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "✓ 测试完成！结果已保存到:" -ForegroundColor Green
    Write-Host "  Assets/Docs/evidence/phase20/2026-03-03/case-f-unity-editmode-results.xml" -ForegroundColor Green
} else {
    Write-Host "✗ 测试执行失败，退出代码: $exitCode" -ForegroundColor Red
}

exit $exitCode

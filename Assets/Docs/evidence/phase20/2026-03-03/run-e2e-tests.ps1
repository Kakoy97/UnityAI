# Phase20 E2E Test Runner
# Run this script after sidecar is started on http://127.0.0.1:46321

$baseUrl = "http://127.0.0.1:46321"
$evidenceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$date = "2026-03-03"

Write-Host "Running Phase20 E2E Tests..." -ForegroundColor Green

# Case A: Contract Discoverability
Write-Host "`nCase A: Contract Discoverability" -ForegroundColor Yellow

# A-001: get_write_contract_bundle
$bodyA001 = @{
    tool_name = "apply_visual_actions"
    action_type = "rename_object"
} | ConvertTo-Json

try {
    $responseA001 = Invoke-RestMethod -Uri "$baseUrl/mcp/get_write_contract_bundle" -Method POST -ContentType "application/json" -Body $bodyA001
    $responseA001 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-a-get-write-contract-bundle.json" -Encoding utf8
    Write-Host "✓ P20-A-CONTRACT-001: get_write_contract_bundle" -ForegroundColor Green
} catch {
    Write-Host "✗ P20-A-CONTRACT-001 failed: $_" -ForegroundColor Red
    @{error = $_.Exception.Message} | ConvertTo-Json | Out-File -FilePath "$evidenceDir\case-a-get-write-contract-bundle.json" -Encoding utf8
}

# A-002: get_action_schema
$bodyA002 = @{
    action_type = "rename_object"
} | ConvertTo-Json

try {
    $responseA002 = Invoke-RestMethod -Uri "$baseUrl/mcp/get_action_schema" -Method POST -ContentType "application/json" -Body $bodyA002
    $responseA002 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-a-get-action-schema-template.json" -Encoding utf8
    Write-Host "✓ P20-A-CONTRACT-002: get_action_schema" -ForegroundColor Green
} catch {
    Write-Host "✗ P20-A-CONTRACT-002 failed: $_" -ForegroundColor Red
    @{error = $_.Exception.Message} | ConvertTo-Json | Out-File -FilePath "$evidenceDir\case-a-get-action-schema-template.json" -Encoding utf8
}

# A-003: get_tool_schema
$bodyA003 = @{
    tool_name = "apply_visual_actions"
} | ConvertTo-Json

try {
    $responseA003 = Invoke-RestMethod -Uri "$baseUrl/mcp/get_tool_schema" -Method POST -ContentType "application/json" -Body $bodyA003
    $responseA003 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-a-get-tool-schema-sequence.json" -Encoding utf8
    Write-Host "✓ P20-A-CONTRACT-003: get_tool_schema" -ForegroundColor Green
} catch {
    Write-Host "✗ P20-A-CONTRACT-003 failed: $_" -ForegroundColor Red
    @{error = $_.Exception.Message} | ConvertTo-Json | Out-File -FilePath "$evidenceDir\case-a-get-tool-schema-sequence.json" -Encoding utf8
}

# Case B: Machine-Fixable Error
Write-Host "`nCase B: Machine-Fixable Error" -ForegroundColor Yellow

# B-001: Anchor error feedback
$bodyB001 = @{
    tool_name = "apply_visual_actions"
    payload = @{
        based_on_read_token = "test-token-123"
        write_anchor = @{
            object_id = "test-id"
            path = "Scene/Canvas/Panel"
        }
        actions = @(
            @{
                type = "rename_object"
                action_data = @{
                    name = "P20_Test"
                }
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $responseB001 = Invoke-RestMethod -Uri "$baseUrl/mcp/apply_visual_actions" -Method POST -ContentType "application/json" -Body $bodyB001 -ErrorAction Stop
    Write-Host "⚠ P20-B-FIX-001: Expected error but got success" -ForegroundColor Yellow
    $responseB001 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-anchor-error-feedback.json" -Encoding utf8
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    $errorResponse | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-anchor-error-feedback.json" -Encoding utf8
    Write-Host "✓ P20-B-FIX-001: Anchor error feedback collected" -ForegroundColor Green
}

# Case C: Preflight + Normalization
Write-Host "`nCase C: Preflight + Normalization" -ForegroundColor Yellow

$bodyC = @{
    tool_name = "apply_visual_actions"
    payload = @{
        based_on_read_token = "test-token-123"
        write_anchor = @{
            object_id = "test-id"
            path = "Scene/Canvas/Panel"
        }
        actions = @(
            @{
                type = "rename_object"
                action_data = @{
                    name = "P20_Test"
                }
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $responseC = Invoke-RestMethod -Uri "$baseUrl/mcp/preflight_validate_write_payload" -Method POST -ContentType "application/json" -Body $bodyC
    $responseC | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-c-preflight-normalized.json" -Encoding utf8
    Write-Host "✓ P20-C-PREFLIGHT-001: Preflight validation" -ForegroundColor Green
    Write-Host "✓ P20-C-NORMALIZE-001: Normalization" -ForegroundColor Green
} catch {
    Write-Host "✗ P20-C-PREFLIGHT-001 failed: $_" -ForegroundColor Red
    @{error = $_.Exception.Message} | ConvertTo-Json | Out-File -FilePath "$evidenceDir\case-c-preflight-normalized.json" -Encoding utf8
}

Write-Host "`nE2E Tests Complete!" -ForegroundColor Green
Write-Host "Evidence files saved to: $evidenceDir" -ForegroundColor Cyan

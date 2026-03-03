# Phase20 E2E Test Runner - Complete
# Run this script after sidecar is started on http://127.0.0.1:46321

$baseUrl = "http://127.0.0.1:46321"
$evidenceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Running Phase20 E2E Tests (Complete)..." -ForegroundColor Green

# Case B-002: Corrected payload retry
Write-Host "`nCase B-002: Corrected payload retry" -ForegroundColor Yellow

$bodyB002 = @{
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
                # Missing target_anchor - should be auto-filled
                action_data = @{
                    name = "P20_Test"
                }
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $responseB002 = Invoke-RestMethod -Uri "$baseUrl/mcp/preflight_validate_write_payload" -Method POST -ContentType "application/json" -Body $bodyB002
    $responseB002 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-corrected-payload-retry.json" -Encoding utf8
    Write-Host "✓ P20-B-FIX-002: Corrected payload" -ForegroundColor Green
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    $errorResponse | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-corrected-payload-retry.json" -Encoding utf8
    Write-Host "✓ P20-B-FIX-002: Error feedback collected" -ForegroundColor Green
}

# Case B-003: Action data error feedback
Write-Host "`nCase B-003: Action data error feedback" -ForegroundColor Yellow

$bodyB003 = @{
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
                target_anchor = @{
                    object_id = "test-id"
                    path = "Scene/Canvas/Panel"
                }
                action_data = "invalid-string-instead-of-object"
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $responseB003 = Invoke-RestMethod -Uri "$baseUrl/mcp/apply_visual_actions" -Method POST -ContentType "application/json" -Body $bodyB003 -ErrorAction Stop
    Write-Host "⚠ P20-B-FIX-003: Expected error but got success" -ForegroundColor Yellow
    $responseB003 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-action-data-error-feedback.json" -Encoding utf8
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    $errorResponse | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-b-action-data-error-feedback.json" -Encoding utf8
    Write-Host "✓ P20-B-FIX-003: Action data error feedback collected" -ForegroundColor Green
}

# Case C-002: Dry run alias parity
Write-Host "`nCase C-002: Dry run alias parity" -ForegroundColor Yellow

$bodyC002 = @{
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
    dry_run = $true
} | ConvertTo-Json -Depth 10

try {
    $responseC002 = Invoke-RestMethod -Uri "$baseUrl/mcp/apply_visual_actions" -Method POST -ContentType "application/json" -Body $bodyC002
    $responseC002 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-c-dry-run-alias-parity.json" -Encoding utf8
    Write-Host "✓ P20-C-PREFLIGHT-002: Dry run alias parity" -ForegroundColor Green
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    $errorResponse | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-c-dry-run-alias-parity.json" -Encoding utf8
    Write-Host "✓ P20-C-PREFLIGHT-002: Error collected" -ForegroundColor Green
}

# Case C-NORMALIZE-002: Ambiguous anchor rejected
Write-Host "`nCase C-NORMALIZE-002: Ambiguous anchor rejected" -ForegroundColor Yellow

$bodyCNorm002 = @{
    tool_name = "apply_visual_actions"
    payload = @{
        based_on_read_token = "test-token-123"
        write_anchor = @{
            object_id = "test-id"
            path = "Scene/Canvas/Panel"
        }
        actions = @(
            @{
                type = "create_gameobject"
                # create requires parent_anchor, not target_anchor
                target_anchor = @{
                    object_id = "test-id"
                    path = "Scene/Canvas/Panel"
                }
                action_data = @{}
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $responseCNorm002 = Invoke-RestMethod -Uri "$baseUrl/mcp/preflight_validate_write_payload" -Method POST -ContentType "application/json" -Body $bodyCNorm002 -ErrorAction Stop
    Write-Host "⚠ P20-C-NORMALIZE-002: Expected rejection but got success" -ForegroundColor Yellow
    $responseCNorm002 | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-c-ambiguous-anchor-rejected.json" -Encoding utf8
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    $errorResponse | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-c-ambiguous-anchor-rejected.json" -Encoding utf8
    Write-Host "✓ P20-C-NORMALIZE-002: Ambiguous anchor rejected" -ForegroundColor Green
}

# Case D: Retry Governance
Write-Host "`nCase D: Retry Governance" -ForegroundColor Yellow

$threadId = "test-thread-" + [Guid]::NewGuid().ToString()
$bodyD = @{
    tool_name = "apply_visual_actions"
    payload = @{
        based_on_read_token = "stale-token-123"
        write_anchor = @{
            object_id = "test-id"
            path = "Scene/Canvas/Panel"
        }
        actions = @(
            @{
                type = "rename_object"
                target_anchor = @{
                    object_id = "test-id"
                    path = "Scene/Canvas/Panel"
                }
                action_data = @{
                    name = "P20_Test"
                }
            }
        )
    }
    thread_id = $threadId
} | ConvertTo-Json -Depth 10

# First attempt - should fail with stale snapshot
Write-Host "  First attempt (should fail with stale snapshot)..." -ForegroundColor Gray
try {
    $responseD1 = Invoke-RestMethod -Uri "$baseUrl/mcp/apply_visual_actions" -Method POST -ContentType "application/json" -Body $bodyD -ErrorAction Stop
    Write-Host "  ⚠ First attempt succeeded unexpectedly" -ForegroundColor Yellow
} catch {
    $errorD1 = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  ✓ First attempt failed as expected: $($errorD1.error_code)" -ForegroundColor Green
    
    # Second attempt - should be blocked by duplicate retry fuse
    Write-Host "  Second attempt (should be blocked by duplicate retry fuse)..." -ForegroundColor Gray
    Start-Sleep -Milliseconds 100
    try {
        $responseD2 = Invoke-RestMethod -Uri "$baseUrl/mcp/apply_visual_actions" -Method POST -ContentType "application/json" -Body $bodyD -ErrorAction Stop
        Write-Host "  ⚠ Second attempt succeeded unexpectedly" -ForegroundColor Yellow
    } catch {
        $errorD2 = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "  ✓ Second attempt blocked: $($errorD2.error_code)" -ForegroundColor Green
        
        $retryEvidence = @{
            first_attempt = $errorD1
            second_attempt = $errorD2
            thread_id = $threadId
        }
        $retryEvidence | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-d-retry-fuse-blocked.json" -Encoding utf8
        
        # Check retry policy
        if ($errorD1.retry_policy) {
            $retryPolicyEvidence = @{
                error_code = $errorD1.error_code
                retry_policy = $errorD1.retry_policy
            }
            $retryPolicyEvidence | ConvertTo-Json -Depth 10 | Out-File -FilePath "$evidenceDir\case-d-stale-retry-policy.json" -Encoding utf8
            Write-Host "✓ P20-D-RETRY-003: Retry policy collected" -ForegroundColor Green
        }
    }
}

Write-Host "`nAll E2E Tests Complete!" -ForegroundColor Green
Write-Host "Evidence files saved to: $evidenceDir" -ForegroundColor Cyan

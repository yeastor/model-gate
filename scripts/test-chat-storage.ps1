$ErrorActionPreference = 'Stop'
$fixture = [guid]::NewGuid().ToString('N').Substring(0, 10)
$pgId = $null
$chId = $null
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    # Use throwaway credentials and bind to loopback only. Docker rejects occupied ports.
    $pgId = docker run --rm -d --name "aiz-crypto-pg-$fixture" --label 'aiz.test=chat-encryption' -p '127.0.0.1:19432:5432' -e 'POSTGRES_USER=ga_test' -e 'POSTGRES_DB=ga_test' -e 'POSTGRES_PASSWORD=ga-isolated-test-only' postgres:17-alpine
    if ($LASTEXITCODE) { throw 'Could not start disposable PostgreSQL.' }
    $chId = docker run --rm -d --name "aiz-crypto-ch-$fixture" --label 'aiz.test=chat-encryption' -p '127.0.0.1:19900:9000' -e 'CLICKHOUSE_USER=ga_test' -e 'CLICKHOUSE_PASSWORD=ga-isolated-test-only' clickhouse/clickhouse-server:25.12-alpine
    if ($LASTEXITCODE) { throw 'Could not start disposable ClickHouse.' }
    $ready = $false
    foreach ($attempt in 1..25) {
        docker exec $pgId pg_isready -h 127.0.0.1 -U ga_test -d ga_test | Out-Null
        $pgReady = $LASTEXITCODE -eq 0
        docker exec $chId clickhouse-client --user ga_test --password ga-isolated-test-only --query 'SELECT 1' 2>$null | Out-Null
        if ($pgReady -and $LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Disposable database readiness timed out.' }
    $env:GA_E2E_OUTPUT = 'temporary'
    $env:GA_E2E_PG_DSN = 'postgres://ga_test:ga-isolated-test-only@127.0.0.1:19432/ga_test?sslmode=disable'
    $env:GA_E2E_CH_ADDR = '127.0.0.1:19900'
    $env:GA_E2E_PG_CONTAINER = $pgId
    $env:GA_E2E_CH_CONTAINER = $chId
    $env:GA_E2E_NODE = (Get-Command node).Source
    go test -v ./internal/api/modelgate -run '^TestGosuslugiConditionalHelpRealAPI$' -count=1
    if ($LASTEXITCODE) { throw 'Chat HTTP integration failed.' }
} finally {
    if ($chId -match '^[a-f0-9]{64}$') { docker stop --time 2 $chId | Out-Null }
    if ($pgId -match '^[a-f0-9]{64}$') { docker stop --time 2 $pgId | Out-Null }
    Pop-Location
}

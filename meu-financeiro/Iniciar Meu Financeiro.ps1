$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPort = 3010
$appUrl = "http://127.0.0.1:$desktopPort"

function Get-FinanceiroHealth {
  try {
    return Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Test-FinanceiroReady {
  $health = Get-FinanceiroHealth
  return ($health.ok -and $health.database -eq 'connected' -and $health.monthlyBudget)
}

$runningApp = Get-FinanceiroHealth
if ($runningApp.ok -and $runningApp.database -eq 'connected' -and -not $runningApp.monthlyBudget) {
  # Uma versão anterior pode continuar aberta no Windows durante a atualização.
  $desktopPort = 3011
  $appUrl = "http://127.0.0.1:$desktopPort"
}

if (-not (Test-FinanceiroReady)) {
  foreach ($serviceName in @('MySQL80', 'MySQL')) {
    try {
      $mysqlService = Get-Service -Name $serviceName -ErrorAction Stop
      if ($mysqlService.Status -ne 'Running') {
        Start-Service -Name $serviceName -ErrorAction Stop
        $mysqlService.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
      }
      break
    } catch {
      continue
    }
  }
  $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('O Node.js não foi encontrado. Instale o Node.js para iniciar o Meu Financeiro.', 'Meu Financeiro') | Out-Null
    exit 1
  }
  $previousPort = $env:PORT
  try {
    $env:PORT = [string]$desktopPort
    Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $projectPath -WindowStyle Hidden
  } finally {
    $env:PORT = $previousPort
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  do {
    Start-Sleep -Seconds 1
    if (Test-FinanceiroReady) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
}

if (Test-FinanceiroReady) {
  Start-Process $appUrl
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Não consegui conectar ao MySQL. Confira se o serviço MySQL está iniciado e tente novamente.', 'Meu Financeiro') | Out-Null
  exit 1
}

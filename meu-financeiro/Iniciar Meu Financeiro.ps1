$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = 'http://127.0.0.1:3000'

function Test-FinanceiroReady {
  try {
    $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
    return ($health.ok -and $health.database -eq 'connected')
  } catch {
    return $false
  }
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
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('O Node.js não foi encontrado. Instale o Node.js para iniciar o Meu Financeiro.', 'Meu Financeiro') | Out-Null
    exit 1
  }
  Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $projectPath -WindowStyle Hidden
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

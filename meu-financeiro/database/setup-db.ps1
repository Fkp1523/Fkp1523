$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
$schemaFile = Join-Path $PSScriptRoot 'schema.sql'
$mysqlExe = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'Crie o arquivo .env a partir de .env.example e preencha a conexão MySQL.' }
if (-not (Test-Path -LiteralPath $mysqlExe)) { throw 'Não encontrei o cliente mysql.exe no caminho padrão do MySQL Server 8.0.' }

$config = ConvertFrom-StringData (Get-Content -LiteralPath $envFile -Raw)
if ([string]::IsNullOrWhiteSpace($config.DB_PASSWORD)) { throw 'Preencha DB_PASSWORD no arquivo .env.' }

$env:MYSQL_PWD = $config.DB_PASSWORD
try {
  Write-Host 'Conectando ao MySQL e configurando o banco...'
  Get-Content -LiteralPath $schemaFile -Raw | & $mysqlExe --protocol=TCP --connect-timeout=5 -h $config.DB_HOST -P $config.DB_PORT -u $config.DB_USER --default-character-set=utf8mb4
  if ($LASTEXITCODE -ne 0) { throw 'O MySQL recusou o esquema. Confira a conexão e as permissões do usuário.' }
  Write-Host 'Banco e tabelas configurados.'
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}

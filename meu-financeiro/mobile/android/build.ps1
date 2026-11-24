[CmdletBinding()]
param(
    [string]$SdkRoot = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }),
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$BuildToolsVersion,
    [int]$Platform = 0,
    [string]$KeyStore = (Join-Path $env:LOCALAPPDATA 'MeuFinanceiro\assinatura\release.p12'),
    [string]$Output = (Join-Path $PSScriptRoot '..\..\..\Meu Financeiro - Android.apk')
)
$ErrorActionPreference = 'Stop'
$Project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Storage = [System.Text.UTF8Encoding]::new($false)

function RunTool([string]$Tool, [string[]]$ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao executar $([IO.Path]::GetFileName($Tool)) (código $LASTEXITCODE)."
    }
}

function RequireFile([string]$Path, [string]$Description) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Não encontrei $Description em $Path."
    }
    return $Path
}

function JavaTool([string]$Name) {
    if ($JavaHome) { return RequireFile (Join-Path $JavaHome "bin\$Name.exe") $Name }
    return (Get-Command "$Name.exe" -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}

if (!(Test-Path -LiteralPath $SdkRoot -PathType Container)) {
    throw 'Informe o caminho de um Android SDK instalado com -SdkRoot.'
}
if (!$BuildToolsVersion) {
    $versions = Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'build-tools') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending
    if (!$versions) { throw 'Instale a versão estável do Android SDK Build Tools.' }
    $BuildToolsVersion = @($versions)[0].Name
}
if ($Platform -eq 0) {
    $platforms = Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'platforms') -Directory |
        Where-Object { $_.Name -match '^android-(\d+)$' } |
        ForEach-Object { [int]$_.Name.Substring(8) } |
        Sort-Object -Descending
    if (!$platforms) { throw 'Instale a plataforma do Android SDK.' }
    $Platform = @($platforms)[0]
}
if ($Platform -lt 34) { throw 'Instale a plataforma Android 34 ou superior.' }

$Tools = Join-Path $SdkRoot "build-tools\$BuildToolsVersion"
$AndroidJar = RequireFile (Join-Path $SdkRoot "platforms\android-$Platform\android.jar") 'android.jar'
$Aapt2 = RequireFile (Join-Path $Tools 'aapt2.exe') 'aapt2'
$D8 = RequireFile (Join-Path $Tools 'd8.bat') 'd8'
$ZipAlign = RequireFile (Join-Path $Tools 'zipalign.exe') 'zipalign'
$Signer = RequireFile (Join-Path $Tools 'apksigner.bat') 'apksigner'
$Javac = JavaTool 'javac'
$Jar = JavaTool 'jar'
$Keytool = JavaTool 'keytool'
$Node = (Get-Command 'node.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

$KeyStore = [IO.Path]::GetFullPath($KeyStore)
if ($KeyStore.StartsWith($Project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Escolha um caminho privado para a chave, fora da pasta do projeto.'
}
$PasswordStore = $KeyStore + '.dpapi'
$Output = [IO.Path]::GetFullPath($Output)
$Build = Join-Path ([IO.Path]::GetTempPath()) ('meu-financeiro-android-' + [guid]::NewGuid().ToString('N'))
$Classes = Join-Path $Build 'classes'
$Dex = Join-Path $Build 'dex'
$Web = Join-Path $Build 'web'
$Res = Join-Path $Build 'res'
$IconDir = Join-Path $Res 'mipmap-xxxhdpi'
$OldJavaHome = $env:JAVA_HOME

try {
    $null = New-Item -ItemType Directory -Force -Path $Classes, $Dex, $Web, $IconDir
    if ($JavaHome) { $env:JAVA_HOME = $JavaHome }

    RunTool $Node @((Join-Path $Project 'mobile\build.cjs'), $Web)
    Copy-Item -LiteralPath (Join-Path $Project 'public\icon-192.png') -Destination (Join-Path $IconDir 'ic_launcher.png')
    $ResourceZip = Join-Path $Build 'compiled.zip'
    $Unsigned = Join-Path $Build 'unsigned.apk'
    $Aligned = Join-Path $Build 'aligned.apk'
    $Signed = Join-Path $Build 'signed.apk'
    $ClassJar = Join-Path $Build 'classes.jar'
    $Manifest = Join-Path $PSScriptRoot 'AndroidManifest.xml'

    RunTool $Javac @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $AndroidJar,
        '-d', $Classes, (Join-Path $PSScriptRoot 'MainActivity.java'))
    RunTool $Jar @('cf', $ClassJar, '-C', $Classes, '.')
    RunTool $D8 @('--release', '--min-api', '23', '--lib', $AndroidJar, '--output', $Dex, $ClassJar)
    RunTool $Aapt2 @('compile', '--dir', $Res, '-o', $ResourceZip)
    RunTool $Aapt2 @('link', '-o', $Unsigned, '-I', $AndroidJar, '--manifest', $Manifest, $ResourceZip)

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::Open($Unsigned, [IO.Compression.ZipArchiveMode]::Update)
    try {
        # Android's AssetManager uses forward slashes even for APKs built on Windows.
        foreach ($File in (Get-ChildItem -LiteralPath $Web -File -Recurse)) {
            $RelativePath = $File.FullName.Substring($Web.Length + 1).Replace('\', '/')
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive,
                $File.FullName, "assets/web/$RelativePath", [IO.Compression.CompressionLevel]::Optimal)
        }
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive,
            (Join-Path $Dex 'classes.dex'), 'classes.dex', [IO.Compression.CompressionLevel]::Optimal)
    } finally {
        $Archive.Dispose()
    }
    RunTool $ZipAlign @('-f', '4', $Unsigned, $Aligned)

    $null = New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $KeyStore)
    if (Test-Path -LiteralPath $PasswordStore) {
        $Protected = Get-Content -LiteralPath $PasswordStore -Raw
        $Password = [System.Net.NetworkCredential]::new('', (ConvertTo-SecureString $Protected.Trim())).Password
    } elseif (Test-Path -LiteralPath $KeyStore) {
        throw 'A chave existe, mas falta sua senha protegida. Recupere a senha para preservar a assinatura.'
    } else {
        $Random = [byte[]]::new(32)
        $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $Generator.GetBytes($Random) } finally { $Generator.Dispose() }
        $Password = [Convert]::ToBase64String($Random)
        $Protected = ConvertFrom-SecureString (ConvertTo-SecureString $Password -AsPlainText -Force)
        [IO.File]::WriteAllText($PasswordStore, $Protected, $Storage)
    }

    $env:MEU_FINANCEIRO_APK_KEY_PASSWORD = $Password
    if (!(Test-Path -LiteralPath $KeyStore)) {
        $NewStore = Join-Path $Build 'release.p12'
        RunTool $Keytool @('-genkeypair', '-storetype', 'PKCS12', '-keystore', $NewStore,
            '-storepass:env', 'MEU_FINANCEIRO_APK_KEY_PASSWORD', '-alias', 'meu-financeiro',
            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Meu Financeiro',
            '-noprompt')
        Copy-Item -LiteralPath $NewStore -Destination $KeyStore
    }

    RunTool $Signer @('sign', '--ks', $KeyStore, '--ks-key-alias', 'meu-financeiro',
        '--ks-pass', 'env:MEU_FINANCEIRO_APK_KEY_PASSWORD', '--out', $Signed, $Aligned)
    RunTool $Signer @('verify', '--verbose', $Signed)
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $Output)
    Copy-Item -LiteralPath $Signed -Destination $Output -Force
    Write-Output $Output
} finally {
    Remove-Item Env:MEU_FINANCEIRO_APK_KEY_PASSWORD -ErrorAction SilentlyContinue
    $env:JAVA_HOME = $OldJavaHome
    $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $ResolvedBuild = [IO.Path]::GetFullPath($Build)
    if ($ResolvedBuild.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        ([IO.Path]::GetFileName($ResolvedBuild) -match '^meu-financeiro-android-[a-f0-9]{32}$') -and
        (Test-Path -LiteralPath $ResolvedBuild -PathType Container)) {
        Remove-Item -LiteralPath $ResolvedBuild -Recurse -Force
    }
}

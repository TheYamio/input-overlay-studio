param([string]$Toolchain = "", [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $taskRoot
try {
    if (-not $SkipBuild) {
        Push-Location (Join-Path $taskRoot 'studio')
        try {
            & pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
            & pnpm build
            if ($LASTEXITCODE -ne 0) { throw 'Studio build failed' }
            & pnpm test
            if ($LASTEXITCODE -ne 0) { throw 'Studio tests failed' }
        } finally { Pop-Location }
        $cargoArguments = @()
        if ($Toolchain) { $cargoArguments += "+$Toolchain" }
        & cargo @cargoArguments test --manifest-path ws-server/src-tauri/Cargo.toml --lib
        if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
        & cargo @cargoArguments build --release --manifest-path ws-server/src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed' }
    }
    $binary = Join-Path $taskRoot 'ws-server/src-tauri/target/release/input-overlay-ws.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw 'Release binary does not exist' }
    $package = Join-Path $taskRoot 'release/Input Overlay Studio'
    New-Item -ItemType Directory -Path $package -Force | Out-Null
    Copy-Item -LiteralPath $binary -Destination (Join-Path $package 'Input Overlay Studio.exe')
    $loader = Join-Path $taskRoot 'ws-server/src-tauri/target/release/WebView2Loader.dll'
    if (Test-Path -LiteralPath $loader) { Copy-Item -LiteralPath $loader -Destination $package }
    $unwind = Join-Path $taskRoot 'ws-server/src-tauri/target/release/libunwind.dll'
    if (-not (Test-Path -LiteralPath $unwind)) {
        $clang = Get-Command 'x86_64-w64-mingw32-clang.exe' -ErrorAction SilentlyContinue
        if ($clang) { $unwind = Join-Path (Split-Path -Parent $clang.Source) 'libunwind.dll' }
    }
    if (Test-Path -LiteralPath $unwind) { Copy-Item -LiteralPath $unwind -Destination $package }
    foreach ($notice in @('LICENSE', 'README.md', 'README.upstream.md', 'THIRD_PARTY_NOTICES.md')) {
        Copy-Item -LiteralPath (Join-Path $taskRoot $notice) -Destination $package
    }
    Copy-Item -LiteralPath (Join-Path $taskRoot 'docs') -Destination $package -Recurse -Force
    # Include the WebView2 SDK notice if the dependency supplies one.
    $dependencyRoot = if ($env:CARGO_HOME) { Join-Path $env:CARGO_HOME 'registry/src' } else { Join-Path $env:USERPROFILE '.cargo/registry/src' }
    if (Test-Path -LiteralPath $dependencyRoot) {
        Get-ChildItem -LiteralPath $dependencyRoot -Directory | ForEach-Object {
            Get-ChildItem -LiteralPath $_.FullName -Directory -Filter 'webview2-com-sys-*' | ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -File | Where-Object { $_.Name -match 'LICENSE|NOTICE' } | ForEach-Object {
                    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $package ("WebView2-" + $_.Name))
                }
            }
        }
    }
    Compress-Archive -LiteralPath $package -DestinationPath (Join-Path $taskRoot 'release/Input-Overlay-Studio-Windows-x64.zip') -Force
    $sourceRoot = Join-Path $taskRoot ('release/source-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
    $sourcePaths = & git -c core.quotepath=false ls-files --cached --others --exclude-standard
    foreach ($relative in $sourcePaths) {
        $sourceFile = Join-Path $taskRoot $relative
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
        $destination = Join-Path $sourceRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $sourceFile -Destination $destination
    }
    Compress-Archive -LiteralPath $sourceRoot -DestinationPath (Join-Path $taskRoot 'release/Input-Overlay-Studio-Source.zip') -Force
    Write-Output "Packaged: $package"
} finally { Pop-Location }

param([string]$Toolchain = "", [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $taskRoot
try {
    $version = (Get-Content -LiteralPath (Join-Path $taskRoot 'studio/package.json') -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid package version' }
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
        & cargo @cargoArguments test --locked --manifest-path ws-server/src-tauri/Cargo.toml --lib
        if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
        & cargo @cargoArguments build --locked --release --manifest-path ws-server/src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed' }
    }
    $binary = Join-Path $taskRoot 'ws-server/src-tauri/target/release/input-overlay-ws.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw 'Release binary does not exist' }
    if ((Get-Item -LiteralPath $binary).VersionInfo.ProductVersion -ne $version) { throw 'Binary version does not match package.json' }
    if (& git status --porcelain) { throw 'Commit the release sources before packaging' }
    $package = Join-Path $taskRoot "release/Input Overlay Studio $version"
    if (Test-Path -LiteralPath $package) { throw "Package already exists: $package. Use a fresh release version or move the existing package first." }
    New-Item -ItemType Directory -Path $package -Force | Out-Null
    Copy-Item -LiteralPath $binary -Destination (Join-Path $package 'Input Overlay Studio.exe')
    $loader = Join-Path $taskRoot 'ws-server/src-tauri/target/release/WebView2Loader.dll'
    if (-not (Test-Path -LiteralPath $loader)) { throw 'WebView2Loader.dll is missing from the release directory' }
    if (Test-Path -LiteralPath $loader) { Copy-Item -LiteralPath $loader -Destination $package }
    $unwind = Join-Path $taskRoot 'ws-server/src-tauri/target/release/libunwind.dll'
    if (-not (Test-Path -LiteralPath $unwind)) {
        $clang = Get-Command 'x86_64-w64-mingw32-clang.exe' -ErrorAction SilentlyContinue
        if ($clang) { $unwind = Join-Path (Split-Path -Parent $clang.Source) 'libunwind.dll' }
    }
    if (Test-Path -LiteralPath $unwind) { Copy-Item -LiteralPath $unwind -Destination $package }
    # Keep the portable directory limited to runtime files. Guides, attribution
    # and dependency licenses remain available in the corresponding tagged sources.
    foreach ($requiredNotice in @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/LLVM-RUNTIME-LICENSE.txt', 'docs/WEBVIEW2-SDK-LICENSE.txt', 'docs/WEBVIEW2-SDK-NOTICE.txt')) {
        & git cat-file -e "HEAD:$requiredNotice"
        if ($LASTEXITCODE -ne 0) { throw "Release sources are missing required notice: $requiredNotice" }
    }
    $archive = Join-Path $taskRoot "release/Input-Overlay-Studio-$version-Windows-x64.zip"
    Compress-Archive -LiteralPath $package -DestinationPath $archive -Force
    Write-Output "Packaged: $package"
} finally { Pop-Location }

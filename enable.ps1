# 一次性把本插件补进 profile 的 dsh.profile.bundles
#
# 为什么需要它：DSH 的插件管理器（含 `dsh plugin add`）只把包写进 profile 的
# dependencies，**不会**同时写进 dsh.profile.bundles。少了这一行，Host 半不会加载，
# 界面上表现为「插件已安装但按钮不出来 / 接口 404」。
#
# 用法：安装完插件后运行一次，然后重启 DSH。
#   powershell -ExecutionPolicy Bypass -File .\enable.ps1

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-restart-plugin'

$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
if (-not (Test-Path $profileDir)) {
  Write-Host "找不到 profile 目录：$profileDir" -ForegroundColor Red
  exit 1
}
$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) {
  Write-Host "找不到 $pkgPath" -ForegroundColor Red
  exit 1
}

# 备份（带时间戳），避免改坏 profile
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$pkgPath.bak-$stamp"
Copy-Item $pkgPath $backup -Force
Write-Host "已备份 profile → $backup" -ForegroundColor DarkGray

$json = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
if ($null -eq $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
if ($null -eq $json.dsh.profile.bundles) {
  $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() -Force
}

$bundles = @($json.dsh.profile.bundles)
if ($bundles -contains $pluginName) {
  Write-Host "$pluginName 已在 dsh.profile.bundles 里，无需改动。" -ForegroundColor Green
  exit 0
}

$json.dsh.profile.bundles = @($bundles + $pluginName)
$out = $json | ConvertTo-Json -Depth 20
# 用 UTF-8 无 BOM 写回，避免 JSON 解析问题
[System.IO.File]::WriteAllText($pkgPath, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已把 $pluginName 补进 dsh.profile.bundles。" -ForegroundColor Green
Write-Host "现在请重启 DSH，按钮才会出现。" -ForegroundColor Yellow

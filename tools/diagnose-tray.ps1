<#
.SYNOPSIS
  DSH 重启体检工具：一次看清「有没有重复实例、托盘有几个图标、吃多少资源」。

.DESCRIPTION
  为什么需要它：
  重启插件在真机上出现过「任务栏两个托盘图标、鼠标移上去才消失」的现象。
  光靠肉眼看无法区分两种完全不同的情况：
    a) 幽灵图标（旧进程被硬杀，Windows 通知区域留下的残留条目）——无害；
    b) 真的多启动了一个实例（会额外占内存/CPU）——有害，必须修。
  本工具把这两件事分别测出来，避免「凭感觉判断」。

  它做三件事：
    1. 按角色统计 DSH 进程（MAIN/HOST/renderer/gpu/utility），重复 MAIN 会标红；
    2. 用 UI Automation 枚举通知区域里的托盘按钮，数出 DSH 相关图标个数；
    3. 汇总内存与 CPU 占用，并采样 3 秒判断是否有异常忙等。

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\diagnose-tray.ps1
#>

$ErrorActionPreference = 'Stop'

function Get-DshProcesses {
  # 注意：本工具自己的 bash/node 子进程是通过 DSH 的 subprocess runner 起的，
  # 命令行里也带着 "DeepSeek Harness.exe" 字样，会被误判成 MAIN。
  # 所以这里额外排除「以脚本方式运行其他程序」的那些（命令行里用引号跑外部脚本的特征）。
  Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      # 排除子进程运行器：它把一个外部命令当作参数执行，不是应用本体。
      -not ($_.CommandLine -match 'dsh-subprocess-local[\\/](runner|lib)')
    } |
    ForEach-Object {
      $cmd = [string]$_.CommandLine
      $kind =
        if ($cmd -match '--type=renderer') { 'renderer' }
        elseif ($cmd -match '--type=gpu') { 'gpu' }
        elseif ($cmd -match '--type=utility') { 'utility' }
        elseif ($cmd -match 'desktop-host') { 'HOST' }
        else { 'MAIN' }
      [pscustomobject]@{
        ProcessId       = [int]$_.ProcessId
        ParentProcessId = [int]$_.ParentProcessId
        CreationDate    = $_.CreationDate
        Kind            = $kind
      }
    }
}

function Get-TrayIconNames {
  # 用 UI Automation 读通知区域按钮的 Name（通常就是工具提示文本）。
  # 不依赖任何第三方模块。
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
  } catch {
    return @{ supported = $false; names = @(); reason = "UI Automation 不可用：$($_.Exception.Message)" }
  }
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
    $tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -eq $tray) {
      return @{ supported = $false; names = @(); reason = '找不到 Shell_TrayWnd' }
    }
    $buttonCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button)
    $buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCond)
    $names = @()
    foreach ($button in $buttons) {
      $name = $button.Current.Name
      if (-not [string]::IsNullOrWhiteSpace($name)) { $names += $name }
    }
    return @{ supported = $true; names = $names; reason = '' }
  } catch {
    return @{ supported = $false; names = @(); reason = "枚举失败：$($_.Exception.Message)" }
  }
}

Write-Output '================ DSH 重启体检 ================'
Write-Output ('时间: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Output ''

# ---------- 1. 进程 ----------
$processes = @(Get-DshProcesses)
Write-Output '--- 1. 进程角色 ---'
if ($processes.Count -eq 0) {
  Write-Output '未发现 DSH 进程（应用可能已关闭）'
} else {
  $processes | Sort-Object CreationDate | Format-Table ProcessId, ParentProcessId, Kind, CreationDate -AutoSize | Out-String | Write-Output
  $mainCount = @($processes | Where-Object { $_.Kind -eq 'MAIN' }).Count
  $hostCount = @($processes | Where-Object { $_.Kind -eq 'HOST' }).Count
  if ($mainCount -gt 1) {
    Write-Output ("[警告] 发现 {0} 个 MAIN 进程 —— 可能有重复实例，会额外占用内存/CPU" -f $mainCount)
  } else {
    Write-Output ("[正常] MAIN 进程 1 个（没有重复实例）")
  }
  if ($hostCount -gt 1) {
    Write-Output ("[警告] 发现 {0} 个 Host 进程 —— 可能有重复实例" -f $hostCount)
  } else {
    Write-Output ("[正常] Host 进程 {0} 个" -f $hostCount)
  }
}

# ---------- 2. 托盘图标 ----------
Write-Output ''
Write-Output '--- 2. 通知区域图标 ---'
$tray = Get-TrayIconNames
if ($tray.supported) {
  $dshIcons = @($tray.names | Where-Object { $_ -match 'DeepSeek' })
  Write-Output ("可见托盘按钮总数: {0}" -f $tray.names.Count)
  Write-Output ("其中 DSH 相关: {0}" -f $dshIcons.Count)
  if ($dshIcons.Count -gt 0) {
    Write-Output ('DSH 图标名称: ' + ($dshIcons -join ' | '))
  }
  if ($dshIcons.Count -gt 1) {
    Write-Output '[提示] 出现多个 DSH 托盘图标。若进程只有 1 个 MAIN，则多为旧进程被硬杀留下的幽灵图标（悬停即消失、不占资源）。'
  }
} else {
  Write-Output ('[跳过] ' + $tray.reason)
}

# ---------- 3. 资源 ----------
Write-Output ''
Write-Output '--- 3. 资源占用 ---'
$live = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($live.Count -gt 0) {
  $mem = [math]::Round((($live | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 1)
  $cpuBefore = ($live | Measure-Object CPU -Sum).Sum
  Write-Output ("进程总数: {0}" -f $live.Count)
  Write-Output ("总内存: {0} MB" -f $mem)
  Start-Sleep -Seconds 3
  $live2 = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
  $cpuAfter = ($live2 | Measure-Object CPU -Sum).Sum
  $delta = [math]::Round($cpuAfter - $cpuBefore, 2)
  Write-Output ("3 秒内 CPU 增量: {0} 秒" -f $delta)
  if ($delta -gt 2.5) {
    Write-Output '[警告] 空闲时 CPU 增量偏高，可能有进程在忙等'
  } else {
    Write-Output '[正常] 空闲 CPU 增量接近 0'
  }
}

Write-Output ''
Write-Output '================ 体检结束 ================'

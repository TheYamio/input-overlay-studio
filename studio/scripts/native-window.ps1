param([Parameter(Mandatory=$true)][int]$TaskProcessId, [ValidateSet('close','count','minimize','state')][string]$Mode='count')
$ErrorActionPreference='Stop'
Get-Process -Id $TaskProcessId -ErrorAction Stop | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StudioWindowTest {
    public delegate bool Visitor(IntPtr window, IntPtr arg);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor callback, IntPtr arg);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
$taskWindows=New-Object 'System.Collections.Generic.List[long]'
$visitor=[StudioWindowTest+Visitor]{ param([IntPtr]$window,[IntPtr]$argument)
    [uint32]$owner=0
    [void][StudioWindowTest]::GetWindowThreadProcessId($window,[ref]$owner)
    if ($owner -eq $TaskProcessId) {
        $title=New-Object System.Text.StringBuilder 512
        [void][StudioWindowTest]::GetWindowText($window,$title,512)
        if ($title.ToString() -eq 'Input Overlay Studio') { $taskWindows.Add($window.ToInt64()) }
    }
    return $true
}
[void][StudioWindowTest]::EnumWindows($visitor,[IntPtr]::Zero)
if ($Mode -eq 'close') {
    if ($taskWindows.Count -ne 1) { throw "Expected one owned Studio window, found $($taskWindows.Count)" }
    if (-not [StudioWindowTest]::PostMessage([IntPtr]$taskWindows[0],0x0010,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Close event failed' }
}
if ($Mode -eq 'minimize') {
    if ($taskWindows.Count -ne 1) { throw "Expected one owned Studio window, found $($taskWindows.Count)" }
    [void][StudioWindowTest]::ShowWindowAsync([IntPtr]$taskWindows[0],6)
}
if ($Mode -eq 'state') {
    [pscustomobject]@{
        Count = $taskWindows.Count
        Minimized = ($taskWindows.Count -eq 1 -and [StudioWindowTest]::IsIconic([IntPtr]$taskWindows[0]))
        Visible = ($taskWindows.Count -eq 1 -and [StudioWindowTest]::IsWindowVisible([IntPtr]$taskWindows[0]))
    } | ConvertTo-Json -Compress
    exit
}
$taskWindows.Count

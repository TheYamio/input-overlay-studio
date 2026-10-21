import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus } from 'node:os';
const execute = promisify(execFile);

// Only observes the explicitly supplied process and its descendants. Working sets
// include shared pages; summing them is not unique physical RAM consumption.
export async function processResources(rootProcessId, includeGPU = false) {
  if (!Number.isSafeInteger(rootProcessId) || rootProcessId <= 0) throw Error('Invalid process ID');
  const gpuScript = includeGPU ? "$gpuAvailable=$false; $gpuRows=@(); $gpuMemory=@(); try { $gpuRows=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -match '^pid_([0-9]+)_' -and $ids.Contains([int]$Matches[1]) } | Select-Object Name,UtilizationPercentage); $gpuAvailable=$true } catch {}; try { $gpuMemory=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction Stop | Where-Object { $_.Name -match '^pid_([0-9]+)_' -and $ids.Contains([int]$Matches[1]) } | Select-Object Name,DedicatedUsage,SharedUsage) } catch {};" : "$gpuAvailable=$false; $gpuRows=@(); $gpuMemory=@();";
  const script = `$ErrorActionPreference='Stop'; $all=Get-CimInstance Win32_Process; $started=($all | Where-Object ProcessId -eq ${rootProcessId}).CreationDate; if(-not $started) { throw 'Root process has exited' }; $ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${rootProcessId}); do { $changed=$false; foreach($entry in $all) { if($entry.CreationDate -ge $started -and $ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)) { $changed=$true } } } while($changed); $rows=@(foreach($processIdValue in $ids) { $p=Get-Process -Id $processIdValue -ErrorAction SilentlyContinue; if($p) { [PSCustomObject]@{ id=$p.Id; name=$p.ProcessName; cpuSeconds=$p.TotalProcessorTime.TotalSeconds; workingSetBytes=$p.WorkingSet64; privateBytes=$p.PrivateMemorySize64 } } }); ${gpuScript} [PSCustomObject]@{ gpuAvailable=$gpuAvailable; gpuEngines=$gpuRows; gpuMemory=$gpuMemory; atMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes=$rows } | ConvertTo-Json -Depth 4 -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 1048576 });
  return JSON.parse(stdout.trim());
}
export function resourceDelta(before, after) {
  const seconds = (after.atMs - before.atMs) / 1000, previous = new Map(before.processes.map(p => [p.id, p]));
  const exited = before.processes.some(p => !after.processes.some(next => next.id === p.id));
  const cpu = after.processes.reduce((sum, p) => sum + p.cpuSeconds - (previous.get(p.id)?.cpuSeconds || 0), 0) / seconds * 100;
  return { seconds, processCount: after.processes.length, exitedProcessesDuringSample: exited, cpuCorePercent: +cpu.toFixed(3), cpuMachinePercent: +(cpu / cpus().length).toFixed(3), summedWorkingSetMiB: +(after.processes.reduce((sum, p) => sum + p.workingSetBytes, 0) / 1048576).toFixed(2), privateCommitMiB: +(after.processes.reduce((sum, p) => sum + p.privateBytes, 0) / 1048576).toFixed(2) };
}

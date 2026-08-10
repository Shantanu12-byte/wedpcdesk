import { exec, spawn } from 'child_process';
import { ActionExecutor } from './index';
import { ActionConfig } from '../../../shared/types';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class WindowsActionExecutor implements ActionExecutor {
  async execute(action: ActionConfig): Promise<{ success: boolean; error?: string }> {
    try {
      switch (action.type) {
        case 'launch':
          if (!action.launchPath) {
            return { success: false, error: 'No launch path specified' };
          }
          return this.launchApp(action.launchPath);

        case 'shortcut':
          if (!action.shortcutKeys) {
            return { success: false, error: 'No shortcut keys specified' };
          }
          return this.simulateShortcut(action.shortcutKeys);

        case 'volume':
          if (!action.volumeType) {
            return { success: false, error: 'No volume action type specified' };
          }
          return this.handleVolume(action.volumeType);

        case 'power':
          if (!action.powerType) {
            return { success: false, error: 'No power action type specified' };
          }
          return this.handlePower(action.powerType);

        case 'command':
          if (!action.commandStr) {
            return { success: false, error: 'No command specified' };
          }
          return this.runShellCommand(action.commandStr);

        default:
          return { success: false, error: 'Unsupported action type' };
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  private launchApp(pathStr: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Strip surrounding quotes if present
      let cleanPath = pathStr.trim();
      if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) || 
          (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
        cleanPath = cleanPath.slice(1, -1).trim();
      }

      // Use "start" command to launch files, executables or URLs asynchronously and detached
      // If the path contains spaces, start needs empty quotes as first argument: start "" "path"
      const command = `start "" "${cleanPath}"`;
      exec(command, (error) => {
        if (error) {
          // Fallback to spawning directly if "start" failed
          try {
            const child = spawn(cleanPath, [], { detached: true, stdio: 'ignore' });
            child.unref();
            resolve({ success: true });
          } catch (spawnError: any) {
            resolve({ success: false, error: `Failed to launch: ${spawnError.message || spawnError}` });
          }
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  private simulateShortcut(shortcutStr: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Parse human-readable keys like "Ctrl+Shift+Esc" or "MediaPlayPause" into WScript SendKeys syntax
      const psCommand = this.buildSendKeysScript(shortcutStr);
      exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  private buildSendKeysScript(shortcutStr: string): string {
    const lower = shortcutStr.toLowerCase().trim();

    // Handle media key shortcuts using character codes directly in PowerShell
    const mediaKeys: Record<string, number> = {
      playpause: 179,
      mediaplaypause: 179,
      next: 176,
      medianexttrack: 176,
      prev: 177,
      mediaprevtrack: 177,
      stop: 178,
      mediastop: 178,
    };

    if (mediaKeys[lower]) {
      const code = mediaKeys[lower];
      return `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]${code})`;
    }

    // Parse standard modifiers: Ctrl (+), Shift (+), Alt (%)
    // WScript.Shell modifier codes:
    // Shift: +
    // Ctrl: ^
    // Alt: %
    const parts = shortcutStr.split('+');
    let modifiers = '';
    let key = '';

    for (const part of parts) {
      const p = part.trim().toLowerCase();
      if (p === 'ctrl' || p === 'control') {
        modifiers += '^';
      } else if (p === 'shift') {
        modifiers += '+';
      } else if (p === 'alt') {
        modifiers += '%';
      } else if (p === 'win' || p === 'gui') {
        // WScript.Shell does not support Windows key directly, but we can approximate or log.
        // Let's use simple key mappings.
      } else {
        key = part.trim();
      }
    }

    // Map special keys to SendKeys equivalents
    const keyMap: Record<string, string> = {
      esc: '{ESC}',
      escape: '{ESC}',
      enter: '{ENTER}',
      tab: '{TAB}',
      backspace: '{BACKSPACE}',
      bs: '{BACKSPACE}',
      up: '{UP}',
      down: '{DOWN}',
      left: '{LEFT}',
      right: '{RIGHT}',
      space: ' ',
      delete: '{DELETE}',
      del: '{DELETE}',
      insert: '{INSERT}',
      ins: '{INSERT}',
      home: '{HOME}',
      end: '{END}',
      pgup: '{PGUP}',
      pgdn: '{PGDN}',
    };

    const mappedKey = keyMap[key.toLowerCase()] || key;

    // Send keys with modifier grouping (e.g. ^(ab) or similar) if needed, but standard is modifiers + key
    const sendKeysArg = `${modifiers}${mappedKey.length > 1 && !mappedKey.startsWith('{') ? `{${mappedKey.toUpperCase()}}` : mappedKey}`;
    return `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('${sendKeysArg.replace(/'/g, "''")}')`;
  }

  private handleVolume(type: 'up' | 'down' | 'mute'): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const tmpFile = path.join(os.tmpdir(), `vol_${Date.now()}.ps1`);

      const delta = type === 'up' ? 0.05 : -0.05;
      const executeCall = type === 'mute' 
        ? '[AudioControl]::ToggleMute()' 
        : `[AudioControl]::Change(${delta})`;

      const psContent = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(int nChannel, float fLevelDB, ref Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(int nChannel, float fLevel, ref Guid pguidEventContext);
  int GetChannelVolumeLevel(int nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(int nChannel, out float pfLevel);
  int SetMute(bool bMute, ref Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  int GetState(out int pdwState);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

public class AudioControl {
  public static void Change(float delta) {
    Type t = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
    var en = (IMMDeviceEnumerator)Activator.CreateInstance(t);
    IMMDevice dev = null;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    
    Guid iidVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object volObj = null;
    dev.Activate(ref iidVolume, 0x17, IntPtr.Zero, out volObj);
    
    var vol = (IAudioEndpointVolume)volObj;
    float cur = 0f;
    vol.GetMasterVolumeLevelScalar(out cur);
    float next = Math.Max(0f, Math.Min(1f, cur + delta));
    Guid context = Guid.Empty;
    vol.SetMasterVolumeLevelScalar(next, ref context);
    
    Marshal.ReleaseComObject(vol);
    Marshal.ReleaseComObject(dev);
    Marshal.ReleaseComObject(en);
  }

  public static void ToggleMute() {
    Type t = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
    var en = (IMMDeviceEnumerator)Activator.CreateInstance(t);
    IMMDevice dev = null;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    
    Guid iidVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object volObj = null;
    dev.Activate(ref iidVolume, 0x17, IntPtr.Zero, out volObj);
    
    var vol = (IAudioEndpointVolume)volObj;
    bool isMuted = false;
    vol.GetMute(out isMuted);
    Guid context = Guid.Empty;
    vol.SetMute(!isMuted, ref context);
    
    Marshal.ReleaseComObject(vol);
    Marshal.ReleaseComObject(dev);
    Marshal.ReleaseComObject(en);
  }
}
'@ -Language CSharp
${executeCall}
`.trim();

      try {
        fs.writeFileSync(tmpFile, psContent, 'utf-8');
      } catch (writeErr: any) {
        return resolve({ success: false, error: `Cannot write temp file: ${writeErr.message}` });
      }

      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, (error, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch {}
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  private handlePower(type: 'lock' | 'sleep' | 'minimize_all' | 'shutdown' | 'restart'): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let command = '';
      switch (type) {
        case 'lock':
          command = 'rundll32.exe user32.dll,LockWorkStation';
          break;
        case 'sleep':
          command = 'powershell -Command "Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState(\'Suspend\', $false, $false)"';
          break;
        case 'minimize_all':
          command = 'powershell -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"';
          break;
        case 'shutdown':
          command = 'shutdown /s /t 5';
          break;
        case 'restart':
          command = 'shutdown /r /t 5';
          break;
        default:
          return resolve({ success: false, error: `Unsupported power action: ${type}` });
      }

      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  private runShellCommand(cmd: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }
}

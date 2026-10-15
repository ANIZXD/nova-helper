# audio.ps1 — Core Audio volume control (get/set/mute), no external modules.
# Usage: powershell -File audio.ps1 get | set <0-100> | mute | unmute | toggle
# Prints JSON: { ok, volume (0-100), muted }

param([string]$Action = "get", [double]$Value = -1)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CoreAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int NotImpl1();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams,
                     [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
        int _0(); int _1(); int _2(); int _3();
        int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
        int _5();
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int _7(); int _8(); int _9(); int _10();
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
        int GetMute(out bool pbMute);
    }

    private static IAudioEndpointVolume GetVolume() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 1, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }

    public static float Get() {
        float v; Marshal.ThrowExceptionForHR(GetVolume().GetMasterVolumeLevelScalar(out v)); return v;
    }
    public static void Set(float v) {
        Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(GetVolume().SetMasterVolumeLevelScalar(v, g));
    }
    public static bool GetMute() {
        bool m; Marshal.ThrowExceptionForHR(GetVolume().GetMute(out m)); return m;
    }
    public static void SetMute(bool m) {
        Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(GetVolume().SetMute(m, g));
    }
}
"@

try {
    switch ($Action.ToLower()) {
        "set" {
            if ($Value -lt 0 -or $Value -gt 100) { throw "value must be 0-100" }
            [CoreAudio]::Set([float]($Value / 100.0))
        }
        "mute"   { [CoreAudio]::SetMute($true) }
        "unmute" { [CoreAudio]::SetMute($false) }
        "toggle" { [CoreAudio]::SetMute(-not [CoreAudio]::GetMute()) }
        "get"    { }
        default  { throw "unknown action '$Action'" }
    }
    $vol = [math]::Round([CoreAudio]::Get() * 100)
    $muted = [CoreAudio]::GetMute()
    @{ ok = $true; volume = $vol; muted = $muted } | ConvertTo-Json -Compress
}
catch {
    @{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress
}

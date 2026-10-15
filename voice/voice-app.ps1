#requires -version 5.1
<#
  Nova Voice - a desktop app for talking to Nova out loud.

    * One big round TALK button: click to listen, click again to mute (the mic
      is released when you stop, nothing stays open).
    * You SEE it hearing you: live "Hearing:" text, a mic level meter, and the
      final transcript with a confidence score.
    * Nova repairs likely misheard words, does the thing, and ANSWERS ALOUD.
    * Follows your audio devices: plug in earphones/headset and it re-binds the
      mic and the speaker automatically.
    * Test mic / Test voice buttons prove both directions work.
    * Safety: from voice Nova does everyday things (apps, volume, files, search)
      but refuses destructive ones (delete, kill, sleep) - by design.

  Usage:  powershell -ExecutionPolicy Bypass -File voice-app.ps1 [-StartListening]
          (or double-click "Start Nova Voice.cmd")
#>
param(
  [switch]$NoServer,       # don't auto-start the Nova API server
  [switch]$StartListening  # open straight into listening mode
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Net.Http
[System.Windows.Forms.Application]::EnableVisualStyles()

# -------- Core Audio device info (which mic / speaker is the default right now)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NovaDev {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection {
        int GetCount(out int pcDevices);
        int Item(int nDevice, out IMMDevice ppDevice);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
        int GetCount(out int cProps);
        int GetAt(int iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
        int Commit();
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY { public Guid fmtid; public int pid; }
    [StructLayout(LayoutKind.Explicit)]
    private struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

    private static PROPERTYKEY PKEY_FriendlyName = new PROPERTYKEY {
        fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14
    };
    private static string FriendlyName(IMMDevice dev) {
        IPropertyStore ps;
        Marshal.ThrowExceptionForHR(dev.OpenPropertyStore(0, out ps));
        PROPVARIANT pv;
        Marshal.ThrowExceptionForHR(ps.GetValue(ref PKEY_FriendlyName, out pv));
        if (pv.p == IntPtr.Zero) return "";
        return Marshal.PtrToStringUni(pv.p);
    }
    public static string DefaultName(int dataFlow) {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice dev;
        Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(dataFlow, 0, out dev));
        return FriendlyName(dev);
    }
    public static string DefaultId(int dataFlow) {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice dev;
        Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(dataFlow, 0, out dev));
        string id;
        Marshal.ThrowExceptionForHR(dev.GetId(out id));
        return id;
    }
    public static string[] ListNames(int dataFlow) {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDeviceCollection col;
        Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(dataFlow, 1, out col));
        int n; col.GetCount(out n);
        var res = new string[n];
        for (int i = 0; i < n; i++) { IMMDevice d; col.Item(i, out d); res[i] = FriendlyName(d); }
        return res;
    }
}
"@

# ---------------------------------------------------------------- configuration
$BASE   = 'http://127.0.0.1:20129'
$ROOT   = Split-Path -Parent $PSScriptRoot
$LOGDIR = Join-Path $env:USERPROFILE '.nova'
$LOG    = Join-Path $LOGDIR 'voice.log'
$script:CONF_FLOOR = 0.55
# Single words only count as a command if they are one of these.
$script:CMD_WORDS = @('play','pause','stop','mute','unmute','screenshot','next','previous','skip','back','lock','sleep','volume','louder','quieter')

if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Force -Path $LOGDIR | Out-Null }

# ------------------------------------------------------------------- palette
$C_BG      = [System.Drawing.Color]::FromArgb(13, 15, 20)
$C_PANEL   = [System.Drawing.Color]::FromArgb(23, 26, 33)
$C_PANEL2  = [System.Drawing.Color]::FromArgb(32, 36, 45)
$C_TEXT    = [System.Drawing.Color]::FromArgb(230, 237, 243)
$C_DIM     = [System.Drawing.Color]::FromArgb(139, 148, 158)
$C_GREEN   = [System.Drawing.Color]::FromArgb(46, 160, 67)
$C_GREEN2  = [System.Drawing.Color]::FromArgb(63, 185, 80)
$C_RED     = [System.Drawing.Color]::FromArgb(218, 54, 51)
$C_BLUE    = [System.Drawing.Color]::FromArgb(88, 166, 255)
$C_AMBER   = [System.Drawing.Color]::FromArgb(210, 160, 60)

function Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -Path $LOG -Value $line -Encoding UTF8 } catch {}
}

# --------------------------------------------------------------- API plumbing
function Test-Api {
  try { $null = Invoke-RestMethod -Uri "$BASE/health" -TimeoutSec 2; $true } catch { $false }
}
function Ensure-Api {
  if (Test-Api) { return $true }
  if ($NoServer) { return $false }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Log 'node not found; cannot start API'; return $false }
  Log 'starting Nova API server...'
  try { Start-Process -FilePath $node -ArgumentList 'src/index.js','serve' -WorkingDirectory $ROOT -WindowStyle Hidden }
  catch { Log ("failed to start API: " + $_.Exception.Message); return $false }
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Test-Api) { Log 'API up'; return $true } }
  return (Test-Api)
}

# ------------------------------------------------------- audio device helpers
function Get-AudioId([int]$flow)   { try { return [NovaDev]::DefaultId($flow) }   catch { return '' } }
function Get-AudioName([int]$flow) { try { return [NovaDev]::DefaultName($flow) } catch { return 'unknown' } }
function Mic-Name { Get-AudioName 1 }
function Spk-Name { Get-AudioName 0 }

# ---------------------------------------------------------- speech primitives
function New-Engine {
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $e.SetInputToDefaultAudioDevice()
  $g = New-Object System.Speech.Recognition.DictationGrammar
  $g.Name = 'free speech'
  $null = $e.LoadGrammar($g)
  try { $e.BabbleTimeout = [TimeSpan]::FromSeconds(60); $e.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1200) } catch {}
  return $e
}

function OnUi([scriptblock]$b) {
  if ($script:form -and $script:form.IsHandleCreated -and $script:form.InvokeRequired) { $script:form.Invoke($b) } else { & $b }
}

# ---------------------------------------------------------------------- state
$script:engine    = $null
$script:client    = New-Object System.Net.Http.HttpClient
$script:client.Timeout = [TimeSpan]::FromSeconds(300)
$script:synth     = New-Object System.Speech.Synthesis.SpeechSynthesizer
$script:synth.Rate = 1
try { $script:synth.SetOutputToDefaultAudioDevice() } catch {}
$script:httpTask  = $null
$script:enabled   = $false
$script:busy      = $false
$script:testing   = $false
$script:testOwned = $false
$script:sessionId = 'voice'
$script:apiOk     = $false
$script:lastMicId = Get-AudioId 1
$script:lastSpkId = Get-AudioId 0
$script:ignoreUntil  = (Get-Date)
$script:lastAnswer    = ''
$script:lastAnswerAt  = (Get-Date).AddMinutes(-5)
$script:lastFeedbackAt = (Get-Date).AddMinutes(-5)

# Is this utterance a plausible command (not ambient noise / a stray word)?
function Test-Utterance($result) {
  if ($null -eq $result) { return $false }
  if ($result.Confidence -lt $script:CONF_FLOOR) { return $false }
  $w = @($result.Text -split '\s+' | Where-Object { $_ -match '\w' })
  if ($w.Count -ge 2) { return $true }
  if ($w.Count -eq 1 -and ($script:CMD_WORDS -contains $w[0].ToLower())) { return $true }
  return $false
}
# The improver sometimes answers nonsense input with a meta-reply instead of an
# instruction; that must never be executed or answered.
function Test-MetaReply([string]$s) {
  if (-not $s) { return $false }
  return ($s -match '(?i)need more (context|information)|please (provide|clarify|specify)|cannot (help|assist|do that)|i''m sorry|i am sorry|not sure what|no context|unclear|as an ai')
}

# ------------------------------------------------------------------------- UI
$form                = New-Object System.Windows.Forms.Form
$script:form         = $form
$form.Text           = 'Nova Voice'
$form.ClientSize     = New-Object System.Drawing.Size(520, 740)
$form.StartPosition  = 'CenterScreen'
$form.BackColor      = $C_BG
$form.Font           = New-Object System.Drawing.Font('Segoe UI', 9)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox    = $false
$form.KeyPreview     = $true

function MkLabel($text, $x, $y, $w, $h, $color, $size, $bold) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = $color; $l.BackColor = 'Transparent'
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $l.Font = New-Object System.Drawing.Font('Segoe UI', $size, $style)
  $form.Controls.Add($l); return $l
}

# header
$null = MkLabel 'Nova' 22 12 200 32 $C_TEXT 20 $true
$null = MkLabel 'Voice assistant for this PC' 24 46 320 18 $C_DIM 9 $false
$script:connLbl = New-Object System.Windows.Forms.Label
$script:connLbl.Text = 'Connecting...'
$script:connLbl.Location = New-Object System.Drawing.Point(352, 18)
$script:connLbl.Size = New-Object System.Drawing.Size(150, 24)
$script:connLbl.TextAlign = 'MiddleCenter'
$script:connLbl.BackColor = $C_PANEL2
$script:connLbl.ForeColor = $C_DIM
$script:connLbl.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($script:connLbl)

# big round TALK button
$script:talkBtn = New-Object System.Windows.Forms.Button
$script:talkBtn.Text = 'TALK'
$script:talkBtn.Location = New-Object System.Drawing.Point(200, 72)
$script:talkBtn.Size = New-Object System.Drawing.Size(120, 120)
$script:talkBtn.FlatStyle = 'Flat'
$script:talkBtn.FlatAppearance.BorderSize = 0
$script:talkBtn.BackColor = $C_GREEN
$script:talkBtn.ForeColor = [System.Drawing.Color]::White
$script:talkBtn.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$script:talkBtn.Cursor = 'Hand'
$script:talkBtn.TabStop = $false
$form.Controls.Add($script:talkBtn)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(0, 0, 120, 120)
$script:talkBtn.Region = New-Object System.Drawing.Region($path)

# mic level meter
$null = MkLabel 'Mic level' 110 196 120 16 $C_DIM 8 $false
$script:meterBg = New-Object System.Windows.Forms.Panel
$script:meterBg.Location = New-Object System.Drawing.Point(110, 212)
$script:meterBg.Size = New-Object System.Drawing.Size(300, 12)
$script:meterBg.BackColor = $C_PANEL2
$form.Controls.Add($script:meterBg)
$script:meterFill = New-Object System.Windows.Forms.Panel
$script:meterFill.Location = New-Object System.Drawing.Point(0, 0)
$script:meterFill.Size = New-Object System.Drawing.Size(0, 12)
$script:meterFill.BackColor = $C_GREEN2
$script:meterBg.Controls.Add($script:meterFill)

# status + live hearing line
$script:statusLbl = New-Object System.Windows.Forms.Label
$script:statusLbl.Text = 'Starting up...'
$script:statusLbl.Location = New-Object System.Drawing.Point(20, 230)
$script:statusLbl.Size = New-Object System.Drawing.Size(480, 22)
$script:statusLbl.TextAlign = 'MiddleCenter'
$script:statusLbl.ForeColor = $C_DIM
$script:statusLbl.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($script:statusLbl)

$script:hearLbl = New-Object System.Windows.Forms.Label
$script:hearLbl.Text = ''
$script:hearLbl.Location = New-Object System.Drawing.Point(20, 254)
$script:hearLbl.Size = New-Object System.Drawing.Size(480, 20)
$script:hearLbl.TextAlign = 'MiddleCenter'
$script:hearLbl.ForeColor = $C_TEXT
$script:hearLbl.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$form.Controls.Add($script:hearLbl)

# chat transcript
$script:transcript = New-Object System.Windows.Forms.RichTextBox
$script:transcript.Location = New-Object System.Drawing.Point(20, 278)
$script:transcript.Size = New-Object System.Drawing.Size(480, 210)
$script:transcript.ReadOnly = $true
$script:transcript.BackColor = $C_PANEL
$script:transcript.ForeColor = $C_TEXT
$script:transcript.BorderStyle = 'FixedSingle'
$script:transcript.Font = New-Object System.Drawing.Font('Consolas', 9)
$script:transcript.DetectUrls = $false
$form.Controls.Add($script:transcript)

# quick actions
$chips = New-Object System.Windows.Forms.FlowLayoutPanel
$chips.Location = New-Object System.Drawing.Point(20, 494)
$chips.Size = New-Object System.Drawing.Size(480, 64)
$chips.BackColor = 'Transparent'
$chips.WrapContents = $true
$form.Controls.Add($chips)
$quickActions = @(
  @{ t = 'Open notepad'; s = 'open notepad' },
  @{ t = 'Battery';      s = 'what is my battery level' },
  @{ t = 'Volume down';  s = 'turn the volume down' },
  @{ t = 'Screenshot';   s = 'take a screenshot' },
  @{ t = 'Play / pause'; s = 'play or pause the media' },
  @{ t = 'Time';         s = 'what time is it' },
  @{ t = 'Mute';         s = 'mute the volume' },
  @{ t = 'Search web';   s = 'search the web for ' }
)
foreach ($qa in $quickActions) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $qa.t
  $b.Size = New-Object System.Drawing.Size(115, 28)
  $b.Margin = New-Object System.Windows.Forms.Padding(2)
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 80, 95)
  $b.BackColor = $C_PANEL2
  $b.ForeColor = $C_TEXT
  $b.Cursor = 'Hand'
  $b.Tag = $qa.s
  $b.Add_Click({
    $s = $this.Tag
    if ($s -like '*for ') { $script:textBox.Text = $s; $script:textBox.Focus(); return }
    if ($script:busy) { return }
    if (-not $script:apiOk) { $script:apiOk = Ensure-Api }
    if (-not $script:apiOk) { Set-Status 'Cannot reach Nova' $C_RED; return }
    $script:busy = $true
    if ($script:enabled -and $script:engine) { try { $script:engine.StopRecognition() } catch {} }
    Send-Ask $s -Precise
  })
  $chips.Controls.Add($b)
}

# options
$script:speakBox = New-Object System.Windows.Forms.CheckBox
$script:speakBox.Text = 'Speak answers'; $script:speakBox.Checked = $true; $script:speakBox.AutoSize = $true
$script:speakBox.Location = New-Object System.Drawing.Point(22, 566); $script:speakBox.ForeColor = $C_TEXT; $script:speakBox.BackColor = 'Transparent'
$form.Controls.Add($script:speakBox)
$script:improveBox = New-Object System.Windows.Forms.CheckBox
$script:improveBox.Text = 'Fix misheard words'; $script:improveBox.Checked = $true; $script:improveBox.AutoSize = $true
$script:improveBox.Location = New-Object System.Drawing.Point(160, 566); $script:improveBox.ForeColor = $C_TEXT; $script:improveBox.BackColor = 'Transparent'
$form.Controls.Add($script:improveBox)
$topMostBox = New-Object System.Windows.Forms.CheckBox
$topMostBox.Text = 'Always on top'; $topMostBox.AutoSize = $true
$topMostBox.Location = New-Object System.Drawing.Point(330, 566); $topMostBox.ForeColor = $C_TEXT; $topMostBox.BackColor = 'Transparent'
$topMostBox.Add_CheckedChanged({ $script:form.TopMost = $topMostBox.Checked })
$form.Controls.Add($topMostBox)

# device line
$script:devLbl = MkLabel '' 20 588 480 18 $C_DIM 8 $false
$script:devLbl.Text = ("Mic: {0}   |   Speaker: {1}" -f (Mic-Name), (Spk-Name))

# input row
$script:textBox = New-Object System.Windows.Forms.TextBox
$script:textBox.Location = New-Object System.Drawing.Point(20, 610)
$script:textBox.Size = New-Object System.Drawing.Size(384, 26)
$script:textBox.BackColor = $C_PANEL2
$script:textBox.ForeColor = $C_TEXT
$script:textBox.BorderStyle = 'FixedSingle'
$script:textBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.Controls.Add($script:textBox)
$sendBtn = New-Object System.Windows.Forms.Button
$sendBtn.Text = 'Send'; $sendBtn.Location = New-Object System.Drawing.Point(412, 609); $sendBtn.Size = New-Object System.Drawing.Size(88, 28)
$sendBtn.FlatStyle = 'Flat'; $sendBtn.FlatAppearance.BorderSize = 0; $sendBtn.BackColor = $C_GREEN; $sendBtn.ForeColor = [System.Drawing.Color]::White
$sendBtn.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold); $sendBtn.Cursor = 'Hand'
$form.Controls.Add($sendBtn)

function MkSmallButton($text, $x, $w) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text; $b.Location = New-Object System.Drawing.Point($x, 644); $b.Size = New-Object System.Drawing.Size($w, 30)
  $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 80, 95)
  $b.BackColor = $C_PANEL2; $b.ForeColor = $C_TEXT; $b.Cursor = 'Hand'
  $form.Controls.Add($b); return $b
}
$testBtn  = MkSmallButton 'Test mic'   20 92
$voiceBtn = MkSmallButton 'Test voice' 116 92
$clearBtn = MkSmallButton 'Clear'      212 92
$helpBtn  = MkSmallButton 'Say...'     308 92
$quitBtn  = MkSmallButton 'Quit'       404 92

$null = MkLabel 'Ctrl+L start/stop   |   Esc stop   |   Enter send' 20 682 480 16 $C_DIM 8 $false
$null = MkLabel 'Everyday actions run instantly. Destructive ones are refused from voice.' 20 700 480 16 $C_DIM 8 $false

# ------------------------------------------------------------ transcript API
function TAppend([string]$text, $color) {
  OnUi {
    $rtb = $script:transcript
    $rtb.SelectionStart = $rtb.TextLength
    $rtb.SelectionLength = 0
    $rtb.SelectionColor = $color
    $rtb.AppendText($text + "`r`n")
    $rtb.SelectionStart = $rtb.TextLength
    $rtb.ScrollToCaret()
  }
}
function Say-User([string]$t) { TAppend ("You:  " + $t) $C_TEXT }
function Say-Nova([string]$t) { TAppend ("Nova: " + $t) $C_GREEN2 }
function Say-Note([string]$t) { TAppend ("      " + $t) $C_DIM }

function Set-Status([string]$t, $color) {
  OnUi { $script:statusLbl.Text = $t; if ($color) { $script:statusLbl.ForeColor = $color } }
}
function Set-Hearing([string]$t, $color) {
  OnUi { $script:hearLbl.Text = $t; if ($color) { $script:hearLbl.ForeColor = $color } }
}
function Set-Meter([int]$level) {
  OnUi {
    $w = [int](300 * ([math]::Max(0, [math]::Min(100, $level)) / 100.0))
    $script:meterFill.Width = $w
    $script:meterFill.BackColor = if ($level -gt 60) { $C_GREEN2 } elseif ($level -gt 20) { $C_GREEN } else { $C_PANEL2 }
  }
}
function Set-TalkButton([bool]$listening) {
  OnUi {
    if ($listening) { $script:talkBtn.Text = 'STOP'; $script:talkBtn.BackColor = $C_RED }
    else { $script:talkBtn.Text = 'TALK'; $script:talkBtn.BackColor = $C_GREEN }
  }
}
function Set-Conn([string]$state) {
  OnUi {
    switch ($state) {
      'online'  { $script:connLbl.Text = 'Online';  $script:connLbl.ForeColor = $C_GREEN2 }
      'offline' { $script:connLbl.Text = 'Offline'; $script:connLbl.ForeColor = $C_RED }
      default   { $script:connLbl.Text = 'Connecting...'; $script:connLbl.ForeColor = $C_DIM }
    }
  }
}
function Set-Devices {
  OnUi { $script:devLbl.Text = ("Mic: {0}   |   Speaker: {1}" -f (Mic-Name), (Spk-Name)) }
}

# ------------------------------------------------------------- engine wiring
function Attach-Engine($e) {
  $e.add_SpeechRecognized({
    param($s, $ev)
    OnUi {
      if ($script:testing) { Handle-TestResult $ev.Result; return }
      if (-not $script:enabled -or $script:busy) { return }
      if ((Get-Date) -lt $script:ignoreUntil) { Log ("ignored (cooldown): " + $ev.Result.Text); return }
      $txt = $ev.Result.Text
      $conf = [math]::Round($ev.Result.Confidence, 2)
      $pct = [int]($conf * 100)
      Log ("heard (conf {0}): {1}" -f $conf, $txt)
      if (-not (Test-Utterance $ev.Result)) {
        Set-Hearing ("Ignored: ""$txt""  ($pct%)") $C_AMBER
        if ($ev.Result.Confidence -ge 0.35) {
          Set-Status 'I did not catch a command - try again' $C_AMBER
          Speak-Feedback "Sorry, I didn't catch that. Please say it again."
        }
        return
      }
      Set-Hearing ("Heard: ""$txt""  ($pct%)") $C_TEXT
      $script:busy = $true
      try { $script:engine.StopRecognition() } catch {}
      Send-Ask $txt
    }
  }) | Out-Null

  $e.add_SpeechHypothesized({
    param($s, $ev)
    OnUi {
      if ($script:testing) { Set-Hearing ("test: " + $ev.Result.Text) $C_BLUE; return }
      if (-not $script:enabled -or $script:busy) { return }
      Set-Hearing ("Hearing: " + $ev.Result.Text + " ...") $C_BLUE
    }
  }) | Out-Null

  $e.add_SpeechDetected({
    param($s, $ev)
    OnUi { if ($script:enabled -and -not $script:busy) { Set-Status 'I hear you...' $C_BLUE } }
  }) | Out-Null

  $e.add_SpeechRecognitionRejected({
    param($s, $ev)
    OnUi { if ($script:enabled -and -not $script:busy) { Log ("rejected: " + $ev.Result.Text) } }
  }) | Out-Null

  $e.add_AudioLevelUpdated({
    param($s, $ev)
    Set-Meter $ev.AudioLevel
  }) | Out-Null
}

# ------------------------------------------------------------- control logic
function Start-Listening([string]$why = 'unknown') {
  if ($script:busy) { return }
  if (-not $script:apiOk) { Set-Conn 'connecting'; $script:apiOk = Ensure-Api }
  if (-not $script:apiOk) { Set-Conn 'offline'; Set-Status 'Cannot reach Nova - start the server with: npm start' $C_RED; Log 'API unreachable'; return }
  Set-Conn 'online'
  try {
    # always (re)bind to the CURRENT default microphone
    if ($script:engine) { try { $script:engine.StopRecognition(); $script:engine.Dispose() } catch {}; $script:engine = $null }
    $script:engine = New-Engine
    Attach-Engine $script:engine
    $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    $script:enabled = $true
    Set-TalkButton $true
    Set-Devices
    Set-Status 'Listening - just talk' $C_GREEN2
    Say-Note ("listening on: " + (Mic-Name))
    Log ("listening started on: " + (Mic-Name) + " [" + $why + "]")
  } catch {
    Set-Status ('Mic error: ' + $_.Exception.Message) $C_RED
    Log ("mic error: " + $_.Exception.Message)
  }
}
function Stop-Listening([string]$why = 'unknown') {
  $script:enabled = $false
  if ($script:engine) { try { $script:engine.StopRecognition() } catch {}; try { $script:engine.Dispose() } catch {}; $script:engine = $null }
  Set-Meter 0
  Set-TalkButton $false
  Set-Hearing ''
  Set-Status 'Stopped - mic released' $C_DIM
  Log ("listening stopped (mic released) [" + $why + "]")
}

function Send-Ask([string]$text, [switch]$Precise) {
  if (-not $text) { $script:busy = $false; return }
  Set-Status 'Nova is thinking...' $C_AMBER
  Say-User $text
  $useImprove = if ($Precise) { $false } else { [bool]$script:improveBox.Checked }
  $useVoice   = if ($Precise) { $false } else { $true }
  $payload = @{
    message = $text; sessionId = $script:sessionId
    improve = $useImprove; voice = $useVoice
    approveUpTo = 'medium'; confirmTimeoutMs = 0
  } | ConvertTo-Json -Depth 5
  try {
    $content = New-Object System.Net.Http.StringContent($payload, [System.Text.Encoding]::UTF8, 'application/json')
    $script:httpTask = $script:client.PostAsync("$BASE/ask", $content)
    $script:pollTimer.Start()
  } catch { Fail-Ask $_.Exception.Message }
}
function Speak([string]$t) {
  if (-not $t) { Finish-Turn; return }
  if (-not $script:speakBox.Checked) { Finish-Turn; return }
  try { $script:synth.SetOutputToDefaultAudioDevice() } catch {}   # follow the current speaker / earphones
  Set-Status 'Nova is speaking...' $C_BLUE
  try { $script:synth.SpeakAsync($t) } catch { Finish-Turn }
}
# Speak a short status/error message (throttled so ambient noise cannot spam you).
function Speak-Feedback([string]$text, [int]$minGapSec = 12) {
  $now = Get-Date
  if ($minGapSec -gt 0 -and ($now - $script:lastFeedbackAt).TotalSeconds -lt $minGapSec) {
    Log ("feedback (throttled): " + $text); Say-Note $text; return
  }
  $script:lastFeedbackAt = $now
  Say-Note $text
  if (-not $script:speakBox.Checked) { return }
  try {
    # pause the mic so it does not hear Nova's own voice, then resume on completion
    if ($script:enabled -and $script:engine) { $script:engine.StopRecognition() }
    $script:synth.SetOutputToDefaultAudioDevice()
    Set-Status $text $C_AMBER
    $script:synth.SpeakAsync($text)
  } catch { Finish-Turn }
}
function Finish-Turn {
  $script:busy = $false; $script:httpTask = $null
  Set-Meter 0
  $script:ignoreUntil = (Get-Date).AddMilliseconds(1500)   # let speaker audio drain / avoid echo
  if ($script:enabled -and $script:engine) {
    try { $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple) } catch {}
    Set-Status 'Listening - just talk' $C_GREEN2
  } else { Set-Status 'Ready - press TALK' $C_DIM }
}
function Fail-Ask([string]$msg) {
  Log ("error: " + $msg)
  Say-Nova ("(error) " + $msg)
  $script:busy = $false; $script:httpTask = $null
  Set-Status 'Something went wrong' $C_RED
  if ($script:enabled -and $script:engine) { try { $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple) } catch {} }
  if ($script:speakBox.Checked) {
    try {
      if ($script:enabled -and $script:engine) { $script:engine.StopRecognition() }
      $script:synth.SetOutputToDefaultAudioDevice()
      $script:synth.SpeakAsync("Sorry, there was an error. " + $msg)
    } catch {}
  }
}
function Handle-TestResult($result) {
  $script:testing = $false
  $pct = [int]($result.Confidence * 100)
  Log ("mic test heard: '{0}' (conf {1}%)" -f $result.Text, $pct)
  Set-Hearing ("Mic test heard: ""{0}""  ({1}%)" -f $result.Text, $pct) $C_TEXT
  Set-Status ("Test: heard you at $pct% confidence") $C_BLUE
  try { $script:synth.SetOutputToDefaultAudioDevice() } catch {}
  try { $script:synth.SpeakAsync("I heard: " + $result.Text) } catch {}
  if ($script:testOwned -and -not $script:enabled) {
    try { $script:engine.Dispose() } catch {}; $script:engine = $null; $script:testOwned = $false
  }
}

# -------------------------------------------------------------------- timers
$script:pollTimer = New-Object System.Windows.Forms.Timer
$script:pollTimer.Interval = 200
$script:pollTimer.Add_Tick({
  $t = $script:httpTask
  if ($null -eq $t -or -not $t.IsCompleted) { return }
  $script:pollTimer.Stop()
  try {
    if ($t.IsFaulted) { throw ($t.Exception.GetBaseException()) }
    $resp = $t.Result
    if (-not $resp.IsSuccessStatusCode) { throw ("HTTP " + [int]$resp.StatusCode) }
    $raw = $resp.Content.ReadAsStringAsync().Result
    $data = $raw | ConvertFrom-Json
    if ($data.improved) {
      Log ("understood: " + $data.improved)
      Say-Note ("understood as: " + $data.improved)
      if (Test-MetaReply $data.improved) {
        Log 'skipped: did not look like a command'
        Set-Status 'That did not sound like a command' $C_AMBER
        Speak-Feedback "Sorry, I didn't understand that."
        if (-not $script:speakBox.Checked) { Finish-Turn }
        return
      }
    }
    $answer = $data.text
    $now = Get-Date
    if ($answer -and $answer -eq $script:lastAnswer -and ($now - $script:lastAnswerAt).TotalSeconds -lt 25) {
      Log 'suppressed duplicate answer'
      Set-Status 'Heard the same thing again - ignoring' $C_AMBER
      Say-Note 'same answer as moments ago - ignored'
      Finish-Turn
      return
    }
    $script:lastAnswer = $answer
    $script:lastAnswerAt = $now
    Say-Nova $answer
    Log ("answer: " + $answer)
    Speak $answer
  } catch { Fail-Ask $_.Exception.Message }
})

$script:testTimer = New-Object System.Windows.Forms.Timer
$script:testTimer.Interval = 20000
$script:testTimer.Add_Tick({
  if ($script:testing) {
    $script:testing = $false
    Log 'mic test: no speech detected'
    Set-Hearing 'Mic test: did not hear anything - check the mic or speak louder' $C_AMBER
    Set-Status 'Test: no speech detected' $C_AMBER
    if ($script:testOwned -and -not $script:enabled) { try { $script:engine.Dispose() } catch {}; $script:engine = $null; $script:testOwned = $false }
  }
  $script:testTimer.Stop()
})

# follow the default audio devices (earphones / headset plug-in)
$script:devTimer = New-Object System.Windows.Forms.Timer
$script:devTimer.Interval = 2000
$script:devTimer.Add_Tick({
  $mic = Get-AudioId 1
  $spk = Get-AudioId 0
  if ($mic -ne $script:lastMicId -or $spk -ne $script:lastSpkId) {
    $changedMic = ($mic -ne $script:lastMicId)
    $script:lastMicId = $mic; $script:lastSpkId = $spk
    Set-Devices
    try { $script:synth.SetOutputToDefaultAudioDevice() } catch {}
    Log ("audio device changed -> mic: " + (Mic-Name) + " ; speaker: " + (Spk-Name))
    if ($changedMic) { Say-Note ("microphone changed -> now using: " + (Mic-Name)) } else { Say-Note ("speaker changed -> now using: " + (Spk-Name)) }
    if ($script:enabled -and -not $script:busy) {
      try {
        if ($script:engine) { $script:engine.StopRecognition(); $script:engine.Dispose() }
        $script:engine = New-Engine; Attach-Engine $script:engine
        $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
        Set-Status 'Audio device changed - listening on the new mic' $C_GREEN2
      } catch { Log ("rebind error: " + $_.Exception.Message) }
    }
  }
})

$script:synth.add_SpeakCompleted({ param($s, $e) OnUi { Finish-Turn } }) | Out-Null

# ------------------------------------------------------------------ handlers
$script:talkBtn.Add_Click({ if ($script:enabled) { Stop-Listening 'talk-button' } else { Start-Listening 'talk-button' }; $script:textBox.Focus() })

$testBtn.Add_Click({
  if ($script:busy) { return }
  if (-not $script:apiOk) { $script:apiOk = Ensure-Api; Set-Conn $(if ($script:apiOk) {'online'} else {'offline'}) }
  if ($script:engine) { try { $script:engine.StopRecognition() } catch {} }
  try {
    if (-not $script:engine) { $script:engine = New-Engine; Attach-Engine $script:engine; $script:testOwned = $true }
    $script:testing = $true
    Set-Status 'Say something to test the mic...' $C_AMBER
    Set-Hearing 'Mic test: listening for one phrase...' $C_BLUE
    Log 'mic test: listening for one phrase...'
    $script:testTimer.Start()
    $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Single)
  } catch {
    $script:testing = $false
    Set-Status ('Mic error: ' + $_.Exception.Message) $C_RED
    Log ("mic test error: " + $_.Exception.Message)
  }
})

$voiceBtn.Add_Click({
  if ($script:busy) { return }
  try {
    $script:synth.SetOutputToDefaultAudioDevice()
    $script:synth.SpeakAsync("Hi, this is Nova. If you can hear this, my voice is working.")
    Set-Status 'Test voice - you should hear me now' $C_BLUE
    Log 'voice test spoken'
  } catch { Set-Status ('Voice error: ' + $_.Exception.Message) $C_RED; Log ("voice test error: " + $_.Exception.Message) }
})

$clearBtn.Add_Click({
  try {
    Invoke-RestMethod -Uri "$BASE/clear" -Method POST -Body (@{ sessionId = $script:sessionId } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    Say-Note 'memory cleared'; Set-Status 'Memory cleared' $C_DIM
  } catch { Set-Status 'Could not clear memory' $C_RED }
})

$helpBtn.Add_Click({
  $msg = @"
Say any of these out loud after pressing TALK:

  "open notepad"
  "what is my battery level"
  "turn the volume down"
  "set the volume to forty percent"
  "take a screenshot"
  "search the web for pizza recipes"
  "play some music"
  "what time is it"

Nova repairs likely misheard words using context, so just speak naturally.
Everyday actions run automatically. Destructive ones (delete, kill, sleep)
are refused from voice on purpose - do those in a text session.
"@
  [System.Windows.Forms.MessageBox]::Show($msg, 'Say something like...') | Out-Null
})

$sendBtn.Add_Click({
  $t = $script:textBox.Text.Trim()
  if (-not $t -or $script:busy) { return }
  if (-not $script:apiOk) { $script:apiOk = Ensure-Api }
  if (-not $script:apiOk) { Set-Status 'Cannot reach Nova' $C_RED; return }
  $script:textBox.Text = ''
  $script:busy = $true
  if ($script:enabled -and $script:engine) { try { $script:engine.StopRecognition() } catch {} }
  Send-Ask $t
})
$script:textBox.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { $e.SuppressKeyPress = $true; $sendBtn.PerformClick() } })
$quitBtn.Add_Click({ $script:form.Close() })

$form.Add_KeyDown({
  param($s, $e)
  if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::L) { $e.SuppressKeyPress = $true; if ($script:enabled) { Stop-Listening 'ctrl+L' } else { Start-Listening 'ctrl+L' } }
  elseif ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $e.SuppressKeyPress = $true; if ($script:enabled) { Stop-Listening 'escape' } }
})

$form.Add_FormClosing({
  try { if ($script:engine) { $script:engine.StopRecognition(); $script:engine.Dispose() } } catch {}
  try { $script:synth.Dispose() } catch {}
  try { $script:client.Dispose() } catch {}
  Log 'app closed'
})

# ---------------------------------------------------------------------- boot
Log '--- Nova Voice app started ---'
$script:transcript.AppendText("Nova Voice ready.`r`n`r`n")
TAppend 'Press TALK (or Ctrl+L), then just speak. Nova answers out loud.' $C_DIM
Set-Status 'Checking Nova server...' $C_DIM
$script:apiOk = Ensure-Api
if ($script:apiOk) {
  Set-Conn 'online'; Set-Status 'Ready - press TALK' $C_GREEN2
  TAppend 'Connected to Nova.' $C_GREEN2
} else {
  Set-Conn 'offline'; Set-Status 'Nova server not reachable - start it with: npm start' $C_RED
  TAppend 'WARNING: could not reach the Nova API server.' $C_RED
}
Log ("devices -> mic: " + (Mic-Name) + " ; speaker: " + (Spk-Name))
# Start each run with a clean voice memory so stale context can never leak into
# answers (that caused unrelated, repeated replies).
try { Invoke-RestMethod -Uri "$BASE/clear" -Method POST -Body (@{ sessionId = $script:sessionId } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 5 | Out-Null; Log 'voice memory cleared at startup' } catch {}
$script:devTimer.Start()
if ($StartListening) { Start-Listening 'boot-switch' }
$form.ActiveControl = $script:textBox

[void]$form.ShowDialog()

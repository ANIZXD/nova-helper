# Nova voice self-check
#   Verifies the pieces the Nova Voice app needs on THIS machine:
#     1. a text-to-speech voice exists (Nova answers aloud)
#     2. a speech recognizer + default mic exist (Nova hears you)
#     3. round-trips synthesised speech back through the recognizer so you can
#        SEE how well it understands natural sentences before trusting it.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\voice-check.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [ok]   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [warn] $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  [FAIL] $t" -ForegroundColor Red }

# ---------------------------------------------------------------- 1. TTS voices
Section "Text-to-speech (Nova answering aloud)"
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
if ($voices.Count -eq 0) {
  Bad "No TTS voices installed. Settings > Time & language > Speech > Voices."
} else {
  foreach ($v in $voices) {
    $i = $v.VoiceInfo
    Ok ("{0}  ({1}, {2})" -f $i.Name, $i.Gender, $i.Culture)
  }
  $preferred = $voices | Where-Object { $_.VoiceInfo.Gender -eq 'Female' } | Select-Object -First 1
  if (-not $preferred) { $preferred = $voices[0] }
  Write-Host ("  default -> {0}" -f $preferred.VoiceInfo.Name) -ForegroundColor DarkGray
}

# ------------------------------------------------------- 2. recognizer + mic
Section "Speech recognition (Nova hearing you)"
try {
  $recs = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $recs -or $recs.Count -eq 0) { Bad "No speech recognizer installed." }
  foreach ($r in $recs) { Ok ("{0}  ({1})" -f $r.Description, $r.Culture) }
} catch { Bad "Could not enumerate recognizers: $($_.Exception.Message)" }

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $engine.SetInputToDefaultAudioDevice()
  Ok "Default microphone opened"
} catch {
  Bad "Microphone unavailable: $($_.Exception.Message)"
  Warn "Check Settings > Privacy & security > Microphone (and 'Let desktop apps access your microphone')."
}
$dict = New-Object System.Speech.Recognition.DictationGrammar
$dict.Name = "free speech"
$null = $engine.LoadGrammar($dict)
Ok "Dictation grammar loaded"

# ------------------------------------------- 3. synth -> wave -> recognise
Section "Understanding check (synthesised speech -> recognizer)"
$samples = @(
  "open notepad and turn the volume down",
  "what is my battery level",
  "take a screenshot",
  "set the volume to fifty percent",
  "search the web for cheap flights to tokyo"
)
$tmp = Join-Path $env:TEMP "nova-voice-check"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$totalConf = 0.0; $n = 0; $hits = 0
foreach ($s in $samples) {
  $wav = Join-Path $tmp ("sample{0}.wav" -f $n)
  $synth.SetOutputToWaveFile($wav)
  $synth.Speak($s)
  $synth.SetOutputToNull()
  $engine.SetInputToWaveFile($wav)
  $res = $engine.Recognize()
  if ($res -eq $null) {
    Bad ("heard nothing          | said: {0}" -f $s)
  } else {
    $conf = [math]::Round($res.Confidence, 2)
    # treat a sample as a "hit" when most said words survive recognition
    $said = ($s -split '\W+' | Where-Object { $_.Length -gt 2 })
    $got = ($res.Text -split '\W+' | Where-Object { $_.Length -gt 2 })
    $match = 0; foreach ($w in $said) { if ($got -contains $w) { $match++ } }
    $ratio = if ($said.Count) { $match / $said.Count } else { 0 }
    $totalConf += $res.Confidence
    if ($ratio -ge 0.6) { $hits++; Ok ("{0,4}% conf, {1,3}% words  | said: {2}`n                                | heard: {3}" -f [int]($conf*100), [int]($ratio*100), $s, $res.Text) }
    else { Warn ("{0,4}% conf, {1,3}% words  | said: {2}`n                                | heard: {3}" -f [int]($conf*100), [int]($ratio*100), $s, $res.Text) }
  }
  $n++
}
if ($n -gt 0) {
  $avg = [math]::Round(($totalConf / $n) * 100)
  Write-Host ""
  Write-Host ("  Recognised {0}/{1} sample sentences  (avg confidence {2}%)" -f $hits, $n, $avg) -ForegroundColor Cyan
  if ($hits -eq $n) { Ok "Recognition is working well on this machine." }
  else { Warn "Some samples were misheard - speak the same wording as you would naturally; Nova asks when unsure." }
}
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host ""

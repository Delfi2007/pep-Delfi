# Batch text-to-speech with the Windows built-in speech engine (System.Speech).
# Used instead of Piper, whose speech library is blocked by Windows Smart App Control.
# Input: a JSON file of jobs [{ "text": "...", "voice": "Microsoft Zira Desktop", "rate": 0, "path": "...wav" }]
param([Parameter(Mandatory = $true)][string]$JobsFile)

Add-Type -AssemblyName System.Speech
$jobs = Get-Content -Raw -Encoding UTF8 $JobsFile | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($job in $jobs) {
    $synth.SelectVoice($job.voice)
    $synth.Rate = [int]$job.rate
    $synth.SetOutputToWaveFile($job.path)
    $synth.Speak([string]$job.text)
}
$synth.SetOutputToNull()
$synth.Dispose()

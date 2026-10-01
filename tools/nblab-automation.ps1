<#
.SYNOPSIS
  NBLAB dispatch automation agent - runs on each lab PC.

.DESCRIPTION
  Watches a folder (your Downloads, unless set otherwise). When a file finishes
  downloading there, it reads the text inside the file, finds the first
  automation whose words are ALL in it, and prints what that automation says:
  the file itself, documents from the shared folder, and a sticker on the
  sticker printer with details read from the file.

  The automations come from automations.json, exported from the NBLAB website
  (Dispatch automation page). Nothing is sent anywhere; every run is written to
  nblab-automation.log next to this script.

  Settings live in nblab-automation.config.json next to this script, created on
  the first run:
    watchFolder     the folder to watch (default: your Downloads)
    sharedFolder    where automations.json and the "documents" folder are: a
                    folder on this PC or a network share (\\server\share\nblab).
                    Empty means: next to this script.
    stickerPrinter  the sticker printer's name, exactly as Windows shows it
    dryRun          true = only write to the log what would be printed

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File nblab-automation.ps1
  Start watching (nblab-automation.cmd does this, hidden).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File nblab-automation.ps1 -Test "$env:USERPROFILE\Downloads\return.pdf"
  Show what the agent reads from a file, which automation matches, and what it
  would print - without printing anything.
#>
param(
  [string]$Test,
  [switch]$DryRun,
  # Load the functions only; used by nblab-automation.test.ps1.
  [switch]$Library
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$AgentVersion = '1.0.0'
$AgentFolder = $PSScriptRoot
$ConfigPath = Join-Path $AgentFolder 'nblab-automation.config.json'
$LogPath = Join-Path $AgentFolder 'nblab-automation.log'
$TempExtensions = @('.crdownload', '.part', '.partial', '.tmp', '.download', '.opdownload', '.!ut')
$MaxFileBytes = 50MB
$ValueLimit = 80

# ---- Reading a file's text ------------------------------------------------------

function ConvertFrom-Markup([string]$Markup) {
  # Rows, paragraphs and breaks become new lines; cells become tabs; tags go.
  $text = $Markup -replace '(?i)<\s*br\s*/?>', "`n"
  $text = $text -replace '(?i)</\s*(p|div|tr|li|h[1-6]|w:p|row)\s*>', "`n"
  $text = $text -replace '(?i)</\s*(td|th)\s*>', "`t"
  $text = $text -replace '(?i)<w:tab\s*/>', "`t"
  $text = $text -replace '(?s)<script.*?</script>|<style.*?</style>', ''
  $text = $text -replace '<[^>]+>', ''
  return [System.Net.WebUtility]::HtmlDecode($text)
}

function Get-ZipEntryText($Zip, [string]$Name) {
  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-TextFromDocx([string]$Path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try { return ConvertFrom-Markup (Get-ZipEntryText $zip 'word/document.xml') } finally { $zip.Dispose() }
}

function Get-TextFromXlsx([string]$Path) {
  # Every sheet, as rows of tab-separated cells, so "Asset tag | NB-1" reads
  # as one line: the label, a tab, the value.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    $shared = New-Object System.Collections.Generic.List[string]
    $sharedXml = Get-ZipEntryText $zip 'xl/sharedStrings.xml'
    if ($sharedXml) {
      $doc = [xml]$sharedXml
      $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable); $ns.AddNamespace('m', $main)
      foreach ($si in $doc.SelectNodes('//m:si', $ns)) { $shared.Add($si.InnerText) }
    }
    $lines = New-Object System.Collections.Generic.List[string]
    $sheets = $zip.Entries | Where-Object { $_.FullName -like 'xl/worksheets/sheet*.xml' } | Sort-Object FullName
    foreach ($sheet in $sheets) {
      $doc = [xml](Get-ZipEntryText $zip $sheet.FullName)
      $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable); $ns.AddNamespace('m', $main)
      foreach ($row in $doc.SelectNodes('//m:sheetData/m:row', $ns)) {
        $cells = foreach ($c in $row.SelectNodes('m:c', $ns)) {
          $type = $c.GetAttribute('t')
          $v = $c.SelectSingleNode('m:v', $ns)
          if ($type -eq 's' -and $v) { $shared[[int]$v.InnerText] }
          elseif ($type -eq 'inlineStr') { $c.InnerText }
          elseif ($v) { $v.InnerText }
          else { '' }
        }
        $lines.Add((@($cells) -join "`t"))
      }
    }
    return ($lines -join "`n")
  } finally { $zip.Dispose() }
}

function Expand-PdfStream([byte[]]$Bytes) {
  # FlateDecode: zlib data. Skip the 2-byte zlib header and inflate the rest.
  if ($Bytes.Length -lt 3) { return $null }
  try {
    $source = New-Object System.IO.MemoryStream(, $Bytes)
    [void]$source.ReadByte(); [void]$source.ReadByte()
    $inflate = New-Object System.IO.Compression.DeflateStream($source, [System.IO.Compression.CompressionMode]::Decompress)
    $output = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 65536
    while (($read = $inflate.Read($buffer, 0, $buffer.Length)) -gt 0) { $output.Write($buffer, 0, $read) }
    return $output.ToArray()
  } catch { return $null }
}

function Read-PdfCMaps([string[]]$Contents) {
  # ToUnicode maps: glyph code (hex) -> text. Fonts that embed only the
  # glyphs they use (most PDFs made by Windows and browsers) need them.
  $map = @{}
  foreach ($content in $Contents) {
    if ($content -notmatch 'begincmap') { continue }
    foreach ($block in [regex]::Matches($content, '(?s)beginbfchar(.*?)endbfchar')) {
      foreach ($pair in [regex]::Matches($block.Groups[1].Value, '<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>')) {
        $map[$pair.Groups[1].Value.ToUpper()] = ConvertFrom-Utf16Hex $pair.Groups[2].Value
      }
    }
    foreach ($block in [regex]::Matches($content, '(?s)beginbfrange(.*?)endbfrange')) {
      foreach ($range in [regex]::Matches($block.Groups[1].Value, '<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>')) {
        $from = [Convert]::ToInt32($range.Groups[1].Value, 16)
        $to = [Convert]::ToInt32($range.Groups[2].Value, 16)
        $start = [Convert]::ToInt32($range.Groups[3].Value, 16)
        $width = $range.Groups[1].Value.Length
        for ($code = $from; $code -le $to -and $code -le $from + 2000; $code++) {
          $map[$code.ToString("X$width")] = [string][char]($start + $code - $from)
        }
      }
    }
  }
  return $map
}

function ConvertFrom-Utf16Hex([string]$Hex) {
  # "0041" -> "A"; "00410042" -> "AB"; a short code is one character.
  if ($Hex.Length -lt 4) { return [string][char][Convert]::ToInt32($Hex, 16) }
  $out = New-Object System.Text.StringBuilder
  for ($i = 0; $i -le $Hex.Length - 4; $i += 4) { [void]$out.Append([char][Convert]::ToInt32($Hex.Substring($i, 4), 16)) }
  return $out.ToString()
}

function ConvertFrom-PdfHexString([string]$Hex, $CMap) {
  $Hex = ($Hex -replace '[^0-9A-Fa-f]', '').ToUpper()
  if ($Hex.Length -eq 0) { return '' }
  if ($Hex.Length % 2 -eq 1) { $Hex += '0' }
  if ($CMap.Count -gt 0) {
    foreach ($width in 4, 2) {
      if ($Hex.Length % $width -ne 0) { continue }
      $out = New-Object System.Text.StringBuilder
      $known = 0
      for ($i = 0; $i -lt $Hex.Length; $i += $width) {
        $code = $Hex.Substring($i, $width)
        if ($CMap.ContainsKey($code)) { [void]$out.Append($CMap[$code]); $known++ }
      }
      if ($known -gt 0) { return $out.ToString() }
    }
  }
  $bytes = for ($i = 0; $i -lt $Hex.Length; $i += 2) { [Convert]::ToByte($Hex.Substring($i, 2), 16) }
  return [System.Text.Encoding]::GetEncoding(28591).GetString([byte[]]@($bytes))
}

function ConvertFrom-PdfContent([string]$Content, $CMap) {
  # Text-showing operators only: (literal) and <hex> strings, with a new line
  # wherever the text moves to another line.
  $out = New-Object System.Text.StringBuilder
  $i = 0
  $n = $Content.Length
  while ($i -lt $n) {
    $c = $Content[$i]
    if ($c -eq '(') {
      $depth = 1; $i++
      $piece = New-Object System.Text.StringBuilder
      while ($i -lt $n -and $depth -gt 0) {
        $c = $Content[$i]
        if ($c -eq '\' -and $i + 1 -lt $n) {
          $next = $Content[$i + 1]
          if ($next -match '[0-7]') {
            $oct = [regex]::Match($Content.Substring($i + 1, [Math]::Min(3, $n - $i - 1)), '^[0-7]{1,3}').Value
            [void]$piece.Append([char][Convert]::ToInt32($oct, 8)); $i += 1 + $oct.Length; continue
          }
          switch ($next) { 'n' { [void]$piece.Append("`n") } 'r' { } 't' { [void]$piece.Append("`t") } default { [void]$piece.Append($next) } }
          $i += 2; continue
        }
        if ($c -eq '(') { $depth++ } elseif ($c -eq ')') { $depth--; if ($depth -eq 0) { $i++; break } }
        [void]$piece.Append($c); $i++
      }
      $text = $piece.ToString()
      if ($CMap.Count -gt 0 -and $text.Length -gt 0 -and ($text.ToCharArray() | Where-Object { [int]$_ -lt 32 })) {
        $hex = -join ($text.ToCharArray() | ForEach-Object { ([int]$_).ToString('X2') })
        $text = ConvertFrom-PdfHexString $hex $CMap
      }
      [void]$out.Append($text)
      continue
    }
    if ($c -eq '<' -and $i + 1 -lt $n -and $Content[$i + 1] -ne '<') {
      $end = $Content.IndexOf('>', $i)
      if ($end -lt 0) { break }
      [void]$out.Append((ConvertFrom-PdfHexString $Content.Substring($i + 1, $end - $i - 1) $CMap))
      $i = $end + 1; continue
    }
    if ($c -eq '<' -and $i + 1 -lt $n -and $Content[$i + 1] -eq '<') {
      # A dictionary: skip it, so its keys are not read as text.
      $end = $Content.IndexOf('>>', $i)
      if ($end -lt 0) { break }
      $i = $end + 2; continue
    }
    if ($c -eq '-' -or [char]::IsDigit($c)) {
      # A large negative kerning inside a TJ array is a word gap.
      $m = [regex]::Match($Content.Substring($i, [Math]::Min(12, $n - $i)), '^-?\d+(\.\d+)?')
      if ($m.Success -and [double]$m.Value -le -200 -and $out.Length -gt 0 -and $out[$out.Length - 1] -ne ' ') { [void]$out.Append(' ') }
      $i += [Math]::Max(1, $m.Length); continue
    }
    if ([char]::IsLetter($c) -or $c -eq "'" -or $c -eq '"' -or $c -eq '*') {
      $m = [regex]::Match($Content.Substring($i, [Math]::Min(4, $n - $i)), "^(T\*|Td|TD|Tm|ET|'|`")")
      if ($m.Success) {
        if ($out.Length -gt 0 -and $out[$out.Length - 1] -ne "`n") { [void]$out.Append("`n") }
        $i += $m.Length; continue
      }
    }
    $i++
  }
  return $out.ToString()
}

function Get-TextFromPdf([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $latin = [System.Text.Encoding]::GetEncoding(28591)
  $raw = $latin.GetString($bytes)
  $contents = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches($raw, '(?s)(<<.*?>>)\s*stream\r?\n')) {
    $start = $m.Index + $m.Length
    $end = $raw.IndexOf('endstream', $start)
    if ($end -lt 0) { continue }
    $data = New-Object byte[] ($end - $start)
    [Array]::Copy($bytes, $start, $data, 0, $data.Length)
    if ($m.Groups[1].Value -match '/FlateDecode') {
      $data = Expand-PdfStream $data
      if (-not $data) { continue }
    } elseif ($m.Groups[1].Value -match '/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)') { continue }
    $contents.Add($latin.GetString($data))
  }
  $cmap = Read-PdfCMaps $contents
  $pages = foreach ($content in $contents) {
    if ($content -match 'begincmap' -or $content -notmatch '(?s)BT.*ET') { continue }
    # One unreadable stream must not lose the rest of the document.
    try { ConvertFrom-PdfContent $content $cmap } catch { }
  }
  return (($pages -join "`n") -replace "[`r]", '')
}

function Get-FileText([string]$Path) {
  $info = Get-Item -LiteralPath $Path
  if ($info.Length -gt $MaxFileBytes) { return '' }
  switch ($info.Extension.ToLower()) {
    { $_ -in '.txt', '.csv', '.tsv', '.log', '.json', '.xml', '.eml', '.ini' } {
      return [System.IO.File]::ReadAllText($Path)
    }
    { $_ -in '.html', '.htm', '.mht' } { return ConvertFrom-Markup ([System.IO.File]::ReadAllText($Path)) }
    '.docx' { return Get-TextFromDocx $Path }
    '.xlsx' { return Get-TextFromXlsx $Path }
    '.pdf' { return Get-TextFromPdf $Path }
    default {
      # Anything else: the readable characters, in case it is text after all.
      $raw = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($Path))
      return ($raw -replace '[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]', ' ')
    }
  }
}

# ---- Automations (the same rules as src/services/automation.js) -------------------

function Find-Automation([string]$Text, [string]$FileName, $Automations) {
  $haystack = $Text.ToLowerInvariant()
  $type = [System.IO.Path]::GetExtension($FileName).TrimStart('.').ToLowerInvariant()
  foreach ($automation in @($Automations)) {
    if ($automation.enabled -eq $false) { continue }
    $types = @($automation.fileTypes | Where-Object { $_ })
    if ($types.Count -gt 0 -and $types -notcontains $type) { continue }
    $words = @($automation.keywords | Where-Object { $_ })
    if ($words.Count -eq 0) { continue }
    $all = $true
    foreach ($word in $words) { if (-not $haystack.Contains(([string]$word).ToLowerInvariant())) { $all = $false; break } }
    if ($all) { return $automation }
  }
  return $null
}

function Read-Field([string]$Text, [string]$Label) {
  if (-not $Label) { return '' }
  $pattern = [regex]::Escape($Label) + ' *([:=#-]*) *([,;\t])?[ \t]*([^\n]*)'
  $m = [regex]::Match($Text, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $m.Success) { return '' }
  $value = $m.Groups[3].Value
  if ($m.Groups[2].Success -and $m.Groups[2].Value) { $value = $value.Split($m.Groups[2].Value)[0] }
  $value = $value.Trim()
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2).Trim() }
  if ($value.Length -gt $ValueLimit) { $value = $value.Substring(0, $ValueLimit) }
  return $value
}

function Read-Fields([string]$Text, $Fields) {
  $values = @{}
  foreach ($field in @($Fields)) { if ($field -and $field.name) { $values[([string]$field.name).ToLowerInvariant()] = Read-Field $Text $field.label } }
  return $values
}

function Get-BuiltinValues([string]$FileName, [string]$AutomationName, [datetime]$Now) {
  return @{
    file = $FileName
    # Fixed formats: '/' and ':' would otherwise follow the PC's regional settings.
    date = $Now.ToString('dd/MM/yyyy', [System.Globalization.CultureInfo]::InvariantCulture)
    time = $Now.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
    automation = $AutomationName
  }
}

function Format-Sticker($Lines, $Values) {
  return @(foreach ($line in @($Lines)) {
    [regex]::Replace([string]$line, '\{([a-zA-Z0-9_]+)\}', {
      param($m)
      $key = $m.Groups[1].Value.ToLowerInvariant()
      if ($Values.ContainsKey($key)) { [string]$Values[$key] } else { '' }
    })
  })
}

function Read-Automations([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "No automations file at $Path. Export it from the NBLAB website (Dispatch automation page)." }
  $data = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
  if ($data.version -ne 1) { throw "Unknown automations file version '$($data.version)'." }
  return @($data.automations)
}

# ---- Settings, log, notices --------------------------------------------------------

function Get-AgentConfig {
  $defaults = [ordered]@{
    watchFolder = (Join-Path $env:USERPROFILE 'Downloads')
    sharedFolder = ''
    stickerPrinter = ''
    dryRun = $false
  }
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    ($defaults | ConvertTo-Json) | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  }
  $saved = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $config = @{}
  foreach ($key in $defaults.Keys) {
    $value = $defaults[$key]
    if ($saved.PSObject.Properties[$key] -and "$($saved.$key)" -ne '') { $value = $saved.$key }
    if ($value -is [string]) { $value = [Environment]::ExpandEnvironmentVariables($value) }
    $config[$key] = $value
  }
  if (-not $config.sharedFolder) { $config.sharedFolder = $AgentFolder }
  return $config
}

function Write-AgentLog([string]$Message) {
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

$script:Tray = $null
function Show-Notice([string]$Title, [string]$Text, [string]$Kind = 'Info') {
  if (-not $script:Tray) { return }
  $script:Tray.ShowBalloonTip(6000, $Title, $Text, [System.Windows.Forms.ToolTipIcon]::$Kind)
}

# ---- Printing ------------------------------------------------------------------------

function Invoke-PrintFile([string]$Path, [int]$Copies, [bool]$Dry) {
  for ($n = 1; $n -le [Math]::Max(1, $Copies); $n++) {
    if ($Dry) { Write-AgentLog "  (dry run) would print $Path"; continue }
    # The app Windows uses for this kind of file prints it to the default
    # printer - for PDFs that needs a reader with a Print command (Adobe Reader).
    Start-Process -FilePath $Path -Verb Print -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
}

function Invoke-PrintSticker([string]$Printer, [string[]]$Lines, [bool]$Dry, [string]$ToFile) {
  if ($Dry) { Write-AgentLog ("  (dry run) would print a sticker on '{0}': {1}" -f $Printer, ($Lines -join ' | ')); return }
  Add-Type -AssemblyName System.Drawing
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Printer
  if (-not $doc.PrinterSettings.IsValid) { throw "There is no printer named '$Printer' on this PC." }
  if ($ToFile) { $doc.PrinterSettings.PrintToFile = $true; $doc.PrinterSettings.PrintFileName = $ToFile }
  $doc.DocumentName = 'NBLAB sticker'
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $text = ($Lines -join "`n")
  $doc.add_PrintPage({
    param($printing, $page)
    # The biggest bold font that fits the label, top to bottom.
    $area = $page.MarginBounds
    if ($area.Width -le 0 -or $area.Height -le 0) { $area = $page.PageBounds }
    $size = 28.0
    do {
      $font = New-Object System.Drawing.Font('Arial', $size, [System.Drawing.FontStyle]::Bold)
      $measured = $page.Graphics.MeasureString($text, $font, [int]$area.Width)
      $size -= 1
    } while (($measured.Height -gt $area.Height -or $measured.Width -gt $area.Width) -and $size -gt 6)
    $rect = New-Object System.Drawing.RectangleF($area.X, $area.Y, $area.Width, $area.Height)
    $page.Graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, $rect)
    $page.HasMorePages = $false
  })
  $doc.Print()
  $doc.Dispose()
}

# ---- One file ----------------------------------------------------------------------------

function Wait-FileReady([string]$Path, [int]$TimeoutSeconds = 90) {
  # Browsers write the file in steps; wait until it stops growing and can be
  # opened on its own.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSize = -1
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
      $size = (Get-Item -LiteralPath $Path).Length
      $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'None')
      $stream.Dispose()
      if ($size -eq $lastSize -and $size -gt 0) { return $true }
      $lastSize = $size
    } catch { }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Get-Plan([string]$Path, $Config) {
  $name = [System.IO.Path]::GetFileName($Path)
  $text = Get-FileText $Path
  $automations = Read-Automations (Join-Path $Config.sharedFolder 'automations.json')
  $automation = Find-Automation $text $name $automations
  if (-not $automation) { return @{ file = $name; text = $text; automation = $null } }
  $values = Read-Fields $text $automation.stickerFields
  $builtins = Get-BuiltinValues $name $automation.name (Get-Date)
  foreach ($key in $builtins.Keys) { $values[$key] = $builtins[$key] }
  $documents = @(foreach ($doc in @($automation.documents)) {
    if ($doc -and $doc.file) { @{ path = (Join-Path (Join-Path $Config.sharedFolder 'documents') $doc.file); copies = [int]$doc.copies } }
  })
  return @{
    file = $name
    text = $text
    automation = $automation
    values = $values
    printFile = [bool]$automation.printFile
    fileCopies = [int]$automation.fileCopies
    documents = $documents
    sticker = [bool]$automation.sticker
    stickerLines = @(Format-Sticker $automation.stickerLines $values)
  }
}

function Invoke-Automation([string]$Path, $Config) {
  $plan = Get-Plan $Path $Config
  if (-not $plan.automation) { Write-AgentLog "No automation for $($plan.file)"; return }
  $dry = [bool]$Config.dryRun
  Write-AgentLog "'$($plan.automation.name)' for $($plan.file)"
  $done = @()
  $problems = @()
  if ($plan.printFile) {
    try { Invoke-PrintFile $Path $plan.fileCopies $dry; $done += 'the file' } catch { $problems += "the file: $($_.Exception.Message)" }
  }
  foreach ($doc in $plan.documents) {
    $docName = Split-Path -Leaf $doc.path
    if (-not (Test-Path -LiteralPath $doc.path)) { $problems += "$docName is not in the documents folder"; continue }
    try { Invoke-PrintFile $doc.path $doc.copies $dry; $done += $docName } catch { $problems += "${docName}: $($_.Exception.Message)" }
  }
  if ($plan.sticker) {
    if (-not $Config.stickerPrinter) { $problems += 'no sticker printer is set' }
    else {
      try { Invoke-PrintSticker $Config.stickerPrinter $plan.stickerLines $dry ''; $done += 'sticker' } catch { $problems += "sticker: $($_.Exception.Message)" }
    }
  }
  $verb = if ($dry) { 'would print' } else { 'printed' }
  if ($done.Count) { Write-AgentLog ("  ${verb}: " + ($done -join ', ')) }
  foreach ($problem in $problems) { Write-AgentLog "  PROBLEM: $problem" }
  $summary = if (-not $done.Count) { 'Nothing printed' } elseif ($dry) { '(dry run) Would print ' + ($done -join ', ') } else { 'Printed ' + ($done -join ', ') }
  if ($problems.Count) {
    Show-Notice "NBLAB: $($plan.automation.name)" ("$summary. Problem: " + ($problems -join '; ')) 'Warning'
  } else {
    Show-Notice "NBLAB: $($plan.automation.name)" "$summary - $($plan.file)"
  }
}

if ($Library) { return }

# ---- Test mode: read a file and say what would happen ------------------------------------------

$config = Get-AgentConfig
if ($DryRun) { $config.dryRun = $true }

if ($Test) {
  $plan = Get-Plan (Resolve-Path -LiteralPath $Test).Path $config
  Write-Host "NBLAB automation agent $AgentVersion - test of $($plan.file)" -ForegroundColor Cyan
  Write-Host "`n--- Text read from the file (first 1500 characters) ---"
  $preview = $plan.text
  if ($preview.Length -gt 1500) { $preview = $preview.Substring(0, 1500) + ' ...' }
  Write-Host $preview
  Write-Host ''
  if (-not $plan.automation) { Write-Host 'No automation matches this file.' -ForegroundColor Yellow; exit 0 }
  Write-Host "Matches: $($plan.automation.name)" -ForegroundColor Green
  foreach ($key in ($plan.values.Keys | Sort-Object)) { Write-Host ("  {{{0}}} = {1}" -f $key, $plan.values[$key]) }
  if ($plan.printFile) { Write-Host "Would print the file x$($plan.fileCopies)" }
  foreach ($doc in $plan.documents) {
    $state = if (Test-Path -LiteralPath $doc.path) { 'found' } else { 'NOT FOUND' }
    Write-Host "Would print $($doc.path) x$($doc.copies) ($state)"
  }
  if ($plan.sticker) { Write-Host "Would print a sticker on '$($config.stickerPrinter)':"; $plan.stickerLines | ForEach-Object { Write-Host "  | $_" } }
  exit 0
}

# ---- Watching -------------------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $config.watchFolder)) {
  Write-AgentLog "PROBLEM: the folder to watch does not exist: $($config.watchFolder) - fix watchFolder in $ConfigPath"
  exit 1
}

$script:Tray = New-Object System.Windows.Forms.NotifyIcon
$script:Tray.Icon = [System.Drawing.SystemIcons]::Information
$script:Tray.Text = 'NBLAB automation - watching ' + (Split-Path -Leaf $config.watchFolder)
$script:Tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Open log', $null, { Start-Process notepad.exe $LogPath })
[void]$menu.Items.Add('Open settings', $null, { Start-Process notepad.exe $ConfigPath })
$script:Stop = $false
[void]$menu.Items.Add('Stop watching', $null, { $script:Stop = $true })
$script:Tray.ContextMenuStrip = $menu

$watcher = New-Object System.IO.FileSystemWatcher $config.watchFolder
$watcher.IncludeSubdirectories = $false
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
Register-ObjectEvent $watcher Created -SourceIdentifier 'nblab.created' | Out-Null
Register-ObjectEvent $watcher Renamed -SourceIdentifier 'nblab.renamed' | Out-Null
$watcher.EnableRaisingEvents = $true

$mode = if ($config.dryRun) { ' (DRY RUN - nothing is printed)' } else { '' }
Write-AgentLog "Agent $AgentVersion watching $($config.watchFolder); automations and documents in $($config.sharedFolder)$mode"
Show-Notice 'NBLAB automation' "Watching $($config.watchFolder)$mode"

$recent = @{}
try {
  while (-not $script:Stop) {
    [System.Windows.Forms.Application]::DoEvents()
    $change = Wait-Event -Timeout 1
    if (-not $change) { continue }
    $path = $change.SourceEventArgs.FullPath
    Remove-Event -EventIdentifier $change.EventIdentifier
    $name = [System.IO.Path]::GetFileName($path)
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($TempExtensions -contains $ext -or $name.StartsWith('~$') -or $name.StartsWith('.')) { continue }
    # A download fires several events; handle each file once a minute at most.
    if ($recent.ContainsKey($path) -and ((Get-Date) - $recent[$path]).TotalSeconds -lt 60) { continue }
    $recent[$path] = Get-Date
    if (-not (Wait-FileReady $path)) { continue }
    try { Invoke-Automation $path $config }
    catch {
      Write-AgentLog "PROBLEM with ${name}: $($_.Exception.Message)"
      Show-Notice 'NBLAB automation' "Could not handle ${name}: $($_.Exception.Message)" 'Error'
    }
  }
} finally {
  Unregister-Event -SourceIdentifier 'nblab.created' -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier 'nblab.renamed' -ErrorAction SilentlyContinue
  $watcher.Dispose()
  $script:Tray.Visible = $false
  $script:Tray.Dispose()
  Write-AgentLog 'Agent stopped'
}

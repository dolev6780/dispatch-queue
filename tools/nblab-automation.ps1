<#
.SYNOPSIS
  NBLAB dispatch automation agent - runs on each lab PC.

.DESCRIPTION
  It only listens: to one folder on this PC, and to the NBLAB website open on
  this same PC. Its printers are chosen in the website's Settings, and files
  are printed by hand on its Automation page.

  When a file finishes arriving in the folder, it reads the text inside it.
  A file with all the automation's words is a Grab & Go file; its return type
  is the first type whose words are all in it (PC refresh, LDO, ...), or
  "Anything else". Each type says what to print: the receipt (the downloaded
  file itself) and forms from the files-to-print folder on this PC's A4
  printer, and a sticker with details read from the file on its sticker
  printer. Each PC chooses its two printers from the printers in Windows, on
  the website.

  The website reaches it on http://127.0.0.1:47815 (only the NBLAB website,
  only from this PC): to hand it the site's automation, to choose this PC's
  printers, and to print a file - uploaded, or one it handled - or any part
  of it. Nothing is sent anywhere else; there is no sign-in and no window.

  It is published as nblab-automation.cmd: double-click it. It runs next to
  the clock, starts with Windows, and updates itself when the website has a
  newer version. Its settings and log are in %LOCALAPPDATA%\NBLAB\automation.

.EXAMPLE
  nblab-automation.cmd
  Start (or restart) the agent.

.EXAMPLE
  nblab-automation.cmd -Test "C:\Users\me\Downloads\return.pdf"
  Show what the agent reads from a file, its type and what it would print -
  without printing anything.
#>
param(
  [string]$Test,
  # Opens the website's Settings, where this PC's printers are chosen.
  [switch]$Setup,
  [switch]$DryRun,
  # The .cmd this runs from, passed by the .cmd - for "start when I sign in".
  [string]$Self,
  # Load the functions only; used by nblab-automation.test.ps1.
  [switch]$Library
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
# GitHub Pages needs TLS 1.2, which Windows PowerShell 5.1 does not use by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Raise it with every change: the PCs update themselves to a newer version.
$AgentVersion = '3.0.1'
# Filled in when the website is built (vite.config.js): where the website is.
$SiteUrl = '__NBLAB_SITE_URL__'
# Agents 2.2 check for this line before taking an update; it is not used.
$FirebaseApiKey = '__NBLAB_FIREBASE_API_KEY__'
$SiteOrigin = if ($SiteUrl -match '^https?://') { ([uri]$SiteUrl).GetLeftPart([System.UriPartial]::Authority) } else { '' }
$UpdateUrl = if ($SiteUrl -match '^https?://') { $SiteUrl.TrimEnd('/') + '/nblab-automation.cmd' } else { '' }
$AgentPort = if ($env:NBLAB_AGENT_PORT) { [int]$env:NBLAB_AGENT_PORT } else { 47815 }
$OtherType = 'Anything else'

# NBLAB_DATA_FOLDER: a separate agent for testing, with its own settings.
$DataFolder = if ($env:NBLAB_DATA_FOLDER) { $env:NBLAB_DATA_FOLDER } else { Join-Path $env:LOCALAPPDATA 'NBLAB\automation' }
$MutexName = if ($env:NBLAB_DATA_FOLDER) { 'NBLAB-dispatch-automation-' + [Math]::Abs($env:NBLAB_DATA_FOLDER.ToLowerInvariant().GetHashCode()) } else { 'NBLAB-dispatch-automation' }
$ConfigPath = Join-Path $DataFolder 'config.json'
$LogPath = Join-Path $DataFolder 'automation.log'
$UploadFolder = Join-Path $DataFolder 'uploads'
$StableCopy = Join-Path $DataFolder 'nblab-automation.cmd'
# A test agent (NBLAB_DATA_FOLDER) keeps its shortcut to itself, never in Startup.
$StartupLink = if ($env:NBLAB_DATA_FOLDER) { Join-Path $DataFolder 'NBLAB automation.lnk' } else { Join-Path ([Environment]::GetFolderPath('Startup')) 'NBLAB automation.lnk' }
$TempExtensions = @('.crdownload', '.part', '.partial', '.tmp', '.download', '.opdownload', '.!ut')
$MaxFileBytes = 50MB
$ValueLimit = 80
# A test run: everything happens except the paper (-DryRun, or NBLAB_DRY_RUN=1).
$script:DryRunMode = $false

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

# ---- Details from the file, and the sticker -------------------------------------------

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

function Format-Sticker($Lines, $Values) {
  return @(foreach ($line in @($Lines)) {
    [regex]::Replace([string]$line, '\{([a-zA-Z0-9_]+)\}', {
      param($m)
      $key = $m.Groups[1].Value.ToLowerInvariant()
      if ($Values.ContainsKey($key)) { [string]$Values[$key] } else { '' }
    })
  })
}

function Get-Prop($Object, [string]$Name) {
  # A property that may be missing - strict mode would throw on it.
  if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
  return $null
}

# ---- The automation: Grab & Go files and their return types --------------------------

function Limit-Copies($Value) {
  $n = 1
  try { $n = [int]$Value } catch { }
  return [Math]::Min(5, [Math]::Max(1, $n))
}

function ConvertTo-WordList($List, [int]$Max = 10) {
  return @(@($List) | Where-Object { $null -ne $_ -and ([string]$_).Trim() } | ForEach-Object { ([string]$_).Trim() } | Select-Object -First $Max)
}

function ConvertTo-Prints($Object) {
  # What one return type prints - every field present, whatever was sent.
  $docs = @(@(foreach ($doc in @(Get-Prop $Object 'documents')) {
    $file = ([string](Get-Prop $doc 'file')).Trim()
    if ($file) { [pscustomobject]@{ file = $file; copies = (Limit-Copies (Get-Prop $doc 'copies')) } }
  }) | Select-Object -First 10)
  return [pscustomobject]@{
    receipt = ((Get-Prop $Object 'receipt') -eq $true)
    receiptCopies = (Limit-Copies (Get-Prop $Object 'receiptCopies'))
    documents = $docs
    sticker = ((Get-Prop $Object 'sticker') -eq $true)
  }
}

function ConvertTo-AgentAutomation($Object) {
  # The automation the website handed over, cleaned the same way the website
  # cleans it (src/services/automation.js cleanAutomation).
  if ($null -eq $Object) { return $null }
  $types = @(@(foreach ($type in @(Get-Prop $Object 'types')) {
    if ($null -eq $type) { continue }
    $name = ([string](Get-Prop $type 'name')).Trim()
    $words = @(ConvertTo-WordList (Get-Prop $type 'keywords'))
    if (-not $name -or $words.Count -eq 0 -or $name -eq $OtherType) { continue }
    $prints = ConvertTo-Prints $type
    [pscustomobject]@{
      name = $name; keywords = $words
      receipt = $prints.receipt; receiptCopies = $prints.receiptCopies; documents = $prints.documents; sticker = $prints.sticker
    }
  }) | Select-Object -First 8)
  $fields = @(foreach ($field in @(Get-Prop $Object 'stickerFields')) {
    $name = ([string](Get-Prop $field 'name')).Trim().ToLowerInvariant()
    $label = ([string](Get-Prop $field 'label')).Trim()
    if ($name -and $label) { [pscustomobject]@{ name = $name; label = $label } }
  })
  return [pscustomobject]@{
    keywords = @(ConvertTo-WordList (Get-Prop $Object 'keywords'))
    fileTypes = @(ConvertTo-WordList (Get-Prop $Object 'fileTypes') | ForEach-Object { $_.TrimStart('*').TrimStart('.').ToLowerInvariant() })
    types = $types
    other = (ConvertTo-Prints (Get-Prop $Object 'other'))
    stickerFields = $fields
    stickerLines = @(@(Get-Prop $Object 'stickerLines') | Where-Object { $null -ne $_ -and ([string]$_).Trim() } | ForEach-Object { [string]$_ } | Select-Object -First 8)
    watchFolder = ([string](Get-Prop $Object 'watchFolder')).Trim()
    filesFolder = ([string](Get-Prop $Object 'filesFolder')).Trim()
    autoPrint = ((Get-Prop $Object 'autoPrint') -ne $false)
  }
}

function Test-AllWords([string]$Haystack, $Words) {
  $list = @($Words)
  if ($list.Count -eq 0) { return $false }
  foreach ($word in $list) { if (-not $Haystack.Contains(([string]$word).ToLowerInvariant())) { return $false } }
  return $true
}

function Find-ReturnType([string]$Text, [string]$FileName, $Automation) {
  # Is it a Grab & Go file (the right kind of file, with all the words), and
  # which type: the first whose words are all in it, else "Anything else".
  $no = @{ isGrabAndGo = $false; type = '' }
  if (-not $Automation) { return $no }
  $ext = [System.IO.Path]::GetExtension($FileName).TrimStart('.').ToLowerInvariant()
  $kinds = @($Automation.fileTypes)
  if ($kinds.Count -gt 0 -and $kinds -notcontains $ext) { return $no }
  $haystack = $Text.ToLowerInvariant()
  if (-not (Test-AllWords $haystack $Automation.keywords)) { return $no }
  foreach ($type in @($Automation.types)) {
    if (Test-AllWords $haystack $type.keywords) { return @{ isGrabAndGo = $true; type = $type.name } }
  }
  return @{ isGrabAndGo = $true; type = $OtherType }
}

function Get-TypePrints($Automation, [string]$TypeName) {
  # The prints of a type by name; an unknown name is "Anything else".
  foreach ($type in @($Automation.types)) { if ($type.name -eq $TypeName) { return $type } }
  $other = $Automation.other
  return [pscustomobject]@{
    name = $OtherType; keywords = @()
    receipt = $other.receipt; receiptCopies = $other.receiptCopies; documents = $other.documents; sticker = $other.sticker
  }
}

function Read-Fields([string]$Text, $Fields) {
  $values = @{}
  foreach ($field in @($Fields)) { if ($field -and $field.name) { $values[([string]$field.name).ToLowerInvariant()] = Read-Field $Text $field.label } }
  return $values
}

function Get-BuiltinValues([string]$FileName, [string]$TypeName, [datetime]$Now) {
  return @{
    type = $TypeName
    file = $FileName
    # Fixed formats: '/' and ':' would otherwise follow the PC's regional settings.
    date = $Now.ToString('dd/MM/yyyy', [System.Globalization.CultureInfo]::InvariantCulture)
    time = $Now.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
  }
}

function Get-ReturnPlan([string]$Path, [string]$Name, $Automation, $Settings, [string]$TypeName = '') {
  # What a file is and what it prints - as its own type, or as the type asked for.
  $text = Get-FileText $Path
  $found = Find-ReturnType $text $Name $Automation
  $chosen = if ($TypeName) { $TypeName } elseif ($found.isGrabAndGo) { $found.type } else { $OtherType }
  $prints = Get-TypePrints $Automation $chosen
  $values = Read-Fields $text $Automation.stickerFields
  $builtins = Get-BuiltinValues $Name $prints.name (Get-Date)
  foreach ($key in $builtins.Keys) { $values[$key] = $builtins[$key] }
  $documents = @(foreach ($doc in @($prints.documents)) {
    $docPath = Join-Path $Settings.filesFolder $doc.file
    @{ file = $doc.file; copies = [int]$doc.copies; path = $docPath; found = (Test-Path -LiteralPath $docPath) }
  })
  return @{
    path = $Path
    name = $Name
    text = $text
    isGrabAndGo = $found.isGrabAndGo
    detected = $found.type
    type = $prints.name
    values = $values
    receipt = $(if ($prints.receipt) { @{ copies = [int]$prints.receiptCopies } } else { $null })
    documents = $documents
    sticker = [bool]$prints.sticker
    stickerLines = @(Format-Sticker $Automation.stickerLines $values)
  }
}

function Test-FormName([string]$File) {
  # A form is a file name in the files-to-print folder - never a path.
  return ($File -and $File -eq [System.IO.Path]::GetFileName($File) -and $File -notmatch '^\.+$')
}

function Invoke-Prints($Plan, [string]$What, [string]$File, $Lines, $Settings) {
  # Print all of a plan, or one part of it: the receipt, the sticker, or one
  # form. A form alone needs no plan (a blank form).
  $done = New-Object System.Collections.Generic.List[string]
  $problems = New-Object System.Collections.Generic.List[string]
  $dry = [bool]$Settings.dryRun
  $a4 = [string]$Settings.a4Printer
  $stickerPrinter = [string]$Settings.stickerPrinter
  $noA4 = 'no A4 printer is chosen on this PC (website, Settings)'
  $all = $What -eq 'all'

  if ($Plan -and ($What -eq 'receipt' -or ($all -and $Plan.receipt))) {
    $copies = if ($Plan.receipt) { $Plan.receipt.copies } else { 1 }
    if (-not $a4) { $problems.Add($noA4) }
    else { try { Invoke-PrintFile $Plan.path $copies $a4 $dry; $done.Add('receipt') } catch { $problems.Add("receipt: $($_.Exception.Message)") } }
  }

  $forms = @()
  if ($all -and $Plan) { $forms = @($Plan.documents) }
  elseif ($What -eq 'document') {
    if (-not (Test-FormName $File)) { $problems.Add('that is not a form name') }
    else {
      $known = @()
      if ($Plan) { $known = @($Plan.documents | Where-Object { $_.file -eq $File }) }
      if ($known.Count) { $forms = $known } else { $forms = @(@{ file = $File; copies = 1; path = (Join-Path $Settings.filesFolder $File) }) }
    }
  }
  foreach ($form in $forms) {
    if (-not (Test-Path -LiteralPath $form.path)) { $problems.Add("$($form.file) is not in $($Settings.filesFolder)"); continue }
    if (-not $a4) { if (-not $problems.Contains($noA4)) { $problems.Add($noA4) }; continue }
    try { Invoke-PrintFile $form.path $form.copies $a4 $dry; $done.Add($form.file) } catch { $problems.Add("$($form.file): $($_.Exception.Message)") }
  }

  if ($Plan -and ($What -eq 'sticker' -or ($all -and $Plan.sticker))) {
    $text = @($Plan.stickerLines)
    if ($null -ne $Lines -and @($Lines).Count) { $text = @($Lines | ForEach-Object { [string]$_ }) }
    if (-not $stickerPrinter) { $problems.Add('no sticker printer is chosen on this PC (website, Settings)') }
    else { try { Invoke-PrintSticker $stickerPrinter $text $dry ''; $done.Add('sticker') } catch { $problems.Add("sticker: $($_.Exception.Message)") } }
  }
  return @{ done = @($done); problems = @($problems); dryRun = $dry }
}

# ---- This PC's settings: its printers, and the automation the website gave it ----------

function Get-AgentConfig {
  # config.json; on the first start after 2.x, the printers chosen then are
  # kept and the old sign-in is removed - the agent no longer signs in.
  $config = @{ a4Printer = ''; stickerPrinter = ''; automation = $null; revision = [long]0; siteId = ''; siteName = ''; isNew = $false }
  if (Test-Path -LiteralPath $ConfigPath) {
    $saved = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
    foreach ($key in @('a4Printer', 'stickerPrinter', 'siteId', 'siteName')) { $config[$key] = [string](Get-Prop $saved $key) }
    $config.revision = [long](Get-Prop $saved 'revision')
    $config.automation = ConvertTo-AgentAutomation (Get-Prop $saved 'automation')
    return $config
  }
  $old = Join-Path $DataFolder 'settings.json'
  if (Test-Path -LiteralPath $old) {
    try {
      $saved = [System.IO.File]::ReadAllText($old) | ConvertFrom-Json
      $config.a4Printer = [string](Get-Prop $saved 'a4Printer')
      $config.stickerPrinter = [string](Get-Prop $saved 'stickerPrinter')
    } catch { }
    Save-AgentConfig $config
    foreach ($name in @('settings.json', 'automations-cache.json')) { Remove-Item -LiteralPath (Join-Path $DataFolder $name) -Force -ErrorAction SilentlyContinue }
    return $config
  }
  $config.isNew = $true
  return $config
}

function Save-AgentConfig($Config) {
  New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
  $out = @{
    a4Printer = $Config.a4Printer; stickerPrinter = $Config.stickerPrinter
    automation = $Config.automation; revision = $Config.revision; siteId = $Config.siteId; siteName = $Config.siteName
  }
  [System.IO.File]::WriteAllText($ConfigPath, ($out | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-AgentSettings($Config) {
  # What this PC does now: the automation's folders (each person's own with
  # %USERPROFILE%), this PC's printers, and whether to print by itself.
  $defaults = Get-DefaultFolders
  $a = $Config.automation
  $watch = if ($a -and $a.watchFolder) { [Environment]::ExpandEnvironmentVariables($a.watchFolder) } else { $defaults.watchFolder }
  $files = if ($a -and $a.filesFolder) { [Environment]::ExpandEnvironmentVariables($a.filesFolder) } else { $defaults.filesFolder }
  return @{
    watchFolder = $watch
    filesFolder = $files
    a4Printer = [string]$Config.a4Printer
    stickerPrinter = [string]$Config.stickerPrinter
    autoPrint = [bool]($a -and $a.autoPrint)
    dryRun = [bool]$script:DryRunMode
    wanted = @{}
  }
}

function Get-InstalledPrinters {
  Add-Type -AssemblyName System.Drawing
  return @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
}

function Set-AgentSetup($Config, $Request) {
  # From the website: this PC's printers, and/or the site's automation.
  $printers = Get-Prop $Request 'printers'
  if ($null -ne $printers) {
    $installed = Get-InstalledPrinters
    foreach ($key in @('a4Printer', 'stickerPrinter')) {
      $name = [string](Get-Prop $printers $key)
      if ($name -and $installed -notcontains $name) { throw "There is no printer named '$name' on this PC." }
      $Config[$key] = $name
    }
  }
  $automation = Get-Prop $Request 'automation'
  if ($null -ne $automation) {
    $Config.automation = ConvertTo-AgentAutomation $automation
    $Config.revision = [long](Get-Prop $Request 'revision')
    $site = Get-Prop $Request 'site'
    $Config.siteId = [string](Get-Prop $site 'id')
    $Config.siteName = [string](Get-Prop $site 'name')
  }
  Save-AgentConfig $Config
}

# ---- Files handled lately: what arrived, and what the website uploaded -------------------

$script:Recent = New-Object System.Collections.ArrayList
$script:RecentCount = 0

function Add-Recent([string]$Path, [string]$Name, $Plan, [string]$Status) {
  $script:RecentCount++
  $entry = @{
    id = 'f' + [DateTime]::UtcNow.Ticks + '-' + $script:RecentCount
    name = $Name
    path = $Path
    at = (Get-Date).ToString('o')
    type = $(if ($Plan.isGrabAndGo) { $Plan.type } else { '' })
    status = $Status
  }
  $script:Recent.Insert(0, $entry)
  while ($script:Recent.Count -gt 20) { $script:Recent.RemoveAt($script:Recent.Count - 1) }
  return $entry
}

function Find-Recent([string]$Id) {
  foreach ($entry in $script:Recent) { if ($entry.id -eq $Id) { return $entry } }
  return $null
}

function Clear-OldUploads {
  if (-not (Test-Path -LiteralPath $UploadFolder)) { return }
  Get-ChildItem -LiteralPath $UploadFolder -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-2) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function Save-Upload([string]$Name, [byte[]]$Bytes) {
  New-Item -ItemType Directory -Force -Path $UploadFolder | Out-Null
  $safe = ([System.IO.Path]::GetFileName($Name) -replace '[\\/:*?"<>|]', '_').Trim()
  if (-not $safe -or $safe -match '^\.+$') { $safe = 'upload' }
  $path = Join-Path $UploadFolder (([DateTime]::UtcNow.Ticks).ToString() + '-' + $safe)
  [System.IO.File]::WriteAllBytes($path, $Bytes)
  return $path
}

function ConvertTo-PlanAnswer([string]$Id, $Plan) {
  # A plan as the website shows it.
  $preview = [string]$Plan.text
  if ($preview.Length -gt 2000) { $preview = $preview.Substring(0, 2000) }
  return @{
    id = $Id
    name = $Plan.name
    isGrabAndGo = [bool]$Plan.isGrabAndGo
    detected = $Plan.detected
    type = $Plan.type
    values = $Plan.values
    receipt = $Plan.receipt
    documents = @($Plan.documents | ForEach-Object { @{ file = $_.file; copies = $_.copies; found = [bool]$_.found } })
    sticker = $Plan.sticker
    stickerLines = @($Plan.stickerLines)
    textPreview = $preview
  }
}

# ---- Listening to the website on this PC ---------------------------------------------------

function Test-AllowedOrigin([string]$Origin) {
  # Only the NBLAB website - or the app run on this PC while developing it.
  if (-not $Origin) { return $false }
  if ($SiteOrigin -and $Origin -eq $SiteOrigin) { return $true }
  return [regex]::IsMatch($Origin, '^http://(localhost|127\.0\.0\.1)(:\d{1,5})?$')
}

function Read-HttpRequest($Stream) {
  # One HTTP/1.1 request: the request line, headers, and a Content-Length body.
  $Stream.ReadTimeout = 15000
  $head = New-Object System.Collections.Generic.List[byte]
  while ($true) {
    $b = $Stream.ReadByte()
    if ($b -lt 0) { return $null }
    $head.Add([byte]$b)
    $n = $head.Count
    if ($n -ge 4 -and $head[$n - 4] -eq 13 -and $head[$n - 3] -eq 10 -and $head[$n - 2] -eq 13 -and $head[$n - 1] -eq 10) { break }
    if ($n -gt 32768) { throw 'The request headers are too long.' }
  }
  $lines = [System.Text.Encoding]::ASCII.GetString($head.ToArray()) -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 3) { return $null }
  $headers = @{}
  foreach ($line in $lines | Select-Object -Skip 1) {
    $i = $line.IndexOf(':')
    if ($i -gt 0) { $headers[$line.Substring(0, $i).Trim().ToLowerInvariant()] = $line.Substring($i + 1).Trim() }
  }
  $target = $first[1]
  $path = $target
  $query = @{}
  $q = $target.IndexOf('?')
  if ($q -ge 0) {
    $path = $target.Substring(0, $q)
    foreach ($pair in ($target.Substring($q + 1) -split '&')) {
      if (-not $pair) { continue }
      $kv = $pair -split '=', 2
      $query[[uri]::UnescapeDataString($kv[0])] = if ($kv.Count -gt 1) { [uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
    }
  }
  $length = 0
  if ($headers.ContainsKey('content-length')) { $length = [long]$headers['content-length'] }
  $request = @{ method = $first[0].ToUpperInvariant(); path = $path; query = $query; headers = $headers; body = [byte[]]@(); tooLarge = $false }
  if ($length -gt $MaxFileBytes) { $request.tooLarge = $true; return $request }
  if ($length -gt 0) {
    $body = New-Object byte[] $length
    $read = 0
    while ($read -lt $length) {
      $got = $Stream.Read($body, $read, [int]($length - $read))
      if ($got -le 0) { break }
      $read += $got
    }
    $request.body = $body
  }
  return $request
}

function Send-HttpResponse($Stream, [int]$Status, [string]$Origin, $Answer, [hashtable]$Extra = @{}) {
  $reasons = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }
  # (An empty array would vanish through 'if': start from one.)
  $body = [byte[]]@()
  if ($null -ne $Answer) { $body = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Answer -Depth 8 -Compress)) }
  $head = New-Object System.Text.StringBuilder
  [void]$head.Append("HTTP/1.1 $Status $($reasons[$Status])`r`n")
  [void]$head.Append("Content-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n")
  if ($Origin) { [void]$head.Append("Access-Control-Allow-Origin: $Origin`r`nVary: Origin`r`n") }
  foreach ($key in $Extra.Keys) { [void]$head.Append("${key}: $($Extra[$key])`r`n") }
  [void]$head.Append("`r`n")
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($head.ToString())
  $Stream.Write($bytes, 0, $bytes.Length)
  if ($body.Length) { $Stream.Write($body, 0, $body.Length) }
  $Stream.Flush()
}

function Get-AgentStatus {
  $settings = $script:Settings
  $forms = @()
  try { $forms = @(Get-ChildItem -LiteralPath $settings.filesFolder -File -ErrorAction Stop | ForEach-Object { $_.Name }) } catch { }
  return @{
    app = 'nblab-automation'
    version = $AgentVersion
    printers = @(Get-InstalledPrinters)
    defaultPrinter = (Get-DefaultPrinter)
    a4Printer = $script:Config.a4Printer
    stickerPrinter = $script:Config.stickerPrinter
    watching = $settings.watchFolder
    filesFolder = $settings.filesFolder
    documents = $forms
    autoPrint = $settings.autoPrint
    dryRun = $settings.dryRun
    automationRevision = $script:Config.revision
    site = @{ id = $script:Config.siteId; name = $script:Config.siteName }
    recent = @($script:Recent | ForEach-Object { @{ id = $_.id; name = $_.name; at = $_.at; type = $_.type; status = $_.status } })
  }
}

function Invoke-AgentApi($Request) {
  # What the website asks; returns @{ status; answer }.
  $json = $null
  if ($Request.body.Length -and $Request.path -ne '/read') {
    try { $json = [System.Text.Encoding]::UTF8.GetString($Request.body) | ConvertFrom-Json } catch { return @{ status = 400; answer = @{ error = 'That was not JSON.' } } }
  }
  $route = "$($Request.method) $($Request.path)"
  switch ($route) {
    'GET /status' { return @{ status = 200; answer = (Get-AgentStatus) } }
    'POST /setup' {
      if ($null -eq $json) { return @{ status = 400; answer = @{ error = 'Nothing to set up.' } } }
      Set-AgentSetup $script:Config $json
      Use-AgentSettings
      return @{ status = 200; answer = (Get-AgentStatus) }
    }
    'POST /read' {
      if (-not $script:Config.automation) { return @{ status = 400; answer = @{ error = 'The automation has not reached this PC yet.' } } }
      $name = [string]$Request.query['name']
      if (-not $name) { $name = 'upload' }
      $path = Save-Upload $name $Request.body
      $plan = Get-ReturnPlan $path $name $script:Config.automation $script:Settings
      $entry = Add-Recent $path $name $plan 'uploaded'
      Write-AgentLog "Uploaded from the website: $name ($($plan.type))"
      return @{ status = 200; answer = (ConvertTo-PlanAnswer $entry.id $plan) }
    }
    'GET /plan' {
      $entry = Find-Recent ([string]$Request.query['id'])
      if (-not $entry -or -not (Test-Path -LiteralPath $entry.path)) { return @{ status = 404; answer = @{ error = 'That file is no longer here.' } } }
      if (-not $script:Config.automation) { return @{ status = 400; answer = @{ error = 'The automation has not reached this PC yet.' } } }
      $plan = Get-ReturnPlan $entry.path $entry.name $script:Config.automation $script:Settings ([string]$Request.query['type'])
      return @{ status = 200; answer = (ConvertTo-PlanAnswer $entry.id $plan) }
    }
    'POST /print' {
      if ($null -eq $json) { return @{ status = 400; answer = @{ error = 'Nothing to print.' } } }
      $what = [string](Get-Prop $json 'what')
      if (@('all', 'receipt', 'sticker', 'document') -notcontains $what) { return @{ status = 400; answer = @{ error = 'Print what?' } } }
      $plan = $null
      $entry = $null
      $id = [string](Get-Prop $json 'id')
      if ($id) {
        $entry = Find-Recent $id
        if (-not $entry -or -not (Test-Path -LiteralPath $entry.path)) { return @{ status = 404; answer = @{ error = 'That file is no longer here.' } } }
        if (-not $script:Config.automation) { return @{ status = 400; answer = @{ error = 'The automation has not reached this PC yet.' } } }
        $plan = Get-ReturnPlan $entry.path $entry.name $script:Config.automation $script:Settings ([string](Get-Prop $json 'type'))
      } elseif ($what -ne 'document') {
        return @{ status = 400; answer = @{ error = 'Which file?' } }
      }
      $result = Invoke-Prints $plan $what ([string](Get-Prop $json 'file')) (Get-Prop $json 'lines') $script:Settings
      $about = if ($entry) { "$($entry.name) as $($plan.type)" } else { 'a blank form' }
      Write-AgentLog ("Printing from the website ($what, $about): " + $(if ($result.done.Count) { ($result.done -join ', ') } else { 'nothing' }))
      foreach ($problem in $result.problems) { Write-AgentLog "  PROBLEM: $problem" }
      if ($entry -and $what -eq 'all') { $entry.status = $(if ($result.problems.Count) { 'problem' } else { 'printed' }); $entry.type = $plan.type }
      return @{ status = 200; answer = $result }
    }
    default { return @{ status = 404; answer = @{ error = "Not here: $route" } } }
  }
}

function Invoke-LocalRequest($Client) {
  # One request from the website: checked, answered, closed.
  $origin = ''
  $stream = $null
  try {
    $stream = $Client.GetStream()
    $request = Read-HttpRequest $stream
    if (-not $request) { return }
    $from = [string]$request.headers['origin']
    if (Test-AllowedOrigin $from) { $origin = $from }
    if ($request.method -eq 'OPTIONS') {
      if (-not $origin) { Send-HttpResponse $stream 403 '' @{ error = 'Only the NBLAB website may use this agent.' }; return }
      Send-HttpResponse $stream 204 $origin $null @{
        'Access-Control-Allow-Methods' = 'GET, POST, OPTIONS'
        'Access-Control-Allow-Headers' = 'Content-Type'
        'Access-Control-Allow-Private-Network' = 'true'
        'Access-Control-Max-Age' = '600'
      }
      return
    }
    if (-not $origin) { Send-HttpResponse $stream 403 '' @{ error = 'Only the NBLAB website may use this agent.' }; return }
    if ($request.tooLarge) { Send-HttpResponse $stream 413 $origin @{ error = 'That file is too big.' }; return }
    $reply = Invoke-AgentApi $request
    Send-HttpResponse $stream $reply.status $origin $reply.answer
  } catch {
    # The page gave up waiting (it closed the connection): nothing to answer.
    if ($_.Exception.ToString() -match 'transport connection|forcibly closed') { return }
    Write-AgentLog "PROBLEM answering the website: $($_.Exception.Message)"
    if ($stream) { try { Send-HttpResponse $stream 500 $origin @{ error = $_.Exception.Message } } catch { } }
  } finally {
    $Client.Close()
  }
}

function Start-LocalServer([int]$Port) {
  # Only on 127.0.0.1: nothing outside this PC can reach it.
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
  return $listener
}

function Step-LocalServer($Listener) {
  # Answer what is waiting, without waiting for more.
  $answered = 0
  while ($Listener -and $Listener.Pending() -and $answered -lt 20) {
    $null = Invoke-LocalRequest ($Listener.AcceptTcpClient())
    $answered++
  }
  return $answered
}

# ---- A file arrives -------------------------------------------------------------------------

function Invoke-Arrival([string]$Path) {
  # A new file in the folder: a Grab & Go file is printed by itself, or kept
  # for the website when automatic printing is off. Other files are left alone.
  $name = [System.IO.Path]::GetFileName($Path)
  $automation = $script:Config.automation
  if (-not $automation) {
    Write-AgentLog "Not set up yet - $name was not looked at. Open the NBLAB website on this PC."
    return
  }
  $plan = Get-ReturnPlan $Path $name $automation $script:Settings
  if (-not $plan.isGrabAndGo) { Write-AgentLog "Not a Grab & Go file: $name"; return }
  if (-not $script:Settings.autoPrint) {
    $entry = Add-Recent $Path $name $plan 'waiting'
    Write-AgentLog "'$($plan.type)': $name - waiting to be printed from the website"
    Show-Notice "NBLAB: $($plan.type)" "$name - print it from the Automation page."
    return
  }
  $entry = Add-Recent $Path $name $plan 'printed'
  Write-AgentLog "'$($plan.type)': $name"
  $result = Invoke-Prints $plan 'all' '' $null $script:Settings
  $verb = if ($result.dryRun) { 'would print' } else { 'printed' }
  if ($result.done.Count) { Write-AgentLog ("  ${verb}: " + ($result.done -join ', ')) }
  foreach ($problem in $result.problems) { Write-AgentLog "  PROBLEM: $problem" }
  $summary = if (-not $result.done.Count) { 'Nothing printed' } elseif ($result.dryRun) { '(test run) Would print ' + ($result.done -join ', ') } else { 'Printed ' + ($result.done -join ', ') }
  if ($result.problems.Count) {
    $entry.status = 'problem'
    Show-Notice "NBLAB: $($plan.type)" ("$summary. Problem: " + ($result.problems -join '; ')) 'Warning'
  } else {
    Show-Notice "NBLAB: $($plan.type)" "$summary - $name"
  }
}

# ---- Folders ---------------------------------------------------------------------------

function Get-DefaultFolders {
  return @{
    watchFolder = (Join-Path $env:USERPROFILE 'Downloads')
    filesFolder = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NBLAB print files')
  }
}

function Resolve-AgentFolder($Settings, [string]$Key) {
  # A folder from the website may not exist on this PC yet: make it, or fall
  # back to the default one. What was asked for is kept, so the same problem
  # is not reported again on every refresh.
  $Settings.wanted[$Key] = $Settings[$Key]
  try {
    # Test-Path itself throws on characters Windows does not allow.
    if (Test-Path -LiteralPath $Settings[$Key] -PathType Container) { return }
    New-Item -ItemType Directory -Force -Path $Settings[$Key] | Out-Null
  } catch {
    $fallback = (Get-DefaultFolders)[$Key]
    Write-AgentLog "PROBLEM: cannot use $($Settings[$Key]) ($($_.Exception.Message)); using $fallback"
    Show-Notice 'NBLAB automation' "Cannot use $($Settings[$Key]) - using $fallback instead." 'Warning'
    $Settings[$Key] = $fallback
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
  }
}

# ---- Updating itself ---------------------------------------------------------------------------

function Get-ScriptVersion([string]$Text) {
  $m = [regex]::Match($Text, "(?m)^\`$AgentVersion = '(\d+(\.\d+){1,3})'")
  if ($m.Success) { return [version]$m.Groups[1].Value }
  return $null
}

function Test-AgentScript([string]$Text) {
  # Is this a whole, working copy of the agent? Returns what is wrong, or ''.
  if ($Text.Length -lt 20000 -or $Text.Length -gt 3000000) { return 'not the agent (size)' }
  if (-not $Text.TrimStart([char]0xFEFF).StartsWith('<# :')) { return 'not the agent' }
  if (-not (Get-ScriptVersion $Text)) { return 'no version' }
  if (-not [regex]::IsMatch($Text, '(?m)^\$SiteUrl = ''https?://[^'']+''')) { return 'not built for the website' }
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count) { return 'damaged' }
  return ''
}

function Get-AgentUpdate {
  # The agent on the website, when it is newer than this one; otherwise $null.
  $url = if ($env:NBLAB_UPDATE_URL) { $env:NBLAB_UPDATE_URL } else { $UpdateUrl }
  if (-not $url) { return $null }
  # Past any cache, so a new version is seen at once.
  if ($url -match '^https?://') { $url += $(if ($url.Contains('?')) { '&' } else { '?' }) + 'v=' + [DateTime]::UtcNow.Ticks }
  $client = New-Object System.Net.WebClient
  if ($client.Proxy) { $client.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials }
  try { $bytes = $client.DownloadData($url) } finally { $client.Dispose() }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $problem = Test-AgentScript $text
  if ($problem) { throw "The agent on the website looks wrong ($problem); keeping this one." }
  $version = Get-ScriptVersion $text
  if ($version -le [version]$AgentVersion) { return $null }
  return @{ version = $version; bytes = $bytes }
}

function Save-AgentUpdate($Update, [string]$Path) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $temp = "$Path.new"
  [System.IO.File]::WriteAllBytes($temp, $Update.bytes)
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Start-AgentCopy([string]$Path, [hashtable]$Environment = @{}) {
  # Like double-clicking it, but straight to the hidden agent: no console window.
  $info = New-Object System.Diagnostics.ProcessStartInfo 'powershell.exe'
  $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:NBLAB_SELF))) -Self $env:NBLAB_SELF"'
  $info.CreateNoWindow = $true
  $info.UseShellExecute = $false
  $info.EnvironmentVariables['NBLAB_SELF'] = $Path
  foreach ($key in $Environment.Keys) { $info.EnvironmentVariables[$key] = [string]$Environment[$key] }
  return [System.Diagnostics.Process]::Start($info)
}

# ---- Log, notices, starting with Windows --------------------------------------------------

function Write-AgentLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

$script:Tray = $null
function Show-Notice([string]$Title, [string]$Text, [string]$Kind = 'Info') {
  if (-not $script:Tray) { return }
  $script:Tray.ShowBalloonTip(6000, $Title, $Text, [System.Windows.Forms.ToolTipIcon]::$Kind)
}

function Set-StartAtSignIn([bool]$On, [string]$Link = '') {
  # A shortcut in the Startup folder to a copy of the .cmd kept with the
  # settings, so moving or deleting the download does not break it.
  $link = if ($Link) { $Link } else { $StartupLink }
  if (-not $On) {
    if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
    return
  }
  if ($Self -and (Test-Path -LiteralPath $Self) -and ((Resolve-Path -LiteralPath $Self).Path -ne $StableCopy)) {
    Copy-Item -LiteralPath $Self -Destination $StableCopy -Force
  }
  if (-not (Test-Path -LiteralPath $StableCopy)) { return }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  # Through a console with no window (conhost --headless), so nothing opens
  # at sign-in - Windows Terminal would otherwise show the .cmd's window.
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  if (Test-Path -LiteralPath $conhost) {
    $shortcut.TargetPath = $conhost
    $shortcut.Arguments = "--headless cmd.exe /c `"$StableCopy`""
  } else {
    $shortcut.TargetPath = $StableCopy
  }
  $shortcut.WorkingDirectory = $DataFolder
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NBLAB dispatch automation'
  $shortcut.Save()
}

# ---- Printing ------------------------------------------------------------------------

function Get-DefaultPrinter {
  Add-Type -AssemblyName System.Drawing
  return [string](New-Object System.Drawing.Printing.PrinterSettings).PrinterName
}

function New-PrintJob([string]$Printer, [string]$Name, [string]$ToFile) {
  # A print job for one named printer, with no "Printing..." window.
  # ToFile: print into a file instead (for tests, with "Microsoft Print to PDF").
  Add-Type -AssemblyName System.Drawing
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Printer
  if (-not $doc.PrinterSettings.IsValid) { $doc.Dispose(); throw "There is no printer named '$Printer' on this PC." }
  if ($ToFile) { $doc.PrinterSettings.PrintToFile = $true; $doc.PrinterSettings.PrintFileName = $ToFile }
  $doc.DocumentName = $Name
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  return $doc
}

function Get-PrintKind([string]$Path) {
  # How a file is printed: PDFs and pictures are drawn by the agent, text is
  # laid out by the agent, anything else goes through its app (Word, Excel...).
  $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($ext -eq '.pdf') { return 'pdf' }
  if (@('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff') -contains $ext) { return 'picture' }
  if (@('.txt', '.csv', '.tsv', '.log') -contains $ext) { return 'text' }
  return 'app'
}

$script:WinRt = $null
function Wait-WinRt($Operation, [type]$ResultType) {
  # Windows' own PDF reader is a Windows Runtime API: wait for its answers.
  if (-not $script:WinRt) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
    $script:WinRt = @{
      operation = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
      action = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
    }
  }
  if (-not $Operation) { return }
  $task = if ($ResultType) { $script:WinRt.operation.MakeGenericMethod($ResultType).Invoke($null, @($Operation)) } else { $script:WinRt.action.Invoke($null, @($Operation)) }
  [void]$task.Wait(60000)
  if ($ResultType) { return $task.Result }
}

function Open-Pdf([string]$Path) {
  Wait-WinRt $null $null
  $file = Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Path).Path)) ([Windows.Storage.StorageFile])
  return Wait-WinRt ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
}

function Get-PdfPagePicture($Pdf, [int]$Index) {
  # One page as a picture, sharp enough for paper (about 200 dots per inch).
  $page = $Pdf.GetPage([uint32]$Index)
  try {
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = [uint32][Math]::Max(1, [Math]::Round($page.Size.Width * 2))
    Wait-WinRt ($page.RenderToStreamAsync($stream, $options)) $null
    return [System.Drawing.Image]::FromStream([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream))
  } finally { $page.Dispose() }
}

function Invoke-PrintPictures([string]$Printer, [string]$Name, [int]$Count, [scriptblock]$GetPicture, [string]$ToFile) {
  # Pages that are pictures, each fitted to the printable area at the top of
  # the page; a wide one turns the page to landscape.
  $doc = New-PrintJob $Printer $Name $ToFile
  $state = @{ index = 0; picture = $null }
  $doc.add_QueryPageSettings({
    param($job, $e)
    $state.picture = & $GetPicture $state.index
    $e.PageSettings.Landscape = $state.picture.Width -gt $state.picture.Height
  })
  $doc.add_PrintPage({
    param($job, $e)
    $picture = $state.picture
    $area = $e.Graphics.VisibleClipBounds
    $scale = [Math]::Min($area.Width / $picture.Width, $area.Height / $picture.Height)
    $w = $picture.Width * $scale
    $h = $picture.Height * $scale
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.DrawImage($picture, [float]($area.X + ($area.Width - $w) / 2), [float]$area.Y, [float]$w, [float]$h)
    $picture.Dispose()
    $state.picture = $null
    $state.index++
    $e.HasMorePages = $state.index -lt $Count
  })
  try { $doc.Print() } finally { if ($state.picture) { $state.picture.Dispose() }; $doc.Dispose() }
}

function Invoke-PrintText([string]$Printer, [string]$Path, [string]$ToFile) {
  # A text or CSV file, page after page, in a fixed-width font.
  $text = [System.IO.File]::ReadAllText($Path).Replace("`t", '    ').Replace("`r`n", "`n")
  if (-not $text.Trim()) { $text = ' ' }
  $doc = New-PrintJob $Printer ([System.IO.Path]::GetFileName($Path)) $ToFile
  $state = @{ rest = $text; font = (New-Object System.Drawing.Font('Consolas', 10)) }
  $doc.add_PrintPage({
    param($job, $e)
    $area = New-Object System.Drawing.RectangleF($e.MarginBounds.X, $e.MarginBounds.Y, $e.MarginBounds.Width, $e.MarginBounds.Height)
    $format = New-Object System.Drawing.StringFormat
    $format.Trimming = [System.Drawing.StringTrimming]::Word
    $fitted = 0
    $lines = 0
    [void]$e.Graphics.MeasureString($state.rest, $state.font, $area.Size, $format, [ref]$fitted, [ref]$lines)
    if ($fitted -lt 1) { $fitted = $state.rest.Length }
    $e.Graphics.DrawString($state.rest.Substring(0, $fitted), $state.font, [System.Drawing.Brushes]::Black, $area, $format)
    $state.rest = $state.rest.Substring($fitted)
    $e.HasMorePages = $state.rest.Length -gt 0
  })
  try { $doc.Print() } finally { $state.font.Dispose(); $doc.Dispose() }
}

function Invoke-PrintWithApp([string]$Printer, [string]$Path) {
  # Word, Excel and the like: the file's app prints it to the named printer
  # (the "print to" command apps register with Windows).
  $info = New-Object System.Diagnostics.ProcessStartInfo $Path
  if (-not (@($info.Verbs) -contains 'printto')) {
    throw "no app on this PC can print $([System.IO.Path]::GetExtension($Path)) files to a chosen printer"
  }
  $info.Verb = 'printto'
  $info.Arguments = '"' + $Printer + '"'
  $info.UseShellExecute = $true
  $info.WindowStyle = 'Hidden'
  [void][System.Diagnostics.Process]::Start($info)
  Start-Sleep -Seconds 2
}

function Invoke-PrintFile([string]$Path, [int]$Copies, [string]$Printer, [bool]$Dry, [string]$ToFile = '') {
  # A file on the A4 printer, as many copies as asked.
  $name = [System.IO.Path]::GetFileName($Path)
  $kind = Get-PrintKind $Path
  for ($n = 1; $n -le [Math]::Max(1, $Copies); $n++) {
    if ($Dry) { Write-AgentLog "  (dry run) would print $Path on '$Printer'"; continue }
    switch ($kind) {
      'pdf' {
        $pdf = $null
        try { $pdf = Open-Pdf $Path } catch { }
        if ($pdf -and $pdf.PageCount -gt 0) {
          Invoke-PrintPictures $Printer $name ([int]$pdf.PageCount) { param($index) Get-PdfPagePicture $pdf $index } $ToFile
        } else {
          # Windows could not read it (a password, say): its PDF app may.
          Invoke-PrintWithApp $Printer $Path
        }
      }
      'picture' { Invoke-PrintPictures $Printer $name 1 { param($index) [System.Drawing.Image]::FromFile($Path) } $ToFile }
      'text' { Invoke-PrintText $Printer $Path $ToFile }
      default { Invoke-PrintWithApp $Printer $Path }
    }
  }
}

function Invoke-PrintSticker([string]$Printer, [string[]]$Lines, [bool]$Dry, [string]$ToFile) {
  if ($Dry) { Write-AgentLog ("  (dry run) would print a sticker on '{0}': {1}" -f $Printer, ($Lines -join ' | ')); return }
  $doc = New-PrintJob $Printer 'NBLAB sticker' $ToFile
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

if ($Library) { return }

# ---- Start ------------------------------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
$script:DryRunMode = [bool]$DryRun -or $env:NBLAB_DRY_RUN -eq '1'
$script:Config = Get-AgentConfig
$script:Settings = Get-AgentSettings $script:Config
$AutomationPage = if ($SiteUrl -match '^https?://') { $SiteUrl.TrimEnd('/') + '/#/automation' } else { '' }
$SettingsPage = if ($SiteUrl -match '^https?://') { $SiteUrl.TrimEnd('/') + '/#/settings' } else { '' }

if ($Test) {
  if (-not $script:Config.automation) { Write-Host 'Not set up yet: open the NBLAB website on this PC.' -ForegroundColor Yellow; exit 1 }
  $path = (Resolve-Path -LiteralPath $Test).Path
  $plan = Get-ReturnPlan $path ([System.IO.Path]::GetFileName($path)) $script:Config.automation $script:Settings
  Write-Host "NBLAB automation agent $AgentVersion - test of $($plan.name)" -ForegroundColor Cyan
  Write-Host "Automation of $($script:Config.siteName); A4 printer: $($script:Settings.a4Printer); sticker printer: $($script:Settings.stickerPrinter)"
  Write-Host "`n--- Text read from the file (first 1500 characters) ---"
  $preview = $plan.text
  if ($preview.Length -gt 1500) { $preview = $preview.Substring(0, 1500) + ' ...' }
  Write-Host $preview
  Write-Host ''
  if (-not $plan.isGrabAndGo) { Write-Host 'Not a Grab & Go file: it would be left alone.' -ForegroundColor Yellow; exit 0 }
  Write-Host "Return type: $($plan.type)" -ForegroundColor Green
  foreach ($key in ($plan.values.Keys | Sort-Object)) { Write-Host ("  {{{0}}} = {1}" -f $key, $plan.values[$key]) }
  if ($plan.receipt) { Write-Host "Would print the receipt (the file) x$($plan.receipt.copies)" }
  foreach ($doc in $plan.documents) { Write-Host "Would print $($doc.path) x$($doc.copies) ($(if ($doc.found) { 'found' } else { 'NOT FOUND' }))" }
  if ($plan.sticker) { Write-Host 'Would print the sticker:'; $plan.stickerLines | ForEach-Object { Write-Host "  | $_" } }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($Setup -and $SettingsPage) { Start-Process $SettingsPage }

# One agent per Windows user. Starting another - a newer download, or the
# same one again - quietly takes over from the one that is running.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$created)
if (-not $created) {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*NBLAB_SELF*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  try { [void]$mutex.WaitOne(10000) } catch [System.Threading.AbandonedMutexException] { }
}

# Always start with Windows, from the copy kept with the settings.
try { Set-StartAtSignIn $true } catch { Write-AgentLog "Could not set start at sign-in: $($_.Exception.Message)" }
Clear-OldUploads

$script:Tray = New-Object System.Windows.Forms.NotifyIcon
$script:Tray.Icon = [System.Drawing.SystemIcons]::Information
$script:Tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:Stop = $false
$script:CheckForUpdate = $false
$script:Restart = $false
if ($AutomationPage) { [void]$menu.Items.Add('Print (Automation page)', $null, { Start-Process $AutomationPage }) }
if ($SettingsPage) { [void]$menu.Items.Add('Printers (Settings)', $null, { Start-Process $SettingsPage }) }
[void]$menu.Items.Add('Open the log', $null, { Start-Process notepad.exe $LogPath })
[void]$menu.Items.Add('Open the files to print', $null, { Start-Process explorer.exe $script:Settings.filesFolder })
[void]$menu.Items.Add('Check for updates', $null, { $script:CheckForUpdate = $true })
[void]$menu.Items.Add('Stop', $null, { $script:Stop = $true })
$script:Tray.ContextMenuStrip = $menu

$script:Watcher = $null
function Stop-Watching {
  Unregister-Event -SourceIdentifier 'nblab.created' -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier 'nblab.renamed' -ErrorAction SilentlyContinue
  Get-Event | Remove-Event
  if ($script:Watcher) { $script:Watcher.Dispose(); $script:Watcher = $null }
}

function Start-Watching($Settings) {
  Stop-Watching
  Resolve-AgentFolder $Settings 'watchFolder'
  Resolve-AgentFolder $Settings 'filesFolder'
  $script:Watcher = New-Object System.IO.FileSystemWatcher $Settings.watchFolder
  $script:Watcher.IncludeSubdirectories = $false
  $script:Watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
  Register-ObjectEvent $script:Watcher Created -SourceIdentifier 'nblab.created' | Out-Null
  Register-ObjectEvent $script:Watcher Renamed -SourceIdentifier 'nblab.renamed' | Out-Null
  $script:Watcher.EnableRaisingEvents = $true
  $tip = "NBLAB automation $AgentVersion - " + (Split-Path -Leaf $Settings.watchFolder)
  $script:Tray.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 63) } else { $tip }
  $mode = if ($Settings.dryRun) { ' TEST RUN - nothing is printed.' } elseif ($Settings.autoPrint) { '' } else { ' Waits for the website to print.' }
  Write-AgentLog "Agent $AgentVersion listening to $($Settings.watchFolder); forms in $($Settings.filesFolder); A4 printer: $($Settings.a4Printer); sticker printer: $($Settings.stickerPrinter).$mode"
}

function Use-AgentSettings {
  # Apply what the website set; listen again only if the folder changed.
  $next = Get-AgentSettings $script:Config
  $before = $script:Settings
  if (-not $before -or -not $before.wanted.ContainsKey('watchFolder') -or $before.wanted.watchFolder -ne $next.watchFolder) {
    $script:Settings = $next
    Start-Watching $next
    return
  }
  $next.watchFolder = $before.watchFolder
  $next.wanted.watchFolder = $before.wanted.watchFolder
  if ($before.wanted.filesFolder -ne $next.filesFolder) { Resolve-AgentFolder $next 'filesFolder' }
  else { $next.filesFolder = $before.filesFolder; $next.wanted.filesFolder = $before.wanted.filesFolder }
  $script:Settings = $next
}

function Update-Agent([bool]$Manual) {
  # True when a newer agent was saved and this one should hand over to it.
  try {
    $update = Get-AgentUpdate
    if (-not $update) {
      if ($Manual) { Show-Notice 'NBLAB automation' "This is the newest version ($AgentVersion)." }
      return $false
    }
    Save-AgentUpdate $update $StableCopy
    Write-AgentLog "Updating from $AgentVersion to $($update.version)"
    return $true
  } catch {
    Write-AgentLog "Could not check for updates: $($_.Exception.Message)"
    if ($Manual) { Show-Notice 'NBLAB automation' "Could not check for updates: $($_.Exception.Message)" 'Warning' }
    return $false
  }
}

$script:Settings = $null
Use-AgentSettings

$script:Server = $null
try { $script:Server = Start-LocalServer $AgentPort }
catch {
  Write-AgentLog "PROBLEM: cannot listen for the website on port ${AgentPort}: $($_.Exception.Message)"
  Show-Notice 'NBLAB automation' "The website cannot reach this agent: port $AgentPort is taken. Restart the PC." 'Warning'
}

if ($env:NBLAB_UPDATED_FROM) {
  Write-AgentLog "Updated from $($env:NBLAB_UPDATED_FROM) to $AgentVersion"
  Show-Notice 'NBLAB automation' "Updated to version $AgentVersion."
  Remove-Item Env:NBLAB_UPDATED_FROM
} elseif (-not $script:Config.automation -or -not $script:Config.a4Printer -or -not $script:Config.stickerPrinter) {
  Show-Notice 'NBLAB automation' 'Running. Choose this PC''s printers in the NBLAB website: Settings, Printing on this PC.'
  # The very first time, open that page.
  if ($script:Config.isNew -and $SettingsPage -and -not $Setup) { Start-Process $SettingsPage }
} else {
  Show-Notice 'NBLAB automation' "Listening to $(Split-Path -Leaf $script:Settings.watchFolder)."
}

$recent = @{}
# Updates are looked for soon after starting, then twice a day.
$nextUpdateCheck = (Get-Date).AddMinutes(2)
try {
  while (-not $script:Stop) {
    [System.Windows.Forms.Application]::DoEvents()
    if (Step-LocalServer $script:Server) { continue }
    if ($script:CheckForUpdate -or (Get-Date) -ge $nextUpdateCheck) {
      $manual = $script:CheckForUpdate
      $script:CheckForUpdate = $false
      $nextUpdateCheck = (Get-Date).AddHours(12)
      if (Update-Agent $manual) { $script:Restart = $true; break }
    }
    $change = Get-Event | Select-Object -First 1
    if (-not $change) { Start-Sleep -Milliseconds 100; continue }
    $path = $change.SourceEventArgs.FullPath
    Remove-Event -EventIdentifier $change.EventIdentifier
    $name = [System.IO.Path]::GetFileName($path)
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($TempExtensions -contains $ext -or $name.StartsWith('~$') -or $name.StartsWith('.')) { continue }
    # A download fires several events; handle each file once a minute at most.
    if ($recent.ContainsKey($path) -and ((Get-Date) - $recent[$path]).TotalSeconds -lt 60) { continue }
    $recent[$path] = Get-Date
    if (-not (Wait-FileReady $path)) { continue }
    try {
      Invoke-Arrival $path
    } catch {
      Write-AgentLog "PROBLEM with ${name}: $($_.Exception.Message)"
      Show-Notice 'NBLAB automation' "Could not handle ${name}: $($_.Exception.Message)" 'Error'
    }
  }
} finally {
  Stop-Watching
  if ($script:Server) { try { $script:Server.Stop() } catch { } }
  $script:Tray.Visible = $false
  $script:Tray.Dispose()
  $mutex.ReleaseMutex()
  if ($script:Restart) {
    # Hand over to the new version, kept where "start with Windows" runs it from.
    try {
      [void](Start-AgentCopy $StableCopy @{ NBLAB_UPDATED_FROM = $AgentVersion })
      Write-AgentLog 'Restarting with the new version'
    } catch { Write-AgentLog "PROBLEM: could not start the new version: $($_.Exception.Message)" }
  } else {
    Write-AgentLog 'Agent stopped'
  }
}

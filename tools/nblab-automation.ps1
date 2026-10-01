<#
.SYNOPSIS
  NBLAB dispatch automation agent - runs on each lab PC.

.DESCRIPTION
  Listens to one folder on this PC. When a file finishes arriving there, it
  reads the text inside the file, finds the first automation whose words are
  ALL in it, and prints what that automation says: the file itself and files
  from the print-files folder (the LDO form etc.) on this PC's A4 printer, and
  a sticker with details read from the file on its sticker printer. Each PC
  chooses its two printers from the printers installed in Windows.

  The automations are written on the NBLAB website (Automation page). The agent
  signs in once with a work ID and reads them from there by itself, so a change
  on the website reaches every PC. So do the site's Lab PC settings - the folder
  to listen to, the folder with the files to print, and test mode - unless this
  PC sets its own folders. Nothing is sent anywhere else.

  It is published as nblab-automation.cmd: double-click it. The first time, a
  window asks for a work ID and the two printers (and, optionally, this PC's
  own folders). Settings, the sign-in and the log are kept in
  %LOCALAPPDATA%\NBLAB\automation. The work ID itself is never stored; the
  sign-in is kept encrypted for this Windows user only.

  It updates itself: when the website has a newer nblab-automation.cmd, it
  downloads it, checks it, and restarts with it.

.EXAMPLE
  nblab-automation.cmd
  Start. The setup window opens the first time; after that it runs in the tray.

.EXAMPLE
  nblab-automation.cmd -Setup
  Change the settings.

.EXAMPLE
  nblab-automation.cmd -Test "C:\Users\me\Downloads\return.pdf"
  Show what the agent reads from a file, which automation matches and what it
  would print - without printing anything.
#>
param(
  [string]$Test,
  [switch]$Setup,
  [switch]$DryRun,
  # The .cmd this runs from, passed by the .cmd - for "start when I sign in".
  [string]$Self,
  # Load the functions only; used by nblab-automation.test.ps1.
  [switch]$Library
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
# Google's servers need TLS 1.2, which Windows PowerShell 5.1 does not use by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Raise it with every change: the PCs update themselves to a newer version.
$AgentVersion = '2.2.0'
# Filled in when the website is built (vite.config.js) with the same public
# Firebase settings the website uses, and where the website publishes this file.
$FirebaseApiKey = '__NBLAB_FIREBASE_API_KEY__'
$FirebaseProject = '__NBLAB_FIREBASE_PROJECT_ID__'
$UpdateUrl = '__NBLAB_UPDATE_URL__'
$EmailDomain = 'nblab.local'

# NBLAB_DATA_FOLDER: a separate agent for testing, with its own settings.
$DataFolder = if ($env:NBLAB_DATA_FOLDER) { $env:NBLAB_DATA_FOLDER } else { Join-Path $env:LOCALAPPDATA 'NBLAB\automation' }
$MutexName = if ($env:NBLAB_DATA_FOLDER) { 'NBLAB-dispatch-automation-' + [Math]::Abs($env:NBLAB_DATA_FOLDER.ToLowerInvariant().GetHashCode()) } else { 'NBLAB-dispatch-automation' }
$ConfigPath = Join-Path $DataFolder 'settings.json'
$LogPath = Join-Path $DataFolder 'automation.log'
$CachePath = Join-Path $DataFolder 'automations-cache.json'
$StableCopy = Join-Path $DataFolder 'nblab-automation.cmd'
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

function Get-Prop($Object, [string]$Name) {
  # A property that may be missing - strict mode would throw on it.
  if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
  return $null
}

function ConvertTo-Automation($Object, [string]$Id) {
  # Every field present, whatever the source - the rules below rely on it.
  $docs = @(foreach ($doc in @(Get-Prop $Object 'documents')) {
    $file = Get-Prop $doc 'file'
    if ($file) { [pscustomobject]@{ file = [string]$file; copies = [Math]::Min(5, [Math]::Max(1, [int](Get-Prop $doc 'copies'))) } }
  })
  $fields = @(foreach ($field in @(Get-Prop $Object 'stickerFields')) {
    $name = Get-Prop $field 'name'
    if ($name) { [pscustomobject]@{ name = [string]$name; label = [string](Get-Prop $field 'label') } }
  })
  return [pscustomobject]@{
    id = $Id
    name = [string](Get-Prop $Object 'name')
    enabled = ((Get-Prop $Object 'enabled') -ne $false)
    keywords = @(@(Get-Prop $Object 'keywords') | Where-Object { $_ } | ForEach-Object { [string]$_ })
    fileTypes = @(@(Get-Prop $Object 'fileTypes') | Where-Object { $_ } | ForEach-Object { ([string]$_).ToLowerInvariant() })
    printFile = [bool](Get-Prop $Object 'printFile')
    fileCopies = [Math]::Min(5, [Math]::Max(1, [int](Get-Prop $Object 'fileCopies')))
    documents = $docs
    sticker = [bool](Get-Prop $Object 'sticker')
    stickerLines = @(@(Get-Prop $Object 'stickerLines') | ForEach-Object { [string]$_ })
    stickerFields = $fields
  }
}

# ---- Signing in: the same work-ID sign-in as the website -------------------------------

function Test-WorkId([string]$WorkId) {
  # src/services/credentials.js validateWwid
  $id = $WorkId.Trim().ToUpperInvariant()
  if (-not $id) { return 'Enter your work ID.' }
  if ($id.Length -lt 3) { return 'The work ID must be at least 3 characters.' }
  if ($id -notmatch '^[A-Z0-9._-]+$') { return 'Use only letters, numbers, dots, dashes or underscores.' }
  return $null
}

function Get-WorkIdCredentials([string]$WorkId) {
  # src/services/credentials.js: email from the work ID, password = SHA-256 of
  # the namespaced work ID, hex, first 32 characters.
  $id = $WorkId.Trim().ToUpperInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("nblab-dispatch-credential:$id")) } finally { $sha.Dispose() }
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  return @{ email = "$($id.ToLowerInvariant())@$EmailDomain"; password = $hex.Substring(0, 32) }
}

function Get-FirebaseErrorMessage([string]$Body) {
  $code = ''
  $status = ''
  try { $err = (ConvertFrom-Json $Body).error; $code = [string]$err.message; $status = [string](Get-Prop $err 'status') } catch { }
  if ($status -eq 'NOT_FOUND') { return 'Not found.' }
  if ($code -match 'INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL') { return 'That work ID was not recognised.' }
  if ($code -match 'USER_DISABLED') { return 'This account is disabled.' }
  if ($code -match 'TOO_MANY_ATTEMPTS') { return 'Too many attempts. Wait a moment and try again.' }
  if ($code -match 'TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND') { return 'The sign-in on this PC has expired. Open the settings and enter the work ID again.' }
  if ($code -match 'API key not valid') { return 'This copy of the agent is not set up for the NBLAB website. Download it again from the website.' }
  if ($code) { return "The server said: $code" }
  return 'No connection to the server.'
}

function Invoke-Firebase([string]$Method, [string]$Uri, $Body, [string]$ContentType = 'application/json', $Headers = @{}) {
  try {
    if ($null -eq $Body) { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType $ContentType -Body $Body
  } catch {
    # The server's explanation: in ErrorDetails on newer PowerShell, in the
    # response itself on Windows PowerShell 5.1.
    $details = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $details = $_.ErrorDetails.Message }
    elseif ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $details = $reader.ReadToEnd()
        $reader.Dispose()
      } catch { }
    }
    throw (Get-FirebaseErrorMessage $details)
  }
}

function Invoke-FirebaseSignIn([string]$WorkId) {
  $credentials = Get-WorkIdCredentials $WorkId
  $body = @{ email = $credentials.email; password = $credentials.password; returnSecureToken = $true } | ConvertTo-Json
  $r = Invoke-Firebase 'Post' "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FirebaseApiKey" $body
  $script:Session = @{ uid = $r.localId; idToken = $r.idToken; expires = (Get-Date).AddSeconds([int]$r.expiresIn - 60) }
  return @{ uid = [string]$r.localId; email = [string]$r.email; refreshToken = [string]$r.refreshToken }
}

function Protect-Text([string]$Text) {
  # Windows DPAPI: only this Windows user on this PC can read it back.
  return ConvertFrom-SecureString (ConvertTo-SecureString $Text -AsPlainText -Force)
}

function Unprotect-Text([string]$Blob) {
  $secure = ConvertTo-SecureString $Blob
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$script:Session = $null
function Get-IdToken($Config) {
  if ($script:Session -and (Get-Date) -lt $script:Session.expires) { return $script:Session.idToken }
  $refresh = Unprotect-Text $Config.refreshToken
  $r = Invoke-Firebase 'Post' "https://securetoken.googleapis.com/v1/token?key=$FirebaseApiKey" ("grant_type=refresh_token&refresh_token=" + [uri]::EscapeDataString($refresh)) 'application/x-www-form-urlencoded'
  $script:Session = @{ uid = [string]$r.user_id; idToken = [string]$r.id_token; expires = (Get-Date).AddSeconds([int]$r.expires_in - 60) }
  return $script:Session.idToken
}

# ---- Reading the automations from the website ------------------------------------------

function ConvertFrom-FirestoreValue($Value) {
  if ($null -eq $Value) { return $null }
  $p = @($Value.PSObject.Properties)[0]
  if (-not $p) { return $null }
  switch ($p.Name) {
    'stringValue' { return [string]$p.Value }
    'booleanValue' { return [bool]$p.Value }
    'integerValue' { return [long]$p.Value }
    'doubleValue' { return [double]$p.Value }
    'timestampValue' { return ([DateTimeOffset]::Parse([string]$p.Value, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime }
    'arrayValue' { return ,@(foreach ($v in @(Get-Prop $p.Value 'values')) { if ($null -ne $v) { ConvertFrom-FirestoreValue $v } }) }
    'mapValue' { return ConvertFrom-FirestoreFields (Get-Prop $p.Value 'fields') }
    default { return $null }
  }
}

function ConvertFrom-FirestoreFields($Fields) {
  $out = [ordered]@{}
  if ($null -ne $Fields) { foreach ($f in $Fields.PSObject.Properties) { $out[$f.Name] = ConvertFrom-FirestoreValue $f.Value } }
  return [pscustomobject]$out
}

function Get-CurrentSite($Me, [datetime]$Now) {
  # src/services/roles.js currentSiteOf: a temporary move counts until it ends.
  $temp = Get-Prop $Me 'tempSiteId'
  $ends = Get-Prop $Me 'tempEndsAt'
  if ($temp -and $ends -and $Now.ToUniversalTime() -lt ([datetime]$ends).ToUniversalTime()) { return [string]$temp }
  return [string](Get-Prop $Me 'siteId')
}

function Get-WebsiteAutomations($Config) {
  $token = Get-IdToken $Config
  $headers = @{ Authorization = "Bearer $token" }
  $base = "https://firestore.googleapis.com/v1/projects/$FirebaseProject/databases/(default)/documents"
  $me = ConvertFrom-FirestoreFields (Get-Prop (Invoke-Firebase 'Get' "$base/users/$($script:Session.uid)" $null 'application/json' $headers) 'fields')
  $site = Get-CurrentSite $me (Get-Date)
  if (-not $site) { throw 'This account has no site yet. Ask an administrator.' }
  $list = Invoke-Firebase 'Get' "$base/sites/$site/features/dispatch-automation/automations?pageSize=100" $null 'application/json' $headers
  $automations = @(foreach ($doc in @(Get-Prop $list 'documents')) {
    if ($doc) { ConvertTo-Automation (ConvertFrom-FirestoreFields (Get-Prop $doc 'fields')) (([string]$doc.name) -split '/')[-1] }
  }) | Sort-Object name
  # The site's Lab PC settings; not there until an admin sets them.
  $settings = $null
  try {
    $settings = ConvertTo-SiteSettings (ConvertFrom-FirestoreFields (Get-Prop (Invoke-Firebase 'Get' "$base/sites/$site/features/dispatch-automation/settings/agent" $null 'application/json' $headers) 'fields'))
  } catch {
    if ($_.Exception.Message -ne 'Not found.') { throw }
  }
  return @{ site = $site; person = [string](Get-Prop $me 'name'); automations = @($automations); settings = $settings }
}

function ConvertTo-SiteSettings($Object) {
  # The website's Lab PC settings (src/services/automation.js cleanAgentSettings).
  if ($null -eq $Object) { return $null }
  return @{
    watchFolder = [string](Get-Prop $Object 'watchFolder')
    filesFolder = [string](Get-Prop $Object 'filesFolder')
    dryRun = ((Get-Prop $Object 'dryRun') -eq $true)
  }
}

function ConvertFrom-SavedAutomations($Data, [string]$From) {
  return @{
    site = [string](Get-Prop $Data 'site')
    person = [string](Get-Prop $Data 'person')
    from = $From
    automations = @(foreach ($a in @(Get-Prop $Data 'automations')) { if ($a) { ConvertTo-Automation $a ([string](Get-Prop $a 'id')) } })
    settings = ConvertTo-SiteSettings (Get-Prop $Data 'settings')
  }
}

$script:LastWebsiteProblem = ''
function Get-Automations($Config) {
  # The website first; if it cannot be reached, the copy from the last time it could.
  if ($env:NBLAB_AUTOMATIONS_FILE) {
    # For testing without signing in.
    $loaded = ConvertFrom-SavedAutomations ([System.IO.File]::ReadAllText($env:NBLAB_AUTOMATIONS_FILE) | ConvertFrom-Json) 'file'
    if (-not $loaded.site) { $loaded.site = 'test' }
    return $loaded
  }
  try {
    $fresh = Get-WebsiteAutomations $Config
    $fresh.from = 'website'
    $script:LastWebsiteProblem = ''
    @{ site = $fresh.site; person = $fresh.person; automations = $fresh.automations; settings = $fresh.settings } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $CachePath -Encoding UTF8
    return $fresh
  } catch {
    $problem = $_.Exception.Message
    if (Test-Path -LiteralPath $CachePath) {
      if ($problem -ne $script:LastWebsiteProblem) { Write-AgentLog "Using the saved automations ($problem)" }
      $script:LastWebsiteProblem = $problem
      return ConvertFrom-SavedAutomations ([System.IO.File]::ReadAllText($CachePath) | ConvertFrom-Json) 'saved copy'
    }
    throw $problem
  }
}

# ---- What this PC follows: its own settings, else the site's, else the defaults ----

function Get-DefaultFolders {
  return @{
    watchFolder = (Join-Path $env:USERPROFILE 'Downloads')
    filesFolder = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NBLAB print files')
  }
}

function Get-EffectiveSettings($Config, $Site) {
  # Folders: a value set on this PC wins; then the site's (from the website);
  # then the default. %USERPROFILE% and the like become this user's folders.
  # The two printers are always this PC's own. Test mode is on if either this
  # PC or the site turns it on.
  $defaults = Get-DefaultFolders
  $out = @{ from = @{} }
  foreach ($key in @('watchFolder', 'filesFolder')) {
    $own = if ($Config -and $Config.ContainsKey($key)) { ([string]$Config[$key]).Trim() } else { '' }
    $siteValue = if ($Site -and $Site.ContainsKey($key)) { ([string]$Site[$key]).Trim() } else { '' }
    if ($own) { $out[$key] = $own; $out.from[$key] = 'this PC' }
    elseif ($siteValue) { $out[$key] = $siteValue; $out.from[$key] = 'the site' }
    else { $out[$key] = $defaults[$key]; $out.from[$key] = 'default' }
    $out[$key] = [Environment]::ExpandEnvironmentVariables($out[$key])
  }
  foreach ($key in @('a4Printer', 'stickerPrinter')) {
    $out[$key] = if ($Config -and $Config.ContainsKey($key)) { ([string]$Config[$key]).Trim() } else { '' }
    $out.from[$key] = 'this PC'
  }
  $out.dryRun = ($Config -and [bool]$Config.dryRun) -or ($Site -and [bool]$Site.dryRun)
  $out.from.dryRun = if ($Config -and [bool]$Config.dryRun) { 'this PC' } elseif ($Site -and [bool]$Site.dryRun) { 'the site' } else { 'default' }
  return $out
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

function Format-EffectiveSettings($Settings) {
  $a4 = if ($Settings.a4Printer) { $Settings.a4Printer } else { '(not chosen)' }
  $sticker = if ($Settings.stickerPrinter) { $Settings.stickerPrinter } else { '(not chosen)' }
  $test = if ($Settings.dryRun) { 'ON - nothing is printed' } else { 'off' }
  return @(
    "Folder to listen to: $($Settings.watchFolder) ($($Settings.from.watchFolder))"
    "Files to print are in: $($Settings.filesFolder) ($($Settings.from.filesFolder))"
    "A4 printer: $a4"
    "Sticker printer: $sticker"
    "Test mode: $test ($($Settings.from.dryRun))"
  )
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
  if (-not [regex]::IsMatch($Text, '(?m)^\$FirebaseApiKey = ''(?!__)[A-Za-z0-9_\-]{10,}''')) { return 'not built for the website' }
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count) { return 'damaged' }
  return ''
}

function Get-AgentUpdate {
  # The agent on the website, when it is newer than this one; otherwise $null.
  $url = if ($env:NBLAB_UPDATE_URL) { $env:NBLAB_UPDATE_URL } else { $UpdateUrl }
  if (-not $url -or $url.StartsWith('__')) { return $null }
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

# ---- Settings, log, notices --------------------------------------------------------------

function Get-AgentConfig {
  # This PC's own settings. An empty folder or printer means: as the site sets
  # it on the website.
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
  $saved = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $config = @{
    watchFolder = ''
    filesFolder = ''
    a4Printer = ''
    stickerPrinter = ''
    dryRun = $false
    startAtSignIn = $true
    email = ''
    refreshToken = ''
  }
  foreach ($key in @($config.Keys)) {
    $value = Get-Prop $saved $key
    if ($null -ne $value -and "$value" -ne '') { $config[$key] = $value }
  }
  # Before 2.2 every PC saved the default folders; those now follow the site.
  $defaults = Get-DefaultFolders
  foreach ($key in @('watchFolder', 'filesFolder')) {
    if ([string]$config[$key] -eq $defaults[$key]) { $config[$key] = '' }
  }
  return $config
}

function Save-AgentConfig($Config) {
  New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
  $Config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

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
  $link = if ($Link) { $Link } else { Join-Path ([Environment]::GetFolderPath('Startup')) 'NBLAB automation.lnk' }
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

# ---- The setup window ----------------------------------------------------------------------

function Get-SiteHint($Site, [string]$Key) {
  # What an empty box means on this PC, for the setup window.
  $value = if ($Site) { [string]$Site[$Key] } else { '' }
  if ($value) { return "Empty: the site's - " + [Environment]::ExpandEnvironmentVariables($value) }
  $defaults = Get-DefaultFolders
  return "Empty: the site's setting from the website, else " + $defaults[$Key]
}

function New-SetupForm($Config, $Site = $null) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $font = New-Object System.Drawing.Font('Segoe UI', 9.5)
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'NBLAB dispatch automation'
  $form.Font = $font
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = 'CenterScreen'
  $form.ClientSize = New-Object System.Drawing.Size(560, 504)
  $form.TopMost = $true

  $y = 16
  $add = {
    param($Control, [int]$X, [int]$Width, [int]$Height = 24)
    $Control.Location = New-Object System.Drawing.Point($X, $script:SetupY)
    $Control.Size = New-Object System.Drawing.Size($Width, $Height)
    $form.Controls.Add($Control)
    $Control
  }
  $script:SetupY = $y
  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'When a file arrives in the folder to listen to, this PC prints what its automation on the NBLAB website says: files on the A4 printer, stickers on the sticker printer. The folders can stay empty to follow the site''s Lab PC settings on the website.'
  [void](& $add $title 16 528 52)
  $script:SetupY += 16

  $controls = @{}
  $row = {
    param([string]$Caption, $Control, [int]$Width = 380)
    $script:SetupY += 44
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Caption
    $label.TextAlign = 'MiddleLeft'
    [void](& $add $label 16 128)
    [void](& $add $Control 148 $Width)
  }

  $controls.workId = New-Object System.Windows.Forms.TextBox
  $controls.workId.UseSystemPasswordChar = $true
  & $row 'Work ID' $controls.workId 200
  $controls.signedIn = New-Object System.Windows.Forms.Label
  $controls.signedIn.ForeColor = [System.Drawing.Color]::DimGray
  $controls.signedIn.Text = if ($Config -and $Config.email) { "Signed in as $(($Config.email -split '@')[0].ToUpperInvariant()) - leave empty to keep it" } else { 'Signs in once; the work ID itself is not saved' }
  $controls.signedIn.Location = New-Object System.Drawing.Point(356, $script:SetupY)
  $controls.signedIn.Size = New-Object System.Drawing.Size(196, 32)
  $form.Controls.Add($controls.signedIn)

  $folderRow = {
    param([string]$Caption, [string]$Value, [string]$Key)
    $box = New-Object System.Windows.Forms.TextBox
    $box.Text = $Value
    & $row $Caption $box 300
    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = Get-SiteHint $Site $Key
    $hint.ForeColor = [System.Drawing.Color]::DimGray
    $hint.Font = New-Object System.Drawing.Font('Segoe UI', 8)
    $hint.AutoEllipsis = $true
    $hint.Location = New-Object System.Drawing.Point(148, ($script:SetupY + 25))
    $hint.Size = New-Object System.Drawing.Size(396, 16)
    $form.Controls.Add($hint)
    $controls[$Key + 'Hint'] = $hint
    $browse = New-Object System.Windows.Forms.Button
    $browse.Text = 'Browse...'
    $browse.Location = New-Object System.Drawing.Point(456, ($script:SetupY - 1))
    $browse.Size = New-Object System.Drawing.Size(88, 26)
    $browse.Tag = $box
    $browse.Add_Click({
      param($button)
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      if ($button.Tag.Text) { $dialog.SelectedPath = [Environment]::ExpandEnvironmentVariables($button.Tag.Text) }
      if ($dialog.ShowDialog() -eq 'OK') { $button.Tag.Text = $dialog.SelectedPath }
    })
    $form.Controls.Add($browse)
    $controls[$Key] = $box
  }
  # The two printers, from the printers installed in Windows.
  $installed = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
  $printerBox = {
    param([string]$Current)
    $box = New-Object System.Windows.Forms.ComboBox
    $box.DropDownStyle = 'DropDownList'
    [void]$box.Items.Add('(choose a printer)')
    foreach ($printer in $installed) { [void]$box.Items.Add($printer) }
    if ($Current) { $box.SelectedItem = $Current }
    if ($box.SelectedIndex -lt 0) { $box.SelectedIndex = 0 }
    $box
  }
  $a4 = if ($Config -and $Config.a4Printer) { [string]$Config.a4Printer } else { '' }
  $sticker = if ($Config -and $Config.stickerPrinter) { [string]$Config.stickerPrinter } else { '' }
  # Not chosen yet: suggest the Windows default printer for A4.
  if (-not $a4) { $windowsDefault = Get-DefaultPrinter; if ($windowsDefault -ne $sticker) { $a4 = $windowsDefault } }
  $controls.a4Printer = & $printerBox $a4
  & $row 'A4 printer' $controls.a4Printer 300
  $controls.stickerPrinter = & $printerBox $sticker
  & $row 'Sticker printer' $controls.stickerPrinter 300

  $watch = if ($Config) { [string]$Config.watchFolder } else { '' }
  $files = if ($Config) { [string]$Config.filesFolder } else { '' }
  & $folderRow 'Folder to listen to' $watch 'watchFolder'
  $script:SetupY += 12
  & $folderRow 'Files to print are in' $files 'filesFolder'
  $script:SetupY += 12

  $script:SetupY += 44
  $controls.startAtSignIn = New-Object System.Windows.Forms.CheckBox
  $controls.startAtSignIn.Text = 'Start when I sign in to Windows'
  $controls.startAtSignIn.Checked = if ($Config) { [bool]$Config.startAtSignIn } else { $true }
  [void](& $add $controls.startAtSignIn 148 300)

  $script:SetupY += 36
  $controls.problem = New-Object System.Windows.Forms.Label
  $controls.problem.ForeColor = [System.Drawing.Color]::Firebrick
  [void](& $add $controls.problem 16 528 40)

  $controls.save = New-Object System.Windows.Forms.Button
  $controls.save.Text = 'Save and start'
  $controls.save.Location = New-Object System.Drawing.Point(316, 456)
  $controls.save.Size = New-Object System.Drawing.Size(128, 32)
  $form.Controls.Add($controls.save)
  $form.AcceptButton = $controls.save
  $controls.cancel = New-Object System.Windows.Forms.Button
  $controls.cancel.Text = 'Cancel'
  $controls.cancel.DialogResult = 'Cancel'
  $controls.cancel.Location = New-Object System.Drawing.Point(452, 456)
  $controls.cancel.Size = New-Object System.Drawing.Size(92, 32)
  $form.Controls.Add($controls.cancel)
  $form.CancelButton = $controls.cancel
  return @{ form = $form; controls = $controls }
}

function Show-SetupWindow($Config, $Site = $null) {
  # Returns the new settings, or $null when cancelled.
  $window = New-SetupForm $Config $Site
  $c = $window.controls
  $script:SetupResult = $null
  $c.save.Add_Click({
    $c.problem.Text = ''
    if ($c.a4Printer.SelectedIndex -le 0) { $c.problem.Text = 'Choose the A4 printer.'; return }
    if ($c.stickerPrinter.SelectedIndex -le 0) { $c.problem.Text = 'Choose the sticker printer.'; return }
    $watch = $c.watchFolder.Text.Trim()
    $files = $c.filesFolder.Text.Trim()
    if ($watch -and -not (Test-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables($watch)) -PathType Container)) { $c.problem.Text = 'The folder to listen to does not exist.'; return }
    if ($files -and -not (Test-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables($files)))) {
      try { New-Item -ItemType Directory -Force -Path ([Environment]::ExpandEnvironmentVariables($files)) | Out-Null }
      catch { $c.problem.Text = 'The folder with the files to print could not be made.'; return }
    }
    $result = @{
      watchFolder = $watch
      filesFolder = $files
      a4Printer = [string]$c.a4Printer.SelectedItem
      stickerPrinter = [string]$c.stickerPrinter.SelectedItem
      dryRun = if ($Config) { [bool]$Config.dryRun } else { $false }
      startAtSignIn = $c.startAtSignIn.Checked
      email = if ($Config) { $Config.email } else { '' }
      refreshToken = if ($Config) { $Config.refreshToken } else { '' }
    }
    $workId = $c.workId.Text
    if ($workId.Trim() -or -not $result.refreshToken) {
      $problem = Test-WorkId $workId
      if ($problem) { $c.problem.Text = $problem; return }
      try {
        $c.save.Enabled = $false
        $c.problem.Text = 'Signing in...'
        [System.Windows.Forms.Application]::DoEvents()
        $signedIn = Invoke-FirebaseSignIn $workId
        $result.email = $signedIn.email
        $result.refreshToken = Protect-Text $signedIn.refreshToken
      } catch {
        $c.problem.Text = $_.Exception.Message
        $c.save.Enabled = $true
        return
      }
    }
    $script:SetupResult = $result
    $window.form.DialogResult = 'OK'
    $window.form.Close()
  })
  [void]$window.form.ShowDialog()
  $window.form.Dispose()
  if (-not $script:SetupResult) { return $null }
  Save-AgentConfig $script:SetupResult
  try { Set-StartAtSignIn ([bool]$script:SetupResult.startAtSignIn) } catch { Write-AgentLog "Could not set start at sign-in: $($_.Exception.Message)" }
  return (Get-AgentConfig)
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

function Get-Plan([string]$Path, $Config, $Automations) {
  $name = [System.IO.Path]::GetFileName($Path)
  $text = Get-FileText $Path
  $automation = Find-Automation $text $name $Automations
  if (-not $automation) { return @{ file = $name; text = $text; automation = $null } }
  $values = Read-Fields $text $automation.stickerFields
  $builtins = Get-BuiltinValues $name $automation.name (Get-Date)
  foreach ($key in $builtins.Keys) { $values[$key] = $builtins[$key] }
  $documents = @(foreach ($doc in @($automation.documents)) {
    if ($doc -and $doc.file) { @{ path = (Join-Path $Config.filesFolder $doc.file); copies = [int]$doc.copies } }
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

function Invoke-Automation([string]$Path, $Config, $Automations) {
  $plan = Get-Plan $Path $Config $Automations
  if (-not $plan.automation) { Write-AgentLog "No automation for $($plan.file)"; return }
  $dry = [bool]$Config.dryRun
  Write-AgentLog "'$($plan.automation.name)' for $($plan.file)"
  $done = @()
  $problems = @()
  $a4 = [string]$Config.a4Printer
  $a4Missing = 'no A4 printer is chosen on this PC (right-click the NBLAB icon, Settings)'
  if ($plan.printFile) {
    if (-not $a4) { $problems += $a4Missing }
    else { try { Invoke-PrintFile $Path $plan.fileCopies $a4 $dry; $done += 'the file' } catch { $problems += "the file: $($_.Exception.Message)" } }
  }
  foreach ($doc in $plan.documents) {
    $docName = Split-Path -Leaf $doc.path
    if (-not (Test-Path -LiteralPath $doc.path)) { $problems += "$docName is not in $($Config.filesFolder)"; continue }
    if (-not $a4) { if ($problems -notcontains $a4Missing) { $problems += $a4Missing }; continue }
    try { Invoke-PrintFile $doc.path $doc.copies $a4 $dry; $done += $docName } catch { $problems += "${docName}: $($_.Exception.Message)" }
  }
  if ($plan.sticker) {
    if (-not $Config.stickerPrinter) { $problems += 'no sticker printer is chosen on this PC (right-click the NBLAB icon, Settings)' }
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

# ---- Start ------------------------------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
$config = Get-AgentConfig

if ($Test) {
  if (-not $config) { Write-Host 'Not set up yet: double-click nblab-automation.cmd first.' -ForegroundColor Yellow; exit 1 }
  $loaded = Get-Automations $config
  $effective = Get-EffectiveSettings $config $loaded.settings
  $plan = Get-Plan (Resolve-Path -LiteralPath $Test).Path $effective $loaded.automations
  Write-Host "NBLAB automation agent $AgentVersion - test of $($plan.file)" -ForegroundColor Cyan
  Write-Host "$($loaded.automations.Count) automations for site $($loaded.site), from the $($loaded.from)"
  Format-EffectiveSettings $effective | ForEach-Object { Write-Host "  $_" }
  Write-Host "`n--- Text read from the file (first 1500 characters) ---"
  $preview = $plan.text
  if ($preview.Length -gt 1500) { $preview = $preview.Substring(0, 1500) + ' ...' }
  Write-Host $preview
  Write-Host ''
  if (-not $plan.automation) { Write-Host 'No automation matches this file.' -ForegroundColor Yellow; exit 0 }
  Write-Host "Matches: $($plan.automation.name)" -ForegroundColor Green
  foreach ($key in ($plan.values.Keys | Sort-Object)) { Write-Host ("  {{{0}}} = {1}" -f $key, $plan.values[$key]) }
  if ($plan.printFile) { Write-Host "Would print the file x$($plan.fileCopies) on '$($effective.a4Printer)'" }
  foreach ($doc in $plan.documents) {
    $state = if (Test-Path -LiteralPath $doc.path) { 'found' } else { 'NOT FOUND' }
    Write-Host "Would print $($doc.path) x$($doc.copies) on '$($effective.a4Printer)' ($state)"
  }
  if ($plan.sticker) { Write-Host "Would print a sticker on '$($effective.stickerPrinter)':"; $plan.stickerLines | ForEach-Object { Write-Host "  | $_" } }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# One agent per Windows user. Starting another - typically a newer download -
# offers to replace the one that is running.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$created)
if (-not $created) {
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "NBLAB automation is already running.`n`nStop it and start this copy instead? Choose Yes after downloading a new version.",
    'NBLAB automation', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { exit 0 }
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*NBLAB_SELF*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  try { [void]$mutex.WaitOne(10000) } catch [System.Threading.AbandonedMutexException] { }
}

# The setup window first: never set up, asked for, or something missing -
# the sign-in or one of the two printers.
if (-not $config -or $Setup -or -not $config.refreshToken -or -not $config.a4Printer -or -not $config.stickerPrinter) {
  $knownSite = $null
  if ($config -and (Test-Path -LiteralPath $CachePath)) {
    try { $knownSite = (ConvertFrom-SavedAutomations ([System.IO.File]::ReadAllText($CachePath) | ConvertFrom-Json) '').settings } catch { }
  }
  $config = Show-SetupWindow $config $knownSite
  if (-not $config) { exit 0 }
}

# Keep "start with Windows" pointing at this copy, so a newer download takes
# over the next sign-in too, without opening the settings.
if ($config.startAtSignIn) {
  try { Set-StartAtSignIn $true } catch { Write-AgentLog "Could not set start at sign-in: $($_.Exception.Message)" }
}

try { $script:Loaded = Get-Automations $config }
catch {
  [void][System.Windows.Forms.MessageBox]::Show("Could not read the automations from the NBLAB website:`n$($_.Exception.Message)", 'NBLAB automation')
  exit 1
}

$script:Tray = New-Object System.Windows.Forms.NotifyIcon
$script:Tray.Icon = [System.Drawing.SystemIcons]::Information
$script:Tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:Stop = $false
$script:Reconfigure = $false
$script:CheckForUpdate = $false
$script:Restart = $false
[void]$menu.Items.Add('Settings...', $null, { $script:Reconfigure = $true })
[void]$menu.Items.Add('Open the log', $null, { Start-Process notepad.exe $LogPath })
[void]$menu.Items.Add('Open the files to print', $null, { Start-Process explorer.exe $script:Effective.filesFolder })
[void]$menu.Items.Add('Check for updates', $null, { $script:CheckForUpdate = $true })
[void]$menu.Items.Add('Stop', $null, { $script:Stop = $true })
$script:Tray.ContextMenuStrip = $menu

$script:Watcher = $null
$script:Effective = $null
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
  Write-AgentLog ("Agent $AgentVersion listening. " + ((Format-EffectiveSettings $Settings) -join '; '))
}

function Use-Settings([bool]$Restart = $false) {
  # Apply what this PC follows now; listen again if the folder changed.
  $next = Get-EffectiveSettings $config $script:Loaded.settings
  if ($DryRun) { $next.dryRun = $true; $next.from.dryRun = 'this run' }
  $next.wanted = @{}
  $before = $script:Effective
  $script:Effective = $next
  if ($Restart -or -not $before -or $before.wanted.watchFolder -ne $next.watchFolder) { Start-Watching $next; return }
  # Same folder to listen to: keep listening, and keep any fallback folder.
  $next.watchFolder = $before.watchFolder
  $next.wanted.watchFolder = $before.wanted.watchFolder
  if ($before.wanted.filesFolder -ne $next.filesFolder) { Resolve-AgentFolder $next 'filesFolder' }
  else { $next.filesFolder = $before.filesFolder; $next.wanted.filesFolder = $before.wanted.filesFolder }
  $same = $true
  foreach ($key in @('filesFolder', 'a4Printer', 'stickerPrinter', 'dryRun')) { if ($before[$key] -ne $next[$key]) { $same = $false } }
  if (-not $same) { Write-AgentLog ('Settings changed. ' + ((Format-EffectiveSettings $next) -join '; ')) }
}

function Sync-Website {
  # The newest automations and Lab PC settings; on trouble, keep what we have.
  try { $script:Loaded = Get-Automations $config }
  catch { Write-AgentLog "PROBLEM reading the website: $($_.Exception.Message)" }
  Use-Settings
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
function Stop-Watching {
  Unregister-Event -SourceIdentifier 'nblab.created' -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier 'nblab.renamed' -ErrorAction SilentlyContinue
  Get-Event | Remove-Event
  if ($script:Watcher) { $script:Watcher.Dispose(); $script:Watcher = $null }
}

Use-Settings
if ($env:NBLAB_UPDATED_FROM) {
  Write-AgentLog "Updated from $($env:NBLAB_UPDATED_FROM) to $AgentVersion"
  Show-Notice 'NBLAB automation' "Updated to version $AgentVersion - listening to $(Split-Path -Leaf $script:Effective.watchFolder)"
  Remove-Item Env:NBLAB_UPDATED_FROM
} else {
  Show-Notice 'NBLAB automation' ("Listening to $(Split-Path -Leaf $script:Effective.watchFolder) - $($script:Loaded.automations.Count) automations for $($script:Loaded.site)")
}

$recent = @{}
# The website is read again every few minutes for the Lab PC settings (and on
# every file); updates are looked for soon after starting, then twice a day.
$nextSync = (Get-Date).AddMinutes(5)
$nextUpdateCheck = (Get-Date).AddMinutes(2)
try {
  while (-not $script:Stop) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($script:Reconfigure) {
      $script:Reconfigure = $false
      $changed = Show-SetupWindow $config $script:Loaded.settings
      if ($changed) {
        $config = $changed
        $script:Session = $null
        try { $script:Loaded = Get-Automations $config } catch { Write-AgentLog "PROBLEM reading the website: $($_.Exception.Message)" }
        Use-Settings $true
        Show-Notice 'NBLAB automation' "Listening to $(Split-Path -Leaf $script:Effective.watchFolder)"
      }
    }
    if ((Get-Date) -ge $nextSync) {
      $nextSync = (Get-Date).AddMinutes(5)
      Sync-Website
    }
    if ($script:CheckForUpdate -or (Get-Date) -ge $nextUpdateCheck) {
      $manual = $script:CheckForUpdate
      $script:CheckForUpdate = $false
      $nextUpdateCheck = (Get-Date).AddHours(12)
      if (Update-Agent $manual) { $script:Restart = $true; break }
    }
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
    try {
      # The newest automations every time, so a change on the website counts at once.
      $script:Loaded = Get-Automations $config
      Use-Settings
      Invoke-Automation $path $script:Effective $script:Loaded.automations
    } catch {
      Write-AgentLog "PROBLEM with ${name}: $($_.Exception.Message)"
      Show-Notice 'NBLAB automation' "Could not handle ${name}: $($_.Exception.Message)" 'Error'
    }
  }
} finally {
  Stop-Watching
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

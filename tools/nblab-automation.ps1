<#
.SYNOPSIS
  NBLAB dispatch automation agent - runs on each lab PC.

.DESCRIPTION
  Listens to one folder on this PC. When a file finishes arriving there, it
  reads the text inside the file, finds the first automation whose words are
  ALL in it, and prints what that automation says: the file itself, files from
  this PC's print-files folder (the LDO form etc.), and a sticker on the sticker
  printer with details read from the file.

  The automations are written on the NBLAB website (Automation page). The agent
  signs in once with a work ID and reads them from there by itself, so a change
  on the website reaches every PC. Nothing is sent anywhere else.

  It is published as nblab-automation.cmd: double-click it. The first time, a
  window asks for a work ID, the folder to listen to, the folder with the files
  to print, and the sticker printer. Settings, the sign-in and the log are kept
  in %LOCALAPPDATA%\NBLAB\automation. The work ID itself is never stored; the
  sign-in is kept encrypted for this Windows user only.

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

$AgentVersion = '2.0.0'
# Filled in when the website is built (vite.config.js) with the same public
# Firebase settings the website uses.
$FirebaseApiKey = '__NBLAB_FIREBASE_API_KEY__'
$FirebaseProject = '__NBLAB_FIREBASE_PROJECT_ID__'
$EmailDomain = 'nblab.local'

$DataFolder = Join-Path $env:LOCALAPPDATA 'NBLAB\automation'
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
  try { $code = [string]((ConvertFrom-Json $Body).error.message) } catch { }
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
  return @{ site = $site; person = [string](Get-Prop $me 'name'); automations = @($automations) }
}

function Get-Automations($Config) {
  # The website first; if it cannot be reached, the copy from the last time it could.
  if ($env:NBLAB_AUTOMATIONS_FILE) {
    # For testing without signing in.
    $data = [System.IO.File]::ReadAllText($env:NBLAB_AUTOMATIONS_FILE) | ConvertFrom-Json
    return @{ site = 'test'; person = ''; from = 'file'; automations = @(foreach ($a in @($data.automations)) { ConvertTo-Automation $a ([string](Get-Prop $a 'id')) }) }
  }
  try {
    $fresh = Get-WebsiteAutomations $Config
    $fresh.from = 'website'
    @{ site = $fresh.site; person = $fresh.person; automations = $fresh.automations } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $CachePath -Encoding UTF8
    return $fresh
  } catch {
    $problem = $_.Exception.Message
    if (Test-Path -LiteralPath $CachePath) {
      $cached = [System.IO.File]::ReadAllText($CachePath) | ConvertFrom-Json
      Write-AgentLog "Using the saved automations ($problem)"
      return @{ site = [string]$cached.site; person = [string]$cached.person; from = 'saved copy'; automations = @(foreach ($a in @($cached.automations)) { ConvertTo-Automation $a ([string](Get-Prop $a 'id')) }) }
    }
    throw $problem
  }
}

# ---- Settings, log, notices --------------------------------------------------------------

function Get-AgentConfig {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
  $saved = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $config = @{
    watchFolder = (Join-Path $env:USERPROFILE 'Downloads')
    filesFolder = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NBLAB print files')
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

function Set-StartAtSignIn([bool]$On) {
  # A shortcut in the Startup folder to a copy of the .cmd kept with the
  # settings, so moving or deleting the download does not break it.
  $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'NBLAB automation.lnk'
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
  $shortcut.TargetPath = $StableCopy
  $shortcut.WorkingDirectory = $DataFolder
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NBLAB dispatch automation'
  $shortcut.Save()
}

# ---- The setup window ----------------------------------------------------------------------

function New-SetupForm($Config) {
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
  $form.ClientSize = New-Object System.Drawing.Size(560, 420)
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
  $title.Text = 'When a file arrives in the folder below, this PC prints what its automation on the NBLAB website says.'
  [void](& $add $title 16 528 36)

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
    $browse = New-Object System.Windows.Forms.Button
    $browse.Text = 'Browse...'
    $browse.Location = New-Object System.Drawing.Point(456, ($script:SetupY - 1))
    $browse.Size = New-Object System.Drawing.Size(88, 26)
    $browse.Tag = $box
    $browse.Add_Click({
      param($button)
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.SelectedPath = $button.Tag.Text
      if ($dialog.ShowDialog() -eq 'OK') { $button.Tag.Text = $dialog.SelectedPath }
    })
    $form.Controls.Add($browse)
    $controls[$Key] = $box
  }
  $watch = if ($Config) { $Config.watchFolder } else { Join-Path $env:USERPROFILE 'Downloads' }
  $files = if ($Config) { $Config.filesFolder } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NBLAB print files' }
  & $folderRow 'Folder to listen to' $watch 'watchFolder'
  & $folderRow 'Files to print are in' $files 'filesFolder'

  $controls.stickerPrinter = New-Object System.Windows.Forms.ComboBox
  $controls.stickerPrinter.DropDownStyle = 'DropDownList'
  [void]$controls.stickerPrinter.Items.Add('(no sticker printer)')
  foreach ($printer in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { [void]$controls.stickerPrinter.Items.Add($printer) }
  $current = if ($Config -and $Config.stickerPrinter) { $Config.stickerPrinter } else { '(no sticker printer)' }
  $controls.stickerPrinter.SelectedItem = $current
  if ($controls.stickerPrinter.SelectedIndex -lt 0) { $controls.stickerPrinter.SelectedIndex = 0 }
  & $row 'Sticker printer' $controls.stickerPrinter 300

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
  $controls.save.Location = New-Object System.Drawing.Point(316, 372)
  $controls.save.Size = New-Object System.Drawing.Size(128, 32)
  $form.Controls.Add($controls.save)
  $form.AcceptButton = $controls.save
  $controls.cancel = New-Object System.Windows.Forms.Button
  $controls.cancel.Text = 'Cancel'
  $controls.cancel.DialogResult = 'Cancel'
  $controls.cancel.Location = New-Object System.Drawing.Point(452, 372)
  $controls.cancel.Size = New-Object System.Drawing.Size(92, 32)
  $form.Controls.Add($controls.cancel)
  $form.CancelButton = $controls.cancel
  return @{ form = $form; controls = $controls }
}

function Show-SetupWindow($Config) {
  # Returns the new settings, or $null when cancelled.
  $window = New-SetupForm $Config
  $c = $window.controls
  $script:SetupResult = $null
  $c.save.Add_Click({
    $c.problem.Text = ''
    $watch = $c.watchFolder.Text.Trim()
    $files = $c.filesFolder.Text.Trim()
    if (-not (Test-Path -LiteralPath $watch -PathType Container)) { $c.problem.Text = 'The folder to listen to does not exist.'; return }
    if (-not $files) { $c.problem.Text = 'Choose the folder with the files to print.'; return }
    if (-not (Test-Path -LiteralPath $files)) { New-Item -ItemType Directory -Force -Path $files | Out-Null }
    $result = @{
      watchFolder = $watch
      filesFolder = $files
      stickerPrinter = if ($c.stickerPrinter.SelectedIndex -le 0) { '' } else { [string]$c.stickerPrinter.SelectedItem }
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
  if ($plan.printFile) {
    try { Invoke-PrintFile $Path $plan.fileCopies $dry; $done += 'the file' } catch { $problems += "the file: $($_.Exception.Message)" }
  }
  foreach ($doc in $plan.documents) {
    $docName = Split-Path -Leaf $doc.path
    if (-not (Test-Path -LiteralPath $doc.path)) { $problems += "$docName is not in $($Config.filesFolder)"; continue }
    try { Invoke-PrintFile $doc.path $doc.copies $dry; $done += $docName } catch { $problems += "${docName}: $($_.Exception.Message)" }
  }
  if ($plan.sticker) {
    if (-not $Config.stickerPrinter) { $problems += 'no sticker printer is chosen in the settings' }
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
  $plan = Get-Plan (Resolve-Path -LiteralPath $Test).Path $config $loaded.automations
  Write-Host "NBLAB automation agent $AgentVersion - test of $($plan.file)" -ForegroundColor Cyan
  Write-Host "$($loaded.automations.Count) automations for site $($loaded.site), from the $($loaded.from)"
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

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# One agent per Windows user: a second double-click opens the settings instead.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'NBLAB-dispatch-automation', [ref]$created)
if (-not $created) {
  [void][System.Windows.Forms.MessageBox]::Show('NBLAB automation is already running. Right-click its icon next to the clock for the settings.', 'NBLAB automation')
  exit 0
}

if (-not $config -or $Setup -or -not $config.refreshToken) {
  $config = Show-SetupWindow $config
  if (-not $config) { exit 0 }
}
if ($DryRun) { $config.dryRun = $true }

try { $loaded = Get-Automations $config }
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
[void]$menu.Items.Add('Settings...', $null, { $script:Reconfigure = $true })
[void]$menu.Items.Add('Open the log', $null, { Start-Process notepad.exe $LogPath })
[void]$menu.Items.Add('Open the files to print', $null, { Start-Process explorer.exe $config.filesFolder })
[void]$menu.Items.Add('Stop', $null, { $script:Stop = $true })
$script:Tray.ContextMenuStrip = $menu

$script:Watcher = $null
function Start-Watching($Config) {
  Stop-Watching
  $script:Watcher = New-Object System.IO.FileSystemWatcher $Config.watchFolder
  $script:Watcher.IncludeSubdirectories = $false
  $script:Watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
  Register-ObjectEvent $script:Watcher Created -SourceIdentifier 'nblab.created' | Out-Null
  Register-ObjectEvent $script:Watcher Renamed -SourceIdentifier 'nblab.renamed' | Out-Null
  $script:Watcher.EnableRaisingEvents = $true
  $script:Tray.Text = 'NBLAB automation - ' + (Split-Path -Leaf $Config.watchFolder)
  $mode = if ($Config.dryRun) { ' (DRY RUN - nothing is printed)' } else { '' }
  Write-AgentLog "Agent $AgentVersion listening to $($Config.watchFolder); files to print in $($Config.filesFolder)$mode"
}
function Stop-Watching {
  Unregister-Event -SourceIdentifier 'nblab.created' -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier 'nblab.renamed' -ErrorAction SilentlyContinue
  Get-Event | Remove-Event
  if ($script:Watcher) { $script:Watcher.Dispose(); $script:Watcher = $null }
}

Start-Watching $config
Show-Notice 'NBLAB automation' ("Listening to $(Split-Path -Leaf $config.watchFolder) - $($loaded.automations.Count) automations for $($loaded.site)")

$recent = @{}
try {
  while (-not $script:Stop) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($script:Reconfigure) {
      $script:Reconfigure = $false
      $changed = Show-SetupWindow $config
      if ($changed) {
        $config = $changed
        $script:Session = $null
        Start-Watching $config
        Show-Notice 'NBLAB automation' "Listening to $(Split-Path -Leaf $config.watchFolder)"
      }
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
      $loaded = Get-Automations $config
      Invoke-Automation $path $config $loaded.automations
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
  Write-AgentLog 'Agent stopped'
}

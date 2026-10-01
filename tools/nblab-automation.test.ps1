# Tests for nblab-automation.ps1, run with:
#   npm run test:agent
# (Windows PowerShell. The website only cleans and saves the automation;
# reading files, finding the return type and printing are tested here.)

. "$PSScriptRoot\nblab-automation.ps1" -Library

$script:Pass = 0
$script:Fail = 0
function Eq([string]$Label, $Got, $Want) {
  $g = ConvertTo-Json -InputObject $Got -Compress -Depth 5
  $w = ConvertTo-Json -InputObject $Want -Compress -Depth 5
  if ($g -eq $w) { $script:Pass++; Write-Host "  OK   $Label" }
  else { $script:Fail++; Write-Host "  FAIL $Label`n       got  $g`n       want $w" -ForegroundColor Red }
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("nblab-agent-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null

try {
  $text = "GRAB & GO locker 4`nReturn reason: damaged screen`nTicket: RITM0012345`nAsset tag: NB-48213`n"

  Write-Host '--- reading details (same cases as the website) ---'
  Eq 'after a label and a colon' (Read-Field $text 'Asset tag') 'NB-48213'
  Eq 'the label in any case' (Read-Field $text 'ticket') 'RITM0012345'
  Eq 'up to the end of the line' (Read-Field $text 'Return reason') 'damaged screen'
  Eq 'CSV: up to the next comma' (Read-Field 'Asset tag,NB-1,Dana Levi' 'Asset tag') 'NB-1'
  Eq 'tabs: up to the next tab' (Read-Field "Ticket`tRITM9`tOpen" 'Ticket') 'RITM9'
  Eq 'quotes are dropped' (Read-Field 'User: "Dana Levi"' 'User') 'Dana Levi'
  Eq 'a dash or equals sign works too' (Read-Field "Asset - NB-7`nSerial = 123" 'Serial') '123'
  Eq 'a missing label reads nothing' (Read-Field $text 'Serial') ''
  Eq 'long values are cut' (Read-Field ("Note: " + ('x' * 200)) 'Note').Length 80
  Eq 'Windows line endings' (Read-Field "Ticket: RITM1`r`nNext: x" 'Ticket') 'RITM1'

  Write-Host '--- return types (the automation from the website) ---'
  $pushed = '{"keywords":[" Grab & Go "],"fileTypes":[".PDF","txt"],"types":[{"name":"PC refresh","keywords":["refresh"],"receipt":true,"receiptCopies":9,"documents":[],"sticker":true},{"name":"LDO","keywords":["LDO"],"receipt":true,"receiptCopies":1,"documents":[{"file":"LDO.pdf","copies":2},{"file":" "}],"sticker":false},{"name":"No words","keywords":[],"receipt":true},{"name":"Anything else","keywords":["x"]}],"other":{"receipt":true,"receiptCopies":1,"documents":[],"sticker":true},"stickerFields":[{"name":"Ticket","label":"Ticket"},{"name":"asset","label":"Asset tag"}],"stickerLines":["{type}","{ticket}","  ","Asset {asset}"],"watchFolder":"%USERPROFILE%\\GrabGo","filesFolder":"","autoPrint":true}' | ConvertFrom-Json
  $auto = ConvertTo-AgentAutomation $pushed
  Eq 'the Grab & Go words, trimmed' @($auto.keywords) @('Grab & Go')
  Eq 'file types without dots, in lower case' @($auto.fileTypes) @('pdf', 'txt')
  Eq 'a type without words, and a second "Anything else", are dropped' @($auto.types | ForEach-Object { $_.name }) @('PC refresh', 'LDO')
  Eq 'copies kept within 1-5; empty forms dropped' @($auto.types[0].receiptCopies, @($auto.types[1].documents).Count) @(5, 1)
  Eq 'detail names in lower case; empty sticker lines dropped' @($auto.stickerFields[0].name, @($auto.stickerLines).Count) @('ticket', 3)
  Eq 'nothing handed over: nothing' (ConvertTo-AgentAutomation $null) $null
  $refresh = "Grab & Go return`nType: PC REFRESH`nTicket: RITM1"
  Eq 'the first type whose words are all in the file, any case' (Find-ReturnType $refresh 'a.pdf' $auto).type 'PC refresh'
  Eq 'LDO' (Find-ReturnType "GRAB & GO`nLDO return" 'b.txt' $auto).type 'LDO'
  Eq 'the first type wins when two match' (Find-ReturnType 'Grab & Go refresh LDO' 'f.pdf' $auto).type 'PC refresh'
  Eq 'a Grab & Go file of no listed type: anything else' (Find-ReturnType 'Grab & Go laptop swap' 'c.pdf' $auto).type 'Anything else'
  Eq 'without the Grab & Go words it is not a Grab & Go file' (Find-ReturnType 'PC refresh LDO' 'd.pdf' $auto).isGrabAndGo $false
  Eq 'another kind of file is left alone' (Find-ReturnType $refresh 'e.docx' $auto).isGrabAndGo $false
  Eq 'no automation yet: nothing is a Grab & Go file' (Find-ReturnType $refresh 'a.pdf' $null).isGrabAndGo $false
  Eq 'an unknown type name prints as anything else' (Get-TypePrints $auto 'Nope').name 'Anything else'

  Write-Host '--- the sticker ---'
  $values = Read-Fields $text @([pscustomobject]@{ name = 'ticket'; label = 'Ticket' }, [pscustomobject]@{ name = 'asset'; label = 'Asset tag' })
  $builtins = Get-BuiltinValues 'gg.pdf' 'Grab & Go return' (Get-Date -Year 2026 -Month 10 -Day 1 -Hour 9 -Minute 5)
  foreach ($k in $builtins.Keys) { $values[$k] = $builtins[$k] }
  Eq 'lines filled in' @(Format-Sticker @('{ticket}', 'Asset {asset}', '{date}') $values) @('RITM0012345', 'Asset NB-48213', '01/10/2026')
  Eq 'placeholders in any case' @(Format-Sticker @('{TICKET}') $values) @('RITM0012345')
  Eq 'an unknown placeholder is left empty' @(Format-Sticker @('[{nothing}]') $values) @('[]')
  Eq 'the return type is a detail too' @(Format-Sticker @('{type}') $values) @('Grab & Go return')

  Write-Host '--- reading files ---'
  $txt = Join-Path $work 'return.txt'; [System.IO.File]::WriteAllText($txt, $text)
  Eq 'a text file' ((Get-FileText $txt) -match 'Asset tag: NB-48213') $true

  $csvFile = Join-Path $work 'return.csv'; [System.IO.File]::WriteAllText($csvFile, "Ticket,Asset tag,User`nRITM1,NB-9,Dana")
  Eq 'a CSV file' (Get-FileText $csvFile).StartsWith('Ticket,Asset tag') $true

  $html = Join-Path $work 'return.html'
  [System.IO.File]::WriteAllText($html, '<html><body><h1>Grab &amp; Go</h1><table><tr><td>Asset tag</td><td>NB-77</td></tr></table></body></html>')
  $htmlText = Get-FileText $html
  Eq 'a web page: entities decoded' ($htmlText -match 'Grab & Go') $true
  Eq 'a web page: table cells as tabs, so the label finds its value' (Read-Field $htmlText 'Asset tag') 'NB-77'

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  function New-Zip([string]$Path, [hashtable]$Entries) {
    $zip = [System.IO.Compression.ZipFile]::Open($Path, 'Create')
    try {
      foreach ($name in $Entries.Keys) {
        $writer = New-Object System.IO.StreamWriter(($zip.CreateEntry($name)).Open())
        $writer.Write($Entries[$name]); $writer.Dispose()
      }
    } finally { $zip.Dispose() }
  }
  $docx = Join-Path $work 'return.docx'
  New-Zip $docx @{ 'word/document.xml' = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Grab &amp; Go return</w:t></w:r></w:p><w:p><w:r><w:t>Asset tag:</w:t></w:r><w:r><w:tab/><w:t>NB-55</w:t></w:r></w:p></w:body></w:document>' }
  $docxText = Get-FileText $docx
  Eq 'a Word file: paragraphs as lines' ($docxText -match 'Grab & Go return') $true
  Eq 'a Word file: a detail after its label' (Read-Field $docxText 'Asset tag') 'NB-55'

  $xlsx = Join-Path $work 'return.xlsx'
  $m = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  New-Zip $xlsx @{
    'xl/sharedStrings.xml' = "<sst xmlns=`"$m`"><si><t>Asset tag</t></si><si><t>NB-66</t></si><si><t>Grab &amp; Go</t></si></sst>"
    'xl/worksheets/sheet1.xml' = "<worksheet xmlns=`"$m`"><sheetData><row r=`"1`"><c r=`"A1`" t=`"s`"><v>2</v></c></row><row r=`"2`"><c r=`"A2`" t=`"s`"><v>0</v></c><c r=`"B2`" t=`"s`"><v>1</v></c><c r=`"C2`"><v>42</v></c></row></sheetData></worksheet>"
    'xl/worksheets/sheet2.xml' = "<worksheet xmlns=`"$m`"><sheetData/></worksheet>"
  }
  $xlsxText = Get-FileText $xlsx
  Eq 'an Excel file: rows as lines, cells as tabs' $xlsxText "Grab & Go`nAsset tag`tNB-66`t42"
  Eq 'an Excel file: a detail in the next cell' (Read-Field $xlsxText 'Asset tag') 'NB-66'

  # A PDF with a compressed page, written by hand.
  $content = "BT /F1 12 Tf 72 712 Td (Grab & Go return) Tj 0 -16 Td (Asset tag: NB-48213) Tj 0 -16 Td [(Tic) 30 (ket:) -300 (RITM0012345)] TJ ET"
  $raw = [System.Text.Encoding]::ASCII.GetBytes($content)
  $packed = New-Object System.IO.MemoryStream
  $packed.WriteByte(0x78); $packed.WriteByte(0x9C)
  $deflate = New-Object System.IO.Compression.DeflateStream($packed, [System.IO.Compression.CompressionMode]::Compress, $true)
  $deflate.Write($raw, 0, $raw.Length); $deflate.Dispose()
  $streamBytes = $packed.ToArray()
  $head = [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n1 0 obj`n<< /Length $($streamBytes.Length) /Filter /FlateDecode >>`nstream`n")
  $tail = [System.Text.Encoding]::ASCII.GetBytes("`nendstream`nendobj`n%%EOF`n")
  $pdf = Join-Path $work 'return.pdf'
  [System.IO.File]::WriteAllBytes($pdf, [byte[]]($head + $streamBytes + $tail))
  $pdfText = Get-FileText $pdf
  Eq 'a compressed PDF: the text comes out' ($pdfText -match 'Grab & Go return') $true
  Eq 'a compressed PDF: a detail after its label' (Read-Field $pdfText 'Asset tag') 'NB-48213'
  Eq 'a compressed PDF: kerned text joins, a wide gap is a space' (Read-Field $pdfText 'Ticket') 'RITM0012345'

  # A real PDF made by Windows: the agent's own sticker printed to
  # "Microsoft Print to PDF". Its fonts carry only the glyphs used, so this
  # checks the ToUnicode decoding real-world PDFs need.
  Add-Type -AssemblyName System.Drawing
  $printers = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
  if ($printers -contains 'Microsoft Print to PDF') {
    $winPdf = Join-Path $work 'windows.pdf'
    Invoke-PrintSticker 'Microsoft Print to PDF' @('Grab & Go return', 'Asset tag: NB-48213', 'Ticket: RITM0012345') $false $winPdf
    $deadline = (Get-Date).AddSeconds(20)
    while (-not ((Test-Path $winPdf) -and (Get-Item $winPdf).Length -gt 0) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    Start-Sleep -Milliseconds 800
    $winText = Get-FileText $winPdf
    Eq 'a Windows PDF: the sticker was printed to a file' ((Get-Item $winPdf).Length -gt 0) $true
    Eq 'a Windows PDF: keywords are found' (($winText -match 'Grab') -and ($winText -match 'return')) $true
    Eq 'a Windows PDF: a detail after its label' (Read-Field $winText 'Asset tag') 'NB-48213'
  } else {
    Write-Host '  (skipped: no "Microsoft Print to PDF" printer here)'
  }

  Write-Host '--- printing on the A4 printer ---'
  Eq 'how each kind of file is printed' @((Get-PrintKind 'a.PDF'), (Get-PrintKind 'b.jpg'), (Get-PrintKind 'c.csv'), (Get-PrintKind 'd.docx')) @('pdf', 'picture', 'text', 'app')
  if ($printers -contains 'Microsoft Print to PDF') {
    $waitFile = {
      param($File)
      $deadline = (Get-Date).AddSeconds(30)
      while (-not ((Test-Path $File) -and (Get-Item $File).Length -gt 0) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
      Start-Sleep -Milliseconds 800
    }
    # A two-page PDF, made by Windows.
    $twoPages = Join-Path $work 'ldo.pdf'
    $job = New-PrintJob 'Microsoft Print to PDF' 'test' $twoPages
    $pageNo = @{ n = 0 }
    $job.add_PrintPage({
      param($j, $e)
      $pageNo.n++
      $e.Graphics.DrawString("LDO form page $($pageNo.n)", (New-Object System.Drawing.Font('Arial', 20)), [System.Drawing.Brushes]::Black, 100, 100)
      $e.HasMorePages = $pageNo.n -lt 2
    })
    $job.Print()
    $job.Dispose()
    & $waitFile $twoPages
    Eq "Windows' own PDF reader opens it" (Open-Pdf $twoPages).PageCount 2
    $out = Join-Path $work 'printed-pdf.pdf'
    Invoke-PrintFile $twoPages 1 'Microsoft Print to PDF' $false $out
    & $waitFile $out
    Eq 'a PDF prints on the chosen printer, every page, with no PDF app' (Open-Pdf $out).PageCount 2

    $textFile = Join-Path $work 'notes.txt'
    [System.IO.File]::WriteAllText($textFile, "Grab & Go return`r`nTicket:`tRITM0012345`r`n" + ("a line of text`r`n" * 120))
    $out = Join-Path $work 'printed-text.pdf'
    Invoke-PrintFile $textFile 1 'Microsoft Print to PDF' $false $out
    & $waitFile $out
    Eq 'a text file prints as text' ((Get-FileText $out) -match 'Grab & Go return') $true
    Eq '...on as many pages as it needs' ((Open-Pdf $out).PageCount -ge 2) $true

    $png = Join-Path $work 'label.png'
    $bmp = New-Object System.Drawing.Bitmap(600, 300)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawString('PICTURE', (New-Object System.Drawing.Font('Arial', 40)), [System.Drawing.Brushes]::Black, 10, 10)
    $g.Dispose()
    $bmp.Save($png)
    $bmp.Dispose()
    $out = Join-Path $work 'printed-picture.pdf'
    Invoke-PrintFile $png 1 'Microsoft Print to PDF' $false $out
    & $waitFile $out
    $printedPage = (Open-Pdf $out).GetPage(0)
    Eq 'a picture prints; a wide one on a landscape page' ($printedPage.Size.Width -gt $printedPage.Size.Height) $true
    Eq '...and the picture file is free again afterwards' $(Remove-Item -LiteralPath $png -ErrorAction SilentlyContinue; Test-Path -LiteralPath $png) $false

    $answer = try { Invoke-PrintFile $textFile 1 'No Such Printer 123' $false ''; 'printed?!' } catch { $_.Exception.Message }
    Eq 'a printer that is not on this PC, in words' $answer "There is no printer named 'No Such Printer 123' on this PC."
    $odd = Join-Path $work 'thing.nblabx'
    [System.IO.File]::WriteAllText($odd, 'x')
    $answer = try { Invoke-PrintFile $odd 1 'Microsoft Print to PDF' $false ''; 'printed?!' } catch { $_.Exception.Message }
    Eq 'a kind of file no app here can print, in words' $answer 'no app on this PC can print .nblabx files to a chosen printer'
  } else {
    Write-Host '  (skipped printing: no "Microsoft Print to PDF" printer here)'
  }

  Write-Host '--- a return: planned, and printed (test run) ---'
  $files = Join-Path $work 'forms'
  New-Item -ItemType Directory -Path $files | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $files 'LDO.pdf'), '%PDF-1.4 placeholder')
  $ret = Join-Path $work 'gg-return.txt'
  [System.IO.File]::WriteAllText($ret, "Grab & Go return`nLDO`nTicket: RITM0012345`nAsset tag: NB-48213`n")
  $settings = @{ watchFolder = $work; filesFolder = $files; a4Printer = 'Office A4'; stickerPrinter = 'Label printer'; autoPrint = $true; dryRun = $true; wanted = @{} }
  $plan = Get-ReturnPlan $ret 'gg-return.txt' $auto $settings
  Eq 'the plan: the type, from the file' @($plan.isGrabAndGo, $plan.detected, $plan.type) @($true, 'LDO', 'LDO')
  Eq 'the plan: what LDO prints' @($plan.receipt.copies, $plan.documents[0].file, $plan.documents[0].copies, $plan.documents[0].found, $plan.sticker) @(1, 'LDO.pdf', 2, $true, $false)
  Eq 'the plan: sticker lines, with the type' @($plan.stickerLines) @('LDO', 'RITM0012345', 'Asset NB-48213')
  $asRefresh = Get-ReturnPlan $ret 'gg-return.txt' $auto $settings 'PC refresh'
  Eq 'another type, chosen on the website' @($asRefresh.detected, $asRefresh.type, $asRefresh.sticker, @($asRefresh.documents).Count, $asRefresh.stickerLines[0]) @('LDO', 'PC refresh', $true, 0, 'PC refresh')
  $script:LogPath = Join-Path $work 'test.log'
  $result = Invoke-Prints $plan 'all' '' $null $settings
  Eq 'print all: the receipt and each form' @($result.done) @('receipt', 'LDO.pdf')
  Eq '...a test run says so' $result.dryRun $true
  $log = Get-Content $script:LogPath -Raw
  Eq '...every copy of a form, on the A4 printer' ([regex]::Matches($log, "would print .*LDO\.pdf on 'Office A4'").Count) 2
  Eq 'just the sticker, whatever the type prints' @((Invoke-Prints $plan 'sticker' '' $null $settings).done) @('sticker')
  [void](Invoke-Prints $plan 'sticker' '' @('Edited', 'line') $settings)
  Eq '...or with its lines changed on the website' ((Get-Content $script:LogPath -Raw) -match "sticker on 'Label printer': Edited \| line") $true
  Eq 'just the receipt' @((Invoke-Prints $plan 'receipt' '' $null $settings).done) @('receipt')
  Eq 'just one form' @((Invoke-Prints $plan 'document' 'LDO.pdf' $null $settings).done) @('LDO.pdf')
  Eq 'a blank form, with no file at all' @((Invoke-Prints $null 'document' 'LDO.pdf' $null $settings).done) @('LDO.pdf')
  Eq 'a form missing from the folder is said, not fatal' @((Invoke-Prints $null 'document' 'Nope.pdf' $null $settings).problems) @("Nope.pdf is not in $files")
  Eq 'a path is never a form' @((Invoke-Prints $null 'document' '..\secret.pdf' $null $settings).problems) @('that is not a form name')
  $noPrinters = $settings.Clone()
  $noPrinters.a4Printer = ''
  $noPrinters.stickerPrinter = ''
  $r = Invoke-Prints $asRefresh 'all' '' $null $noPrinters
  Eq 'no printers chosen: said once each, nothing printed' @(@($r.done).Count, @($r.problems).Count) @(0, 2)

  Write-Host '--- files arriving ---'
  $script:Config = @{ a4Printer = 'Office A4'; stickerPrinter = 'Label printer'; automation = $auto; revision = [long]1; siteId = 'l12'; siteName = 'L12'; isNew = $false }
  $script:Settings = $settings
  $script:Recent.Clear()
  Invoke-Arrival $ret
  Eq 'a Grab & Go file is printed by itself, and listed' @($script:Recent[0].name, $script:Recent[0].type, $script:Recent[0].status) @('gg-return.txt', 'LDO', 'printed')
  $holiday = Join-Path $work 'holiday.txt'
  [System.IO.File]::WriteAllText($holiday, 'Holiday photos')
  Invoke-Arrival $holiday
  Eq 'any other file is left alone' $script:Recent.Count 1
  $settings.autoPrint = $false
  Invoke-Arrival $ret
  Eq 'automatic printing off: kept for the website, not printed' $script:Recent[0].status 'waiting'
  $settings.autoPrint = $true
  $script:Config.automation = $null
  Invoke-Arrival $ret
  Eq 'not set up yet: nothing happens' $script:Recent.Count 2
  $script:Config.automation = $auto

  Write-Host "--- this PC's settings ---"
  $DataFolder = Join-Path $work 'agent-data'
  $ConfigPath = Join-Path $DataFolder 'config.json'
  $UploadFolder = Join-Path $DataFolder 'uploads'
  New-Item -ItemType Directory -Path $DataFolder | Out-Null
  Eq 'the first time: nothing set, and it knows it is new' (Get-AgentConfig).isNew $true
  @{ a4Printer = 'HP A4'; stickerPrinter = 'Zebra'; refreshToken = 'secret'; email = 'a@nblab.local' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataFolder 'settings.json')
  [System.IO.File]::WriteAllText((Join-Path $DataFolder 'automations-cache.json'), '{}')
  $migrated = Get-AgentConfig
  Eq 'from 2.x: the printers are kept' @($migrated.a4Printer, $migrated.stickerPrinter) @('HP A4', 'Zebra')
  Eq '...the old sign-in and copy are gone' @((Test-Path (Join-Path $DataFolder 'settings.json')), (Test-Path (Join-Path $DataFolder 'automations-cache.json')), (Test-Path $ConfigPath)) @($false, $false, $true)
  $somePrinter = (Get-InstalledPrinters)[0]
  Set-AgentSetup $migrated (@{ printers = @{ a4Printer = $somePrinter; stickerPrinter = $somePrinter } } | ConvertTo-Json | ConvertFrom-Json)
  Eq "the website chooses this PC's printers" @($migrated.a4Printer, $migrated.stickerPrinter) @($somePrinter, $somePrinter)
  $answer = try { Set-AgentSetup $migrated (@{ printers = @{ a4Printer = 'No Such Printer 123'; stickerPrinter = '' } } | ConvertTo-Json | ConvertFrom-Json); 'saved?!' } catch { $_.Exception.Message }
  Eq '...only a printer this PC has' $answer "There is no printer named 'No Such Printer 123' on this PC."
  Set-AgentSetup $migrated (@{ automation = $pushed; revision = 1717; site = @{ id = 'l12'; name = 'L12' } } | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
  $again = Get-AgentConfig
  Eq "the site's automation is kept on this PC, with its revision" @($again.revision, $again.siteName, @($again.automation.types).Count, $again.a4Printer) @(1717, 'L12', 2, $somePrinter)
  Eq '...and works the same after a restart' (Find-ReturnType $refresh 'a.pdf' $again.automation).type 'PC refresh'
  $effective = Get-AgentSettings $again
  Eq "its folders are this user's own" @($effective.watchFolder, $effective.filesFolder) @((Join-Path $env:USERPROFILE 'GrabGo'), (Get-DefaultFolders).filesFolder)
  Eq '...and it prints by itself' $effective.autoPrint $true
  $made = @{ watchFolder = (Join-Path $work 'from-site\grab-go'); wanted = @{} }
  Resolve-AgentFolder $made 'watchFolder'
  Eq 'a folder missing on this PC is made' (Test-Path -LiteralPath $made.watchFolder -PathType Container) $true
  $bad = @{ watchFolder = 'C:' + [char]92 + 'bad<name>'; wanted = @{} }
  Resolve-AgentFolder $bad 'watchFolder'
  Eq 'a folder that cannot be used falls back to the default' $bad.watchFolder (Get-DefaultFolders).watchFolder

  Write-Host '--- the website on this PC (127.0.0.1) ---'
  Add-Type -AssemblyName System.Net.Http
  $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $probe.Start()
  $port = $probe.LocalEndpoint.Port
  $probe.Stop()
  $server = Start-LocalServer $port
  $http = New-Object System.Net.Http.HttpClient
  $http.DefaultRequestHeaders.ExpectContinue = $false
  $ask = {
    param([string]$Method, [string]$Path, [string]$Origin = 'http://localhost:5173', $Body = $null, [string]$Type = 'application/json', [hashtable]$Headers = @{})
    $message = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod $Method), "http://127.0.0.1:$port$Path")
    if ($Origin) { [void]$message.Headers.TryAddWithoutValidation('Origin', $Origin) }
    foreach ($key in $Headers.Keys) { [void]$message.Headers.TryAddWithoutValidation($key, $Headers[$key]) }
    if ($null -ne $Body) {
      $content = if ($Body -is [byte[]]) { New-Object System.Net.Http.ByteArrayContent(, $Body) } else { New-Object System.Net.Http.StringContent([string]$Body, [System.Text.Encoding]::UTF8) }
      $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue($Type)
      $message.Content = $content
    }
    $task = $http.SendAsync($message)
    $deadline = (Get-Date).AddSeconds(30)
    while (-not $task.IsCompleted -and (Get-Date) -lt $deadline) {
      if ($server.Pending()) { $null = Invoke-LocalRequest ($server.AcceptTcpClient()) } else { Start-Sleep -Milliseconds 20 }
    }
    $response = $task.Result
    $text = $response.Content.ReadAsStringAsync().Result
    $header = { param($name) $values = $null; if ($response.Headers.TryGetValues($name, [ref]$values)) { [string]@($values)[0] } else { '' } }
    @{
      status = [int]$response.StatusCode
      origin = (& $header 'Access-Control-Allow-Origin')
      privateNetwork = (& $header 'Access-Control-Allow-Private-Network')
      json = $(if ($text) { try { $text | ConvertFrom-Json } catch { $null } } else { $null })
    }
  }
  try {
    $script:Config = $again
    $script:Settings = $settings
    $script:Recent.Clear()
    $r = & $ask 'OPTIONS' '/status' 'http://localhost:5173' $null 'application/json' @{ 'Access-Control-Request-Private-Network' = 'true' }
    Eq "Chrome's check first: allowed, for this website, private network too" @($r.status, $r.origin, $r.privateNetwork) @(204, 'http://localhost:5173', 'true')
    $r = & $ask 'GET' '/status'
    Eq 'who it is' @($r.status, $r.json.app, $r.json.version) @(200, 'nblab-automation', $AgentVersion)
    Eq "this PC's printers, and the chosen ones" @((@($r.json.printers) -contains $somePrinter), $r.json.a4Printer) @($true, $somePrinter)
    Eq 'the forms found in the folder, and the automation it has' @((@($r.json.documents) -contains 'LDO.pdf'), $r.json.automationRevision, $r.json.site.name) @($true, 1717, 'L12')
    $r = & $ask 'GET' '/status' 'https://evil.example'
    Eq 'another website is turned away, without a CORS answer' @($r.status, $r.origin) @(403, '')
    Eq 'no website at all is turned away too' (& $ask 'GET' '/status' '').status 403
    Eq 'the published website is let in' (& $ask 'GET' '/status' 'https://dolev6780.github.io').status $(if ($SiteOrigin -eq 'https://dolev6780.github.io') { 200 } else { 403 })
    $r = & $ask 'POST' '/read?name=gg-return.txt' 'http://localhost:5173' ([System.IO.File]::ReadAllBytes($ret)) 'application/octet-stream'
    Eq 'an uploaded file: read, its type found' @($r.status, $r.json.name, $r.json.detected, $r.json.type) @(200, 'gg-return.txt', 'LDO', 'LDO')
    Eq '...what it prints, and its details' @($r.json.documents[0].file, $r.json.documents[0].found, $r.json.values.ticket) @('LDO.pdf', $true, 'RITM0012345')
    $id = $r.json.id
    $r = & $ask 'GET' "/plan?id=$id&type=PC%20refresh"
    Eq 'the same file as another type' @($r.json.type, $r.json.sticker, $r.json.stickerLines[0]) @('PC refresh', $true, 'PC refresh')
    $r = & $ask 'POST' '/print' 'http://localhost:5173' (@{ id = $id; type = 'PC refresh'; what = 'all' } | ConvertTo-Json)
    Eq 'print all for that type' @($r.status, @($r.json.done), $r.json.dryRun) @(200, @('receipt', 'sticker'), $true)
    Eq '...and the file is listed as printed' @((& $ask 'GET' '/status').json.recent[0].status) @('printed')
    $r = & $ask 'POST' '/print' 'http://localhost:5173' (@{ what = 'document'; file = 'LDO.pdf' } | ConvertTo-Json)
    Eq 'a blank form' @(@($r.json.done)) @('LDO.pdf')
    Eq 'print all needs a file' (& $ask 'POST' '/print' 'http://localhost:5173' '{"what":"all"}').json.error 'Which file?'
    Eq 'a file that is gone' (& $ask 'POST' '/print' 'http://localhost:5173' '{"what":"all","id":"f0-0"}').status 404
    Eq 'not JSON' (& $ask 'POST' '/print' 'http://localhost:5173' 'print!').status 400
    $r = & $ask 'POST' '/setup' 'http://localhost:5173' '{"printers":{"a4Printer":"No Such Printer 123","stickerPrinter":""}}'
    Eq 'a printer this PC does not have, in words' @($r.status, $r.json.error) @(500, "There is no printer named 'No Such Printer 123' on this PC.")
    Eq 'anything else: not here' (& $ask 'GET' '/nothing').status 404
  } finally {
    $server.Stop()
    $http.Dispose()
  }

  Write-Host '--- starting with Windows ---'
  $StableCopy = Join-Path $work 'nblab-automation.cmd'
  [System.IO.File]::WriteAllText($StableCopy, '@echo off')
  $link = Join-Path $work 'NBLAB automation.lnk'
  Set-StartAtSignIn $true $link
  $saved = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
  Eq 'the shortcut starts a console with no window' ($saved.TargetPath -like '*\System32\conhost.exe') $true
  Eq '...running the copy kept with the settings' $saved.Arguments "--headless cmd.exe /c `"$StableCopy`""
  Set-StartAtSignIn $false $link
  Eq 'turning it off removes the shortcut' (Test-Path -LiteralPath $link) $false

  Write-Host '--- updating itself ---'
  Eq 'not built for the website: no update check' (Get-AgentUpdate) $null
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    # The agent exactly as the website publishes it (vite.config.js).
    $builder = Join-Path $work 'build.mjs'
    $viteConfig = ([uri](Resolve-Path (Join-Path $PSScriptRoot '..\vite.config.js')).Path).AbsoluteUri
    [System.IO.File]::WriteAllText($builder, "import { agentCmd } from '$viteConfig'`nimport { writeFileSync } from 'node:fs'`nwriteFileSync(process.argv[2], agentCmd({ VITE_FIREBASE_API_KEY: 'AIzaTestKey0123456789', VITE_SITE_URL: 'https://example.invalid/nblab/' }))`n")
    $built = Join-Path $work 'built.cmd'
    & $node.Source $builder $built
    $builtText = [System.IO.File]::ReadAllText($built)
    Eq 'the published agent carries its version' ([string](Get-ScriptVersion $builtText)) $AgentVersion
    Eq '...knows the website it answers and updates from' ([regex]::Match($builtText, "(?m)^\`$SiteUrl = '([^']*)'").Groups[1].Value) 'https://example.invalid/nblab/'
    Eq '...and agents 2.2 take it as an update' ([regex]::IsMatch($builtText, '(?m)^\$FirebaseApiKey = ''(?!__)[A-Za-z0-9_\-]{10,}''')) $true
    Eq '...and passes the check' (Test-AgentScript $builtText) ''
    Eq 'a web page is not the agent' (Test-AgentScript ('<!doctype html><html>' + ('x' * 30000))) 'not the agent'
    $cut = $builtText.Substring(0, $builtText.IndexOf('while (-not $script:Stop)') + 40)
    Eq 'a cut-off download is refused' (Test-AgentScript $cut) 'damaged'
    Eq 'one without a version is refused' (Test-AgentScript ($builtText -replace "(?m)^\`$AgentVersion = '[^']*'", '$AgentVersion = $null')) 'no version'
    Eq 'one built without the website settings is refused' (Test-AgentScript ("<# :`r`n#>`r`n" + [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'nblab-automation.ps1')))) 'not built for the website'

    $withVersion = { param([string]$Version) $builtText -replace "(?m)^\`$AgentVersion = '[^']*'", "`$AgentVersion = '$Version'" }
    $newer = Join-Path $work 'newer.cmd'
    [System.IO.File]::WriteAllText($newer, (& $withVersion '9.9.9'))
    $older = Join-Path $work 'older.cmd'
    [System.IO.File]::WriteAllText($older, (& $withVersion '1.0.0'))
    $broken = Join-Path $work 'broken.cmd'
    [System.IO.File]::WriteAllText($broken, '<!doctype html><title>404</title>' + ('x' * 30000))
    try {
      $env:NBLAB_UPDATE_URL = ([uri]$newer).AbsoluteUri
      $update = Get-AgentUpdate
      Eq 'a newer version on the website is found' ([string]$update.version) '9.9.9'
      $kept = Join-Path $work 'kept\nblab-automation.cmd'
      Save-AgentUpdate $update $kept
      Eq '...and saved, whole, where it starts from' ([System.IO.File]::ReadAllText($kept)) ([System.IO.File]::ReadAllText($newer))
      Eq '...with nothing left over' (Test-Path -LiteralPath "$kept.new") $false
      $env:NBLAB_UPDATE_URL = ([uri]$built).AbsoluteUri
      Eq 'the same version: nothing to do' (Get-AgentUpdate) $null
      $env:NBLAB_UPDATE_URL = ([uri]$older).AbsoluteUri
      Eq 'an older version: nothing to do' (Get-AgentUpdate) $null
      $env:NBLAB_UPDATE_URL = ([uri]$broken).AbsoluteUri
      $answer = try { Get-AgentUpdate | Out-Null; 'accepted' } catch { $_.Exception.Message }
      Eq 'a broken download is refused, keeping this version' $answer 'The agent on the website looks wrong (not the agent); keeping this one.'
    } finally {
      Remove-Item Env:NBLAB_UPDATE_URL -ErrorAction SilentlyContinue
    }
  } else {
    Write-Host '  (skipped: no Node.js here to build the published agent)'
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Host "`n$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail) { exit 1 }

# Tests for nblab-automation.ps1, run with:
#   npm run test:agent
# (Windows PowerShell; the matching and field rules mirror
# src/services/automation.test.mjs case for case.)

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

  Write-Host '--- matching (same cases as the website) ---'
  $base = [pscustomobject]@{ name = 'Grab & Go return'; enabled = $true; keywords = @('Grab & Go', 'Return'); fileTypes = @() }
  $off = [pscustomobject]@{ name = 'Off'; enabled = $false; keywords = @('Return'); fileTypes = @() }
  $csv = [pscustomobject]@{ name = 'CSV only'; enabled = $true; keywords = @('Return'); fileTypes = @('csv') }
  $all = @($off, $csv, $base)
  Eq 'all keywords, any case: the first enabled match' (Find-Automation $text 'gg_return.pdf' $all).name 'Grab & Go return'
  Eq 'a file type limit is honoured' (Find-Automation $text 'export.csv' $all).name 'CSV only'
  Eq 'a missing keyword means no match' (Find-Automation 'Grab & Go pickup' 'a.pdf' $all) $null
  Eq 'a disabled automation never matches' (Find-Automation 'Return' 'a.txt' @($off)) $null

  Write-Host '--- the sticker ---'
  $values = Read-Fields $text @([pscustomobject]@{ name = 'ticket'; label = 'Ticket' }, [pscustomobject]@{ name = 'asset'; label = 'Asset tag' })
  $builtins = Get-BuiltinValues 'gg.pdf' 'Grab & Go return' (Get-Date -Year 2026 -Month 10 -Day 1 -Hour 9 -Minute 5)
  foreach ($k in $builtins.Keys) { $values[$k] = $builtins[$k] }
  Eq 'lines filled in' @(Format-Sticker @('{ticket}', 'Asset {asset}', '{date}') $values) @('RITM0012345', 'Asset NB-48213', '01/10/2026')
  Eq 'placeholders in any case' @(Format-Sticker @('{TICKET}') $values) @('RITM0012345')
  Eq 'an unknown placeholder is left empty' @(Format-Sticker @('[{nothing}]') $values) @('[]')

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

  Write-Host '--- the whole plan, dry run ---'
  $files = Join-Path $work 'print files'
  New-Item -ItemType Directory -Path $files | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $files 'LDO.pdf'), '%PDF-1.4 placeholder')
  $automations = @(ConvertTo-Automation ([pscustomobject]@{
    name = 'Grab & Go return'; enabled = $true; keywords = @('Grab & Go', 'Return'); fileTypes = @()
    printFile = $true; fileCopies = 1
    documents = @([pscustomobject]@{ file = 'LDO.pdf'; copies = 2 }, [pscustomobject]@{ file = 'Missing.pdf'; copies = 1 })
    sticker = $true; stickerLines = @('{ticket}', 'Asset {asset}')
    stickerFields = @([pscustomobject]@{ name = 'ticket'; label = 'Ticket' }, [pscustomobject]@{ name = 'asset'; label = 'Asset tag' })
  }) 'a1')
  $config = @{ watchFolder = $work; filesFolder = $files; a4Printer = 'Office A4'; stickerPrinter = 'Label printer'; dryRun = $true }
  $plan = Get-Plan $txt $config $automations
  Eq 'the plan: the matching automation' $plan.automation.name 'Grab & Go return'
  Eq 'the plan: the sticker lines' $plan.stickerLines @('RITM0012345', 'Asset NB-48213')
  Eq 'the plan: files from the print-files folder' (@($plan.documents | ForEach-Object { $_.path })) @((Join-Path $files 'LDO.pdf'), (Join-Path $files 'Missing.pdf'))
  $script:LogPath = Join-Path $work 'test.log'
  Invoke-Automation $txt $config $automations
  $log = Get-Content $script:LogPath -Raw
  Eq 'a dry run logs the file it would print, on the A4 printer' ($log -match "would print .*return\.txt on 'Office A4'") $true
  Eq 'a dry run logs each copy of a file to print' ([regex]::Matches($log, "would print .*LDO\.pdf on 'Office A4'").Count) 2
  Eq 'a dry run logs the sticker' ($log -match "sticker on 'Label printer': RITM0012345 \| Asset NB-48213") $true
  Eq 'a missing file to print is reported, not fatal' ($log -match 'PROBLEM: Missing\.pdf is not in') $true
  Eq 'a file that matches nothing is only logged' ((Get-Plan $csvFile $config $automations).automation) $null
  Remove-Item -LiteralPath $script:LogPath
  Invoke-Automation $txt @{ watchFolder = $work; filesFolder = $files; a4Printer = ''; stickerPrinter = ''; dryRun = $true } $automations
  $log = Get-Content $script:LogPath -Raw
  Eq 'no A4 printer chosen: said once, nothing printed on paper' ([regex]::Matches($log, 'PROBLEM: no A4 printer is chosen on this PC').Count) 1
  Eq 'no sticker printer chosen: said too' ($log -match 'PROBLEM: no sticker printer is chosen on this PC') $true

  Write-Host '--- automations read from the website ---'
  $rest = '{"name":"projects/p/databases/(default)/documents/sites/l12/features/dispatch-automation/automations/a7","fields":{"name":{"stringValue":"Return"},"enabled":{"booleanValue":true},"keywords":{"arrayValue":{"values":[{"stringValue":"Grab & Go"}]}},"fileTypes":{"arrayValue":{}},"printFile":{"booleanValue":false},"fileCopies":{"integerValue":"9"},"documents":{"arrayValue":{"values":[{"mapValue":{"fields":{"file":{"stringValue":"LDO.pdf"},"copies":{"integerValue":"2"}}}}]}},"sticker":{"booleanValue":true},"stickerLines":{"arrayValue":{"values":[{"stringValue":"{ticket}"}]}},"stickerFields":{"arrayValue":{"values":[{"mapValue":{"fields":{"name":{"stringValue":"ticket"},"label":{"stringValue":"Ticket"}}}}]}},"updatedAt":{"timestampValue":"2026-10-01T09:00:00.123456Z"}}}' | ConvertFrom-Json
  $fromWeb = ConvertTo-Automation (ConvertFrom-FirestoreFields $rest.fields) 'a7'
  Eq 'a website automation: name and words' @($fromWeb.name, $fromWeb.keywords) @('Return', @('Grab & Go'))
  Eq 'a website automation: an empty list stays empty' $fromWeb.fileTypes.Count 0
  Eq 'a website automation: copies kept within 1-5' $fromWeb.fileCopies 5
  Eq 'a website automation: files to print' @($fromWeb.documents[0].file, $fromWeb.documents[0].copies) @('LDO.pdf', 2)
  Eq 'a website automation: sticker details' @($fromWeb.stickerFields[0].name, $fromWeb.stickerFields[0].label) @('ticket', 'Ticket')
  Eq 'a website automation: it works with the matching rules' (Find-Automation 'GRAB & GO return' 'a.pdf' @($fromWeb)).id 'a7'
  Eq 'a missing field gets its default' (ConvertTo-Automation ([pscustomobject]@{ name = 'Bare' }) 'b').enabled $true
  $me = ConvertFrom-FirestoreFields (('{"siteId":{"stringValue":"l12"},"tempSiteId":{"stringValue":"l9"},"tempEndsAt":{"timestampValue":"2026-10-05T00:00:00Z"}}') | ConvertFrom-Json)
  Eq 'the current site: away on a temporary move' (Get-CurrentSite $me ([datetime]'2026-10-01T10:00:00Z')) 'l9'
  Eq 'the current site: home again once it ends' (Get-CurrentSite $me ([datetime]'2026-10-06T10:00:00Z')) 'l12'

  Write-Host "--- the site's Lab PC settings ---"
  $siteRest = '{"name":"projects/p/databases/(default)/documents/sites/l12/features/dispatch-automation/settings/agent","fields":{"watchFolder":{"stringValue":"%USERPROFILE%\\GrabGo"},"filesFolder":{"stringValue":"\\\\lab-server\\print"},"stickerPrinter":{"stringValue":"ZDesigner ZD421"},"dryRun":{"booleanValue":true},"updatedBy":{"stringValue":"u1"},"updatedAt":{"timestampValue":"2026-10-01T09:00:00Z"}}}' | ConvertFrom-Json
  $site = ConvertTo-SiteSettings (ConvertFrom-FirestoreFields $siteRest.fields)
  Eq 'the site settings from the website' @($site.watchFolder, $site.filesFolder, $site.dryRun) @('%USERPROFILE%\GrabGo', '\\lab-server\print', $true)
  Eq '...never a printer: each PC chooses its own' $site.ContainsKey('stickerPrinter') $false
  Eq 'none set on the website yet' (ConvertTo-SiteSettings $null) $null
  Eq 'a missing document, in words' (Get-FirebaseErrorMessage '{"error":{"code":404,"message":"Document x was not found.","status":"NOT_FOUND"}}') 'Not found.'
  $defaults = Get-DefaultFolders
  $blank = @{ watchFolder = ''; filesFolder = ''; a4Printer = ''; stickerPrinter = ''; dryRun = $false }
  $none = Get-EffectiveSettings $blank $null
  Eq 'nothing set anywhere: the default folders, no printers yet' @($none.watchFolder, $none.filesFolder, $none.a4Printer, $none.stickerPrinter, $none.dryRun) @($defaults.watchFolder, $defaults.filesFolder, '', '', $false)
  $fromSite = Get-EffectiveSettings $blank $site
  Eq "the site's settings, %USERPROFILE% as this user's folder" @($fromSite.watchFolder, $fromSite.filesFolder, $fromSite.dryRun) @((Join-Path $env:USERPROFILE 'GrabGo'), '\\lab-server\print', $true)
  Eq '...and where each one came from' @($fromSite.from.watchFolder, $fromSite.from.filesFolder, $fromSite.from.dryRun) @('the site', 'the site', 'the site')
  $own = Get-EffectiveSettings @{ watchFolder = 'D:\In'; filesFolder = ''; a4Printer = 'HP A4'; stickerPrinter = 'Brother QL'; dryRun = $false } $site
  Eq "this PC's own folder and its two printers, the rest from the site" @($own.watchFolder, $own.filesFolder, $own.a4Printer, $own.stickerPrinter, $own.from.watchFolder) @('D:\In', '\\lab-server\print', 'HP A4', 'Brother QL', 'this PC')
  Eq 'test mode: on when this PC turns it on' (Get-EffectiveSettings @{ dryRun = $true } $null).dryRun $true
  Eq 'test mode: on when the site turns it on' (Get-EffectiveSettings $blank @{ dryRun = $true }).dryRun $true
  Eq 'the printers in words' @((Format-EffectiveSettings $own)[2], (Format-EffectiveSettings $own)[3], (Format-EffectiveSettings $none)[2]) @('A4 printer: HP A4', 'Sticker printer: Brother QL', 'A4 printer: (not chosen)')
  $script:LogPath = Join-Path $work 'test.log'
  $made = @{ watchFolder = (Join-Path $work 'from-site\grab-go'); wanted = @{} }
  Resolve-AgentFolder $made 'watchFolder'
  Eq "a site folder missing on this PC is made" (Test-Path -LiteralPath $made.watchFolder -PathType Container) $true
  $bad = @{ watchFolder = 'C:\bad<name>'; wanted = @{} }
  Resolve-AgentFolder $bad 'watchFolder'
  Eq 'a folder that cannot be used falls back to the default' $bad.watchFolder $defaults.watchFolder
  Eq '...remembering what was asked for, to not warn again' $bad.wanted.watchFolder 'C:\bad<name>'
  $saved = @{ site = 'l12'; person = 'Dana'; automations = @($fromWeb); settings = $site } | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $again = ConvertFrom-SavedAutomations $saved 'saved copy'
  Eq 'the saved copy keeps the automations and the site settings' @($again.site, $again.automations[0].id, $again.settings.filesFolder, $again.settings.dryRun) @('l12', 'a7', '\\lab-server\print', $true)
  $ConfigPath = Join-Path $work 'settings.json'
  @{ watchFolder = $defaults.watchFolder; filesFolder = 'E:\Forms'; stickerPrinter = 'Zebra'; dryRun = $false; startAtSignIn = $true; email = 'a@nblab.local'; refreshToken = 'x' } |
    ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  $migrated = Get-AgentConfig
  Eq 'a PC set up before 2.2 with the default folder now follows the site' @($migrated.watchFolder, $migrated.filesFolder) @('', 'E:\Forms')
  Eq '...keeps its sticker printer, and still has to choose the A4 printer' @($migrated.stickerPrinter, $migrated.a4Printer) @('Zebra', '')

  Write-Host '--- signing in (the same as the website) ---'
  Eq 'the credentials match the website' (Get-WorkIdCredentials '4471') @{ email = '4471@nblab.local'; password = '7151242b4b3ae3938e73ec7cc7e658c5' }
  Eq '...trimmed and in any case' (Get-WorkIdCredentials ' ab12.x ').password '54b292074947116eb84c3d2b61ddafee'
  Eq 'a work ID is needed' (Test-WorkId '  ') 'Enter your work ID.'
  Eq 'too short' (Test-WorkId '12') 'The work ID must be at least 3 characters.'
  Eq 'odd characters' (Test-WorkId 'a b') 'Use only letters, numbers, dots, dashes or underscores.'
  Eq 'a good work ID' (Test-WorkId 'ab12.x') $null
  Eq 'a wrong work ID, in words' (Get-FirebaseErrorMessage '{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}') 'That work ID was not recognised.'
  Eq 'an expired sign-in, in words' (Get-FirebaseErrorMessage '{"error":{"message":"TOKEN_EXPIRED"}}') 'The sign-in on this PC has expired. Open the settings and enter the work ID again.'
  Eq 'no answer at all' (Get-FirebaseErrorMessage '') 'No connection to the server.'
  Eq 'the sign-in is kept encrypted, for this user only' (Unprotect-Text (Protect-Text 'refresh-123')) 'refresh-123'
  Eq '...and is not readable as stored' ((Protect-Text 'refresh-123') -match 'refresh') $false

  # The real sign-in service, with a work ID that does not exist: proves the
  # address, TLS and the error message - using the key from .env.local.
  $envFile = Join-Path $PSScriptRoot '..\.env.local'
  $keyLine = if (Test-Path $envFile) { Get-Content $envFile | Where-Object { $_ -match '^VITE_FIREBASE_API_KEY=' } | Select-Object -First 1 } else { $null }
  if ($keyLine) {
    $FirebaseApiKey = ($keyLine -split '=', 2)[1].Trim().Trim('"')
    $answer = try { Invoke-FirebaseSignIn 'ZZTEST000NOTREAL' | Out-Null; 'signed in?!' } catch { $_.Exception.Message }
    Eq 'the real sign-in service refuses an unknown work ID, in words' $answer 'That work ID was not recognised.'
  } else {
    Write-Host '  (skipped the live sign-in check: no .env.local)'
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

  Write-Host '--- the setup window ---'
  $installed = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
  $somePrinter = $installed[0]
  $form = New-SetupForm @{ watchFolder = 'C:\In'; filesFolder = 'C:\Print'; a4Printer = $somePrinter; stickerPrinter = 'Not a printer'; startAtSignIn = $false; email = '4471@nblab.local'; refreshToken = 'x'; dryRun = $false }
  Eq 'it shows the saved folders' @($form.controls.watchFolder.Text, $form.controls.filesFolder.Text) @('C:\In', 'C:\Print')
  Eq 'both printers are chosen from the printers in Windows' @($form.controls.a4Printer.Items.Count, $form.controls.stickerPrinter.Items.Count) @(($installed.Count + 1), ($installed.Count + 1))
  Eq 'it shows the saved A4 printer' ([string]$form.controls.a4Printer.SelectedItem) $somePrinter
  Eq 'a sticker printer no longer on this PC is to be chosen again' ([string]$form.controls.stickerPrinter.SelectedItem) '(choose a printer)'
  Eq 'it says who is signed in' ($form.controls.signedIn.Text -match '^Signed in as 4471') $true
  Eq 'the work ID box hides what is typed' $form.controls.workId.UseSystemPasswordChar $true
  $form.form.Dispose()
  $form = New-SetupForm @{ watchFolder = ''; filesFolder = ''; a4Printer = ''; stickerPrinter = ''; startAtSignIn = $true; email = ''; refreshToken = ''; dryRun = $false } $site
  Eq "empty folders: it says they follow the site's" @($form.controls.watchFolder.Text, $form.controls.watchFolderHint.Text) @('', "Empty: the site's - $(Join-Path $env:USERPROFILE 'GrabGo')")
  $form.form.Dispose()
  $form = New-SetupForm $null $null
  Eq 'the first time: empty, falling back to Downloads' @($form.controls.watchFolder.Text, ($form.controls.watchFolderHint.Text -like '*else*Downloads')) @('', $true)
  Eq '...the A4 printer suggested: the Windows default' ([string]$form.controls.a4Printer.SelectedItem) (Get-DefaultPrinter)
  Eq '...the sticker printer still to be chosen' $form.controls.stickerPrinter.SelectedIndex 0
  $form.form.Dispose()

  Write-Host '--- updating itself ---'
  Eq 'not built for the website: no update check' (Get-AgentUpdate) $null
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    # The agent exactly as the website publishes it (vite.config.js).
    $builder = Join-Path $work 'build.mjs'
    $viteConfig = ([uri](Resolve-Path (Join-Path $PSScriptRoot '..\vite.config.js')).Path).AbsoluteUri
    [System.IO.File]::WriteAllText($builder, "import { agentCmd } from '$viteConfig'`nimport { writeFileSync } from 'node:fs'`nwriteFileSync(process.argv[2], agentCmd({ VITE_FIREBASE_API_KEY: 'AIzaTestKey0123456789', VITE_FIREBASE_PROJECT_ID: 'demo-nblab', VITE_AGENT_UPDATE_URL: 'https://example.invalid/nblab-automation.cmd' }))`n")
    $built = Join-Path $work 'built.cmd'
    & $node.Source $builder $built
    $builtText = [System.IO.File]::ReadAllText($built)
    Eq 'the published agent carries its version' ([string](Get-ScriptVersion $builtText)) $AgentVersion
    Eq '...knows where to update from' ([regex]::Match($builtText, "(?m)^\`$UpdateUrl = '([^']*)'").Groups[1].Value) 'https://example.invalid/nblab-automation.cmd'
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

# EqualLearn forced dark mode installer
# Run this script from the extracted project root (D:\equallearn-main).
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$CssPath = Join-Path $Root 'assets\css\forced-dark-theme.css'
if (-not (Test-Path -LiteralPath $CssPath)) {
    throw "Missing assets\css\forced-dark-theme.css. Extract the complete patch ZIP into the EqualLearn project root first."
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path (Split-Path $Root -Parent) "EqualLearn-Dark-Backup-$Stamp"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$Changed = New-Object System.Collections.Generic.List[string]

function Save-Backup([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $relative = $Path.Substring($Root.Length).TrimStart('\')
    $backup = Join-Path $BackupRoot $relative
    $parent = Split-Path $backup -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $Path -Destination $backup -Force
}

function Write-TextFile([string]$Path, [string]$Text) {
    Save-Backup $Path
    $parent = Split-Path $Path -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Set-Content -LiteralPath $Path -Value $Text -Encoding UTF8
    $script:Changed.Add($Path.Substring($Root.Length).TrimStart('\'))
}

# Force dark theme in all static application pages. The generated www/ folder
# is intentionally skipped; npm run mobile:build-web regenerates it from source.
$HtmlFiles = Get-ChildItem -LiteralPath $Root -Recurse -Filter '*.html' -File | Where-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\').Replace('\','/')
    $rel -notmatch '^(www|web|node_modules|\.git)/' -and
    $rel -ne 'assets/widgets/lumi.html'
}

foreach ($file in $HtmlFiles) {
    $path = $file.FullName
    $html = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    $original = $html
    $fileDir = Split-Path $path -Parent
    $cssTarget = Join-Path $Root 'assets\css\forced-dark-theme.css'
    $themeTarget = Join-Path $Root 'assets\js\theme.js'
    $cssUri = ([System.Uri]::new(($fileDir.TrimEnd('\') + '\'))).MakeRelativeUri([System.Uri]::new($cssTarget)).ToString()
    $themeUri = ([System.Uri]::new(($fileDir.TrimEnd('\') + '\'))).MakeRelativeUri([System.Uri]::new($themeTarget)).ToString()
    $cssUri = [System.Uri]::UnescapeDataString($cssUri).Replace('\','/')
    $themeUri = [System.Uri]::UnescapeDataString($themeUri).Replace('\','/')

    # Apply dark attributes before CSS paints to avoid a light flash.
    if ($html -notmatch 'EQUALLEARN_FORCE_DARK_BOOTSTRAP') {
        $bootstrap = '<script id="EQUALLEARN_FORCE_DARK_BOOTSTRAP">document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";</script>'
        $html = [regex]::Replace($html, '(?i)(<head\b[^>]*>)', ('$1' + "`r`n  " + $bootstrap), 1)
    }

    if ($html -notmatch '(?i)forced-dark-theme\.css') {
        $link = '<link rel="stylesheet" href="' + $cssUri + '?v=1">'
        $html = [regex]::Replace($html, '(?i)</head>', ('  ' + $link + "`r`n</head>"), 1)
    }

    # Existing pages keep their current theme.js; add it to pages that lacked it.
    if ($html -notmatch '(?i)assets/js/theme\.js|\.\./assets/js/theme\.js|theme\.js') {
        $scriptTag = '<script type="module" src="' + $themeUri + '"></script>'
        if ($html -match '(?i)</body>') {
            $html = [regex]::Replace($html, '(?i)</body>', ($scriptTag + "`r`n</body>"), 1)
        } else {
            $html = [regex]::Replace($html, '(?i)</html>', ($scriptTag + "`r`n</html>"), 1)
        }
    }

    # Force browser chrome/status bar theme color on every app page.
    if ($html -match '(?i)<meta\b(?=[^>]*\bname=["'']theme-color["''])') {
        $html = [regex]::Replace(
            $html,
            '(?i)(<meta\b(?=[^>]*\bname=["'']theme-color["''])[^>]*\bcontent=["''])[^"'']*(["''][^>]*>)',
            '$1#0b1020$2',
            1
        )
    } else {
        $themeMeta = '<meta name="theme-color" content="#0b1020">'
        $html = [regex]::Replace($html, '(?i)(<head\b[^>]*>)', ('$1' + "`r`n  " + $themeMeta), 1)
    }

    if ($html -ne $original) {
        Write-TextFile $path $html
    }
}

# Lumi is a transparent iframe/widget. Keep its canvas transparent but darken
# its assistant conversation, forms, and game panels.
$lumiPath = Join-Path $Root 'assets\widgets\lumi.html'
if (Test-Path -LiteralPath $lumiPath) {
    $lumi = Get-Content -LiteralPath $lumiPath -Raw -Encoding UTF8
    if ($lumi -notmatch 'EQUALLEARN_FORCED_DARK_LUMI') {
        $lumiCss = @'
<style id="EQUALLEARN_FORCED_DARK_LUMI">
#lumi-assistant{background:linear-gradient(160deg,#121b2e,#0c1424)!important;color:#edf1fb!important;border-color:#36445e!important}
#lumi-chat-messages,#lumi-chat-form,#lumi-chat-foot,#lumi-games{background:#101a2d!important;color:#e8eef9!important;border-color:#2a3852!important}
.lumi-bot,.lumi-suggestions button,.lumi-game-cards button,#lumi-game-answers button,#lumi-game-feedback,#lumi-games-back{background:#1a2740!important;color:#e8eef9!important;border-color:#35445f!important}
#lumi-chat-input{background:#0b1425!important;color:#edf1fb!important;border-color:#3a4965!important}
#lumi-chat-input::placeholder{color:#91a0ba!important}
#lumi-game-menu h3,#lumi-game-play h3,#lumi-game-result h3{color:#f1f4fc!important}
#lumi-game-menu p,#lumi-game-play p,#lumi-game-result p{color:#aab7cc!important}
.lumi-game-progress{color:#c0b5ff!important}.lumi-game-progress-track{background:#26344d!important}
#lumi-label,#lumi-speech{background:rgba(20,29,48,.94)!important;color:#e9e5ff!important;border-color:#475270!important}
#lumi-fallback{background:radial-gradient(circle,#1a2740,#0b1020)!important;color:#c4b7ff!important}
</style>
'@
        $lumi = [regex]::Replace($lumi, '(?i)</head>', ($lumiCss + "`r`n</head>"), 1)
        Write-TextFile $lumiPath $lumi
    }
}

# Static app theme controller: never follow OS light/dark preferences.
$themeJs = @'
import { hydrateIcons } from './icons.js';

const THEME = 'dark';
const THEME_COLOR = '#0b1020';

function applyForcedDarkTheme() {
  const root = document.documentElement;
  root.dataset.theme = THEME;
  root.style.colorScheme = THEME;

  if (document.body) {
    document.body.dataset.theme = THEME;
    document.body.style.colorScheme = THEME;
  }

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', THEME_COLOR);
}

applyForcedDarkTheme();
window.addEventListener('pageshow', applyForcedDarkTheme);
hydrateIcons();
'@
Write-TextFile (Join-Path $Root 'assets\js\theme.js') $themeJs

# App manifest / browser chrome / installed PWA surface colors.
$manifestPath = Join-Path $Root 'manifest.webmanifest'
if (Test-Path $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    $manifest = $manifest -replace '"background_color"\s*:\s*"#[0-9a-fA-F]{3,8}"', '"background_color": "#0b1020"'
    $manifest = $manifest -replace '"theme_color"\s*:\s*"#[0-9a-fA-F]{3,8}"', '"theme_color": "#0b1020"'
    Write-TextFile $manifestPath $manifest
}

# Refresh the service-worker shell cache so devices fetch the new stylesheet.
$swPath = Join-Path $Root 'service-worker.js'
if (Test-Path $swPath) {
    $sw = Get-Content -LiteralPath $swPath -Raw -Encoding UTF8
    $sw = $sw -replace 'equallearn-shell-v\d+', 'equallearn-shell-v10'
    if ($sw -notmatch 'forced-dark-theme\.css') {
        $swReplacement = '"./assets/css/equallearn.css",' + "`r`n    " + '"./assets/css/forced-dark-theme.css",'
        $sw = $sw -replace '"\./assets/css/equallearn\.css",', $swReplacement
    }
    $sw = $sw -replace 'background:\s*#f5f7fb;', 'background: #0b1020;'
    $sw = $sw -replace 'color:\s*#243047;', 'color: #edf1fb;'
    Write-TextFile $swPath $sw
}

# Vite/React client is also forced to the same dark PTC-inspired palette.
$contextPath = Join-Path $Root 'web\src\context\ThemeContext.jsx'
$context = @'
import { createContext, useContext, useEffect, useMemo } from 'react';

const themes = [{ id: 'ptc', label: 'EqualLearn Dark' }];
const ThemeContext = createContext(null);
const DARK_THEME = 'ptc';

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.dataset.theme = DARK_THEME;
    document.documentElement.style.colorScheme = 'dark';
    if (document.body) {
      document.body.dataset.theme = 'dark';
      document.body.style.colorScheme = 'dark';
    }
    try { localStorage.setItem('equallearn-theme', DARK_THEME); } catch (_) {}
  }, []);

  const value = useMemo(() => ({ theme: DARK_THEME, setTheme: () => {}, themes }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
'@
Write-TextFile $contextPath $context

$pickerPath = Join-Path $Root 'web\src\components\ThemePicker.jsx'
$picker = @'
import { Check, Moon } from 'lucide-react';

export default function ThemePicker({ compact = false }) {
  return (
    <div className={`theme-options ${compact ? 'compact' : ''}`} aria-label="EqualLearn appearance">
      <button
        type="button"
        title="EqualLearn dark theme is always enabled"
        aria-label="EqualLearn Dark theme is enabled on all devices"
        aria-pressed="true"
        className="theme-option active"
        disabled
      >
        <span className="theme-swatch" style={{ background: 'linear-gradient(135deg,#263454 0 50%,#101a2d 50% 100%)' }}>
          <Moon size={compact ? 12 : 16} />
        </span>
        {!compact && <span className="theme-copy"><strong>EqualLearn Dark</strong><small>Always on · all devices</small></span>}
        {!compact && <Check className="theme-check" size={16} />}
      </button>
    </div>
  );
}
'@
Write-TextFile $pickerPath $picker

# Force the React app's initial palette to dark before React mounts.
$webStylesPath = Join-Path $Root 'web\src\styles.css'
if (Test-Path $webStylesPath) {
    $webStyles = Get-Content -LiteralPath $webStylesPath -Raw -Encoding UTF8
    $darkRoot = @'
:root {
  font-family: 'DM Sans', system-ui, sans-serif;
  color-scheme: dark;
  --bg:#0b1020; --surface:#141d30; --surface-2:#19243a; --text:#edf1fb; --muted:#a6b3c9;
  --primary:#9584ff; --primary-2:#6e9cff; --primary-soft:#2b2a50; --line:#2a3852;
  --shadow:0 18px 55px rgba(0,0,0,.28); --hero:#101a2d; --hero-text:#f1f4fc;
  --danger:#ff929c; --radius:22px; --radius-sm:14px;
}
'@
    $webStyles = [regex]::Replace($webStyles, ':root\s*\{[^}]*\}', $darkRoot)
    if ($webStyles -notmatch 'EQUALLEARN_FORCED_DARK_GLOBAL') {
        $webStyles += @'

/* EQUALLEARN_FORCED_DARK_GLOBAL */
:root,html,body,#root{color-scheme:dark!important;background:#0b1020;color:#edf1fb}
:root[data-theme='ptc']{color-scheme:dark;--bg:#0b1020;--surface:#141d30;--surface-2:#19243a;--text:#edf1fb;--muted:#a6b3c9;--primary:#9584ff;--primary-2:#6e9cff;--primary-soft:#2b2a50;--line:#2a3852;--hero:#101a2d;--hero-text:#f1f4fc}
body{background:var(--bg)!important;color:var(--text)!important}
.panel,.card,.feature-card,.person-card,.stat-card,.module-row,.empty-state,.auth-card,.sidebar,.topbar,.dropdown-menu,.modal-card{background:var(--surface)!important;color:var(--text)!important;border-color:var(--line)!important}
input,select,textarea{background:#101a2d!important;color:#edf1fb!important;border-color:#34445f!important;color-scheme:dark!important}
input::placeholder,textarea::placeholder{color:#8291ad!important}
label,.muted,.panel-intro,.auth-brand>p,.section-heading p,.app-promo p{color:var(--muted)!important}
.theme-option:disabled{opacity:1!important;cursor:default!important;filter:none!important}
'@
    }
    Write-TextFile $webStylesPath $webStyles
}

# Update the wording in the React settings screen to reflect the locked theme.
$appPath = Join-Path $Root 'web\src\App.jsx'
if (Test-Path $appPath) {
    $app = Get-Content -LiteralPath $appPath -Raw -Encoding UTF8
    $app = $app.Replace('Choose a comfortable theme here. Workspace themes stay out of the dashboard header so the interface remains focused.', 'EqualLearn uses a consistent dark appearance across phones, tablets, and computers. This setting is always enabled.')
    if ($app -ne (Get-Content -LiteralPath $appPath -Raw -Encoding UTF8)) { Write-TextFile $appPath $app }
}

# Keep shared theme-token defaults dark for any page/tool that reads this file.
$tokensPath = Join-Path $Root 'shared\theme-tokens.json'
if (Test-Path $tokensPath) {
    $tokens = Get-Content -LiteralPath $tokensPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $tokens.default = [pscustomobject]@{
        name = 'EqualLearn Dark'
        primary = '#9584ff'
        accent = '#6e9cff'
        background = '#0b1020'
        surface = '#141d30'
        text = '#edf1fb'
    }
    $json = $tokens | ConvertTo-Json -Depth 8
    Write-TextFile $tokensPath $json
}

# Make the separate Vite HTML document use the dark browser chrome as well.
$webHtmlPath = Join-Path $Root 'web\index.html'
if (Test-Path $webHtmlPath) {
    $webHtml = Get-Content -LiteralPath $webHtmlPath -Raw -Encoding UTF8
    $webHtml = $webHtml -replace '(<meta name="theme-color" content=")[^"]*(")', '${1}#0b1020${2}'
    if ($webHtml -notmatch 'data-theme="ptc"') {
        $webBootstrap = '<script>document.documentElement.dataset.theme="ptc";document.documentElement.style.colorScheme="dark";</script>'
        $webHtml = [regex]::Replace($webHtml, '(<head[^>]*>)', ('$1' + "`r`n    " + $webBootstrap), 1)
    }
    Write-TextFile $webHtmlPath $webHtml
}

Write-Host ''
Write-Host 'EqualLearn forced dark mode patch completed.' -ForegroundColor Green
Write-Host ("Changed files: {0}" -f $Changed.Count)
Write-Host ("Backup folder: {0}" -f $BackupRoot)
Write-Host 'Next: run npm run mobile:build-web, then test Admin, Teacher, Student, Login and Live pages.' -ForegroundColor Cyan

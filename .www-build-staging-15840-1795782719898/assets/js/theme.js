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

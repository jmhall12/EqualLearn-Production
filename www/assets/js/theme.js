
import { hydrateIcons } from './icons.js';

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

function applyDeviceTheme() {
  const theme = themeMedia.matches ? 'dark' : 'light';

  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;

  const themeColor = document.querySelector('meta[name="theme-color"]');

  if (themeColor) {
    themeColor.setAttribute(
      'content',
      theme === 'dark' ? '#171821' : '#e3e4ec'
    );
  }
}

// Initial theme
applyDeviceTheme();

// Automatically update when the device theme changes
if (typeof themeMedia.addEventListener === 'function') {
  themeMedia.addEventListener('change', applyDeviceTheme);
} else {
  // Older browser support
  themeMedia.addListener(applyDeviceTheme);
}

// Keep existing application icons working
hydrateIcons();

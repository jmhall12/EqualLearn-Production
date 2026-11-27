const toggle = document.getElementById("profileSettingsToggle");
const menu = document.getElementById("profileSettingsMenu");

function closeMenu() {
  if (!toggle || !menu) return;
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}

if (toggle && menu) {
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
  });

  menu.addEventListener("click", event => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("pointerdown", event => {
    if (!menu.hidden && !event.target.closest(".sp-settings-anchor")) closeMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });
}

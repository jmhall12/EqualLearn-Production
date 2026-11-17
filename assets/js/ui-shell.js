
import { auth } from "./firebase-config.js";
import { icon } from "./icons.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

/* =========================================================
   EQUALLEARN — GLOBAL APPLICATION SHELL
   Roles: Admin / Teacher / Student
   Keeps existing Firebase authentication and page scripts.
========================================================= */

(() => {
  "use strict";

  const path = window.location.pathname.toLowerCase();

  const role = path.includes("/admin/")
    ? "admin"
    : path.includes("/teacher/")
    ? "teacher"
    : path.includes("/student/")
    ? "student"
    : null;

  if (!role) return;

  const ROLE_CONFIG = {
    admin: {
      title: "Administrator",
      subtitle: "Administration workspace",
      links: [
        ["dashboard.html", "home", "Dashboard"],
        ["students.html", "users", "Students"],
        ["manage-teachers.html", "teacher", "Teachers"],
        ["register-teacher.html", "userPlus", "Register Teacher"],
        ["class-assignments.html", "classes", "Class Assignments"],
        ["check-content.html", "lesson", "Check Lessons & Modules"],
        ["reports.html", "chart", "Reports"],
        ["live.html", "video", "Live"],
        ["settings.html", "settings", "Settings"],
        ["create-content.html", "modules", "Modules"]
      ]
    },

   teacher: {
  title: "Teacher",
  subtitle: "Teaching workspace",
  links: [
    ["dashboard.html", "home", "Dashboard"],
    ["modules.html", "modules", "Learning Modules"],
    ["lessons.html", "lesson", "Lessons"],
    ["students.html", "users", "Students"],
    ["grading.html", "chart", "Activity Grading"]
  ]
},

    student: {
      title: "Student",
      subtitle: "Student workspace",
      links: [
        ["dashboard.html", "home", "Dashboard"],
        ["classwork.html", "modules", "Classwork"],
        ["progress.html", "chart", "Progress"],
        ["quizzes.html", "quizzes", "Quizzes"],
        ["live.html", "zap", "Live"],
        ["profile.html", "profile", "Profile"]
      ]
    }
  };

  const config = ROLE_CONFIG[role];
  const currentPage = path.split("/").pop() || "dashboard.html";
  const storageKey = `equallearn-sidebar-collapsed-${role}`;

  let shellBuilt = false;
  let sidebar;
  let main;
  let pageContent;
  let topbar;
  let profileObserver;

  /* -------------------------------------------------------
     UTILITIES
  ------------------------------------------------------- */

  const safeIcon = (name, size = 20) => {
    try {
      return icon(name, size);
    } catch (error) {
      console.warn("[EqualLearn Shell] Icon unavailable:", name);
      return `<span aria-hidden="true">◆</span>`;
    }
  };

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function getPageTitle() {
    let title = document.title || "Dashboard";

    title = title
      .replace(/\s*[|–—-]\s*EqualLearn/gi, "")
      .replace(/EqualLearn\s*[|–—-]\s*/gi, "")
      .trim();

    return title || "Dashboard";
  }

  function getPageHref(file) {
    return file;
  }

  function isActivePage(file) {
    return currentPage === file.toLowerCase();
  }

  
  
  /* -------------------------------------------------------
     REMOVE ONLY LEGACY SHELL ELEMENTS
     Do not remove page content or Firebase scripts.
  ------------------------------------------------------- */

  function isLegacyNavigation(element) {
    if (!(element instanceof HTMLElement)) return false;

    // Never remove actual application content.
    if (
      element.matches(
        ".el-dashboard, .el-page-content, .el-app-main, .el-app-shell, main"
      ) ||
      element.querySelector(
        ".el-dashboard, .el-page-content, .el-app-main"
      )
    ) {
      return false;
    }

    // Only detect old navigation containers.
    const links = [...element.querySelectorAll("a[href]")];

    if (links.length < 3) return false;

    const knownPages = [
      "dashboard.html",
      "classwork.html",
      "modules.html",
      "lessons.html",
      "students.html",
      "assignments.html",
      "assigments.html",
      "quizzes.html",
      "live.html",
      "logout.html"
    ];

    const matches = links.filter(link => {
      try {
        const page = new URL(
          link.getAttribute("href"),
          window.location.href
        ).pathname.split("/").pop().toLowerCase();

        return knownPages.includes(page);
      } catch {
        return false;
      }
    }).length;

    return matches >= 3;
  }

  /* -------------------------------------------------------
     LEGACY LOGO DETECTION
  ------------------------------------------------------- */


  function isLegacyLogoOnly(element) {
    if (!(element instanceof HTMLElement)) return false;

    if (element.matches("main, .el-app-shell, .el-app-main")) {
      return false;
    }

    const images = [...element.querySelectorAll("img")];

    if (!images.length) return false;

    const hasLogo = images.some(image => {
      const source = (
        image.getAttribute("src") ||
        ""
      ).toLowerCase();

      const alt = (
        image.getAttribute("alt") ||
        ""
      ).toLowerCase();

      return (
        source.includes("equallearn-logo") ||
        source.includes("equallearn_logo") ||
        (alt.includes("equallearn") && images.length === 1)
      );
    });

    if (!hasLogo) return false;

    const meaningfulText = (element.textContent || "")
      .replace(/\s+/g, "")
      .trim();

    const otherLinks = element.querySelectorAll("a").length;
    const formControls = element.querySelectorAll(
      "input, button, select, textarea"
    ).length;

    return (
      meaningfulText.length < 80 &&
      otherLinks === 0 &&
      formControls === 0
    );
  }

  function removeLegacyShellElements() {
    const directChildren = [...document.body.children];

    directChildren.forEach(element => {
      if (
        element.tagName === "SCRIPT" ||
        element.tagName === "STYLE" ||
        element.tagName === "LINK" ||
        element.classList.contains("el-app-shell")
      ) {
        return;
      }

      if (
        isLegacyNavigation(element) ||
        isLegacyLogoOnly(element)
      ) {
        element.remove();
      }
    });
  }

  /* -------------------------------------------------------
     PAGE CONTENT COLLECTION
  ------------------------------------------------------- */

  function collectPageNodes() {
  return [...document.body.children].filter(element => {
    if (!(element instanceof HTMLElement)) return false;

    // Lumi must remain outside the dashboard shell.
    if (element.id === "equallearn-lumi-frame") {
      return false;
    }

    if (
      ["SCRIPT", "STYLE", "LINK", "META"].includes(element.tagName)
    ) {
      return false;
    }

    if (
      element.classList.contains("el-app-shell") ||
      element.id === "equallearn-shell-theme"
    ) {
      return false;
    }

    return true;
  });
}

/* =========================================================
   LUMI — GLOBAL FLOATING COMPANION
   Desktop + Mobile Responsive
========================================================= */

function keepLumiOnTop() {
  const frame = document.getElementById("equallearn-lumi-frame");

  if (!frame) return;

  // Keep Lumi directly under BODY, outside dashboard containers.
  if (frame.parentElement !== document.body) {
    document.body.appendChild(frame);
  }

  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  let assistantOpen = false;

  try {
    assistantOpen = Boolean(
      frame.contentDocument
        ?.getElementById("lumi-root")
        ?.classList.contains("assistant-open")
    );
  } catch (_) {}

  Object.assign(frame.style, {
    position: "fixed",
    right: isMobile ? "8px" : "16px",
    bottom: isMobile ? "8px" : "16px",
    width: assistantOpen
      ? (isMobile ? "min(340px, calc(100vw - 16px))" : "360px")
      : (isMobile ? "145px" : "230px"),
    height: assistantOpen
      ? (isMobile ? "min(460px, calc(100dvh - 24px))" : "500px")
      : (isMobile ? "180px" : "280px"),
    display: "block",
    visibility: "visible",
    opacity: "1",
    border: "0",
    background: "transparent",
    zIndex: "2147483647",
    pointerEvents: "auto",
    overflow: "hidden",
    transform: "none"
  });

  frame.setAttribute("allowtransparency", "true");
}

function setupLumiCompanion() {
  keepLumiOnTop();

  // Automatically resize Lumi when device orientation or viewport changes.
  window.addEventListener("resize", keepLumiOnTop);
  window.addEventListener("orientationchange", keepLumiOnTop);

  // Detect if another script inserts or moves Lumi.
  const observer = new MutationObserver(() => {
    const frame = document.getElementById("equallearn-lumi-frame");

    if (frame && frame.parentElement !== document.body) {
      keepLumiOnTop();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

  /* -------------------------------------------------------
     SHELL STYLES
     These styles are intentionally scoped to the shell.
  ------------------------------------------------------- */

  function injectShellStyles() {
    if (document.getElementById("equallearn-shell-theme")) return;

    const style = document.createElement("style");
    style.id = "equallearn-shell-theme";

    style.textContent = `
      :root {
        --el-sidebar-width: 258px;
        --el-sidebar-mini: 88px;
        --el-bg: #171821;
        --el-panel: #1e1f2b;
        --el-panel-soft: #252635;
        --el-border: rgba(255,255,255,.075);
        --el-text: #f2f0fa;
        --el-muted: #a5a3b8;
        --el-purple: #a18bff;
        --el-purple-strong: #755cf0;
        --el-radius: 16px;
      }

      html {
        min-height: 100%;
        margin: 0;
        scroll-behavior: smooth;
      }

      body {
        min-height: 100vh;
        margin: 0 !important;
        padding: 0 !important;
        background: var(--el-bg) !important;
        color: var(--el-text);
        overflow-x: hidden;
      }

      body,
      body * {
        box-sizing: border-box;
      }

      .el-app-shell {
        display: grid !important;
        grid-template-columns: var(--el-sidebar-width) minmax(0, 1fr);
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 0;
        background: var(--el-bg);
        transition: grid-template-columns .25s ease;
      }

      .el-sidebar {
        position: sticky !important;
        inset: 0 auto auto 0;
        z-index: 1000;
        display: flex !important;
        flex-direction: column;
        width: 100%;
        height: 100vh;
        min-height: 100vh;
        padding: 22px 15px 17px;
        overflow-x: hidden;
        overflow-y: auto;
        color: var(--el-text);
        background: linear-gradient(180deg,#20212e 0%,#191a25 100%) !important;
        border-right: 1px solid var(--el-border);
        box-shadow: 8px 0 30px rgba(0,0,0,.12);
        scrollbar-width: thin;
        scrollbar-color: rgba(161,139,255,.28) transparent;
      }

      .el-sidebar-brand {
        display: flex;
        align-items: center;
        gap: 13px;
        min-height: 68px;
        padding: 3px 7px 20px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--el-border);
      }

      .el-wordmark-mark {
        display: grid;
        place-items: center;
        flex: 0 0 49px;
        width: 49px;
        height: 49px;
        overflow: hidden;
        border-radius: 15px;
        background: linear-gradient(140deg,#8f7aff,#5943d8);
        box-shadow: 0 8px 22px rgba(117,92,240,.25);
      }

      .el-wordmark-mark img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .el-wordmark-fallback {
        color: white;
        font-size: 25px;
        font-weight: 850;
      }

      .el-wordmark-text {
        color: #fff;
        font-size: 20px;
        font-weight: 850;
        letter-spacing: -.8px;
        white-space: nowrap;
      }

      .el-wordmark-text span {
        color: var(--el-purple);
      }

      .el-sidebar-collapse {
        position: absolute;
        top: 29px;
        right: 10px;
        display: grid;
        place-items: center;
        width: 27px;
        height: 27px;
        padding: 0;
        color: #c7bcff;
        background: #292a3a;
        border: 1px solid var(--el-border);
        border-radius: 9px;
        cursor: pointer;
      }

      .el-collapse-symbol {
        font-size: 21px;
        line-height: 1;
      }

      .el-role-chip {
        padding: 8px 11px;
        margin: 0 3px 17px;
        color: #a99af0;
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 1.5px;
        text-transform: uppercase;
      }

      .el-nav {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        min-width: 0;
      }

      .el-sidebar > .el-nav {
        flex: 1;
      }

      .el-sidebar .el-nav a {
        position: relative;
        display: flex !important;
        align-items: center;
        gap: 14px;
        width: 100%;
        min-height: 52px;
        padding: 11px 14px !important;
        margin: 0 !important;
        overflow: hidden;
        color: #b8b7ca !important;
        background: transparent !important;
        border: 1px solid transparent !important;
        border-radius: 14px !important;
        font-size: 13px;
        font-weight: 700;
        text-decoration: none !important;
        white-space: nowrap;
        transition: background .18s ease,color .18s ease,transform .18s ease;
      }

      .el-sidebar .el-nav a:hover {
        color: #fff !important;
        background: rgba(255,255,255,.055) !important;
        transform: translateX(2px);
      }

      .el-sidebar .el-nav a.active {
        color: #fff !important;
        background: linear-gradient(110deg,rgba(117,92,240,.23),rgba(117,92,240,.12)) !important;
        border-color: rgba(161,139,255,.12) !important;
        box-shadow: inset 3px 0 0 #9b84ff;
      }

      .el-nav-icon {
        display: grid;
        place-items: center;
        flex: 0 0 23px;
        width: 23px;
        height: 23px;
        color: #a99af0;
      }

      .el-nav-icon svg {
        display: block;
        width: 20px;
        height: 20px;
      }

      .el-nav-label {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .el-sidebar-bottom {
        flex-shrink: 0;
        padding-top: 16px;
        margin-top: 18px;
        border-top: 1px solid var(--el-border);
      }

      .el-sidebar-bottom a {
        color: #d3c9ff !important;
      }

      .el-sidebar-bottom a:hover {
        color: #fff !important;
        background: rgba(117,92,240,.14) !important;
      }

      .el-app-main {
        display: flex !important;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        min-height: 100vh;
        overflow-x: clip;
        background: var(--el-bg);
      }

      .el-topbar {
        position: sticky;
        top: 0;
        z-index: 500;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        width: 100%;
        min-height: 82px;
        padding: 14px 30px;
        color: var(--el-text);
        background: rgba(29,30,42,.94);
        border-bottom: 1px solid var(--el-border);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .el-topbar-title {
        display: flex;
        align-items: center;
        gap: 15px;
        min-width: 0;
      }

      .el-page-kicker {
        margin-bottom: 5px;
        color: #a99af0;
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 1.7px;
        text-transform: uppercase;
      }

      .el-page-title {
        overflow: hidden;
        color: #fff;
        font-size: 21px;
        font-weight: 850;
        line-height: 1.25;
        letter-spacing: -.55px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .el-topbar-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .el-user-pill {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 8px 13px;
        background: #252635;
        border: 1px solid var(--el-border);
        border-radius: 15px;
      }

      .el-user-pill small {
        display: block;
        margin-bottom: 2px;
        color: var(--el-muted);
        font-size: 10px;
      }

      .el-user-pill strong {
        display: block;
        max-width: 190px;
        overflow: hidden;
        color: #fff;
        font-size: 12px;
        font-weight: 800;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .el-avatar {
        display: grid;
        place-items: center;
        flex: 0 0 37px;
        width: 37px;
        height: 37px;
        color: #fff;
        background: linear-gradient(140deg,#8f7aff,#5943d8);
        border-radius: 12px;
        font-size: 15px;
        font-weight: 850;
      }

      .el-menu-toggle {
        display: none;
        place-items: center;
        width: 41px;
        height: 41px;
        padding: 0;
        color: #d3c9ff;
        background: #292a3a;
        border: 1px solid var(--el-border);
        border-radius: 12px;
        cursor: pointer;
      }

      .el-page-content {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        padding: 0;
        overflow-x: clip;
        background: var(--el-bg);
      }

      .el-page-content > * {
        min-width: 0;
        max-width: 100%;
      }

      body.el-sidebar-collapsed .el-app-shell {
        grid-template-columns: var(--el-sidebar-mini) minmax(0,1fr);
      }

      body.el-sidebar-collapsed .el-sidebar {
        padding-right: 10px;
        padding-left: 10px;
      }

      body.el-sidebar-collapsed .el-wordmark-text,
      body.el-sidebar-collapsed .el-role-chip,
      body.el-sidebar-collapsed .el-nav-label {
        display: none !important;
      }

      body.el-sidebar-collapsed .el-sidebar-brand {
        justify-content: center;
        padding-right: 0;
        padding-left: 0;
      }

      body.el-sidebar-collapsed .el-sidebar .el-nav a {
        justify-content: center;
        padding-right: 5px !important;
        padding-left: 5px !important;
      }

      body.el-sidebar-collapsed .el-sidebar-collapse {
        right: 3px;
      }

      .el-route-progress {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        width: 0;
        height: 3px;
        opacity: 0;
        background: linear-gradient(90deg,#705cf0,#b49aff,#67d8ff);
        box-shadow: 0 0 12px rgba(161,139,255,.6);
        transition: width .25s ease,opacity .2s ease;
      }

      body.el-route-loading .el-route-progress {
        width: 78%;
        opacity: 1;
      }

      .el-sidebar a:focus-visible,
      .el-sidebar button:focus-visible,
      .el-menu-toggle:focus-visible {
        outline: 3px solid rgba(161,139,255,.65);
        outline-offset: 3px;
      }

      @media (max-width: 900px) {
        .el-app-shell,
        body.el-sidebar-collapsed .el-app-shell {
          display: block !important;
          min-height: 100vh;
        }

        .el-sidebar,
        body.el-sidebar-collapsed .el-sidebar {
          position: fixed !important;
          top: 0;
          left: 0;
          z-index: 1200;
          width: min(290px,84vw) !important;
          height: 100dvh;
          min-height: 100dvh;
          padding: 22px 15px 17px;
          transform: translateX(-110%);
          transition: transform .25s ease;
          box-shadow: 18px 0 45px rgba(0,0,0,.32);
        }

        body.el-nav-open .el-sidebar {
          transform: translateX(0);
        }

        body.el-sidebar-collapsed .el-wordmark-text,
        body.el-sidebar-collapsed .el-role-chip,
        body.el-sidebar-collapsed .el-nav-label {
          display: block !important;
        }

        body.el-sidebar-collapsed .el-sidebar .el-nav a {
          justify-content: flex-start;
          padding: 11px 14px !important;
        }

        .el-menu-toggle {
          display: grid;
        }

        .el-topbar {
          min-height: 70px;
          padding: 11px 17px;
        }

        .el-page-title {
          font-size: 18px;
        }

        body.el-nav-open::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: 1100;
          background: rgba(5,6,15,.58);
          backdrop-filter: blur(3px);
        }

        body.el-nav-open .el-sidebar {
          z-index: 1200;
        }
      }

      @media (max-width: 520px) {
        .el-topbar {
          gap: 8px;
          padding: 10px 12px;
        }

        .el-topbar-title {
          gap: 10px;
        }

        .el-page-title {
          max-width: 52vw;
          font-size: 15px;
        }

        .el-user-pill {
          gap: 0;
          padding: 5px;
        }

        .el-user-pill > div {
          display: none;
        }

        .el-avatar {
          width: 34px;
          height: 34px;
          min-width: 34px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .el-app-shell *,
        .el-sidebar *,
        .el-app-main * {
          scroll-behavior: auto !important;
          animation-duration: .01ms !important;
          transition-duration: .01ms !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* -------------------------------------------------------
     SIDEBAR MARKUP
  ------------------------------------------------------- */

  function buildSidebar() {
    sidebar = document.createElement("aside");
    sidebar.className = "el-sidebar";
    sidebar.setAttribute("aria-label", `${config.title} navigation`);

    const navMarkup = config.links.map(([href, iconName, label]) => `
      <a
        href="${escapeHTML(getPageHref(href))}"
        class="${isActivePage(href) ? "active" : ""}"
        ${isActivePage(href) ? 'aria-current="page"' : ""}
        title="${escapeHTML(label)}">
        <span class="el-nav-icon">${safeIcon(iconName, 20)}</span>
        <span class="el-nav-label">${escapeHTML(label)}</span>
      </a>
    `).join("");

    sidebar.innerHTML = `
      <div class="el-sidebar-brand">
        <span class="el-wordmark-mark">
          <img
            src="../assets/icons/equallearn-logo.png"
            alt=""
            onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
          <span class="el-wordmark-fallback" style="display:none">E</span>
        </span>

        <span class="el-wordmark-text">
          Equal<span>Learn</span>
        </span>
      </div>

      <button
        class="el-sidebar-collapse"
        type="button"
        aria-label="Collapse sidebar"
        aria-expanded="true"
        title="Collapse sidebar">
        <span class="el-collapse-symbol">‹</span>
      </button>

      <div class="el-role-chip">${escapeHTML(config.subtitle)}</div>

      <nav class="el-nav" aria-label="Main navigation">
        ${navMarkup}
      </nav>

      <div class="el-sidebar-bottom">
        <nav class="el-nav" aria-label="Account navigation">
          <a href="#" data-el-logout title="Logout">
            <span class="el-nav-icon">${safeIcon("logout", 20)}</span>
            <span class="el-nav-label">Logout</span>
          </a>
        </nav>
      </div>
    `;

    return sidebar;
  }

  /* -------------------------------------------------------
     TOPBAR
  ------------------------------------------------------- */

  function buildTopbar() {
    topbar = document.createElement("header");
    topbar.className = "el-topbar";

    const pageTitle = escapeHTML(getPageTitle());

    topbar.innerHTML = `
      <div class="el-topbar-title">
        <button
          class="el-menu-toggle"
          type="button"
          aria-label="Open navigation menu"
          aria-expanded="false">
          ${safeIcon("menu", 21)}
        </button>

        <div>
          <div class="el-page-kicker">EqualLearn</div>
          <div class="el-page-title">${pageTitle}</div>
        </div>
      </div>

      <div class="el-topbar-actions">
        <div class="el-user-pill">
          <span class="el-avatar">${config.title.charAt(0)}</span>
          <div>
            <small>${escapeHTML(config.title)}</small>
            <strong data-el-user-name>${escapeHTML(config.title)}</strong>
          </div>
        </div>
      </div>
    `;

    return topbar;
  }

  /* -------------------------------------------------------
     SIDEBAR INTERACTIONS
  ------------------------------------------------------- */

  function setupSidebar() {
    const collapseButton = sidebar.querySelector(".el-sidebar-collapse");
    const collapseSymbol = sidebar.querySelector(".el-collapse-symbol");
    const menuToggle = topbar.querySelector(".el-menu-toggle");

    function setCollapsed(collapsed, persist = true) {
      document.body.classList.toggle("el-sidebar-collapsed", collapsed);

      collapseSymbol.textContent = collapsed ? "›" : "‹";

      collapseButton.setAttribute(
        "aria-expanded",
        String(!collapsed)
      );

      collapseButton.setAttribute(
        "aria-label",
        collapsed ? "Expand sidebar" : "Collapse sidebar"
      );

      collapseButton.title = collapsed
        ? "Expand sidebar"
        : "Collapse sidebar";

      if (persist) {
        try {
          localStorage.setItem(storageKey, String(collapsed));
        } catch (error) {
          console.warn("Sidebar preference could not be saved.");
        }
      }
    }

    let saved = false;

    try {
      saved = localStorage.getItem(storageKey) === "true";
    } catch (_) {}

    setCollapsed(saved, false);

    collapseButton.addEventListener("click", () => {
      const isCollapsed = document.body.classList.contains(
        "el-sidebar-collapsed"
      );

      setCollapsed(!isCollapsed);
    });

    function closeMobileMenu() {
      document.body.classList.remove("el-nav-open");
      menuToggle.setAttribute("aria-expanded", "false");
    }

    menuToggle.addEventListener("click", event => {
      event.stopPropagation();

      const isOpen = document.body.classList.toggle("el-nav-open");

      menuToggle.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("click", event => {
      if (
        window.innerWidth <= 900 &&
        document.body.classList.contains("el-nav-open") &&
        !sidebar.contains(event.target) &&
        !event.target.closest(".el-menu-toggle")
      ) {
        closeMobileMenu();
      }
    });

    sidebar.querySelectorAll(".el-nav a").forEach(link => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 900) {
          closeMobileMenu();
        }
      });
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeMobileMenu();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) {
        closeMobileMenu();
      }
    });
  }

  /* -------------------------------------------------------
     LOGOUT
  ------------------------------------------------------- */

  function setupLogout() {
    const logoutLink = sidebar.querySelector("[data-el-logout]");

    logoutLink.addEventListener("click", async event => {
      event.preventDefault();

      logoutLink.style.pointerEvents = "none";
      logoutLink.style.opacity = ".65";

      try {
        await signOut(auth);
      } catch (error) {
        console.error("[EqualLearn] Logout error:", error);
      }

      window.location.href = "../login.html";
    });
  }

  /* -------------------------------------------------------
     USER NAME SYNC
  ------------------------------------------------------- */

 
function setupUserNameSync() {
  const selectors = [
    "#adminName",
    "#teacherName",
    "#studentName",
    "#sidebarName",
    "#userName",
    "[data-user-name]"
  ].join(",");

  const shellName = topbar.querySelector("[data-el-user-name]");

  if (!shellName) return;

  const updateName = () => {
    const source = document.querySelector(selectors);

    if (!source || shellName.contains(source)) return;

    const value = (source.textContent || "").trim();

    if (
      value &&
      !value.toLowerCase().includes("loading") &&
      value.length < 100 &&
      shellName.textContent.trim() !== value
    ) {
      // Update only when the name actually changes.
      // Prevents an infinite MutationObserver loop.
      shellName.textContent = value;
    }
  };

  updateName();

  profileObserver = new MutationObserver(() => {
    updateName();
  });

  profileObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}


  /* -------------------------------------------------------
     ROUTE LOADING
  ------------------------------------------------------- */

  function setupRouteProgress() {
    const progress = document.createElement("div");

    progress.className = "el-route-progress";
    progress.setAttribute("aria-hidden", "true");

    document.body.appendChild(progress);

    document.addEventListener("click", event => {
      const link = event.target.closest("a[href]");

      if (
        !link ||
        link.hasAttribute("download") ||
        link.target === "_blank" ||
        link.hasAttribute("data-el-logout")
      ) {
        return;
      }

      const href = link.getAttribute("href");

      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      try {
        const target = new URL(href, location.href);

        if (
          target.origin === location.origin &&
          target.href !== location.href
        ) {
          document.body.classList.add("el-route-loading");
        }
      } catch (_) {}
    });

    window.addEventListener("pageshow", () => {
      document.body.classList.remove("el-route-loading");
    });
  }

  /* -------------------------------------------------------
     BUILD APPLICATION SHELL
  ------------------------------------------------------- */

  function buildShell() {
    if (shellBuilt || !document.body) return;

    shellBuilt = true;

    removeLegacyShellElements();

    const pageNodes = collectPageNodes();

    const shell = document.createElement("div");
    shell.className = "el-app-shell";

    main = document.createElement("main");
    main.className = "el-app-main";

    pageContent = document.createElement("div");
    pageContent.className = "el-page-content";

    shell.appendChild(buildSidebar());
    main.appendChild(buildTopbar());
    main.appendChild(pageContent);
    shell.appendChild(main);

    document.body.insertBefore(shell, document.body.firstChild);

    pageNodes.forEach(node => {
      if (node !== shell && node.parentNode === document.body) {
        pageContent.appendChild(node);
      }
    });

    setupSidebar();
setupLogout();
setupUserNameSync();
setupRouteProgress();

// Initialize Lumi outside the dashboard shell.
setupLumiCompanion();

    console.info(
      `[EqualLearn Shell] ${role} shell initialized successfully.`
    );
  }

  /* -------------------------------------------------------
     AUTH PROFILE ROLE CHECK
     Shell does not redirect based on profile timing.
     Existing page authentication remains responsible for access.
  ------------------------------------------------------- */

  function initialize() {
    injectShellStyles();
    buildShell();

    onAuthStateChanged(auth, user => {
      if (!user) return;

      // The page's own authentication logic remains unchanged.
      // This listener only keeps the shell's display name in sync.
      const displayName = user.displayName;

      if (displayName) {
        const nameElement = document.querySelector("[data-el-user-name]");

        if (nameElement) {
          const current = nameElement.textContent.trim();

          if (!current || current === config.title) {
            nameElement.textContent = displayName;
          }
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {
      once: true
    });
  } else {
    initialize();
  }
})();




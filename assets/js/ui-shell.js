
import { auth } from "./firebase-config.js";
import { icon } from "./icons.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const path = location.pathname.toLowerCase();

const role = path.includes('/admin/')
  ? 'admin'
  : path.includes('/teacher/')
  ? 'teacher'
  : path.includes('/student/')
  ? 'student'
  : null;

const labels = {
  admin: {
    title: 'Administrator',
    nav: [
      ['dashboard.html', 'home', 'Dashboard'],
      ['students.html', 'users', 'Students'],
      ['manage-teachers.html', 'teacher', 'Teachers'],
      ['register-teacher.html', 'userPlus', 'Register Teacher'],
      ['class-assignments.html', 'classes', 'Class Assignments'],
      ['check-content.html', 'lesson', 'Check Lessons & Modules'],
      ['reports.html', 'chart', 'Reports'],
      ['live.html', 'video', 'Live'],
      ['settings.html', 'settings', 'Settings']
    ]
  },

  teacher: {
    title: 'Teacher',
    nav: [
      ['dashboard.html', 'home', 'Dashboard'],
      ['modules.html', 'modules', 'Modules'],
      ['lessons.html', 'lesson', 'Lessons'],
      ['students.html', 'users', 'Students'],
      ['quiz_builder.html', 'quiz', 'Quiz Builder']
    ]
  },

  student: {
    title: 'Student',
    nav: [
      ['dashboard.html', 'home', 'Dashboard'],
      ['modules.html', 'modules', 'Modules'],
      ['live.html', 'video', 'Live'],
      ['progress.html', 'progress', 'Progress'],
      ['profile.html', 'profile', 'Profile']
    ]
  }
};

// ========================================
// EQUALLEARN SHELL THEME
// ========================================

function injectShellStyles() {
  if (document.getElementById('equallearn-shell-theme')) return;

  const style = document.createElement('style');
  style.id = 'equallearn-shell-theme';

  style.textContent = `
    /* TOP HEADER */
    body .el-app-shell .el-app-main .el-topbar {
      min-height: 76px !important;
      height: auto !important;
      padding: 14px 22px !important;
      margin-bottom: 24px !important;

      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 16px !important;

      background: #111a2e !important;
      color: #f8fafc !important;

      border: 1px solid #263550 !important;
      border-radius: 16px !important;

      box-shadow: 0 8px 25px rgba(0,0,0,.16) !important;
    }

    /* HEADER TITLE GROUP */
    body .el-app-shell .el-topbar-title {
      display: flex !important;
      align-items: center !important;
      gap: 14px !important;
      min-width: 0 !important;
    }

    /* EQUALLEARN SMALL LABEL */
    body .el-app-shell .el-page-kicker {
      color: #aab7d0 !important;
      font-size: 12px !important;
      font-weight: 800 !important;
      letter-spacing: .1em !important;
      text-transform: uppercase !important;
      margin-bottom: 5px !important;
    }

    /* PAGE TITLE */
    body .el-app-shell .el-page-title {
      color: #ffffff !important;
      font-size: 23px !important;
      font-weight: 800 !important;
      line-height: 1.3 !important;
      letter-spacing: -.5px !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }

    /* TEACHER / ADMIN / STUDENT PROFILE */
    body .el-app-shell .el-user-pill {
      display: flex !important;
      align-items: center !important;
      gap: 11px !important;

      padding: 8px 13px !important;

      background: #0b1427 !important;
      border: 1px solid #34415e !important;
      border-radius: 15px !important;

      color: #ffffff !important;
    }

    body .el-app-shell .el-user-pill small {
      display: block !important;
      color: #aab7d0 !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
    }

    body .el-app-shell .el-user-pill strong {
      display: block !important;
      color: #ffffff !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      line-height: 1.4 !important;
    }

    body .el-app-shell .el-avatar {
      background: linear-gradient(135deg, #ddd6fe, #c7d2fe) !important;
      color: #4f46e5 !important;
      border-radius: 11px !important;
    }

    /* MOBILE MENU BUTTON */
    body .el-app-shell .el-menu-toggle {
      background: #18243b !important;
      color: #ffffff !important;
      border: 1px solid #34415e !important;
    }

    /* MOBILE RESPONSIVENESS */
    @media (max-width: 900px) {
      body .el-app-shell .el-topbar {
        min-height: 64px !important;
        padding: 10px 13px !important;
        margin-bottom: 16px !important;
      }

      body .el-app-shell .el-page-title {
        font-size: 18px !important;
      }

      body .el-app-shell .el-page-kicker {
        font-size: 10px !important;
      }

      body .el-app-shell .el-user-pill {
        padding: 6px 8px !important;
      }
    }

    @media (max-width: 520px) {
      body .el-app-shell .el-topbar {
        gap: 8px !important;
      }

      body .el-app-shell .el-topbar-title {
        gap: 8px !important;
      }

      body .el-app-shell .el-page-title {
        font-size: 15px !important;
      }

      body .el-app-shell .el-user-pill strong {
        display: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

// ========================================
// APPLICATION SHELL
// ========================================

if (role) {
  injectShellStyles();

  const bodyChildren = [...document.body.children];

  const contentNodes = bodyChildren.filter(el =>
    el.tagName !== 'SCRIPT' &&
    !el.classList.contains('el-sidebar') &&
    !el.classList.contains('el-app-shell')
  );

  const content = contentNodes[0];

  if (content) {
    const shell = document.createElement('div');
    shell.className = 'el-app-shell';

    const aside = document.createElement('aside');
    aside.className = 'el-sidebar';

    const current = path.split('/').pop() || 'dashboard.html';

    aside.innerHTML = `
      <div class="el-sidebar-brand">
        <span class="el-wordmark-mark">
          <img src="../assets/icons/equallearn-logo.png" alt="EqualLearn">
        </span>
        <span class="el-wordmark-text">EqualLearn</span>
      </div>

      <button
        class="el-sidebar-collapse"
        type="button"
        aria-label="Collapse sidebar"
        aria-expanded="true"
        title="Collapse sidebar">
        <span class="el-collapse-symbol">‹</span>
      </button>

      <div class="el-role-chip">
        ${labels[role].title} workspace
      </div>

      <nav class="el-nav">
        ${labels[role].nav.map(([href, iconName, name]) => `
          <a
            href="${href}"
            class="${current === href ? 'active' : ''}"
            title="${name}"
            aria-label="${name}">
            <span class="el-nav-icon">
              ${icon(iconName, 19)}
            </span>
            <span class="el-nav-label">${name}</span>
          </a>
        `).join('')}
      </nav>

      <div class="el-sidebar-bottom el-nav">
        <a href="../login.html" data-el-logout title="Logout">
          <span class="el-nav-icon">${icon('logout', 19)}</span>
          <span class="el-nav-label">Logout</span>
        </a>
      </div>
    `;

    const main = document.createElement('main');
    main.className = 'el-app-main';

    const top = document.createElement('div');
    top.className = 'el-topbar';

    const title = document.title
      .replace(' - EqualLearn', '')
      .replace('EqualLearn - ', '');

    top.innerHTML = `
      <div class="el-topbar-title">
        <button
          class="el-menu-toggle"
          type="button"
          aria-label="Open menu">
          ${icon('menu', 20)}
        </button>

        <div>
          <div class="el-page-kicker">EqualLearn</div>
          <div class="el-page-title">${title}</div>
        </div>
      </div>

      <div class="el-topbar-actions">
        <div class="el-user-pill">
          <span class="el-avatar">${labels[role].title[0]}</span>
          <div>
            <small>${labels[role].title}</small>
            <strong data-el-user-name>${labels[role].title}</strong>
          </div>
        </div>
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'el-page-content';

    // Insert shell
    content.parentNode.insertBefore(shell, content);
    shell.append(aside, main);
    main.append(top, wrapper);

    contentNodes.forEach(node => wrapper.append(node));

    // ========================================
    // DESKTOP COLLAPSE / EXPAND
    // ========================================

    const collapseButton = aside.querySelector('.el-sidebar-collapse');
    const collapseSymbol = aside.querySelector('.el-collapse-symbol');

    const storageKey = `equallearn-sidebar-collapsed-${role}`;

    function setSidebarState(collapsed, save = true) {
      document.body.classList.toggle(
        'el-sidebar-collapsed',
        collapsed
      );

      collapseSymbol.textContent = collapsed ? '›' : '‹';

      collapseButton.setAttribute(
        'aria-expanded',
        String(!collapsed)
      );

      collapseButton.setAttribute(
        'aria-label',
        collapsed ? 'Expand sidebar' : 'Collapse sidebar'
      );

      collapseButton.title = collapsed
        ? 'Expand sidebar'
        : 'Collapse sidebar';

      if (save) {
        localStorage.setItem(storageKey, String(collapsed));
      }
    }

    const savedState = localStorage.getItem(storageKey);

    setSidebarState(savedState === 'true', false);

    collapseButton.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains(
        'el-sidebar-collapsed'
      );

      setSidebarState(collapsed);
    });

    // ========================================
    // MOBILE MENU
    // ========================================

    const menuToggle = top.querySelector('.el-menu-toggle');

    menuToggle.addEventListener('click', () => {
      document.body.classList.toggle('el-nav-open');
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', event => {
      if (
        window.innerWidth <= 900 &&
        document.body.classList.contains('el-nav-open') &&
        !aside.contains(event.target) &&
        !event.target.closest('.el-menu-toggle')
      ) {
        document.body.classList.remove('el-nav-open');
      }
    });

    // Close mobile drawer after selecting a page
    aside.querySelectorAll('.el-nav a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          document.body.classList.remove('el-nav-open');
        }
      });
    });
  }
}

// ========================================
// LOGOUT
// ========================================

const logoutLink = document.querySelector('[data-el-logout]');

if (logoutLink) {
  logoutLink.addEventListener('click', async event => {
    event.preventDefault();

    try {
      await signOut(auth);
    } catch (error) {
      console.warn('Logout warning:', error);
    }

    window.location.href = '../login.html';
  });
}

// ========================================
// USER NAME SYNC
// ========================================

const sourceName = document.querySelector(
  '#adminName, #teacherName, #studentName'
);

const shellName = document.querySelector('[data-el-user-name]');

if (sourceName && shellName) {
  const syncName = () => {
    const value = sourceName.textContent.trim();

    if (value && !value.toLowerCase().includes('loading')) {
      shellName.textContent = value;
    }
  };

  syncName();

  new MutationObserver(syncName).observe(sourceName, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// ========================================
// ROUTE LOADING INDICATOR
// ========================================

const routeProgress = document.createElement('div');

routeProgress.className = 'el-route-progress';
routeProgress.setAttribute('aria-hidden', 'true');

document.body.appendChild(routeProgress);

document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');

  if (
    !link ||
    link.hasAttribute('download') ||
    link.target === '_blank' ||
    link.dataset.elLogout !== undefined
  ) {
    return;
  }

  const href = link.getAttribute('href');

  if (
    !href ||
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:')
  ) {
    return;
  }

  try {
    const target = new URL(link.href, location.href);

    if (
      target.origin === location.origin &&
      target.href !== location.href
    ) {
      document.body.classList.add('el-route-loading');
    }
  } catch (_) {}
});

window.addEventListener('pageshow', () => {
  document.body.classList.remove('el-route-loading');
});

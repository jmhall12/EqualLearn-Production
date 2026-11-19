
const logoUrl = new URL("../icons/equallearn-logo.png", import.meta.url).href;

const LOADER_STYLES = `
  #equalLearnLoader {
    --el-accent: #729cff;
    --el-accent-2: #a78bfa;
    position: fixed;
    inset: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: hidden;
    isolation: isolate;
    background:
      radial-gradient(ellipse at 15% 20%, rgba(70, 105, 210, .20), transparent 45%),
      radial-gradient(ellipse at 85% 80%, rgba(139, 92, 246, .16), transparent 45%),
      #0b1120;
    color: #fff;
    opacity: 1;
    visibility: visible;
    transition: opacity .35s ease, visibility .35s ease;
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  #equalLearnLoader.hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }

  #equalLearnLoader * {
    box-sizing: border-box;
  }

  #equalLearnLoader .loader-orb {
    position: absolute;
    width: 320px;
    height: 320px;
    border-radius: 50%;
    filter: blur(85px);
    opacity: .16;
    pointer-events: none;
    animation: elOrbFloat 8s ease-in-out infinite alternate;
  }

  #equalLearnLoader .loader-orb.one {
    background: #3979ff;
    top: -150px;
    left: -100px;
  }

  #equalLearnLoader .loader-orb.two {
    background: #8b5cf6;
    bottom: -170px;
    right: -100px;
    animation-delay: -4s;
  }

  #equalLearnLoader .loader-content {
    position: relative;
    z-index: 2;
    width: min(100%, 390px);
    padding: 42px 30px 35px;
    text-align: center;
    border: 1px solid rgba(255,255,255,.10);
    border-radius: 28px;
    background: rgba(255,255,255,.045);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 25px 80px rgba(0,0,0,.32),
      inset 0 1px 0 rgba(255,255,255,.07);
    animation: elCardEnter .7s cubic-bezier(.2,.8,.2,1) both;
  }

  #equalLearnLoader .loader-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    margin-bottom: 37px;
  }

  #equalLearnLoader .loader-logo-wrap {
    position: relative;
    width: 70px;
    height: 70px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  #equalLearnLoader .loader-logo-ring {
    position: absolute;
    inset: -5px;
    border: 1px solid rgba(114,156,255,.4);
    border-radius: 22px;
    animation: elRingPulse 2.5s ease-in-out infinite;
  }

  #equalLearnLoader .loader-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 18px;
    filter: drop-shadow(0 5px 16px rgba(75,120,255,.28));
    animation: elLogoFloat 3s ease-in-out infinite;
  }

  #equalLearnLoader .loader-wordmark {
    text-align: left;
  }

  #equalLearnLoader .loader-title {
    margin: 0;
    color: #fff;
    font-size: 25px;
    font-weight: 800;
    letter-spacing: -.8px;
  }

  #equalLearnLoader .loader-wordmark small {
    display: block;
    margin-top: 5px;
    color: #91a8ca;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
  }

  #equalLearnLoader .loader-message {
    margin: 0 0 9px;
    color: #f3f6ff;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -.3px;
  }

  #equalLearnLoader .loader-status {
    min-height: 20px;
    margin: 0 0 28px;
    color: #93a5c2;
    font-size: 12px;
    line-height: 1.6;
  }

  #equalLearnLoader .loader-progress {
    position: relative;
    width: 100%;
    height: 5px;
    overflow: hidden;
    border-radius: 20px;
    background: rgba(255,255,255,.09);
  }

  #equalLearnLoader .loader-progress span {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -40%;
    width: 40%;
    border-radius: inherit;
    background: linear-gradient(90deg,
      transparent,
      #729cff,
      #a78bfa,
      transparent
    );
    box-shadow: 0 0 16px rgba(114,156,255,.55);
    animation: elProgress 1.6s ease-in-out infinite;
  }

  #equalLearnLoader .loader-dots {
    display: flex;
    justify-content: center;
    gap: 7px;
    margin-top: 23px;
  }

  #equalLearnLoader .loader-dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #729cff;
    animation: elDotBounce 1.2s ease-in-out infinite;
  }

  #equalLearnLoader .loader-dots i:nth-child(2) {
    animation-delay: .15s;
    background: #9295fa;
  }

  #equalLearnLoader .loader-dots i:nth-child(3) {
    animation-delay: .3s;
    background: #b39aff;
  }

  #equalLearnLoader .loader-footer {
    margin-top: 35px;
    color: #637693;
    font-size: 10px;
    letter-spacing: 1.2px;
    font-weight: 600;
  }

  @keyframes elCardEnter {
    from { opacity: 0; transform: translateY(22px) scale(.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes elLogoFloat {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }

  @keyframes elRingPulse {
    0%,100% { transform: scale(1); opacity: .4; }
    50% { transform: scale(1.09); opacity: .9; }
  }

  @keyframes elProgress {
    0% { left: -40%; }
    100% { left: 110%; }
  }

  @keyframes elDotBounce {
    0%,60%,100% { transform: translateY(0); opacity: .45; }
    30% { transform: translateY(-6px); opacity: 1; }
  }

  @keyframes elOrbFloat {
    from { transform: translate(0,0); }
    to { transform: translate(35px,-25px); }
  }

  @media (max-width: 480px) {
    #equalLearnLoader {
      padding: 18px;
    }

    #equalLearnLoader .loader-content {
      padding: 36px 23px 30px;
      border-radius: 24px;
    }

    #equalLearnLoader .loader-title {
      font-size: 23px;
    }

    #equalLearnLoader .loader-message {
      font-size: 17px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    #equalLearnLoader *,
    #equalLearnLoader *::before,
    #equalLearnLoader *::after {
      animation: none !important;
      transition: none !important;
    }

    #equalLearnLoader .loader-progress span {
      width: 65%;
      left: 17.5%;
    }
  }
`;

function installLoaderStyles() {
  if (document.getElementById("equalLearnLoaderStyles")) return;

  const style = document.createElement("style");
  style.id = "equalLearnLoaderStyles";
  style.textContent = LOADER_STYLES;
  document.head.appendChild(style);
}

export function showLoadingScreen(
  message = "Welcome to EqualLearn",
  status = "Preparing your workspace…"
) {
  installLoaderStyles();

  let loader = document.getElementById("equalLearnLoader");

  if (!loader) {
    loader = document.createElement("div");
    loader.id = "equalLearnLoader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");

    loader.innerHTML = `
      <div class="loader-orb one"></div>
      <div class="loader-orb two"></div>

      <div class="loader-content">
        <div class="loader-brand">
          <div class="loader-logo-wrap">
            <div class="loader-logo-ring"></div>
            <img
              class="loader-logo"
              src="${logoUrl}"
              alt="EqualLearn logo"
            >
          </div>

          <div class="loader-wordmark">
            <h1 class="loader-title">EqualLearn</h1>
            <small>LEARN • TEACH • GROW</small>
          </div>
        </div>

        <p class="loader-message"></p>
        <p class="loader-status"></p>

        <div class="loader-progress" aria-hidden="true">
          <span></span>
        </div>

        <div class="loader-dots" aria-hidden="true">
          <i></i><i></i><i></i>
        </div>

        <div class="loader-footer">
          YOUR LEARNING SPACE, REIMAGINED
        </div>
      </div>
    `;

    document.body.appendChild(loader);
  }

  loader.querySelector(".loader-message").textContent = message;
  loader.querySelector(".loader-status").textContent = status;

  loader.classList.remove("hidden");

  return loader;
}

export function updateLoadingScreen(message, status) {
  const loader = document.getElementById("equalLearnLoader");

  if (!loader) return;

  if (message) {
    loader.querySelector(".loader-message").textContent = message;
  }

  if (status) {
    loader.querySelector(".loader-status").textContent = status;
  }
}

export function hideLoadingScreen() {
  const loader = document.getElementById("equalLearnLoader");

  if (!loader) return;

  loader.classList.add("hidden");

  window.setTimeout(() => {
    if (loader.classList.contains("hidden")) {
      loader.remove();
    }
  }, 360);
}

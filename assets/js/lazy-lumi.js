(() => {
  "use strict";

  const launcher = document.getElementById("lumiDeferredLauncher");
  if (!launcher) return;

  let frame = null;
  let loading = false;
  let opened = false;

  function restoreLauncher(message) {
    loading = false;
    launcher.disabled = false;
    const label = launcher.querySelector("span");
    if (label) label.textContent = message || "Ask Lumi";
  }

  launcher.addEventListener("click", () => {
    if (loading || opened) return;

    loading = true;
    launcher.disabled = true;
    const label = launcher.querySelector("span");
    if (label) label.textContent = "Opening Lumi…";

    const isMobile = window.matchMedia("(max-width: 600px)").matches;
    frame = document.createElement("iframe");
    frame.id = "equallearn-lumi-frame";
    frame.title = "Lumi — EqualLearn Companion";
    frame.setAttribute("allow", "autoplay");
    frame.setAttribute("allowtransparency", "true");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("loading", "eager");
    frame.referrerPolicy = "strict-origin-when-cross-origin";

    Object.assign(frame.style, {
      position: "fixed",
      right: isMobile ? "8px" : "16px",
      bottom: isMobile ? "8px" : "16px",
      width: isMobile ? "145px" : "176px",
      height: isMobile ? "184px" : "224px",
      border: "0",
      background: "transparent",
      zIndex: "2147483647",
      overflow: "visible",
      pointerEvents: "auto",
      colorScheme: "normal"
    });

    frame.addEventListener("load", () => {
      // The current Lumi widget intentionally hides itself on first load and
      // creates its own #lumi-reopen control. Wait for that hand-off, reopen it,
      // then open chat because the host control is labelled “Ask Lumi”.
      window.setTimeout(() => {
        try {
          const widgetDoc = frame?.contentDocument;
          if (!widgetDoc) throw new Error("Lumi widget document is unavailable.");

          const reopen = widgetDoc.getElementById("lumi-reopen")
            || document.getElementById("lumi-reopen");
          if (reopen) reopen.click();

          const talk = widgetDoc.getElementById("lumi-talk");
          if (!talk) throw new Error("Lumi controls did not initialize.");
          talk.click();

          opened = true;
          loading = false;
          launcher.remove();
        } catch (error) {
          console.error("Unable to initialize Lumi companion:", error);
          restoreLauncher("Try Lumi again");
          frame?.remove();
          frame = null;
          document.getElementById("lumi-reopen")?.remove();
          opened = false;
        }
      }, 450);
    }, { once: true });

    frame.addEventListener("error", () => {
      console.error("Lumi companion failed to load.");
      frame?.remove();
      frame = null;
      opened = false;
      restoreLauncher("Try Lumi again");
    }, { once: true });

    frame.src = new URL("../assets/widgets/lumi.html", window.location.href).href;
    document.body.appendChild(frame);
  });
})();

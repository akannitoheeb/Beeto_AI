/* Beeto landing page: login / sign-up popup that stays on the landing page,
   plus an optional demo video. Same Supabase project as app.html, so the session carries over.
   If this fails to load, the buttons still fall back to /app.html?login=1. */
(function () {
  var SUPABASE_URL = "https://jouvcvrnsegzecqdkody.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvdXZjdnJuc2VnemVjcWRrb2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NDAxOTEsImV4cCI6MjEwMjMxNjE5MX0.fnkm94U5c-gbdDMrBvVoZ4ewyEUcOlRY7TJkqkEQS1Q";
  var overlay = document.getElementById("landingAuthOverlay");

  if (overlay && window.supabase) {
    var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    var $ = function (id) { return document.getElementById(id); };
    var title = $("laTitle"), sub = $("laSubtext"), err = $("laError"), form = $("laForm");
    var email = $("laEmail"), pass = $("laPassword"), submit = $("laSubmitBtn");
    var toggleLabel = $("laToggleLabel"), toggleBtn = $("laToggleBtn"), forgot = $("laForgotBtn");
    var mode = "login", lastFocus = null;

    var FRIENDLY = {
      "Invalid login credentials": "That email or password doesn't look right. Please try again.",
      "User already registered": "An account with that email already exists, try logging in instead.",
      "Email not confirmed": "Please confirm your email before logging in.",
      "Password should be at least 6 characters.": "Your password needs to be at least 6 characters."
    };
    function show(msg, ok) { err.textContent = FRIENDLY[msg] || msg; err.className = "la-error show" + (ok ? " ok" : ""); }
    function clear() { err.className = "la-error"; err.textContent = ""; }

    function render() {
      var login = mode === "login";
      title.textContent = login ? "Log in" : "Sign up";
      sub.textContent = login ? "Sign in to save your chats and settings." : "Create a free account to save your chats and settings.";
      submit.textContent = login ? "Log in" : "Sign up";
      toggleLabel.textContent = login ? "Don't have an account?" : "Already have an account?";
      toggleBtn.textContent = login ? "Sign up" : "Log in";
      pass.autocomplete = login ? "current-password" : "new-password";
      forgot.style.display = login ? "" : "none";
      clear();
    }
    function open(m) {
      mode = m === "signup" ? "signup" : "login";
      lastFocus = document.activeElement;
      render();
      overlay.classList.remove("hidden");
      document.body.style.overflow = "hidden";
      setTimeout(function () { email.focus(); }, 50);
    }
    function close() {
      overlay.classList.add("hidden");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    window.openLandingAuthModal = open;

    $("laCloseBtn").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.classList.contains("hidden")) close(); });
    toggleBtn.addEventListener("click", function () { mode = mode === "login" ? "signup" : "login"; render(); });

    function notifyBrevo(addr) {
      fetch("/api/brevo-signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: addr, name: "" }) }).catch(function () {});
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault(); clear(); submit.disabled = true;
      var addr = email.value.trim(), pw = pass.value;
      try {
        if (mode === "login") {
          var r = await sb.auth.signInWithPassword({ email: addr, password: pw });
          if (r.error) throw r.error;
          location.href = "/app.html";
        } else {
          var s = await sb.auth.signUp({ email: addr, password: pw });
          if (s.error) throw s.error;
          var u = s.data && s.data.user;
          if (u && u.identities && u.identities.length === 0) throw new Error("User already registered");
          notifyBrevo(addr);
          if (s.data && s.data.session) location.href = "/app.html";
          else show("Almost done. Check your email to confirm your account, then log in.", true);
        }
      } catch (ex) {
        show(ex.message || "Something went wrong. Please try again.");
      } finally { submit.disabled = false; }
    });

    forgot.addEventListener("click", async function () {
      var addr = email.value.trim();
      if (!addr) { show('Enter your email above first, then tap "Forgot password?"'); email.focus(); return; }
      var r = await sb.auth.resetPasswordForEmail(addr, { redirectTo: "https://beeto.toheebakanni.name.ng/reset-password.html" });
      if (r.error) show(r.error.message); else show("Check your email for a password reset link.", true);
    });

    $("laGoogleBtn").addEventListener("click", async function () {
      clear();
      var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/app.html" } });
      if (r.error) show(r.error.message);
    });
    $("laMailchimpBtn").addEventListener("click", function () { location.href = "/api/oauth-start?provider=mailchimp&mode=login"; });
    $("laKlaviyoBtn").addEventListener("click", function () { location.href = "/api/oauth-start?provider=klaviyo&mode=login"; });

    var q = new URLSearchParams(location.search);
    if (q.has("login") || q.has("signup")) { open(q.has("signup") ? "signup" : "login"); history.replaceState(null, "", location.pathname); }
  }

  /* ---- Demo video: appears under "How it works" once /beeto-demo.mp4 exists in the repo. ---- */
  (function () {
    var SRC = "/beeto-demo.mp4", how = document.getElementById("how");
    if (!how || !window.fetch) return;
    fetch(SRC, { method: "HEAD" }).then(function (r) {
      if (!r.ok || document.getElementById("demo")) return;
      var still = window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;
      var s = document.createElement("section");
      s.id = "demo";
      s.innerHTML = '<div class="wrap"><h2>See Beeto in action.</h2><p class="sub">From a plain-words request to a checked, send-ready email.</p>' +
        '<div class="frame" style="max-width:900px"><div class="bar"><i></i><i></i><i></i></div>' +
        '<video src="' + SRC + '" ' + (still ? '' : 'autoplay ') + 'muted loop playsinline controls preload="metadata" style="display:block;width:100%;height:auto" aria-label="Screen recording of Beeto writing and checking an email sequence"></video></div></div>';
      how.parentNode.insertBefore(s, how.nextSibling);
    }).catch(function () {});
  })();
})();

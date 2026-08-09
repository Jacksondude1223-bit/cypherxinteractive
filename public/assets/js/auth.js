/* CypherX Interactive — account forms.
   Vanilla JS, no dependencies. The session lives in an HttpOnly cookie set by
   the Worker, so nothing here ever handles a token. */
(function () {
  "use strict";

  /* ---------------------------------------------------------------
     Sign in / create account
     --------------------------------------------------------------- */
  document.querySelectorAll("[data-auth-form]").forEach(function (form) {
    var status = form.querySelector(".form__status");
    var button = form.querySelector('button[type="submit"]');
    var label = button ? button.textContent : "";

    var say = function (message, ok) {
      if (!status) return;
      status.textContent = message;
      status.className =
        "form__status is-visible " + (ok ? "form__status--ok" : "form__status--err");
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var data = new FormData(form);
      var email = (data.get("email") || "").toString().trim();
      var password = (data.get("password") || "").toString();

      if (!email || !password) {
        say("Enter your email and password.", false);
        return;
      }

      if (button) {
        button.disabled = true;
        button.textContent = "One moment…";
      }

      fetch(form.getAttribute("data-endpoint"), {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
        // Belt and braces: the request is same-origin anyway, but the cookie
        // the response sets is the whole point.
        credentials: "same-origin",
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              if (!res.ok) {
                // The endpoint explains itself (taken email, rate limit, bad
                // password), so pass that through rather than a generic error.
                throw new Error(body.error || "That didn't work. Try again.");
              }
              say("Signed in. Taking you through…", true);
              window.location.href = nextUrl(body.redirect || "/portal");
            });
        })
        .catch(function (err) {
          say(err && err.message ? err.message : "Something went wrong.", false);
          if (button) {
            button.disabled = false;
            button.textContent = label;
          }
        });
    });
  });

  /**
   * Honours ?next= so a bounce from a gated page returns you there, but only
   * for same-site paths — an open redirect is a phishing gift.
   */
  function nextUrl(fallback) {
    var next = new URLSearchParams(window.location.search).get("next");
    if (next && /^\/[^/\\]/.test(next)) return next;
    return fallback;
  }

  /* ---------------------------------------------------------------
     Sign out
     --------------------------------------------------------------- */
  document.querySelectorAll("[data-logout]").forEach(function (button) {
    button.addEventListener("click", function () {
      button.disabled = true;
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      })
        .then(function () {
          window.location.href = "/";
        })
        .catch(function () {
          // The cookie may well be gone regardless; a reload lands on /login.
          window.location.href = "/";
        });
    });
  });
})();

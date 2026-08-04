/* CypherX Interactive — site behaviour
   Vanilla JS, no dependencies. Every enhancement degrades gracefully. */
(function () {
  "use strict";

  /* ---------------------------------------------------------------
     Mobile navigation
     --------------------------------------------------------------- */
  var toggle = document.querySelector(".nav__toggle");
  var links = document.getElementById("nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      links.classList.toggle("is-open", !open);
      document.body.style.overflow = !open && window.innerWidth <= 900 ? "hidden" : "";
    });

    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("is-open");
        document.body.style.overflow = "";
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("is-open")) {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("is-open");
        document.body.style.overflow = "";
        toggle.focus();
      }
    });
  }

  /* ---------------------------------------------------------------
     Sticky header state
     --------------------------------------------------------------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-stuck", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------------------------------------------------------------
     Reveal on scroll
     --------------------------------------------------------------- */
  var targets = document.querySelectorAll("[data-reveal]");
  if (targets.length) {
    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("is-in"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var delay = parseInt(el.getAttribute("data-reveal-delay") || "0", 10);
          setTimeout(function () { el.classList.add("is-in"); }, delay);
          io.unobserve(el);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

      targets.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---------------------------------------------------------------
     Count-up statistics
     --------------------------------------------------------------- */
  var counters = document.querySelectorAll("[data-count]");
  if (counters.length && "IntersectionObserver" in window) {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        co.unobserve(el);

        var target = parseFloat(el.getAttribute("data-count"));
        var suffix = el.getAttribute("data-suffix") || "";
        var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);

        if (reduce || isNaN(target)) {
          el.textContent = target.toFixed(decimals) + suffix;
          return;
        }

        var start = performance.now();
        var duration = 1400;
        var tick = function (now) {
          var p = Math.min((now - start) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (target * eased).toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });

    counters.forEach(function (el) { co.observe(el); });
  }

  /* ---------------------------------------------------------------
     Current year in footers
     --------------------------------------------------------------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------------------------------------------------------------
     Contact form
     The site is static, so there is no server to post to. Configure a
     form endpoint (Formspree, Basin, a Worker, …) in data-endpoint on
     the <form>; without one we fall back to opening the user's mail
     client with the message pre-filled.
     --------------------------------------------------------------- */
  var form = document.querySelector("[data-contact-form]");
  if (form) {
    var status = form.querySelector(".form__status");

    var say = function (message, ok) {
      if (!status) return;
      status.textContent = message;
      status.className = "form__status is-visible " + (ok ? "form__status--ok" : "form__status--err");
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var data = new FormData(form);
      var name = (data.get("name") || "").toString().trim();
      var email = (data.get("email") || "").toString().trim();
      var topic = (data.get("topic") || "General").toString();
      var message = (data.get("message") || "").toString().trim();

      if (!name || !email || !message) {
        say("Please fill in your name, email and message.", false);
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        say("That email address doesn't look right.", false);
        return;
      }

      var endpoint = form.getAttribute("data-endpoint");

      if (endpoint) {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

        fetch(endpoint, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: data
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Request failed");
            form.reset();
            say("Thanks — your message is with us. We reply within two business days.", true);
          })
          .catch(function () {
            say("Something went wrong sending that. Email us directly at hello@cypherxinteractive.com.", false);
          })
          .finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = "Send message"; }
          });
        return;
      }

      var to = form.getAttribute("data-mailto") || "hello@cypherxinteractive.com";
      var subject = encodeURIComponent("[" + topic + "] Enquiry from " + name);
      var body = encodeURIComponent(
        message + "\n\n—\n" + name + "\n" + email + "\nTopic: " + topic
      );
      window.location.href = "mailto:" + to + "?subject=" + subject + "&body=" + body;
      say("Opening your email client with the message ready to send.", true);
    });
  }
})();

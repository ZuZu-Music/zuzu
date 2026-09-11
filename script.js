/* =========================================================
   ZuZu — waitlist landing logic
   ========================================================= */

// ---------------------------------------------------------------------------
// 1. WAITLIST ENDPOINT — replace with your own form-service URL before launch.
//    Create a free form at https://formspree.io (or Getform / Tally) and paste
//    its endpoint below. Submissions arrive in your inbox + are exportable.
//    Until this is set to a real value, the form runs in DEMO mode and just
//    shows the success state without sending anything.
// ---------------------------------------------------------------------------
const WAITLIST_ENDPOINT = "https://formspree.io/f/REPLACE_WITH_YOUR_FORM_ID";
const isConfigured = !WAITLIST_ENDPOINT.includes("REPLACE_WITH_YOUR_FORM_ID");

// Per-role copy. Changing the toggle rewrites these across the page.
const COPY = {
  artist: {
    cta: "Become a founding artist",
    note: "Free. Priority onboarding at launch, and first pick of your @handle.",
    success: "You’re on the founding-artist list. We’ll bring you in first when we open the doors.",
  },
  fan: {
    cta: "Join the waitlist",
    note: "Free. First access at launch, and your handle before anyone else.",
    success: "You’re in. We’ll let you know the moment there’s a door to open.",
  },
};

// ---- Role state -----------------------------------------------------------
function getRole() {
  return document.body.dataset.role === "fan" ? "fan" : "artist";
}

// Apply the role to the DOM (instant). The visual crossfade is handled by
// switchRole() wrapping this in a View Transition.
function applyRole(role) {
  if (role !== "artist" && role !== "fan") return;
  document.body.dataset.role = role;

  // Theme follows the role: fan = light, artist = dark.
  const theme = role === "artist" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0b08" : "#f7f3ee");

  // Sync every toggle's pressed state.
  document.querySelectorAll("[data-role-toggle] .seg__btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.roleSet === role));
  });

  // Swap CTA labels (only the default label, never the in-flight "Joining…").
  document.querySelectorAll("[data-cta]").forEach((btn) => {
    if (!btn.disabled) btn.textContent = COPY[role].cta;
  });

  // Swap the hero note.
  const note = document.querySelector("[data-note]");
  if (note) note.textContent = COPY[role].note;

  // The other role's content was display:none, so it never intersected and is
  // still hidden at opacity 0. Re-observe it now that it has layout.
  observeReveals();
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Smoothly crossfade between the artist/fan views where supported.
function switchRole(role) {
  if (role === getRole()) return;
  if (document.startViewTransition && !prefersReducedMotion) {
    const transition = document.startViewTransition(() => applyRole(role));
    // Measure only once the new snapshot is live, so rects are the real ones.
    if (transition && transition.updateCallbackDone) {
      transition.updateCallbackDone.then(revealInView).catch(() => {});
    }
  } else {
    applyRole(role);
    revealInView();
  }
}

document.querySelectorAll("[data-role-toggle] .seg__btn").forEach((btn) => {
  btn.addEventListener("click", () => switchRole(btn.dataset.roleSet));
});

// ---- Forms ----------------------------------------------------------------
document.querySelectorAll("[data-waitlist]").forEach(setupForm);

function setupForm(form) {
  const status = form.querySelector(".waitlist-form__status");
  const button = form.querySelector(".btn");
  const emailInput = form.querySelector('input[type="email"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "waitlist-form__status";
    status.textContent = "";

    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      setStatus(status, "Mind popping in a valid email?", "error");
      emailInput.focus();
      return;
    }

    const role = getRole();
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Joining…";

    try {
      if (isConfigured) {
        const res = await fetch(WAITLIST_ENDPOINT, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: toFormData({ email, role, source: "zuzu-waitlist" }),
        });
        if (!res.ok) throw new Error("Request failed");
      } else {
        await wait(600); // DEMO mode — no endpoint configured yet.
      }

      form.reset();
      if (isConfigured) {
        setStatus(status, COPY[role].success, "ok");
      } else {
        // Demo preview — be honest that nothing was actually sent.
        setStatus(status, "Demo preview — the waitlist isn’t live yet, so nothing was sent.", "ok");
      }
    } catch (err) {
      setStatus(status, "Something went wrong on our end. Try again in a moment?", "error");
    } finally {
      button.disabled = false;
      button.textContent = COPY[getRole()].cta;
    }
  });
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "waitlist-form__status " + (kind === "error" ? "is-error" : "is-ok");
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function toFormData(obj) {
  const fd = new FormData();
  Object.entries(obj).forEach(([k, v]) => fd.append(k, v));
  return fd;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Smooth-scroll the header CTA to the form and focus the email field.
document.querySelectorAll('a[href="#waitlist"]').forEach((link) => {
  link.addEventListener("click", () => {
    const input = document.querySelector("#waitlist input[type='email']");
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 500);
  });
});

// Subtle border on the sticky header once the page is scrolled.
const topbar = document.querySelector("[data-topbar]");
if (topbar) {
  const onScroll = () => topbar.classList.toggle("is-stuck", window.scrollY > 6);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

// ---- Entrance reveals ------------------------------------------------------
// One-shot IntersectionObserver: no scroll listener, no rAF, and each element is
// unobserved once it lands, so there is no ongoing work while scrolling.
let revealObserver = null;

function observeReveals() {
  if (!revealObserver) return;
  document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => revealObserver.observe(el));
}

// After a role switch the other view's blocks were display:none, so they never
// intersected and are still at opacity 0 — including ones scrolled past, which
// would leave content invisible until you scrolled back up. Show anything at or
// above the fold outright: the page has just crossfaded, and a second fade on
// top of that reads as a glitch.
function revealInView() {
  if (!revealObserver) return;
  const fold = window.innerHeight;
  document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => {
    if (el.offsetParent === null) return;               // still hidden by the role switch
    if (el.getBoundingClientRect().top < fold) {
      el.classList.add("is-in");
      revealObserver.unobserve(el);
    }
  });
}

if (!prefersReducedMotion && "IntersectionObserver" in window) {
  // Only hide things once we know JS is running and can reveal them again.
  document.documentElement.classList.add("js-reveal");

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  observeReveals();
}

// Init.
applyRole(getRole());
const yearEl = document.querySelector("[data-year]");
if (yearEl) yearEl.textContent = new Date().getFullYear();

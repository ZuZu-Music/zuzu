/* =========================================================
   ZuZu — waitlist landing logic
   ========================================================= */

// ---------------------------------------------------------------------------
// 1. WAITLIST — signups go straight into our own Supabase, not a third party.
//    The table is INSERT-only for anonymous visitors: there is no select policy
//    and no select grant, so this publishable key cannot read the list back.
//    Publishable keys are designed to ship in client code; the protection is the
//    row-level security policy, not the secrecy of this string.
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://hrmofecwgvzkgqmmctly.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ONBvfglyMxEgcDTXJDnyZw_UZxpb0X1";
const WAITLIST_ENDPOINT = SUPABASE_URL + "/rest/v1/waitlist";
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// ---------------------------------------------------------------------------
// 2. CAMPAIGN ATTRIBUTION
//    Read once on landing and keep it for the session, so a signup made after
//    the visitor has clicked around still carries the ad that brought them.
//    Everything here is wrapped: attribution must never be the reason a signup
//    fails, so every read and write degrades to "direct" rather than throwing.
// ---------------------------------------------------------------------------
const ATTRIBUTION_KEY = "zuzu_attr";

// Known ad variants. An unknown utm_content falls back to the default hero
// rather than rendering an empty headline.
const VARIANTS = {
  ad1: "ad1",
  ad2: "ad2",
  ad4: "ad4",
};

function readAttribution() {
  const attr = { source: "", medium: "", campaign: "", content: "", variant: "", referrer: "" };
  let q = null;
  try { q = new URLSearchParams(window.location.search); } catch (err) { /* leave q null */ }
  const hasUtm = Boolean(q && (q.get("utm_source") || q.get("utm_medium") || q.get("utm_campaign") || q.get("utm_content")));

  // Session copy: the landing page set it, later navigations keep it. A URL
  // that carries its own utm_* is newer information (a fresh ad click in a tab
  // that had already seen the site), so it wins over the saved copy.
  if (!hasUtm) {
    try {
      const saved = sessionStorage.getItem(ATTRIBUTION_KEY);
      if (saved) return JSON.parse(saved);
    } catch (err) {
      /* private mode, blocked storage — fall through and re-derive */
    }
  }

  try {
    const clip = (v, n) => (v || "").slice(0, n);
    attr.source   = clip(q && q.get("utm_source"), 64);
    attr.medium   = clip(q && q.get("utm_medium"), 64);
    attr.campaign = clip(q && q.get("utm_campaign"), 64);
    attr.content  = clip(q && q.get("utm_content"), 64);
    attr.variant  = VARIANTS[attr.content] || "";
    // Same-origin referrers say nothing useful about where the visitor came from.
    const ref = document.referrer || "";
    attr.referrer = ref && ref.indexOf(window.location.origin) !== 0 ? clip(ref, 300) : "";
  } catch (err) {
    /* leave the blanks */
  }

  try {
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attr));
  } catch (err) {
    /* not fatal — we just re-derive on the next page */
  }
  return attr;
}

const ATTR = readAttribution();

// Until the migration adds real columns, attribution rides in `source`, which is
// capped at 64 chars by a CHECK constraint. "direct" when there is no campaign.
function sourceString() {
  const parts = [ATTR.source, ATTR.campaign, ATTR.content].filter(Boolean);
  return parts.length ? parts.join("/").slice(0, 64) : "direct";
}

// ---------------------------------------------------------------------------
// 3. META PIXEL  (optional — leave PIXEL_ID empty and nothing is loaded at all)
//    PageView on landing, Lead only after an insert we know succeeded. The
//    email never leaves this page: Meta gets the event, not the person.
// ---------------------------------------------------------------------------
const PIXEL_ID = "2535552426932453";

function loadPixel() {
  if (!PIXEL_ID) return;                 // no id, no script, no third-party request
  if (window.fbq) return;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
  (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq("init", PIXEL_ID);
  window.fbq("track", "PageView");
}

function pixelLead() {
  if (!PIXEL_ID || !window.fbq) return;
  try {
    // No email, no name, no external id. Variant only, so we can read the ads.
    window.fbq("track", "Lead", { content_name: ATTR.variant || "default" });
  } catch (err) {
    /* a blocked pixel must never surface to the visitor */
  }
}

// ---------------------------------------------------------------------------
// 4. AFTER SIGNUP — one optional question, then a share link.
// ---------------------------------------------------------------------------
const ARTIST_REQUEST_ENDPOINT = SUPABASE_URL + "/rest/v1/artist_requests";
let signedUpEmail = "";

function onSignedUp(email, role) {
  signedUpEmail = email;
  pixelLead();
  if (role !== "fan") return;            // the follow-up question is fan-only
  const panel = document.querySelector("[data-after-signup]");
  if (panel) panel.hidden = false;
}

function setupArtistRequest() {
  const form = document.querySelector("[data-artist-request]");
  if (!form) return;
  const input = form.querySelector("input");
  const status = form.querySelector(".waitlist-form__status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const artist = (input.value || "").trim().slice(0, 120);
    if (!artist) { input.focus(); return; }
    const button = form.querySelector(".btn");
    button.disabled = true;
    try {
      const res = await fetch(ARTIST_REQUEST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email: signedUpEmail, artist }),
      });
      // 404 = the table is not migrated yet. Thank them anyway: this is a
      // bonus question and must never look broken to the visitor.
      if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error("HTTP " + res.status);
      form.reset();
      setStatus(status, "Noted. We\u2019ll see what we can do.", "ok");
    } catch (err) {
      setStatus(status, "Couldn\u2019t save that one. No matter \u2014 you\u2019re still on the list.", "ok");
    } finally {
      button.disabled = false;
    }
  });
}

function setupShare() {
  const btn = document.querySelector("[data-share]");
  if (!btn) return;
  const url = "https://zuzu.music/?utm_source=referral";
  btn.addEventListener("click", async () => {
    const label = btn.textContent;
    try {
      if (navigator.share) {
        await navigator.share({ title: "ZuZu", text: "Get closer than a follow.", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      btn.textContent = "Link copied";
      setTimeout(() => { btn.textContent = label; }, 2000);
    } catch (err) {
      /* a cancelled share is not a failure */
    }
  });
}

// Per-role copy. Changing the toggle rewrites these across the page.
const COPY = {
  artist: {
    cta: "Become a founding artist",
    note: "Free. Priority onboarding at launch, and first pick of your @handle.",
    success: "You’re on the founding-artist list. We’ll bring you in first when we open the doors.",
    already: "You’re already on the list. We’ll be in touch.",
  },
  fan: {
    cta: "Join the waitlist",
    // The ads say $2, so the page says $2 in the same breath as the signup.
    note: "Free to join. At launch, each artist’s community is $2 a month, cancel anytime.",
    success: "You’re in. We’ll tell you the moment ZuZu opens.",
    already: "You’re already on the list. We’ll be in touch.",
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
  if (meta) meta.setAttribute("content", theme === "dark" ? "#17130F" : "#F6F2F0");

  // The link is a toggle, so it announces whether the artist view is on.
  document.querySelectorAll("[data-role-toggle-link]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(role === "artist"));
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
    // A transition aborted by a second click or a hidden tab rejects these too;
    // the DOM update has already happened, so there is nothing to recover.
    if (transition) {
      if (transition.ready) transition.ready.catch(() => {});
      if (transition.finished) transition.finished.catch(() => {});
    }
  } else {
    applyRole(role);
    revealInView();
  }
}

// The segmented control is gone; the role now flips from one quiet link.
document.querySelectorAll("[data-role-toggle-link]").forEach((btn) => {
  btn.addEventListener("click", () => switchRole(getRole() === "fan" ? "artist" : "fan"));
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
    let duplicate = false;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Joining…";

    try {
      if (isConfigured) {
        let res = await fetch(WAITLIST_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY,
            // Required: without it PostgREST tries to return the new row, which
            // needs a SELECT grant we deliberately do not give anon.
            Prefer: "return=minimal",
          },
          body: JSON.stringify(waitlistRow(email, role)),
        });

        // The attribution columns only exist once the migration is run. Until
        // then PostgREST rejects them as unknown columns (400/422) - so fall
        // back to the three columns that have always been there. Tracking is
        // never allowed to be the reason a signup fails.
        if (res.status === 400 || res.status === 422) {
          res = await fetch(WAITLIST_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_PUBLISHABLE_KEY,
              Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ email, role, source: sourceString() }),
          });
        }

        // 409 = the unique index caught a repeat signup. Not an error, but say
        // something truer than the first-time message.
        duplicate = res.status === 409;
        if (!res.ok && !duplicate) throw new Error("HTTP " + res.status);
      } else {
        await wait(600); // DEMO mode — no endpoint configured yet.
      }

      form.reset();
      if (isConfigured) {
        setStatus(status, duplicate ? COPY[role].already : COPY[role].success, "ok");
        onSignedUp(email, role);
      } else {
        // Demo preview — be honest that nothing was actually sent.
        setStatus(status, "Demo preview — the waitlist isn’t live yet, so nothing was sent.", "ok");
      }
    } catch (err) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setStatus(
        status,
        offline
          ? "Looks like you\u2019re offline. We\u2019ll be here when you\u2019re back."
          : "Something went wrong on our end. Try again in a moment?",
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = COPY[getRole()].cta;
    }
  });
}

// The insert body. Attribution is best-effort: if anything here is missing the
// signup still goes through with source "direct".
function waitlistRow(email, role) {
  const row = { email, role, source: sourceString() };
  try {
    if (ATTR.source)   row.utm_source   = ATTR.source;
    if (ATTR.medium)   row.utm_medium   = ATTR.medium;
    if (ATTR.campaign) row.utm_campaign = ATTR.campaign;
    if (ATTR.content)  row.utm_content  = ATTR.content;
    if (ATTR.variant)  row.variant      = ATTR.variant;
    if (ATTR.referrer) row.referrer     = ATTR.referrer;
  } catch (err) {
    /* fall back to the three required fields */
  }
  return row;
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "waitlist-form__status " + (kind === "error" ? "is-error" : "is-ok");
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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
    // Start slightly BEFORE the element reaches the fold, so it has finished
    // arriving by the time it is actually in front of you. Triggering late is
    // what made the page feel sluggish.
    { rootMargin: "0px 0px 12% 0px", threshold: 0 }
  );

  observeReveals();
}

// ---- Story stages ---------------------------------------------------------
// Wide viewports only: the screen beside a story follows whichever beat is in
// the middle of the viewport. One IntersectionObserver per story with a thin
// band around the centre, so there is no scroll listener and no per-frame
// work. On phones the stage is display:none and each beat carries its own
// screen inline. Both the fan story and the Studio story use this.
(function () {
  if (!("IntersectionObserver" in window)) return;
  document.querySelectorAll("[data-stage]").forEach((stage) => {
    const story = stage.closest(".story");
    const shots = Array.from(stage.querySelectorAll("[data-shot]"));
    const beats = story ? story.querySelectorAll("[data-beat]") : [];
    if (!shots.length || !beats.length) return;
    // The screen for this beat comes in; the ones already passed drift up and
    // away, the ones still to come wait below.
    const show = (id) => {
      const at = shots.findIndex((img) => img.dataset.shot === id);
      shots.forEach((img, i) => {
        img.classList.toggle("is-active", i === at);
        img.classList.toggle("is-past", i < at);
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) show(entry.target.dataset.beat);
        });
      },
      { rootMargin: "-42% 0px -42% 0px", threshold: 0 }
    );
    beats.forEach((beat) => io.observe(beat));
  });
})();

// ---- Studio tabs -----------------------------------------------------------
// Progressive: without this every panel shows, one under another. With it, one
// panel at a time, arrow keys move between tabs, and the other screens are
// fetched as soon as the section comes near so a tab never opens on a blank.
(function () {
  const list = document.querySelector("[data-tabs]");
  if (!list) return;
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
  if (!tabs.length || panels.some((p) => !p)) return;
  document.documentElement.classList.add("js-tabs");

  const select = (i, focus) => {
    tabs.forEach((t, n) => {
      t.setAttribute("aria-selected", String(n === i));
      t.tabIndex = n === i ? 0 : -1;
      panels[n].hidden = n !== i;
    });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i, false));
    t.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      select((i + step + tabs.length) % tabs.length, true);
    });
  });
  select(0, false);

  const section = list.closest("section");
  if (section && "IntersectionObserver" in window) {
    const warm = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      panels.forEach((p) => p.querySelectorAll("img").forEach((img) => { img.loading = "eager"; }));
      warm.disconnect();
    }, { rootMargin: "400px 0px" });
    warm.observe(section);
  }
})();

// ---- Motion: the headline word by word, screens that fly in ---------------
// The head script sets .js-words before first paint; this splits every
// headline variant into words, numbered for the stagger, and then shows it.
(function () {
  const root = document.documentElement;
  if (root.classList.contains("js-words")) {
    document.querySelectorAll(".hero__title > span").forEach((line) => {
      let i = 0;
      const walk = (node) => {
        Array.from(node.childNodes).forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            const parts = child.textContent.split(/(\s+)/);
            const frag = document.createDocumentFragment();
            parts.forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
              const w = document.createElement("span");
              w.className = "w";
              w.style.setProperty("--i", String(i++));
              w.textContent = part;
              frag.appendChild(w);
            });
            child.replaceWith(frag);
          } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== "BR") {
            walk(child);
          }
        });
      };
      walk(line);
    });
    document.querySelectorAll(".hero__title").forEach((t) => t.classList.add("is-split"));
  }

  // Screens fly in once, when a fifth of them is in view.
  if (prefersReducedMotion || !("IntersectionObserver" in window)) return;
  const flying = document.querySelectorAll("[data-fly]");
  if (!flying.length) return;
  root.classList.add("js-fly");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-flown");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.12 });
  flying.forEach((el) => io.observe(el));
  // A Studio panel opened by its tab shows its screen straight away.
  document.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener("click", () => {
    const panel = document.getElementById(t.getAttribute("aria-controls"));
    panel && panel.querySelectorAll("[data-fly]").forEach((el) => { el.classList.add("is-flown"); io.unobserve(el); });
  }));
})();

// ---- Earnings calculator (artists): us vs them ---------------------------
// Their number, times the share who join. On ZuZu each of those people pays
// the artist $1 a month (half of the $2, before tax). On the major streaming
// apps the same fans pay what they play: about 30 plays a month each, since
// 2% of listeners drive 20% of streams at roughly 3 plays a listener, at the
// $0.004 a play quoted on the page. All in the browser; nothing is sent.
(function () {
  const box = document.querySelector("[data-calc]");
  if (!box) return;
  const $ = (sel) => box.querySelector(sel);
  const n = $("#calc-n");
  const rate = $("#calc-rate");
  const num = new Intl.NumberFormat("en-US");
  const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v) => (v > 0 && v < 100 && v % 1 ? usd2 : usd0).format(v);
  const PER_PERSON = 1;                 // ZuZu: dollars a month to the artist, per person who joins
  const PLAYS = 30, PER_PLAY = 0.004;   // streaming: the same fan, plays a month and dollars a play
  const MAX = 100000000;

  const count = () => Math.min(MAX, parseInt((n.value || "").replace(/[^0-9]/g, ""), 10) || 0);
  const update = () => {
    const r = parseFloat(rate.value) || 0;
    const joined = Math.round(count() * r / 100);
    const us = joined * PER_PERSON;
    const them = joined * PLAYS * PER_PLAY;
    $("[data-calc-people]").textContent = num.format(joined);
    $("[data-calc-month]").textContent = money(us);
    $("[data-calc-stream]").textContent = money(them);
    $("[data-calc-year]").textContent = money(us * 12);
    $("[data-calc-stream-year]").textContent = money(them * 12);
    $("[data-calc-x]").textContent = Math.round(PER_PERSON / (PLAYS * PER_PLAY)) + "×";
    const top = Math.max(us, them) || 1;
    $("[data-calc-bar-us]").style.width = (us ? (us / top) * 100 : 0) + "%";
    $("[data-calc-bar-them]").style.width = (them ? Math.max(2, (them / top) * 100) : 0) + "%";
    $("[data-calc-rate-out]").textContent = (r % 1 ? r.toFixed(1) : String(r)) + "%";
    rate.style.setProperty("--p", ((r - rate.min) / (rate.max - rate.min)) * 100 + "%");
  };
  n.addEventListener("input", () => {
    const v = count();
    n.value = v ? num.format(v) : "";
    update();
  });
  rate.addEventListener("input", update);
  box.querySelectorAll('input[name="calc-source"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      $("[data-calc-noun]").textContent = radio.value === "followers"
        ? "How many followers do you have?"
        : "How many monthly listeners do you have?";
    });
  });
  update();
})();

// ---- Variant hero ----------------------------------------------------------
// The variant is also set by an inline script in <head> so the right headline
// is there on first paint. This re-asserts it after hydration and is harmless
// if the head script already ran.
function applyVariant() {
  const v = ATTR.variant;
  document.documentElement.setAttribute("data-variant", v || "default");
  // Meta traffic is fan traffic: never land them on the artist view.
  if (ATTR.source === "meta") applyRole("fan");
}

// Init.
applyVariant();
applyRole(getRole());
setupArtistRequest();
setupShare();
loadPixel();
const yearEl = document.querySelector("[data-year]");
if (yearEl) yearEl.textContent = new Date().getFullYear();

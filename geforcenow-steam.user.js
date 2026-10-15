// ==UserScript==
// @name         GeForce NOW on Steam
// @namespace    https://github.com/lcshmn/steam-geforcenow-userscript
// @version      1.0.0
// @description  Shows on Steam store pages whether a game is on GeForce NOW, and with which membership.
// @author       lcshmn
// @license      BSD-3-Clause
// @homepageURL  https://github.com/lcshmn/steam-geforcenow-userscript
// @supportURL   https://github.com/lcshmn/steam-geforcenow-userscript/issues
// @updateURL    https://raw.githubusercontent.com/lcshmn/steam-geforcenow-userscript/main/geforcenow-steam.user.js
// @downloadURL  https://raw.githubusercontent.com/lcshmn/steam-geforcenow-userscript/main/geforcenow-steam.user.js
// @match        https://store.steampowered.com/app/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      api-prod.nvidia.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Adds a "GeForce NOW" section below Steam's "Steam Deck Compatibility"
 * section: whether the game is available on GeForce NOW and with which plan,
 * plus a link to the game on GeForce NOW.
 *
 * Data: NVIDIA's public catalog feed (the one behind NVIDIA's own "supported
 * games" page). It is fetched once per week (after GeForce NOW's Thursday
 * update) for the shopper's region and cached; a game page only does a lookup
 * in that cache.
 *
 * "GeForce NOW" and the NVIDIA logo are trademarks of NVIDIA Corporation. This
 * script is not affiliated with NVIDIA or Valve.
 */

(function () {
  "use strict";

  const CATALOG_URL = "https://api-prod.nvidia.com/services/gfngames/v1/gameList";
  const CACHE_KEY = "gfn-catalog-v1";
  // GeForce NOW adds games once a week, on Thursdays ("GFN Thursday").
  // The cache is refreshed once after each Thursday's update (see isStale).
  const UPDATE_DAY = 4; // Thursday
  const UPDATE_HOUR_UTC = 18; // announced US morning; give it a few hours
  const MAX_PAGES = 40; // 750 titles per page
  const SECTION_ID = "gfn-steam-section";
  const GAME_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const STEAM_URL_RE = /store\.steampowered\.com\/app\/(\d+)/;

  // ---------------------------------------------------------------- texts --

  const STRINGS = {
    en: {
      loading: "Checking GeForce NOW…",
      available: "Available",
      notAvailable: "Not available",
      error: "Couldn't load the GeForce NOW catalog",
      plans: "Plans",
      allPlans: "Free, Performance & Ultimate",
      paidPlans: "Performance & Ultimate",
      ultimatePlan: "Ultimate",
      play: "Play now",
      retry: "Try again",
    },
    de: {
      loading: "Prüfe GeForce NOW …",
      available: "Verfügbar",
      notAvailable: "Nicht verfügbar",
      error: "GeForce-NOW-Katalog konnte nicht geladen werden",
      plans: "Abos",
      allPlans: "Kostenlos, Performance & Ultimate",
      paidPlans: "Performance & Ultimate",
      ultimatePlan: "Ultimate",
      play: "Jetzt spielen",
      retry: "Erneut versuchen",
    },
  };
  const lang = (document.documentElement.lang || navigator.language || "en").toLowerCase();
  const t = lang.startsWith("de") ? STRINGS.de : STRINGS.en;

  // ---------------------------------------------------------------- logos --

  // NVIDIA logo mark (Simple Icons, CC0).
  const NVIDIA_EYE =
    '<svg class="gfn-eye" viewBox="0 0 24 24" aria-hidden="true"><path fill="#76B900" d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z"/></svg>';
  // Steam's own icons from its Deck section ("Verified" / "Unsupported").
  const CHECK =
    '<svg class="gfn-icon" role="presentation" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 19C14.9706 19 19 14.9706 19 10C19 5.02944 14.9706 1 10 1C5.02944 1 1 5.02944 1 10C1 14.9706 5.02944 19 10 19ZM8.33342 11.9222L14.4945 5.76667L16.4556 7.72779L8.33342 15.8556L3.26675 10.7833L5.22786 8.82223L8.33342 11.9222Z" fill="currentColor"/></svg>';
  const CROSS =
    '<svg class="gfn-icon" role="presentation" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.1931 15.6064C13.0246 16.4816 11.5733 17 10.001 17C6.13498 17 3.00098 13.866 3.00098 10C3.00098 8.42766 3.51938 6.97641 4.39459 5.80783L14.1931 15.6064ZM15.6074 14.1922C16.4826 13.0236 17.001 11.5723 17.001 10C17.001 6.13401 13.867 3 10.001 3C8.42864 3 6.97739 3.5184 5.80881 4.39362L15.6074 14.1922ZM19.001 10C19.001 14.9706 14.9715 19 10.001 19C5.03041 19 1.00098 14.9706 1.00098 10C1.00098 5.02944 5.03041 1 10.001 1C14.9715 1 19.001 5.02944 19.001 10Z" fill="currentColor"/></svg>';

  // ---------------------------------------------------------------- style --

  // Mirrors Steam's own "Steam Deck Compatibility" block (same paddings,
  // colours and fonts), so the section looks native in the narrow right column
  // as well as in wider layouts. Own class names, so Steam's hashed class
  // names can change without breaking it.
  const S = "#" + SECTION_ID;
  const CSS = `
${S} { padding: 12px 0; }
${S} .gfn-head {
  display: flex; align-items: center; gap: 6px;
  text-transform: uppercase; padding-bottom: 5px; color: #fff; font-weight: 400; font-size: 14px;
  letter-spacing: .03em; font-family: "Motiva Sans", Arial, sans-serif;
}
.BasicUI ${S} .gfn-head { font-weight: 700; letter-spacing: .5px; font-size: 12px; }
${S} .gfn-eye { flex: none; width: 18px; height: 18px; }
${S} .gfn-body {
  display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px;
  padding: 16px 24px; transition: background-color .2s ease;
  background: linear-gradient(to right, rgba(0,0,0,.2) 0%, rgba(0,0,0,.5) 100%);
}
${S} .gfn-body:focus-within { background-color: rgba(103,139,166,.44); }
${S} .gfn-status { min-width: 0; }
${S} .gfn-icon { width: 20px; height: 20px; padding-right: 8px; vertical-align: middle; color: var(--gpColor-GreenHi, #59bf40); }
${S}.gfn-missing .gfn-icon, ${S}.gfn-error .gfn-icon { color: var(--gpSystemLightestGrey, #dcdedf); }
${S} .gfn-label { vertical-align: middle; font-size: 14px; }
${S}.gfn-loading .gfn-label { color: var(--gpStoreLightGrey, #7c8ea3); }
/* Below the row, aligned with the label. */
${S} .gfn-plans { flex: 1 0 100%; order: 1; margin-top: -4px; padding-left: 28px; font-size: 12px; color: var(--gpStoreLightGrey, #7c8ea3); }
${S} .gfn-button {
  display: flex; padding: 6px 12px; border: 0; border-radius: 2px; cursor: pointer; white-space: nowrap;
  font: inherit; font-size: 14px; color: #fff; text-decoration: none; background-color: var(--gpColor-Blue, #1a9fff);
  box-shadow: 0 3px 6px 0 rgba(0,0,0,.32);
  transition-property: color, background-color, border-radius; transition-duration: .1s; transition-timing-function: ease;
}
${S} .gfn-button:hover { color: #fff; background-color: var(--gpColor-BlueHi, #0bf); }
${S} .gfn-button.gfn-green { background-color: #76b900; }
${S} .gfn-button.gfn-green:hover { background-color: #8ad100; }
${S} .gfn-button:focus-visible, ${S} .gfn-button.gpfocus { background-color: #fff; border-radius: 0; color: #000; outline: none; }
html.GamepadMode ${S} .gfn-label, html.GamepadMode ${S} .gfn-button { font-size: 13px; }
`;

  // ------------------------------------------------------------ requests --

  function postGraphQL(document_) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CATALOG_URL,
        // A bare GraphQL document, sent as application/json (the usual
        // {"query": …} envelope is rejected by this endpoint).
        data: document_,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        timeout: 60000,
        // No cookies: the catalog is public, and NVIDIA doesn't need to know
        // who is asking.
        anonymous: true,
        onload: (res) => {
          if (res.status !== 200) return reject(new Error(`HTTP ${res.status}`));
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  function catalogQuery(country, language, cursor) {
    return (
      `{ apps(country: ${JSON.stringify(country)}, language: ${JSON.stringify(language)}, after: ${JSON.stringify(cursor)}) {` +
      " pageInfo { hasNextPage endCursor }" +
      " items { id title gfn { minimumMembershipTierLabel } variants { appStore storeId storeUrl } } } }"
    );
  }

  function steamAppId(variant) {
    if (variant.storeId && /^\d+$/.test(String(variant.storeId))) return String(variant.storeId);
    const m = STEAM_URL_RE.exec(variant.storeUrl || "");
    return m ? m[1] : null;
  }

  /** Walks the whole catalog: { steam appid: [gfn game id, minimum tier label] }. */
  async function fetchCatalog(country) {
    const games = {};
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const payload = await postGraphQL(catalogQuery(country, "en_US", cursor));
      const apps = payload && payload.data && payload.data.apps;
      if (!apps) throw new Error("no apps in response");
      for (const item of apps.items || []) {
        const tier = (item.gfn && item.gfn.minimumMembershipTierLabel) || "";
        for (const variant of item.variants || []) {
          if (String(variant.appStore || "").toUpperCase() !== "STEAM") continue;
          const appid = steamAppId(variant);
          if (appid) games[appid] = [GAME_ID_RE.test(item.id || "") ? item.id : "", String(tier)];
        }
      }
      const info = apps.pageInfo || {};
      if (!info.hasNextPage || !info.endCursor) break;
      cursor = info.endCursor;
    }
    if (!Object.keys(games).length) throw new Error("empty catalog");
    return games;
  }

  /** The region of the shopper (GFN's catalog differs slightly per region). */
  function region() {
    try {
      const cc = typeof unsafeWindow !== "undefined" && unsafeWindow.g_strCountryCode;
      if (cc && /^[A-Z]{2}$/.test(cc)) return cc;
    } catch (e) {
      /* ignore */
    }
    const m = /[-_]([A-Za-z]{2})$/.exec(navigator.language || "");
    return m ? m[1].toUpperCase() : "US";
  }

  /** The most recent weekly catalog update (Thursday, UTC) at or before `now`. */
  function lastUpdate(now) {
    const d = new Date(now);
    d.setUTCHours(UPDATE_HOUR_UTC, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - UPDATE_DAY + 7) % 7));
    if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 7);
    return d.getTime();
  }

  /**
   * Stale once a Thursday update happened since the last fetch. The day after
   * (late additions) it is refreshed once more; otherwise it is kept up to a week.
   */
  function isStale(updated, now) {
    const thursday = lastUpdate(now);
    if (updated < thursday) return true;
    const dayAfter = thursday + 24 * 3600 * 1000;
    return now >= dayAfter && updated < dayAfter;
  }

  async function loadCatalog(force) {
    const country = region();
    const cached = GM_getValue(CACHE_KEY, null);
    const fresh = cached && cached.country === country && !isStale(cached.updated, Date.now());
    if (fresh && !force) return cached.games;
    try {
      const games = await fetchCatalog(country);
      GM_setValue(CACHE_KEY, { country, updated: Date.now(), games });
      return games;
    } catch (e) {
      console.warn("[GeForce NOW on Steam] catalog refresh failed", e);
      if (cached && cached.games) return cached.games; // stale beats nothing
      throw e;
    }
  }

  // ----------------------------------------------------------------- page --

  function plansFor(tier) {
    const label = String(tier || "").toLowerCase();
    if (!label) return t.allPlans;
    if (label.includes("ultimate")) return t.ultimatePlan;
    return t.paidPlans; // "Premium": any paid plan
  }

  function gfnLink(gameId) {
    const params = new URLSearchParams({
      "game-id": gameId,
      utm_source: "steam-userscript",
      utm_campaign: "store-page",
    });
    return `https://play.geforcenow.com/games?${params}`;
  }

  function el(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function section() {
    let root = document.getElementById(SECTION_ID);
    if (!root) {
      // Same structure as Steam's Deck section: header, then one row with
      // the status on the left and a button on the right.
      root = el(
        `<div id="${SECTION_ID}" role="group" aria-labelledby="gfn-steam-head">` +
          `<div class="gfn-head" id="gfn-steam-head">${NVIDIA_EYE}<span>GeForce NOW</span></div>` +
          `<div class="gfn-body"></div></div>`,
      );
      placeSection(root);
    }
    return root;
  }

  /** Below Steam's Deck compatibility section; it may appear later (React). */
  function placeSection(root) {
    const deck = document.querySelector('[data-featuretarget="deck-verified-results"]');
    if (deck && deck.parentNode) {
      deck.parentNode.insertBefore(root, deck.nextSibling);
      return true;
    }
    const fallback =
      document.querySelector("#game_area_purchase") ||
      document.querySelector(".game_area_purchase") ||
      document.querySelector("#aboutThisGame");
    if (fallback && fallback.parentNode) {
      if (fallback.id === "aboutThisGame") fallback.parentNode.insertBefore(root, fallback);
      else fallback.parentNode.insertBefore(root, fallback.nextSibling);
    } else {
      (document.querySelector(".page_content_ctn") || document.body).appendChild(root);
    }
    return false;
  }

  // The row is Steam's: <div><svg/><span/></div> left, a button right. The
  // plans go on an extra line below it.
  function status(icon, label, plans) {
    return (
      `<div class="gfn-status">${icon}<span class="gfn-label">${label}</span></div>` +
      (plans ? `<div class="gfn-plans">${plans}</div>` : "")
    );
  }

  function render(state) {
    const root = section();
    const body = root.querySelector(".gfn-body");
    for (const kind of ["loading", "error", "available", "missing"]) root.classList.toggle(`gfn-${kind}`, state.kind === kind);
    if (state.kind === "loading") {
      body.innerHTML = status("", t.loading);
    } else if (state.kind === "error") {
      body.innerHTML =
        status(CROSS, t.error, escapeHtml(state.message)) +
        `<div><button type="button" class="gfn-button">${t.retry}</button></div>`;
      body.querySelector("button").addEventListener("click", () => run(true));
    } else if (state.kind === "available") {
      body.innerHTML =
        status(CHECK, t.available, `${t.plans}: ${plansFor(state.tier)}`) +
        (state.gameId
          ? `<div><a class="gfn-button gfn-green" href="${escapeHtml(gfnLink(state.gameId))}" target="_blank" rel="noopener noreferrer">${t.play}</a></div>`
          : "");
    } else {
      body.innerHTML = status(CROSS, t.notAvailable);
    }
  }

  async function run(force) {
    const m = /\/app\/(\d+)/.exec(location.pathname);
    if (!m) return;
    const appid = m[1];
    render({ kind: "loading" });
    try {
      const games = await loadCatalog(force);
      const entry = Object.prototype.hasOwnProperty.call(games, appid) ? games[appid] : null;
      render(entry ? { kind: "available", gameId: entry[0], tier: entry[1] } : { kind: "missing" });
    } catch (e) {
      render({ kind: "error", message: e && e.message ? e.message : String(e) });
    }
  }

  function init() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    run(false);

    // Steam renders its Deck section with React, possibly after this script
    // ran: move ours below it once it shows up.
    const root = document.getElementById(SECTION_ID);
    if (root && !document.querySelector('[data-featuretarget="deck-verified-results"]')) {
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-featuretarget="deck-verified-results"]')) {
          placeSection(root);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 15000);
    }
  }

  init();
})();

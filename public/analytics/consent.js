// Consent, geo-gated to the EEA and UK.
//
// Written once here and copied verbatim into ~/Dev/website and
// ~/Dev/website-games by copy-to-siblings.mjs. None of the three repos has a
// build step, so the copy script is the only thing keeping them from drifting.
// Edit this file, never a copy.
//
// A classic script, not a module, because two of the three sites load their
// JavaScript with a plain <script src>. It defines window.snConsent and
// nothing else.
//
// Why a banner in some countries and not others, at length in ANALYTICS.md
// §9.1. The short version: using Google Ads tags means agreeing to Google's EU
// user consent policy, which requires consent from EEA and UK visitors. That
// obligation is contractual and applies the moment the Ads tag ships. Outside
// those countries we are a US nonprofit below every threshold that would bring
// a US state law into play, and a banner would cost us the Nigerian mobile
// audience we most want to see clearly.
(function () {
  'use strict';

  // EU 27, the three non-EU EEA states, the UK and Switzerland.
  //
  // Google's EU user consent policy names the EEA, the UK and Switzerland in
  // its scope, and requires verified consent signals for EEA traffic
  // specifically. Asking the UK and Switzerland too is the conservative
  // reading and costs us very little traffic.
  var CONSENT_REQUIRED = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE',
    'IS', 'LI', 'NO',
    'GB', 'CH'
  ];

  var STORAGE_KEY = 'sn-consent';

  // One policy for one nonprofit, hosted on the main site and linked from all
  // three. Three separate policies would be three things to keep in step, and
  // they would say the same thing.
  var PRIVACY_URL = 'https://speaknigeria.org/privacy';

  // Google's EU user consent policy requires the notice to link somewhere the
  // reader can see how Google itself uses the data. This is that link, and it
  // is Google's own page rather than our description of it.
  var GOOGLE_DATA_URL = 'https://business.safety.google/privacy/';

  // Bumped whenever the wording or the choices change. The policy requires
  // keeping a record of the text and choices a person was shown along with
  // when they agreed, and a version is how a stored answer stays attached to
  // the notice that produced it. Never reuse a number for different wording.
  var NOTICE_VERSION = '2026-09-08.1';

  // Google consent mode v2. Denied is the starting state for everyone,
  // including the visitors we will immediately grant, because the alternative
  // is a window between page load and country resolution in which an EEA
  // visitor is tracked. Granting late costs us nothing; granting early cannot
  // be taken back.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 2000
  });

  // ad_personalization is NOT granted, even by someone who accepts.
  //
  // Ad Grants serves search text ads only: remarketing and audience lists are
  // unavailable to us, so personalisation is a permission we could not use if
  // we had it. Leaving it denied costs nothing, keeps the notice simpler and
  // truer, and means someone who accepts is agreeing to measurement rather
  // than to being profiled for advertising.
  function grant() {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      analytics_storage: 'granted'
    });
  }

  function remember(answer) {
    try {
      window.localStorage.setItem(STORAGE_KEY, answer);
    } catch (err) {
      // Private mode, or storage disabled. The banner will ask again next
      // visit, which is worse than remembering and better than failing.
    }
  }

  // The record of an affirmative consent: which notice was shown, and when it
  // was agreed to. Google's EU user consent policy requires retaining both.
  //
  // Kept on the device and sent once as an event, so the record survives in a
  // place we can actually query rather than only in the visitor's browser.
  // Only fired for a yes: a refusal leaves nothing to retain, which is the
  // point of refusing.
  function recordConsent() {
    var record = { noticeVersion: NOTICE_VERSION, agreedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(STORAGE_KEY + '-record', JSON.stringify(record));
    } catch (err) {
      // Nothing to do; the event below is the copy that matters.
    }
    // track() queues until the tag is ready, so this is safe to call here.
    if (window.snTrack) window.snTrack('consent_granted', record);
  }

  function remembered() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  // The visitor's country, from the trace endpoint every Cloudflare-proxied
  // domain serves. One request, one line to parse, no library and no
  // third-party geo service. All three of our domains are behind Cloudflare.
  //
  // A failure here is treated as "consent required". That is the safe
  // direction: it costs us data from a visitor we could probably have counted,
  // rather than counting a visitor we were not allowed to.
  function resolveCountry() {
    return fetch('/cdn-cgi/trace', { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('trace ' + response.status);
        return response.text();
      })
      .then(function (text) {
        var match = /^loc=([A-Z]{2})$/m.exec(text);
        return match ? match[1] : null;
      })
      .catch(function () {
        return null;
      });
  }

  // Styles ship with the component rather than with any site's stylesheet.
  // Three sites, three different design systems, one banner: depending on each
  // of them to style it is how it ends up unstyled on the one nobody checked.
  // Deliberately plain, and it inherits the page's font.
  function injectStyles() {
    if (document.getElementById('sn-consent-style')) return;
    var style = document.createElement('style');
    style.id = 'sn-consent-style';
    style.textContent = [
      '.sn-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;',
      'display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;align-items:center;',
      'justify-content:center;padding:.9rem 1.1rem;background:#1c1c1e;color:#fff;',
      'font:inherit;font-size:.95rem;line-height:1.4;box-shadow:0 -2px 12px rgba(0,0,0,.25)}',
      '.sn-consent-text{margin:0;max-width:46rem}',
      '.sn-consent-heading{display:block;margin-bottom:.2rem;font-size:1rem}',
      '.sn-consent-link{color:#9fc6ff;text-decoration:underline;white-space:nowrap}',
      '.sn-consent-buttons{display:flex;gap:.6rem;flex:none}',
      '.sn-consent button{font:inherit;font-size:.95rem;padding:.45rem 1.3rem;',
      'border-radius:999px;border:1px solid #fff;cursor:pointer;min-height:44px}',
      '.sn-consent-yes{background:#fff;color:#1c1c1e}',
      '.sn-consent-no{background:transparent;color:#fff}',
      '.sn-consent button:focus-visible{outline:3px solid #7cb3ff;outline-offset:2px}',
      '@media (max-width:30rem){.sn-consent{justify-content:stretch}',
      '.sn-consent-buttons{width:100%}.sn-consent button{flex:1}}'
    ].join('');
    document.head.appendChild(style);
  }

  function showBanner(onAnswer) {
    injectStyles();
    var wrap = document.createElement('div');
    wrap.className = 'sn-consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Cookie notice');

    // Deliberately the standard formulation rather than anything written
    // fresh. A cookie notice is scanned, not read: people recognise the shape
    // in half a second and act on it, and unfamiliar wording makes them stop
    // and parse a legal notice, which is the opposite of what it is for. The
    // conventional phrasing has also been through far more legal review than
    // this project could give it. Only the specifics change - what the cookies
    // are for, and who processes the data.
    var heading = document.createElement('strong');
    heading.className = 'sn-consent-heading';
    heading.textContent = 'Cookies';

    var text = document.createElement('p');
    text.className = 'sn-consent-text';
    text.appendChild(heading);
    text.appendChild(document.createTextNode(
      'We use cookies to analyse how this site is used and to measure our ' +
      'advertising. Data is shared with PostHog and Google, who process it ' +
      'for us. We do not use them to personalise ads, and we do not sell ' +
      'data. These cookies are optional \u2014 if you reject them, we will ' +
      'only store your choice. Read our '
    ));

    var link = document.createElement('a');
    link.className = 'sn-consent-link';
    link.href = PRIVACY_URL;
    link.textContent = 'Privacy Policy';
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    text.appendChild(link);
    text.appendChild(document.createTextNode(' and '));

    var googleLink = document.createElement('a');
    googleLink.className = 'sn-consent-link';
    googleLink.href = GOOGLE_DATA_URL;
    googleLink.textContent = 'how Google uses data';
    googleLink.setAttribute('target', '_blank');
    googleLink.setAttribute('rel', 'noopener noreferrer');
    text.appendChild(googleLink);
    text.appendChild(document.createTextNode('.'));

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'sn-consent-yes';
    yes.textContent = 'Accept';

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'sn-consent-no';
    no.textContent = 'Reject';

    var buttons = document.createElement('div');
    buttons.className = 'sn-consent-buttons';
    buttons.appendChild(no);
    buttons.appendChild(yes);

    wrap.appendChild(text);
    wrap.appendChild(buttons);

    function answer(granted) {
      remember(granted ? 'granted' : 'denied');
      if (granted) recordConsent();
      wrap.remove();
      onAnswer(granted);
    }

    yes.addEventListener('click', function () { answer(true); });
    no.addEventListener('click', function () { answer(false); });

    function attach() { document.body.appendChild(wrap); }
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  }

  // Resolves to true when we may measure this visitor, false when we may not.
  // Never rejects: a failure resolves false, so a caller can await it without
  // a catch and without the risk of a rejected promise being read as consent.
  var ready = new Promise(function (resolve) {
    var saved = remembered();
    if (saved === 'granted') { grant(); return resolve(true); }
    if (saved === 'denied') { return resolve(false); }

    resolveCountry().then(function (country) {
      var needsAsking = country === null || CONSENT_REQUIRED.indexOf(country) !== -1;

      if (!needsAsking) {
        grant();
        remember('granted');
        return resolve(true);
      }

      showBanner(function (granted) {
        if (granted) grant();
        resolve(granted);
      });
    });
  });

  window.snConsent = {
    ready: ready,
    // Exposed so a privacy page can offer a way back. Clearing the stored
    // answer means the next page load asks again.
    forget: function () {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) {}
    }
  };
})();

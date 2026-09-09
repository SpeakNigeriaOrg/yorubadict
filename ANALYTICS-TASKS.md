# Analytics implementation — task handoff

Companion to `ANALYTICS.md`, which holds the reasoning. This holds the work.
Written 2026-09-04.

Every task names the repo it happens in, what it depends on, and how to tell it
is done. **`analytics/events.schema.json` is the contract** between the three
repos: event and property names come from there, not from prose, and a task that
invents a name has failed even if it runs.

---

## Before anyone starts

Four things gate the code, and none of them are code.

| # | Blocker | Who | Notes |
|---|---|---|---|
| B1 | **Land or stash `website-games`** | human | `public/tones/app.js` has 136 insertions / 43 deletions uncommitted — a rewrite of the tone synthesis. It is the file G2 and G3 edit. An agent starting there now will conflict with the most heavily-reasoned code in that repo. |
| B2 | **PostHog project** | human | US region, one project, all three domains. **The region cannot be changed later.** Produces the API key and host that S1 needs. Build against a placeholder until it exists. |
| B3 | **Does anyone read the search feedback?** | human | If nobody will, build `search_settled` (D5) and skip the "none of these" control (D6). A queue nobody reads is a promise broken quietly — see ANALYTICS.md §6.4. |
| B4 | **Test expectations for the other two repos** | human | This repo has `node --test` and a paint budget. `website` and `website-games` have no `package.json`, no tests, no CLAUDE.md. Either add minimal test infrastructure or accept manual verification there. Changes the acceptance criteria for every G and W task. |

Not a blocker, and worth starting today because **its data is not retroactive**:
Search Console verification on all three domains. Two DNS verifications cover
all three sites, since `speaknigeria.org` and `games.speaknigeria.org` share a
registrable domain.

---

## Dependency graph

```
S1 (shared track + consent)
 ├─→ D1 → D2 → D3 → D4 → D5 → D6
 │         └─→ D7  (spelling-page renderer, independent of D3+)
 ├─→ G1 → G2 → G3
 │    └─→ G4 → G5
 └─→ W1

A1 (Ads tag)     depends on S1 + at least one of D/G/W landing
A2 (conversions) depends on A1 + B2
C1..C3 (copy)    independent of all code; human review required
```

S1 is the only true bottleneck. After it, the three repos run in parallel.

---

## S — Shared foundation

### S1. The `track()` wrapper and consent component

**Repo:** `yorubadict` is the canonical home (it has the build tooling and the
tests); a script copies the built files into the other two.
**Depends on:** nothing. **Blocks:** everything.

Build:

- `analytics/track.js` — one small module exporting `track(name, props)`, which
  adds `site` and forwards to PostHog. Call sites must know nothing about
  PostHog; swapping tools later touches this file only.
- `analytics/consent.js` — Google consent mode v2, defaulting to `denied`,
  resolving the visitor's country, then either showing a banner (EEA/UK) or
  calling `update` with `granted` (everywhere else).
  - Country comes from `/cdn-cgi/trace`, which every Cloudflare-proxied domain
    serves and which returns a `loc=` line. Confirmed working on
    yorubadict.com. One fetch, parse one line, no library.
  - **Order matters: default denied, resolve, then upgrade.** Never the reverse,
    or EEA visitors are tracked during the round trip.
- `analytics/copy-to-siblings.mjs` — copies both files into `~/Dev/website` and
  `~/Dev/website-games`. None of the three repos has a build step, so this is
  the only thing keeping them from drifting.
- Events fired before the tag is ready must queue and flush. PostHog's snippet
  stubs its own queue; `gtag` needs the same treatment.

**Done when:** `track()` is callable and queues before consent resolves; a
forced EEA country shows the banner and sends nothing until accepted; a
non-EEA country sends without a banner; the copy script produces byte-identical
files in all three repos.

---

## D — yorubadict.com

The largest workstream, and the only one with a paint budget under test.

### D1. Load the tags behind the existing paint gate

**Depends on:** S1.

`test/paint-budget.test.mjs` drives a real browser and fails if anything heavy
is requested before the largest paint. Its header records the same code scoring
65 instead of 99 on load ordering alone. Two third-party tags in the template
head are exactly what it exists to catch.

`app.js:1115–1146` already holds the gate: a promise that resolves on the
`largest-contentful-paint` PerformanceObserver entry, with idle and timeout
fallbacks. **Extract it into a named promise and have both consumers await it**
— the existing `entries.json` fetch and the new analytics loader. Do not write a
second gate, and read the comment above it before touching it.

The snippet itself goes in the prerender template in `build/lib/prerender.mjs`,
then `npm run build` regenerates the pages. Not the Cloudflare dashboard.

**Done when:** `npm run test:paint` passes on both viewports, and the tags are
requested after the LCP entry in a throttled run.

### D2. SPA pageviews

**Depends on:** D1.

`interceptLinks` (`app.js:548`) and `handleRoute` (`app.js:651`) mean every
navigation after the first is `pushState` with no document load. The default
one-pageview-per-load reports a single view for a visit that read twenty
entries. Either set `capture_pageview: 'history_change'` or capture explicitly
inside `handleRoute`.

**Done when:** navigating between five entries in one visit produces five
pageviews with correct paths.

### D3. Entry and relation events

**Depends on:** D2. **Events:** `entry_view`, `building_block_followed`,
`relation_followed`, `alternatives_opened`, `dialect_panel_opened`,
`hedge_explainer_opened`, `data_quality_opened`, `outbound_click`,
`pwa_installed`.

All the entry-page affordances are delegated from one listener on
`entryContent`, because `entry-render.js` rebuilds the markup with `innerHTML`
on every render. Hook the existing delegation; do not add per-element listeners.

`entry_view` carries `source` (`search` / `spelling-page` / `relation` /
`direct`), which D4 depends on.

### D4. Spelling-page events

**Depends on:** D3. **Events:** `spelling_page_view`, `sense_chosen`.

`/yo/<spelling>` for the 829 ambiguous spellings is the word-ad landing page.
`sense_chosen` is an `entry_view` whose `source` is `spelling-page` — someone
landed on a toneless spelling, saw it was several words, and picked one.

### D5. `search_settled`

**Depends on:** D2. **Events:** `search_settled`.

`onSearchInput` debounces at **60ms** (`app.js:766`), which is effectively per
keystroke — typing `ilé` runs three searches, two abandoned by construction. Do
not log one event per search. Fire once per search *intent*: query unchanged for
about 1.5s, or blur, clear, or navigation away.

`refinedFromPrevious` marks the case where the next episode's query is a prefix
extension or diacritic variant of this one, which is how a real end-of-search is
told apart from someone still typing.

Note for whoever analyses this: `clicked: false` does **not** mean failure.
`renderResults` (`app.js:277`) already puts the meaning in the result row, so a
reader who searched `ilé`, read "home, house, abode" and stopped was answered.

**Done when:** typing a six-character word with pauses produces one event, not
six; the query text is present; `refinedFromPrevious` is true for a mid-typing
prefix and false for a fresh word.

### D6. The "none of these" control

**Depends on:** D5 **and B3.** **Events:** `search_none_matched`.

A small control on the result list. Skip entirely if B3 says nobody will read
the queue.

### D7. `handleRoute` spelling-page renderer

**Depends on:** D1. Independent of D2–D6.

`handleRoute` has no renderer for `/yo/<spelling>` — its own comment says a
click arriving there falls through to the welcome page while a direct visit gets
the real file. Ad clicks are direct visits and work today; in-app links do not.
A real bug, worth fixing regardless of ads.

---

## G — games.speaknigeria.org

**All G tasks are blocked on B1.** Highest value of the three sites: currently
zero visibility, and it is an ad destination.

### G1. Wire `track()` and the base events

**Depends on:** S1, B1. **Events:** `game_start`, `playlist_selected`,
`word_shown`, `hint_used`, `audio_replayed`, `word_skipped`, `word_back`,
`level_complete`, `level_abandoned`, `fullscreen_toggled`.

Both games have parallel function names — `selectPlaylist`, `loadLevel`,
`loadWord`, `toggleToneHint`, `playFullWordAudio`, `moveToNextWord`, `prevWord`,
`skipWord`, `toggleFullscreen` — so the same instrumentation shape applies
twice. Exact line numbers are in the schema file.

**`level_abandoned` fires on `pagehide` only, never `visibilitychange`.** These
are played in classrooms where a teacher switching tabs is normal.

**Add a content stamp.** `sessions.json`, `vocab.json` and `syllables.json`
carry no version marker today. Add one where `sync_dictionary_data.py` writes
them, read it at boot, and put it on every game event as `contentVersion`.

This is what keeps the analytics honest across content changes, and the git log
shows those are routine — "drop Syllable Practice, double the Tone Pattern
sets", "drop Word Practice, generate 7 Tone Pattern sets". Without a stamp, a
level reorganisation reuses a `levelId` for different words and two
incomparable series merge into one that looks continuous. With it, every query
can segment on content and the merge becomes visible instead of silent.

Related, and the reason the schema carries as many structural properties as it
does: group analyses by `syllableCount`, `tonePattern`, `speaker` and
`category`, not by `word` or `levelId`. See `designNote` in the schema.

### G2. The phonics wrong-answer path

**Depends on:** G1. **This is a code change, not a `track()` call.**

`checkWinCondition` (`phonics/app.js:564`) is a bare `if (isMatch)` with no
`else`. A full but incorrect queue falls through and does nothing, so there is
no failure path to hook. Add one.

**Constraint: do not introduce scoring.** Neither game has a score, lives, or a
penalty, and that is deliberate — see the comment above `playWrong` in
`tones/app.js`. The wrong branch exists to report, not to punish. Match what
tones already does: mark the wrong cards, let them retry.

### G3. `answer_checked`

**Depends on:** G2. **The highest-value event in the plan.**

`tones/checkAnswer` (`tones/app.js:915`) already has both branches. Phonics has
one only after G2.

Recording `expectedTones` against `chosenTones` gives a confusion matrix of
Yorùbá tone perception — whether learners mix high with mid more than mid with
low, which syllables are reliably hard, whether accuracy climbs within a
session, whether one speaker's recordings are harder than another's. That is
curriculum data for Speak Nigeria's classes, and none of those questions has
been asked yet. Carry every property in the schema even where its use is not
obvious: properties are what make later questions askable.

### G4. URL routing

**Depends on:** G1. **A feature build, not tracking work.**

Neither game reads or writes the address bar, so there is nothing to share and
no way to link a level. Add routing that encodes `levelId` and category.

### G5. Share links

**Depends on:** G4. **Events:** `share_link_created`, `share_link_opened`.
**Blocks a primary conversion.**

Traffic is teacher-driven, so the thing that matters is sending a class one
specific level, not a generic "share this site". Give the shared URL its own
campaign parameter so the referral loop measures itself with no cross-domain
work.

---

## W — speaknigeria.org

### W1. Pageviews and outbound clicks

**Depends on:** S1. **Events:** `$pageview`, `outbound_form_click`,
`outbound_click`.

Six static pages, repo root is the deploy root. The three Google Form links are
all in `courses.html`. Smallest workstream — a reasonable shakedown of S1 before
the bigger repos commit to it.

`outbound_form_click` is a click, not a submission, and overcounts by however
many people open a form and abandon it. That ceiling is architectural; see
ANALYTICS.md §9.3.

---

## A — Google Ads

### A1. The Ads tag

**Depends on:** S1, and at least one site landing. Site-wide, under consent
mode, gated on the same signal as PostHog. No GA4.

### A2. Conversion actions

**Depends on:** A1, B2. Eight definitions, per ANALYTICS.md §7.3 and the
`conversions` block of the schema.

**Count: One, never Every**, on all of them. Someone tracing a word family may
click twelve building-block pills in a visit; that is one success, and telling
the bidding algorithm it was twelve teaches it to chase the longest browse.

Never define arrival on the ad's landing page as a conversion.

---

## C — Copy

**Not for agent handoff.** Draft for human review. The plan is explicit that the
current privacy copy went wrong by being written without enough thought, and the
same failure mode applies to everything here.

- **C1. The privacy copy.** `page-render.js:168` claims the dictionary "collects
  nothing about you". Shipping any tag makes that false, so it is revised in the
  same change as D1. Plain and accurate, without the boast.
- **C2. The Wiktionary link wording.** `entry-render.js:59` already links each
  entry to its Wiktionary page. Reword it so it reads as where to go when
  something looks wrong. This is the whole of the entry-feedback plan — see
  ANALYTICS.md §6.4 for why there is no report form.
- **C3. Ad copy for the 25 building blocks.** From
  `data/building-blocks.json`. The pitch is the family, not the definition: `ṣe`
  is not interesting as "to do", it is interesting as the root of 58 words.

---

## Launch order

Per ANALYTICS.md §7.4, the account CTR floor pools across both advertised
domains, so a weak campaign endangers the others.

1. Games campaigns and the dictionary-as-a-tool campaign.
2. The 25 building-block word ads, small and watched weekly — the experiment
   most likely to draw impressions without clicks, which is what erodes a pooled
   CTR floor. Pause these rather than the account.

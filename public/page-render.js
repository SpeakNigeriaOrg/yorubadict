// public/page-render.js
//
// The six pages this dictionary writes itself: the welcome screen, About, About
// Speak Nigeria, Language of Connections, Key Building Blocks, and Contribute.
// Everything else on the site comes from Wiktionary.
//
// Like entry-render.js, these used to write straight into the document, and now
// return strings, because the build needs the same markup to write real HTML
// files. A page whose text only exists after JavaScript runs is a page a search
// engine reads as empty, and About is the page that explains where the data comes
// from and who made it.
//
// Each page is a value: a title, a one-line description for the <meta> tag, and a
// function returning the markup. Two of them take data - the building-block list
// and the contribute queue are generated, and both are fetched on first visit
// rather than at boot. Called with nothing, they render the surrounding prose and
// a placeholder, which is exactly what the prerendered file should contain: the
// prose is the part worth reading, and the list is current only when fetched.

export function createPageRenderer(ctx) {
  // The four words sọ̀rọ̀ sókè is made of, in the order the phrase says them.
  // Not written out by hand: this is the etymology Wiktionary records on the
  // phrase, morpheme for morpheme, and each meaning here is the one that entry
  // gives for that part - òkè is "heights" in this compound and "mountain, hill"
  // on its own page, and the compound's reading is the one that explains the
  // name. So the section is a worked example of the thing the dictionary does
  // rather than a decorative etymology beside it.
  const NAME_PARTS = [
    ['en-sọ-yo-verb-PDpIT1dp', 'sọ', 'verb', 'to say'],
    ['en-ọrọ-yo-noun-dCQfuIN9', 'ọ̀rọ̀', 'noun', 'word'],
    ['en-si-yo-prep-aWOju~yQ', 'sí', 'prep', 'to'],
    ['en-oke-yo-noun-xoCPmvRC', 'òkè', 'noun', 'heights'],
  ];

  function welcomeHtml() {
    // Two halves, and the rule between them is the point. Above it, everything
    // is addressed to somebody who came here to look a word up. Below it is who
    // runs the site and why, which is a different question by a different
    // reader, and which nothing on this page answered before: the footer's
    // "A Speak Nigeria project" is a credit, not an answer.
    //
    // The name carries the introduction because it happens to say all three
    // things at once - what the dictionary is for, where its words come from,
    // and what its design is built around - so the nonprofit arrives through
    // the dictionary rather than beside it.
    const parts = NAME_PARTS.map(([id, form, pos, meaning]) => `
          <a class="sibling-row" href="${ctx.pathFor(id)}">
            <span class="sibling-word">${form}</span>
            <span class="sibling-meta">${pos}</span>
            <span class="sibling-gloss">${meaning}</span>
          </a>`).join('');
    return `
      <div class="entry-welcome">
        <h1>Ẹ káàbọ̀!</h1>
        <p>Welcome! Search this free dictionary in Yorùbá (with or without tone marks or underdots), or search by its English definition. After your first visit, the dictionary is on your device, and it works with no connection.</p>
        <p>Or open a word and discover Yorùbá in a new way, finding the connections between words. Every entry lists its <strong>Component words</strong>, the words it is made from, and <strong>Used in</strong>, the words made from it. For example, <a href="${ctx.pathFor('en-ounjẹ-yo-noun-wfAmWC~m')}">oúnjẹ</a>, food, is made from <a href="${ctx.pathFor('en-ohun-yo-noun-XelNaRrj')}">ohun</a>, a thing, and <a href="${ctx.pathFor('en-jijẹ-yo-noun-w9aEvSCL')}">jíjẹ</a>, eating — and is itself used in <a href="${ctx.pathFor('en-ounjẹ_aarọ-yo-noun-fFjqJTYo')}">oúnjẹ àárọ̀</a>, breakfast, <a href="${ctx.pathFor('en-ounjẹ_alẹ-yo-noun-FXhxqX-b')}">oúnjẹ alẹ́</a>, dinner, and <a href="${ctx.pathFor('en-ile-ounjẹ-yo-noun-7iddZNr8')}">ilé-oúnjẹ</a>, a restaurant. Or start at <a href="${ctx.pathFor('en-ẹrọ-yo-noun-MsZxKZjf')}">ẹ̀rọ</a>, a machine, used in <a href="${ctx.pathFor('en-ẹrọ_ayarabiaṣa-yo-noun-sIRyAz9N')}">ẹ̀rọ ayárabíàṣá</a>, a computer, and <a href="${ctx.pathFor('en-ẹrọ_amuletutu-yo-noun-tpAybTd7')}">ẹ̀rọ amúlétutù</a>, an air conditioner — or at <a href="${ctx.pathFor('en-ade-yo-noun-Dc-vq1-A')}">adé</a>, a crown.</p>

        <svg class="welcome-diagram" viewBox="0 0 420 258" role="img"
          aria-label="ohun, a thing, plus jíjẹ, eating, make oúnjẹ, food. oúnjẹ is in turn used in oúnjẹ àárọ̀, breakfast, and ilé-oúnjẹ, a restaurant.">
          <path class="dg-line" d="M85 58 V82 H335 V58 M210 82 V100" />
          <path class="dg-arrow" d="M205 96 h10 l-5 8 Z" />
          <path class="dg-line" d="M210 154 V176 M106 176 H314 M106 176 V194 M314 176 V194" />
          <path class="dg-arrow" d="M101 190 h10 l-5 8 Z" />
          <path class="dg-arrow" d="M309 190 h10 l-5 8 Z" />

          <rect class="dg-box" x="10" y="10" width="150" height="48" rx="6" />
          <text class="dg-word" x="85" y="32" text-anchor="middle">ohun</text>
          <text class="dg-gloss" x="85" y="48" text-anchor="middle">a thing</text>

          <text class="dg-plus" x="210" y="41" text-anchor="middle">+</text>

          <rect class="dg-box" x="260" y="10" width="150" height="48" rx="6" />
          <text class="dg-word" x="335" y="32" text-anchor="middle">jíjẹ</text>
          <text class="dg-gloss" x="335" y="48" text-anchor="middle">eating</text>

          <rect class="dg-box current" x="135" y="106" width="150" height="48" rx="6" />
          <text class="dg-word" x="210" y="128" text-anchor="middle">oúnjẹ</text>
          <text class="dg-gloss" x="210" y="144" text-anchor="middle">food</text>

          <rect class="dg-box" x="8" y="200" width="196" height="48" rx="6" />
          <text class="dg-word" x="106" y="222" text-anchor="middle">oúnjẹ àárọ̀</text>
          <text class="dg-gloss" x="106" y="238" text-anchor="middle">breakfast</text>

          <rect class="dg-box" x="216" y="200" width="196" height="48" rx="6" />
          <text class="dg-word" x="314" y="222" text-anchor="middle">ilé-oúnjẹ</text>
          <text class="dg-gloss" x="314" y="238" text-anchor="middle">a restaurant</text>
        </svg>

        <section class="welcome-about">
          <h2>Sọ̀rọ̀ sókè</h2>
          <p>The name of this dictionary means <a href="${ctx.pathFor('en-sọrọ_soke-yo-verb-zjLiM20R')}">speak up</a>. It is made of four words:</p>
          <div class="sibling-list">${parts}
          </div>
          <p>Say words to the heights. Those four are its component words, and each of them opens onto its own. <a href="${ctx.pagePath('language-of-connections')}">Language of connections</a> introduces teachers and students alike to this view of Yorùbá as a living language of connections, and how it can make learning more engaging.</p>
          <p>The words come from Wiktionary, which anyone can edit. A word is here because somebody spoke up. A word that is missing stays missing until somebody does. <a href="${ctx.pagePath('contribute')}">Contribute</a> lists the gaps we have found, and the edit each one needs.</p>
          <p><a href="${ctx.pagePath('speak-nigeria')}">Speak Nigeria</a> makes this dictionary. We are a 501(c)(3) nonprofit, and we build free resources so children can learn Nigerian heritage languages and keep them.</p>
        </section>
      </div>
    `;
  }

  function aboutHtml() {
    return `
      <div class="about-content">
        <h1>About the Dictionary</h1>
        <p class="about-lede">Wiktionary's crowdsourced Yorùbá dictionary is one of the best resources online for learning Yorùbá. Not only does it have more defined words than most Yorùbá dictionaries, but it also includes details of how longer words are constructed from shorter words. Learning to recognize these compound words is a core part of learning the language. The Wiktionary website itself, though, is poorly matched to language learners, whether in terms of quick single-word lookups or language exploration. This project keeps the data and rebuilds the user experience.</p>

        <h2>Why care about etymology?</h2>
        <p>We can build a deep, comprehensive, and growing dictionary through the use of Wiktionary. We hope to not only make it easier to navigate, but encourage people to contribute — if you can't find a word in our dictionary, add it to Wiktionary! Beyond that, Yorùbá is fundamentally different from English in how it builds larger words out of smaller building-block words. People often think of etymology as an academic curiosity, but in languages like Yorùbá, being able to recognize compound words is part of fluency. Wiktionary is not comprehensive in these breakdowns, but it's a better source for them than anywhere else online. We make it easier to find and explore these links — <a href="${ctx.pagePath('language-of-connections')}">Language of connections</a> is the long answer, with three sample vocabulary units built out of the ones this dictionary records.</p>

        <h2>Where Wiktionary falls short</h2>
        <p>Wiktionary's own site is difficult to use. To reliably find a word in Yorùbá, you generally want to type it without tone marks, but with underdots. Other combinations generally don't work. Wiktionary will then search every one of its languages for words with that spelling, and present every single result, with definitions, etymology, informative tables, and other details for every matching word in every language. Yorùbá, starting at Y, will be down at the bottom of that page. Not very fun for language learners! Furthermore, because Wiktionary is crowdsourced, it can be messy. Key details like etymology links between words are incredibly valuable to language learners but inconsistent in their entry and presentation. Sometimes a parent word documents the words derived from it, sometimes only the derived word documents where it came from, sometimes both, sometimes neither, depending entirely on which page a contributor happened to edit. Tracing a family of related words means guessing which page has the link and searching for it by hand.</p>

        <h2>What we changed</h2>
        <ul>
          <li><strong>Cleaned and reorganized.</strong> We start from Kaikki's already-cleaned extraction of Wiktionary's raw wikitext, then apply a light additional layer of our own processing. Crowdsourced data keeps changing, so we refresh from the source and rerun those checks with every release — tell us if you spot a quirk we have missed.</li>
          <li><strong>Searchable.</strong> With or without tone marks, with or without underdots, in English or Yorùbá.</li>
          <li><strong>Restructured relationships.</strong> Whichever side of a relationship Wiktionary happens to document — parent or derived word — we automatically synthesize the missing reverse link, turning its inconsistent, crowdsourced etymology links into a real, two-way, navigable path through the language.</li>
        </ul>

        <h2>Part of Speak Nigeria</h2>
        <p>This dictionary is a project of <a href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Speak Nigeria</a>, a nonprofit building free games and resources so children can learn and keep Nigerian heritage languages. If you're learning Yorùbá, our structured courses might also be a good fit.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">See our Yorùbá courses</a>
          <a class="about-btn ghost" href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Visit speaknigeria.org ↗</a>
        </div>

        <h2>Read next</h2>
        <ul>
          <li><a href="${ctx.pagePath('building-blocks')}">Key building block words</a> — the 25 roots that build the most other words in this dictionary.</li>
          <li><a href="${ctx.pagePath('language-of-connections')}">Language of connections</a> — how words are built from words, three sample vocabulary units, and how to teach from them.</li>
          <li><a href="${ctx.pagePath('speak-nigeria')}">About Speak Nigeria</a> — the nonprofit behind this.</li>
        </ul>
      </div>
    `;
  }

function speakNigeriaHtml() {
  return `
    <div class="about-content">
      <h1>About Speak Nigeria</h1>
      <p class="about-lede">Speak Nigeria is a 501(c)(3) nonprofit, registered as SpeakNigeria Inc, EIN 99-2964468. We help children learn and keep Nigerian languages, and we build the free digital resources they learn from. This dictionary is one of them.</p>

      <h2>Why we exist</h2>
      <p>A language can slip away in a single generation. It happens in the diaspora, but it also happens across urban Nigeria, where English-dominant classrooms, internal migration, and rapid cultural shifts leave children disconnected from the languages of their homes.</p>
      <p>The loss usually happens quietly: children understand more than they speak, then speak less than they understand, until the language becomes something only their grandparents spoke.</p>
      <p>A language is never just vocabulary. It carries family memory, cultural identity, and belonging. When a child keeps their language, they keep all of it.</p>
      <p>Yet parents and educators trying to pass these languages on face an immediate hurdle: for most Nigerian languages, modern, child-friendly digital resources simply do not exist. Where tools do exist, they are rarely built for the way children naturally learn.</p>

      <h2>Built for the language, not adapted to it</h2>
      <p>A child learning Spanish has thousands of apps, games and dictionaries built around how Spanish works. A child learning Yorùbá is met with silence, or with software built for European languages and Yorùbá poured into it. Tone marks survive as decoration. Words built from other words are listed as separate vocabulary to memorise — the easiest thing for a computer and the hardest for a child.</p>
      <p>Two things carry meaning in Yorùbá that most software throws away, and both are what our resources are built on.</p>
      <p><strong>Words are made of words.</strong> <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> means Earth. It is <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> (home) and <a href="${ctx.pathFor('en-aye-yo-noun-SG6kYiTR')}">ayé</a> (life). A learner who knows those two words can read the third without being taught it, and that is true of a great deal of the language. This dictionary shows those parts on every entry, in both directions. <a href="${ctx.pagePath('language-of-connections')}">Language of connections</a> is the longer account, written for teachers and learners alike.</p>
      <p><strong>Tone is part of the word.</strong> It is not an accent added to a spelling: change the tone and you have a different word. Our resources treat it that way from the first lesson.</p>
      <p>We are starting with Yorùbá, where our curriculum is deepest. Igbo is next, with Hausa, Edo (Bini), Ijaw and Efik to follow.</p>

      <h2>What we make</h2>
      <ul>
        <li><strong>This dictionary</strong>, free, built on open data that belongs to everybody.</li>
        <li><strong>Language games</strong> on our website, free and open source.</li>
        <li><strong>A larger open-source game</strong> for learning several Nigerian languages, in development.</li>
        <li><strong>A contribution platform</strong>, where volunteers add translations, spellings and pronunciations across Nigerian languages.</li>
        <li><strong>Live courses</strong>, taught by native speakers. These are the one thing we charge for, and they are on <a href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">speaknigeria.org</a> rather than here.</li>
      </ul>

      <h2>How this is funded</h2>
      <p>This dictionary is free and non-commercial. It carries no advertising, sells nothing, and collects nothing about you — after your first visit the whole dictionary is on your device and your searches never leave it.</p>
      <p>To sustain the work, our parent nonprofit charges tuition for small-group live classes, hosted on <a href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">speaknigeria.org</a> rather than here. As a 501(c)(3) nonprofit, that tuition is used for:</p>
      <ul>
        <li><strong>Teacher compensation.</strong> Paying native-speaking educators for instructional time.</li>
        <li><strong>Public reinvestment.</strong> Hosting, maintaining and developing the free resources listed above.</li>
      </ul>
      <p>Our tax-exempt status and annual Form 990-N filings are public under EIN 99-2964468 in the IRS <a href="https://apps.irs.gov/app/eos/" target="_blank" rel="noopener noreferrer">Tax Exempt Organization Search</a>.</p>

      <h2>Contribute</h2>
      <p>The words here come from Wiktionary, which anyone can edit. A correction made there reaches this dictionary at the next refresh, and everything else in the world built on Yorùbá Wiktionary at the same time. <a href="${ctx.pagePath('contribute')}">Contribute</a> lists the gaps we have found and the edit each one needs.</p>

      <div class="about-actions">
        <a class="about-btn primary" href="${ctx.pagePath('welcome')}">Search the dictionary</a>
        <a class="about-btn ghost" href="${ctx.pagePath('contribute')}">Contribute an entry</a>
        <a class="about-btn ghost" href="https://speaknigeria.org" target="_blank" rel="noopener noreferrer">Visit Speak Nigeria ↗</a>
      </div>

      <p>Questions, ideas or feedback: <a href="mailto:hello@speaknigeria.org">hello@speaknigeria.org</a>.</p>

      <p class="blocks-note">SpeakNigeria Inc is a 501(c)(3) nonprofit registered in the United States, EIN 99-2964468. We host community educational programs and develop open-access resources for parents, teachers and schools everywhere. <a href="https://speaknigeria.org/about" target="_blank" rel="noopener noreferrer">speaknigeria.org/about</a></p>
    </div>
  `;
}

  // The five sample vocabulary units.
  //
  // Each is a family that already exists in the dictionary: a few short words,
  // and the longer words they make between them. They vary in size on purpose -
  // the smallest here is nine words and has the largest payoff of any of them.
  // Found with tools/curriculum/find-units.mjs, which is a research tool and not
  // part of the build; which families are worth a reader's time is a judgement,
  // so the chosen ones are written out here rather than generated.
  //
  // They are ordered from the most concrete to the most abstract, and they lean
  // on each other: ilé-ìwé is built in the second and used in the third, so a
  // reader arrives at ọmọ ilé ìwé already holding two of its three words.
  //
  // Every id below is checked at build time: build/lib/prerender.mjs collects
  // the ids these pages ask for, and build/normalize.mjs fails the build if one
  // is no longer in the dictionary. Otherwise a refresh that drops a word leaves
  // a link to the front page with a sentence around it still promising a word.
  //
  // What is deliberately NOT here: greetings. Yorùbá greetings are built on kú,
  // and Wiktionary has one kú, "to die", with all 33 greetings hanging off it.
  // Whatever kú is doing in káàárọ̀, it is not saying anything about death, and
  // a unit built on that entry would teach the gap in the source as a fact about
  // the language.
  const UNITS = [
    {
      title: 'One: your mother’s mother',
      lede: `<p>Yorùbá has no word for grandmother. It does not need one.</p>
        <p><em>ìyá</em> is mother. So your mother’s mother is <em>ìyá ìyá</em>, and your mother’s father is <em>bàbá ìyá</em>. You say what the person is, and then whose.</p>`,
      learn: [
        ['en-iya-yo-noun-SlO7ppnL', 'ìyá', 'noun', 'mother'],
        ['en-baba-yo-noun-unRA3QzP', 'bàbá', 'noun', 'father'],
        ['en-ọmọ-yo-noun-3cnmaRlC', 'ọmọ', 'noun', 'child'],
        ['en-iye-yo-noun-IImldv3w', 'iye', 'noun', 'mother (a respectful word)'],
        ['en-iba-yo-noun-iKGIHwAl', 'iba', 'noun', 'father (a respectful word)'],
      ],
      built: [
        ['en-iya_iya-yo-noun-HZ9Wyzdv', 'ìyá ìyá', 'grandmother, on your mother’s side', 'ìyá + ìyá'],
        ['en-baba_iya-yo-noun-xiukPNPc', 'bàbá ìyá', 'grandfather, on your mother’s side', 'bàbá + ìyá'],
        ['en-omiye-yo-noun-AAMjduGD', 'omiye', 'a sibling by the same mother', 'ọmọ + iye'],
        ['en-ọmiba-yo-noun-QQYF-bjQ', 'ọmiba', 'a sibling by the same father', 'ọmọ + iba'],
      ],
      note: `<p>Nine words, and two of them are things English cannot say in one word at all.</p>
        <p><a href="__P:en-omiye-yo-noun-AAMjduGD__">omiye</a> is a child of the same mother. <a href="__P:en-ọmiba-yo-noun-QQYF-bjQ__">ọmiba</a> is a child of the same father. English needs a whole phrase for either — half-brother on my mother’s side — and Yorùbá needs one short word, made of two words a child already knows.</p>`,
    },
    {
      title: 'Two: the place where it happens',
      lede: `<p><em>ilé</em> is a house. Put it in front of a thing and you get the place where that thing is.</p>
        <p>Learn <em>ilé</em> and seven ordinary nouns, and seven more words come with them.</p>`,
      learn: [
        ['en-ile-yo-noun-VQM0lVeW', 'ilé', 'noun', 'home, house'],
        ['en-iwe-yo-noun-OCY1yTJb', 'ìwé', 'noun', 'paper, book'],
        ['en-iṣẹ-yo-noun-AOE-169V', 'iṣẹ́', 'noun', 'work'],
        ['en-ẹyẹ-yo-noun-elF57swP', 'ẹyẹ', 'noun', 'bird'],
        ['en-oyin-yo-noun-YsuBtZBK', 'oyin', 'noun', 'bee'],
        ['en-ọba-yo-noun-lzwbK3Rk', 'ọba', 'noun', 'king, queen'],
        ['en-ẹjọ-yo-noun-u~zUFgoe', 'ẹjọ́', 'noun', 'a legal case'],
        ['en-ounjẹ-yo-noun-wfAmWC~m', 'oúnjẹ', 'noun', 'food'],
      ],
      built: [
        ['en-ile-iwe-yo-noun-1k3r2ULX', 'ilé-ìwé', 'school', 'ilé + ìwé'],
        ['en-ileeṣẹ-yo-noun-5wfPhLrg', 'iléeṣẹ́', 'company, firm', 'ilé + iṣẹ́'],
        ['en-ile_ẹyẹ-yo-noun-UjceHYyt', 'ilé ẹyẹ', 'bird’s nest', 'ilé + ẹyẹ'],
        ['en-ile_oyin-yo-noun-kN5kAaSH', 'ilé oyin', 'beehive', 'ilé + oyin'],
        ['en-ile_ọba-yo-noun-7iqkSAW1', 'ilé ọba', 'palace', 'ilé + ọba'],
        ['en-ile_ẹjọ-yo-noun-F34atC2j', 'ilé ẹjọ́', 'court of law', 'ilé + ẹjọ́'],
        ['en-ile-ounjẹ-yo-noun-7iddZNr8', 'ilé-oúnjẹ', 'restaurant', 'ilé + oúnjẹ'],
      ],
      note: `<p>A bird’s house is a nest. A bee’s house is a hive. A king’s house is a palace. None of those is a metaphor in Yorùbá — it is what the word says.</p>
        <p>One of the eight is quietly two words already. <a href="__P:en-ounjẹ-yo-noun-wfAmWC~m__">oúnjẹ</a>, food, is <em>ohun</em> ("thing") pressed together with <em>jíjẹ</em> ("eating"): the thing that is eaten. So a restaurant is a house of the thing that is eaten, which is three words deep and still perfectly plain.</p>`,
    },
    {
      title: 'Three: the one who belongs to it',
      lede: `<p>You now have <em>ilé-ìwé</em>, a school. Put <em>ọmọ</em>, a child, in front of the whole thing: <em>ọmọ ilé ìwé</em>, the child of the house of books. A student.</p>
        <p>That word is three words deep and you could read it before anyone told you. <em>ọmọ</em> goes on to do the same job everywhere else.</p>`,
      learn: [
        ['en-ọmọ-yo-noun-3cnmaRlC', 'ọmọ', 'noun', 'child'],
        ['en-ile-yo-noun-VQM0lVeW', 'ilé', 'noun', 'home, house'],
        ['en-iwe-yo-noun-OCY1yTJb', 'ìwé', 'noun', 'paper, book'],
        ['en-ẹgbẹ-yo-noun-4Fbs-JEg', 'ẹgbẹ́', 'noun', 'team, club'],
        ['en-ọwọ-yo-noun-GwAXBqQY', 'ọwọ́', 'noun', 'hand'],
        ['en-ọdọ-yo-noun-nh52yVyc', 'ọ̀dọ̀', 'noun', 'someone’s presence'],
      ],
      built: [
        ['en-ile-iwe-yo-noun-1k3r2ULX', 'ilé-ìwé', 'school', 'ilé + ìwé'],
        ['en-ọmọ_ile_iwe-yo-noun-JkyMOBvx', 'ọmọ ilé ìwé', 'student', 'ọmọ + ilé-ìwé'],
        ['en-ọmọ_ẹgbẹ-yo-noun-4xq2Q8RP', 'ọmọ ẹgbẹ́', 'member', 'ọmọ + ẹgbẹ́'],
        ['en-ọmọ-ọwọ-yo-noun-HsPYyISP', 'ọmọ-ọwọ́', 'baby', 'ọmọ + ọwọ́'],
        ['en-ọmọ_ọdọ-yo-noun-A0vtD6EQ', 'ọmọ ọ̀dọ̀', 'servant', 'ọmọ + ọ̀dọ̀'],
        ['en-ile_ọmọ-yo-noun-cuxVkKH7', 'ilé ọmọ', 'uterus', 'ilé + ọmọ'],
      ],
      note: `<p><em>ọmọ</em> is a child, and in front of another word it is the one who belongs to that thing. The child of the school is a student. The child of the team is a member. <a href="__P:en-ọmọ-ọwọ-yo-noun-HsPYyISP__">ọmọ-ọwọ́</a>, the child of the hand, is a baby: one small enough to carry.</p>
        <p>And the last word turns the unit around. <em>ilé</em> in front of <em>ọmọ</em>, rather than the other way, gives <a href="__P:en-ile_ọmọ-yo-noun-cuxVkKH7__">ilé ọmọ</a> — the house of the child, which is the womb. Order decides which word is doing the describing.</p>`,
    },
    {
      title: 'Four: where you are from',
      lede: `<p><em>ilẹ̀</em> is the land — the ground itself. It turns up in most of the words Yorùbá uses for where a person comes from, and the other words in this family keep meeting each other.</p>
        <p>Watch <em>orí</em>, <em>ìbí</em> and <em>ọjọ́</em>. Each pairs with <em>ilẹ̀</em>, and each pairs with one of the others.</p>`,
      learn: [
        ['en-ilẹ-yo-noun-3j-~5Sdn', 'ilẹ̀', 'noun', 'land, ground'],
        ['en-ori-yo-noun-ny5tM6Nx', 'orí', 'noun', 'head, source'],
        ['en-ibi-yo-noun-96GGEfQu', 'ìbí', 'noun', 'birth'],
        ['en-ọjọ-yo-noun-lEwn5bl6', 'ọjọ́', 'noun', 'day'],
        ['en-ede-yo-noun-pO8wS6Qq', 'èdè', 'noun', 'language'],
        ['en-ile-yo-noun-VQM0lVeW', 'ilé', 'noun', 'home, house'],
        ['en-aye-yo-noun-SG6kYiTR', 'ayé', 'noun', 'world'],
      ],
      built: [
        ['en-orilẹ-yo-noun-cOCzn~lH', 'orílẹ̀', 'clan, lineage', 'orí + ilẹ̀'],
        ['en-orilẹ-ede-yo-noun-7Lwn8w8Z', 'orílẹ̀-èdè', 'country, nation', 'orílẹ̀ + èdè'],
        ['en-ibilẹ-yo-noun-2QKborSA', 'ìbílẹ̀', 'native, indigenous', 'ìbí + ilẹ̀'],
        ['en-ọjọ-ibi-yo-noun-BCLULGib', 'ọjọ́-ìbí', 'birthday', 'ọjọ́ + ìbí'],
        ['en-ọjọ-ori-yo-noun-AT9UQAyC', 'ọjọ́-orí', 'age', 'ọjọ́ + orí'],
        ['en-ileelẹ-yo-noun-zD~7f6bC', 'iléelẹ̀', 'bungalow', 'ilé + ilẹ̀'],
        ['en-ilẹ_aye-yo-noun-t8m1zNPj', 'ilẹ̀ ayé', 'Earth', 'ilẹ̀ + ayé'],
      ],
      note: `<p>Your lineage is the head of the land. Native means born of the land. A country is a lineage and a language together. Your birthday is the day of your birth, and your age is counted in days of your head.</p>
        <p>Nothing here is a chain of one popular word. <em>orí</em> meets <em>ilẹ̀</em> and it also meets <em>ọjọ́</em>. <em>ìbí</em> meets both of those in turn. Take any two of the four and there is usually a word waiting.</p>
        <p>And <a href="__P:en-orilẹ-ede-yo-noun-7Lwn8w8Z__">orílẹ̀-èdè</a>, a country, is built on <em>orílẹ̀</em>, which was already two words — the same second storey as <em>ọmọ ilé ìwé</em> in the third family.</p>`,
    },
    {
            title: 'Five: the subject, and the person who studies it',
      lede: `<p>This last one is a step up in register — the words are the kind that turn up in a university, not a kitchen. The machinery is exactly the same, and here it runs four steps deep.</p>
        <p>Two of the words to learn are not whole words. <em>ì-</em> and <em>oní-</em> are pieces that go on the front of a word and change what kind of thing it is. They are as much a part of the language as any noun, and Yorùbá leans on them constantly.</p>`,
      learn: [
        ['en-mọ-yo-verb-Vk7G5aRj', 'mọ̀', 'verb', 'to know'],
        ['en-i--yo-prefix-ndqtcuc5', 'ì-', 'prefix', 'turns a verb into a noun'],
        ['en-oni--yo-prefix-nTGMUeCG', 'oní-', 'prefix', 'one who has, owner of'],
        ['en-ẹda-yo-noun-llq7JUsQ', 'ẹ̀dá', 'noun', 'creation'],
        ['en-ede-yo-noun-pO8wS6Qq', 'èdè', 'noun', 'language'],
        ['en-ẹrọ-yo-noun-MsZxKZjf', 'ẹ̀rọ', 'noun', 'machine'],
      ],
      built: [
        ['en-imọ-yo-noun-4PiVhy1l', 'ìmọ̀', 'knowledge', 'ì- + mọ̀'],
        ['en-onimọ-yo-noun-e1FQ4Y17', 'onímọ̀', 'one who has knowledge', 'oní- + ìmọ̀'],
        ['en-imọ_ẹda-ede-yo-noun-1yixku0r', 'ìmọ̀ ẹ̀dá-èdè', 'linguistics', 'ìmọ̀ + ẹ̀dá + èdè'],
        ['en-onimọ_ẹda-ede-yo-noun-q6FVJLKJ', 'onímọ̀ ẹ̀dá-èdè', 'linguist', 'onímọ̀ + ẹ̀dá + èdè'],
        ['en-imọ_ẹrọ-yo-noun-3stlhxV2', 'ìmọ̀ ẹ̀rọ', 'technology', 'ìmọ̀ + ẹ̀rọ'],
      ],
      note: `<p>This family is a line rather than a web, which is why it is last. Follow it from the top and you can watch one word grow. <em>mọ̀</em> is to know. <em>ìmọ̀</em> is knowing, made a thing. <em>onímọ̀</em> is the person who holds it. <em>onímọ̀ ẹ̀dá-èdè</em> is the person who holds it about the making of language — a linguist. Four steps, and every step is one short piece added to the front.</p>
        <p>Read the last two side by side. <em>ìmọ̀ ẹ̀dá-èdè</em> is linguistics; <em>onímọ̀ ẹ̀dá-èdè</em> is a linguist. Three words each, two of the three the same, and the one that changes moves you from the subject to the person who does it. That is the same move as <em>ilé-ìwé</em> and <em>ọmọ ilé ìwé</em>, in a suit.</p>
        <p>Now take a harder job. A germ is too small to see, nobody knew it was there until recently, and a language that has always talked about illness suddenly has to name the thing causing it. English reached for Greek and produced <em>pathogen</em>, a word that tells an English speaker nothing at all.</p>
        <p>Yorùbá reached for two words a farmer already had. A pathogen is <a href="__P:en-kokoro_arun-yo-noun-vXspGfMl__">kòkòrò àrùn</a>: the insect of the disease. <em>ẹ̀rọ</em> does the same work — <em>ìmọ̀ ẹ̀rọ</em>, knowledge of machines, is technology.</p>
        <p>This is what a living language looks like. New things keep arriving and Yorùbá keeps meeting them the same way, with the words it already has, so that the newest word on this page is as readable as the oldest.</p>`,
    },
  ];

  function unitHtml(unit) {
    const link = (id, inner) => `<a class="sibling-row unit-row" href="${ctx.pathFor(id)}">${inner}</a>`;
    const learn = unit.learn.map(([id, form, pos, meaning]) => link(id,
      `<span class="sibling-word">${ctx.escapeHtml(form)}</span>` +
      `<span class="sibling-meta">${ctx.escapeHtml(pos)}</span>` +
      `<span class="sibling-gloss">${ctx.escapeHtml(meaning)}</span>`
    )).join('');
    const built = unit.built.map(([id, form, meaning, parts]) => link(id,
      `<span class="sibling-word">${ctx.escapeHtml(form)}</span>` +
      `<span class="sibling-gloss">${ctx.escapeHtml(meaning)}</span>` +
      `<span class="unit-parts">${ctx.escapeHtml(parts)}</span>`
    )).join('');
    // The prose in `lede` and `note` carries links of its own, written as
    // placeholders so the unit data stays free of the path helpers.
    const prose = (html) => html
      .replace(/__P:([^_]+)__/g, (_, id) => ctx.pathFor(id))
      .replace(/__PAGE:([^_]+)__/g, (_, name) => ctx.pagePath(name));
    return `
      <div class="unit">
        <h3>${ctx.escapeHtml(unit.title)}</h3>
        ${prose(unit.lede)}
        <p class="unit-label">${unit.learn.length} words to learn</p>
        <div class="sibling-list">${learn}</div>
        <p class="unit-label">${unit.built.length} words you can now read</p>
        <div class="sibling-list">${built}</div>
        ${prose(unit.note)}
      </div>
    `;
  }

  function connectionsHtml() {
    return `
      <div class="about-content">
        <h1>Language of connections</h1>
        <p class="about-lede">Yorùbá makes long words out of short ones. It does this constantly, and it is doing it today, in ordinary speech. Learn the short words and a great deal of the language opens by itself.</p>

        <h2>Every long word has short words inside it</h2>
        <p><a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> means home. <a href="${ctx.pathFor('en-aye-yo-noun-SG6kYiTR')}">ayé</a> means world, and also life. Together they make <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a>, which means Earth.</p>
        <p>Once you have seen one, you start seeing them everywhere. <a href="${ctx.pathFor('en-iwe-yo-noun-OCY1yTJb')}">ìwé</a> is a book. <a href="${ctx.pathFor('en-ile-iwe-yo-noun-1k3r2ULX')}">ilé-ìwé</a> is a school, a house of books. <a href="${ctx.pathFor('en-ọmọ-yo-noun-3cnmaRlC')}">ọmọ</a> is a child, and <a href="${ctx.pathFor('en-ọmọ_ile_iwe-yo-noun-JkyMOBvx')}">ọmọ ilé ìwé</a> is a student: a child of the house of books. Three small words, stacked, and the last one you never had to be taught.</p>
        <p>People often treat this as history — where a word came from, once, a long time ago. In Yorùbá it is not history. Recognising how a word is put together is part of being fluent in it, and it is one of the things students in our own classes enjoy most.</p>
        <p>So every entry here shows both directions. Open <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> and its two parts are listed under <em>Component words</em>. Open <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> and the words built from it are listed under <em>Used in</em>. The source data only records whichever direction somebody happened to type; we work out the other one and show both.</p>

        <h2>Words come in families</h2>
        <p>A vocabulary list of twenty words is twenty separate things to remember. A family of twenty is not, because the same short words keep coming back in different company, and each time one comes back it is easier.</p>
        <p>Here are five families. Each starts with a handful of short words and ends with the longer words they make between them, so that half the list is words you never have to learn on their own.</p>
        <p>They are different sizes, and the smallest is the one to read first. Nine words in it, and two of those nine say something English cannot say without a whole phrase.</p>

        ${UNITS.map(unitHtml).join('')}

        <h2>The easy way to learn and teach Yorùbá</h2>
        <p>Everything above is one claim: Yorùbá vocabulary is not a list of words, it is a set of connections, and learning the connections is easier than learning the words.</p>
        <p>Most dictionaries cannot help you with that, because they put words in alphabetical order and leave it there. That is fine for English, where a word's history is mostly dead — knowing that <em>salary</em> once meant salt money is a nice fact and changes nothing about using it. Copy that design for Yorùbá and you hide the thing a learner most needs, because the meaning of a long word is usually sitting in two shorter ones and an alphabetical list puts those nowhere near it.</p>
        <p>So we built this one the other way round, the way we wanted the language presented. Every entry names its parts under <em>Component words</em> and lists what is built from it under <em>Used in</em>. You can start at any word and walk. Vocabulary stops being a list to get through and becomes something with a shape you can feel your way around, which is both easier and considerably more fun.</p>
        <p>That is the whole method, and it is the same method with a class in front of you or nobody at all. Look a word up, read what it is made of, read what it makes, follow whichever of those you like.</p>
        <p>Learning on your own, the hard part is rarely willingness. It is choosing. Which of these words is worth the effort today, and which can wait a year? A phrasebook cannot tell you, and a frequency list only reports what people happen to say — not what the language is built out of.</p>
        <p>The dictionary can answer it a different way: <strong>look at where a word sits in the language.</strong> A word that turns up inside twenty others is a word you are going to meet twenty more times, whether or not it appears in anybody's first lesson. That is a fact about Yorùbá rather than an opinion about beginners, and you can check it yourself on any entry by reading how long its <em>Used in</em> list is.</p>
        <p><a href="${ctx.pagePath('building-blocks')}">Key building block words</a> is the map to start from — the 25 words that build more other words than any others here, each with examples of what it builds. It is generated from the dictionary rather than chosen by us, so it reports what is true of the language rather than what we would like to be true.</p>
        <p>What follows is about the order to meet words in. It is written with a class in mind because that is the shorter way to say it, but a learner working alone is doing the same job with one student, and every decision below is one you can make for yourself.</p>

        <h3>What should come first?</h3>
        <p>Most beginners' courses teach the body early, and they are right to. It is concrete, you can point at it, and a class can practise it on each other. Alone, it is the vocabulary you can label your own arm with. Those are good reasons and they are all reasons about learners rather than about Yorùbá.</p>
        <p>Ask the dictionary and you get the same answer for a much better one.</p>
        <p>The body's words are short and plain — <a href="${ctx.pathFor('en-oju-yo-noun-R8IVtfcO')}">ojú</a> (eye), <a href="${ctx.pathFor('en-eti-yo-noun-PGo2tkD8')}">etí</a> (ear), <a href="${ctx.pathFor('en-ori-yo-noun-ny5tM6Nx')}">orí</a> (head), <a href="${ctx.pathFor('en-inu-yo-noun-2x75v7QG')}">inú</a> (stomach), <a href="${ctx.pathFor('en-ara-yo-noun-Iw2DWNyO')}">ara</a> (body) — and they hardly combine with each other at all. In this whole dictionary exactly one word is built from two body parts: <a href="${ctx.pathFor('en-ojugun-yo-noun-ePRj6o4p')}">ojúgun</a>, the shin, the face of the bone. Judged as a unit it goes nowhere.</p>
        <p>Judged by what is built <em>on</em> it, it is the best week you will ever spend. Around seventy words elsewhere have a body part inside and are not about bodies, and three body words sit in this dictionary's twenty-five most productive: <em>ojú</em> builds forty-seven words, <em>orí</em> thirty-four, <em>ara</em> thirty-three.</p>

        <h4>Because feelings are made of the body</h4>
        <p>The clearest payment comes in the theme you would teach soon after. Yorùbá mostly keeps feelings in nouns rather than adjectives — there is no everyday word for <em>sad</em>, there is a word for sadness — so a teacher reaches for <em>ìbànújẹ́</em> where an English course would reach for an adjective. Look at what those nouns are made of.</p>
        <p><strong>The belly holds what you feel.</strong> <a href="${ctx.pathFor('en-ibinu-yo-noun-pTSdjBQf')}">ìbínú</a>, anger, is <em>bí</em> ("to anger") on <em>inú</em>, the belly. <a href="${ctx.pathFor('en-ibanujẹ-yo-noun-tLZwBwIa')}">ìbànújẹ́</a>, sadness, is <em>bà jẹ́</em> ("to spoil") on the same word — the insides gone bad. <a href="${ctx.pathFor('en-ominu-yo-noun-meHiv7-B')}">ominú</a>, doubt, is water in the belly.</p>
        <p><strong>The face shows what you are.</strong> <a href="${ctx.pathFor('en-ojuti-yo-noun-ohLWHZDF')}">ojútì</a>, shame, is a face pushed down. <a href="${ctx.pathFor('en-gboju-yo-noun-OeSO04wW')}">gbójú</a>, bravery, is a face gone hard. <a href="${ctx.pathFor('en-ojukokoro-yo-noun-MgBNSGWp')}">ojúkòkòrò</a>, greed, is the insect eye.</p>
        <p><strong>And the body carries the rest.</strong> <a href="${ctx.pathFor('en-igberaga-yo-noun-OYZdRCcI')}">ìgbéraga</a>, pride, is carrying the body high. <a href="${ctx.pathFor('en-rọra-yo-verb-2enfBmUF')}">rọra</a>, to be careful, is a soft body. <a href="${ctx.pathFor('en-fura-yo-verb-hzYRg~Ho')}">fura</a>, to be suspicious, is the body again.</p>
        <p>This is not nine words that happen to share a part. It is one idea with nine examples, and the idea is not a metaphor. Yorùbá puts what you feel in the belly and what you are in the face, and it says so in the words themselves. Anyone who met <em>inú</em> and <em>ojú</em> first does not have to be told any of this. They see it coming, and the second set of words costs a fraction of the first. That works exactly the same way alone: learn the body, then look up a feeling, and you will recognise half of it before you read the definition.</p>

        <h3>Two more questions to ask of any word</h3>
        <p><strong>In what order?</strong> Parts before wholes. <em>ilé</em> and <em>ìwé</em> before <em>ilé-ìwé</em>, and <em>ilé-ìwé</em> before <em>ọmọ ilé ìwé</em>.</p>
        <p><strong>Alongside what?</strong> Open the word and read <em>Used in</em>. Anything on that list is half-learned already, and the ones that share a second part with each other are the beginnings of a family like the five above.</p>

        <h3>Do the guessing before you read the answer</h3>
        <p>None of this works if the answer arrives first.</p>
        <p>On your own, that means stopping. A long word turns up, you find the parts you know inside it, and you decide what you think it means before you scroll down. Teaching, it means the same discipline pointed outwards: give the class the parts, ask what the whole thing will mean, and take their answers before you give yours.</p>
        <p>You cannot tell in advance which kind you are handing them, and that is what makes it worth doing. Sometimes the room gets it at once. Sometimes the real answer is better than every guess — <em>ilé</em> and <em>ayé</em>, home and world, turning out to mean Earth. Sometimes it is a small joke: <em>ẹ̀kọ́ ilé</em>, house lessons, meaning good manners. Being wrong about a word fixes it in the memory in a way that being told never does, and after a few of them you will start reaching for the next one before anybody offers it.</p>
        <p>The same applies to how a word is introduced — by you, to a class, or by you, to yourself. Say which two words it is made of, the first time, every time. Do not define <em>ilé ayé</em> as "Earth" and move on — a student can see it is two words, and saying which two costs one sentence. This matters most for the ones that do not look like compounds. <a href="${ctx.pathFor('en-sọrọ-yo-verb-SuqWjjbe')}">sọ̀rọ̀</a>, to speak, is <em>sọ</em> ("to say") pressed together with <em>ọ̀rọ̀</em> ("word"). <a href="${ctx.pathFor('en-sọrọ_soke-yo-verb-zjLiM20R')}">sọ̀rọ̀ sókè</a>, the name of this dictionary, is four: <em>sọ</em>, <em>ọ̀rọ̀</em>, <em>sí</em> ("to") and <em>òkè</em> ("heights"). Speak up.</p>
        <p>What can wait is the rules — how words combine, and how combining changes the sounds. Meet enough real examples and you will start predicting the changes before anyone states a rule. That is the moment to go and read the rule, or to teach it, and not before.</p>

        <h3>Tone marks are part of the word</h3>
        <p><a href="${ctx.pathFor('en-gba-yo-verb-DCZgzqX2')}">gbà</a> means to rescue. <a href="${ctx.pathFor('en-gba-yo-verb-VAsl51P3')}">gbá</a> means to hit. Same letters, different marks, two different words. A word learned without its marks is half a word.</p>
        <p>This matters more here than in a phrasebook, because the marks are what tell you which word is inside a longer one. The families above lean on two words spelled <em>ile</em>: <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> is a house and <a href="${ctx.pathFor('en-ilẹ-yo-noun-3j-~5Sdn')}">ilẹ̀</a> is the ground. One builds <em>ilé-ìwé</em>, a school. The other builds <em>ìbílẹ̀</em>, born of the land. Put both in one word and you get <a href="${ctx.pathFor('en-ileelẹ-yo-noun-zD~7f6bC')}">iléelẹ̀</a>, a house at ground level — a bungalow. Learn either without its marks and you cannot read that word again.</p>
        <p>You can still search without them. Type <em>gba</em> and you get all eight words spelled that way, each with its meaning, and you pick the one you meant.</p>

        <h3>Check a breakdown before you trust it</h3>
        <p>Look the word up here first. This dictionary is built from Wiktionary, which is crowdsourced and uneven, and many words have no breakdown at all. Of the 6,273 entries here, 2,314 record their parts, and only 797 have every part traced to a specific word. It is still the most complete source of these we know of, which is exactly why it is worth checking against what you already know, in both directions.</p>
        <p>Where the source does not say which meaning a word was built from, the entry says so rather than choosing one for you. If a word you know is missing its breakdown, you can add it to Wiktionary and it will appear here after the next refresh. The <a href="${ctx.pagePath('contribute')}">Contribute</a> page lists the edits that are already identified and what each one would fix.</p>
        <p>Compare sources, and if you are teaching, show your students that you do. There is no single authority for Yorùbá and everybody should know that before they start looking things up. Use this dictionary for lookups and for how words are built. Use <a href="https://glosbe.com/en/yo" target="_blank" rel="noopener noreferrer">Glosbe</a> to see several dictionaries side by side. Treat Google Translate as unreliable for Yorùbá — fine for a rough idea, not for anything you are going to repeat. Being confident online is not the same skill as judging which source to trust, and the second one has to be practised.</p>

        <h3>The question underneath</h3>
        <p>All of that still takes the themes as given. Body, family, food, animals — somebody decided long ago that those are what a beginner meets first, and they decided it by thinking about beginners, not about Yorùbá.</p>
        <p>The better question is one we cannot fully answer and would like other people to think about: <strong>which words does Yorùbá lean on hardest, and what would a course look like if you began there instead?</strong></p>
        <p>Part of it is answerable now. <a href="${ctx.pagePath('building-blocks')}">Key building block words</a> lists the twenty-five words that build more others than any in this dictionary — <em>ṣe</em> ("to do") builds fifty-eight, <em>ilé</em> ("house") fifty-six, <em>ilẹ̀</em> ("land") fifty. Whatever your first unit is about, those words are going to turn up inside it, and a learner who has them can take apart words nobody has taught them yet.</p>
        <p>The rest is open. Nobody has worked out what order those twenty-five should come in, or which of them can carry a beginner's first conversation, or where a course should put a word that is enormously productive and rarely said on its own. Those are real questions with real answers, and the answers are sitting in the language rather than in anybody's syllabus.</p>
        <p>We are working through them ourselves, in our own courses and in the games we are starting to build, and we do not have them settled either. That is the point of putting the dictionary together this way. The question is not what we say about how Yorùbá should be taught. It is what the language tells us.</p>

        <h2>Where to go next</h2>
        <ul>
          <li><a href="${ctx.pagePath('building-blocks')}">Key building block words</a> — the 25 roots that build the most words in this dictionary, with examples of each. Build your own family from any of them.</li>
          <li>Our <a href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">courses</a> teach Yorùbá in a set order.</li>
          <li>Our <a href="https://games.speaknigeria.org/" target="_blank" rel="noopener noreferrer">games</a> are for practice.</li>
        </ul>

        <div class="about-actions">
          <a class="about-btn primary" href="${ctx.pagePath('building-blocks')}">See the building block words</a>
          <a class="about-btn ghost" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">Our courses ↗</a>
        </div>
      </div>
    `;
  }

  // The one generated page. Its list is computed at build time by
  // build/lib/building-blocks.mjs; see data/frequency/README.md for why
  // choosing the examples needs frequency data rather than signals from our
  // own corpus. Fetched on first visit rather than at boot - nothing on the
  // reading path needs it.
  function buildingBlocksHtml(data) {
    const listHtml = data ? buildingBlocksListHtml(data) : '<p>Loading the list…</p>';
    return `
      <div class="about-content">
        <h1>Key building block words</h1>
        <p class="about-lede">These 25 words build more other words than any others in this dictionary. Learn one and you can read several more.</p>
        <p>Each root below is a single meaning, not a spelling. <em>gbá</em> ("to hit") and <em>gbà</em> ("to accept") are different words, and they build different families, so they are counted separately.</p>
        <div id="blocks-list">${listHtml}</div>
        <p class="blocks-note">Chosen automatically from the etymologies in this dictionary, counting how many words each root builds. Example words are picked using Yorùbá word frequencies from the <a href="https://wortschatz.uni-leipzig.de/en/download" target="_blank" rel="noopener noreferrer">Leipzig Corpora Collection</a> (CC BY 4.0), so they favour words you are likely to meet.</p>
      </div>
    `;

  }

  // The work queue, as edits rather than complaints. Generated by
  // build/lib/wiktionary-tasks.mjs; fetched on first visit like the quality
  // report, never on boot.
  //
  // The canonical entry walked through below is the Yorùbá page `odo`, chosen
  // by going through every multi-section page in the corpus: seven etymology
  // sections, an {{etymid}} on every one, senses nested inside the sections
  // rather than flattened onto the page, derived terms attached per section,
  // and an affix etymology that points back at a component by name. Nothing
  // else in Yorùbá Wiktionary does all five. `dodo` supplies the sixth thing
  // it cannot show about itself - another page pointing INTO it by name.
  function contributeHtml(data) {
    const listHtml = data ? contributeListHtml(data) : '<p>Loading the list…</p>';
    return `
      <div class="about-content">
        <h1>Contribute</h1>
        <p class="about-lede">This dictionary has no words of its own. Every entry here comes from Wiktionary, which anyone can edit — so a correction made there reaches this site, and everything else in the world built on Yorùbá Wiktionary, at the same time.</p>

        <h2>Why corrections go to Wiktionary, not to us</h2>
        <p>We did not write this dictionary. We take Wiktionary's Yorùbá data (through <a href="https://kaikki.org" target="_blank" rel="noopener noreferrer">Kaikki</a>, which does the first cleanup pass) and rebuild the reading and searching around it. The words, the definitions and the etymologies are somebody else's work, contributed by people who mostly do not know each other.</p>
        <p>So when we want to improve what you see here, we do not patch it here. We go and edit Wiktionary, and wait for the next refresh. That is not a limitation we put up with — it is the point. A fix typed into our site would help our readers. The same fix typed into Wiktionary helps every reader, every app, every researcher and every language project working from that data, most of whom we will never hear about.</p>
        <p>Yorùbá Wiktionary is not ours and it is not anybody's. It is community-driven and community-owned, and it will only ever be as good as the people who show up to it. There is a great deal of Yorùbá in it already, and a great deal missing.</p>

        <h2>What this site is good for: finding the gaps</h2>
        <p>Wiktionary is hard to browse. You have to spell a word a particular way to find it, results arrive mixed in with every other language, and the relationship between two words is often recorded on only one of them.</p>
        <p>We fixed those for reading, and the same work makes gaps visible. Search a Yorùbá word however you write it, or search from English. Open a word and see what it is made of, and what is made from it. Anything conspicuously absent from those lists is a gap, and now you can see it without knowing where to look.</p>
        <p>Some of them we can count for you. The <strong>Data quality</strong> panel in the menu holds around 2,300 of them, checked on every rebuild and sorted by how much judgement each one needs.</p>

        <h2>Learning Wiktionary's conventions</h2>
        <p>Editing Wiktionary takes some investment. It has its own markup, its own layout rules and its own templates, and a well-formed entry looks nothing like a sentence you would type into a document. None of it is difficult; there is just a bit of it.</p>
        <p>These are the pages worth reading, roughly in order:</p>
        <ul>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Tutorial" target="_blank" rel="noopener noreferrer">Wiktionary:Tutorial</a> — the official walkthrough for a first-time editor, with practice areas where nothing you do matters.</li>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Entry_layout" target="_blank" rel="noopener noreferrer">Wiktionary:Entry layout</a> — what goes where in an entry, and in what order. This is the one to keep open while you edit.</li>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Yoruba_entry_guidelines" target="_blank" rel="noopener noreferrer">Wiktionary:Yoruba entry guidelines</a> — the Yorùbá-specific rules, chiefly about which spelling a word is filed under. Underdots in the page title, tone marks on the headword line.</li>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Welcome,_newcomers" target="_blank" rel="noopener noreferrer">Wiktionary:Welcome, newcomers</a> — the front door, if you would rather start with the community than the markup.</li>
        </ul>

        <h2>What a well-formed Yorùbá entry looks like</h2>
        <p>The fastest way to learn the conventions is to read one entry that follows all of them. <a href="https://en.wiktionary.org/wiki/odo#Yoruba" target="_blank" rel="noopener noreferrer">odo</a> is the best-formed Yorùbá page we have found, and it is worth opening in another tab.</p>

        <h3>1. The page is a spelling. The sections are the words.</h3>
        <p>Seven different Yorùbá words are written <em>odo</em> once tone marks are removed. They are not senses of one word — they are unrelated words that collided. Wiktionary gives each one a numbered etymology section, and everything about that word lives inside its section.</p>
        <pre class="wikitext">==Yoruba==

===Etymology 1===   òdo   zero
===Etymology 2===   òdo   pig
===Etymology 3===   odò   river
===Etymology 4===   odò   a hardwood tree
===Etymology 5===   odo   the core of a syllable
===Etymology 6===   odo   white yam
===Etymology 7===   odó   pounding mortar</pre>

        <h3>2. Each section gets a name</h3>
        <p>A numbered section cannot be pointed at from anywhere else — "the third one" changes the moment somebody inserts a section above it. So each one opens with <code>{{etymid}}</code>, which gives that meaning a permanent name:</p>
        <pre class="wikitext">===Etymology 3===
{{etymid|yo|river}}</pre>
        <p>All seven sections on <em>odo</em> carry one: <em>zero</em>, <em>pig</em>, <em>river</em>, <em>mansonia</em>, <em>syllable</em>, <em>yam</em>, <em>mortar</em>. That is what makes the rest of this possible, and it is the single most useful thing anyone can add to a crowded Yorùbá page.</p>

        <h3>3. Senses nest inside the section</h3>
        <p>One word can mean several things without being several words. <a href="${ctx.pathFor('en-odo-yo-noun-X1qO2PE5')}">odò</a>, the river, is also the lower part of something, and also the south — one etymology, three senses, numbered inside the one section.</p>
        <pre class="wikitext">====Noun====
{{yo-noun|odò}}

# [[river]]
# [[lower]] or [[inner]] [[part]]
# [[south]]</pre>
        <p>Getting this wrong in either direction is the commonest fault on a Yorùbá page: senses of one word split into separate etymology sections, or genuinely separate words flattened into one list.</p>

        <h3>4. Derived terms belong to the section, not the page</h3>
        <p>This is the part most easily missed, and on <em>odo</em> it is doing real work. Each section lists the words built from <em>that meaning</em>, underneath it:</p>
        <pre class="wikitext">===Etymology 1===   {{etymid|yo|zero}}
  =====Derived terms=====
  * olódo   "a dunce, one who receives poor grades"

===Etymology 3===   {{etymid|yo|river}}
  =====Derived terms=====
  {{col3|yo |etídò&lt;t:river side&gt; |olódò&lt;t:river spirit&gt; |ojúdò&lt;t:midstream&gt; …}}

===Etymology 7===   {{etymid|yo|mortar}}
  =====Derived terms=====
  {{col2|yo |ìyá-odó&lt;t:pounding mortar&gt; |odókódó&lt;t:any mortar&gt; …}}</pre>
        <p>Read those three lists together. <a href="${ctx.pathFor('en-olodo-yo-noun-tmRD5LT5')}">olódo</a> is a dunce, from <em>zero</em>. <em>olódò</em> is a river spirit, from <em>river</em>. <a href="${ctx.pathFor('en-olodo-yo-noun-~rH6VaCc')}">olódó</a> makes and sells mortars, from <em>mortar</em>. Three words that differ only in tone marks, each belonging to a different meaning of the same spelling.</p>
        <p>Put all three in one list at the bottom of the page and that information is gone — every one of them would appear to come from every meaning. Attached to their own sections, each says exactly where it came from.</p>

        <h3>5. A compound says which meaning it came from</h3>
        <p>The last piece is the other direction: a word built from <em>odo</em> naming which <em>odo</em> it means. <a href="${ctx.pathFor('en-dodo-yo-verb-mtMwAeZw')}">dódò</a>, "to arrive at a river", is <a href="${ctx.pathFor('en-de-yo-verb-MaosAbO4')}">dé</a> ("to arrive") plus <a href="${ctx.pathFor('en-odo-yo-noun-X1qO2PE5')}">odò</a> ("river"), and its etymology says so by name:</p>
        <pre class="wikitext">From {{compound|yo|dé|odò|t1=to arrive at|id1=arrive|t2=river|id2=river}}.</pre>
        <p><code>id1=arrive</code> points at the <code>{{etymid|yo|arrive}}</code> on the page <em>de</em>. <code>id2=river</code> points at the one on <em>odo</em>. Both exist, so both resolve, and this dictionary can state where <em>dódò</em> came from instead of guessing — which is why <a href="${ctx.pathFor('en-dodo-yo-verb-mtMwAeZw')}">its entry here</a> shows the right two words.</p>
        <p>The <code>t1=</code> and <code>t2=</code> arguments are the meanings shown to a reader. The <code>id1=</code> and <code>id2=</code> arguments are the machine-readable half, and they are the ones almost always missing.</p>

        <h3>And one loose end, on the best page we could find</h3>
        <p>Etymology 7 of <em>odo</em> derives the mortar from a prefix:</p>
        <pre class="wikitext">equivalent to {{af|yo|o-|dó|t1=nominalizing prefix|id1=nominalizing prefix|t2=to pound}}</pre>
        <p>That <code>id1</code> points at a name on the page <em>o-</em>, and <em>o-</em> has no Yorùbá section at all. The pointer is correct and its target has never been written, so it goes nowhere.</p>
        <p>We are not saying that to criticise a page we have been praising. It is the most realistic thing on this page: the best-formed Yorùbá entry in Wiktionary still has a loose end, that loose end is one short section somebody could write this afternoon, and it is invisible unless you go looking. That is what contributing here mostly is.</p>
        <p>It is also not a one-off. Our data quality report finds nine pointers aimed at names that were never created, and <em>odo</em>'s is one of them.</p>

        <h2>A pile of work, gathered in one place</h2>
        <p>Every time this site rebuilds it checks the data against itself and writes down what does not add up. That is the <strong>Data quality</strong> panel in the menu, and it currently holds about 2,300 things worth fixing.</p>
        <p>The useful part is that they arrive sorted rather than as one large number. Each row names the word and the page it sits on, says what is wrong and why it matters, gives the wikitext to add, and links straight to the section of Wiktionary you would be editing. Rows are ordered by how much judgement each needs, so the quick ones with the widest reach are at the top. Some of what is in there now:</p>
        <ul>
          <li><strong>33 cross-references with the wrong tone marks.</strong> The word being pointed at exists — the reference just spells it with different tones, so a link the reader should get never appears. Two words are involved and either could be the wrong one, so check both before you type: usually the reference is at fault, sometimes the entry it points at.</li>
          <li><strong>Six with a missing or extra underdot.</strong> The same thing, one dimension over.</li>
          <li><strong>Nine pointers aimed at a name nobody ever created</strong>, including <em>odo</em>'s. Somebody did the work and the target page never got the matching name, so careful writing resolves to nothing.</li>
          <li><strong>51 pages where several meanings share a spelling and not one of them has a name.</strong> The other half of the same problem: words are built from these pages and have no way of saying which meaning they mean.</li>
          <li><strong>374 entries with no pronunciation.</strong> This is the IPA line rather than a recording, and <code>{{yo-IPA}}</code> works most of it out from the tone-marked spelling, so it is bulk work rather than research — as long as the tones on the page are right.</li>
          <li><strong>775 words whose main spelling the source never confirms.</strong> No headword template gave a tone-marked spelling, so we fall back to the page title, which is usually untoned. The spelling shown may well be correct; the tones are simply unverified, and settling them needs somebody who knows the word.</li>
          <li><strong>1,046 cross-references to words Wiktionary does not have.</strong> The largest real gap in the dictionary. Every one is a word somebody has already said is worth having, with no entry behind it yet.</li>
        </ul>
        <p>The return on any of them is immediate and it is not only ours. An entry fixed today is live on Wiktionary at once, in this dictionary at the next refresh, and in every other project reading that data whenever they next pull it.</p>

        <h2>What we are working on now: names for meanings</h2>
        <p>Two of those rows are what Speak Nigeria is working through at the moment: the 51 pages carrying several meanings and no names, and the nine pointers aimed at names that were never written. Both are the second step of the <em>odo</em> walkthrough above — <code>{{etymid}}</code> — missing from one side or the other. It is a small piece of a much larger job, and it is bookkeeping rather than research. Somebody has usually written down which meaning a word came from already, in plain words a reader can follow. What is missing is the template that lets a machine follow it too.</p>
        <p>Seven different words are spelled <a href="${ctx.pathFor('en-pa-yo-verb-Ps~5DR-I')}">pa</a>: to kill, to tell, to rub, to gain, to be in a state, to be tight, to be bald. Fifty-four words here are built from one of those seven. Open one and the answer is usually sitting in the etymology already — <code>t1=kill, clear</code>, which tells a person exactly which <em>pa</em> is meant. It tells a computer nothing, because no part of it points at a particular section of the <em>pa</em> page. So this dictionary guesses, and the first guess is often wrong, which is why <a href="${ctx.pathFor('en-pade-yo-verb-no9flbpH')}">pàdé</a>, "to meet", currently appears to come from <em>pa</em> meaning "to kill".</p>
        <p>We picked this up because of what the dictionary is for. Yorùbá builds long words out of short ones, that is the most useful thing a learner can see, and it is the part most often left out of how the language gets taught and written down. A reader who can follow the links can explore. When a link lands on the wrong meaning, or goes nowhere, the exploring stops, and a learner has no way of telling a real connection from a broken one.</p>
        <p>Two lines fix it, and neither works without the other. A name on the section:</p>
        <p><code>{{etymid|yo|kill}}</code></p>
        <p>And a pointer from each word built on it:</p>
        <p><code>{{compound|yo|pa|kó|t1=kill, clear|id1=kill}}</code></p>
        <p>A name nothing points at has no effect; a pointer to a name that does not exist has no effect either — as <em>odo</em>'s prefix shows. So every page in the queue below lists both halves.</p>

        <h3>Choosing a name for a meaning</h3>
        <p>The name is yours to pick. It identifies one etymology section, it does not have to describe every sense inside it, and it only has to be unique on its own page.</p>
        <ul>
          <li><strong>One or two plain words, lowercase.</strong> On <em>odo</em>: <em>zero</em>, <em>pig</em>, <em>river</em>, <em>mortar</em>.</li>
          <li><strong>Enough to tell it from the others on the page.</strong> On <em>pa</em>, <em>kill</em> and <em>tell</em> are enough. <em>verb</em> would not be.</li>
          <li><strong>Broad enough for the whole section.</strong> The names suggested below come from each section's first definition, which is a starting point rather than a rule. Section 6 of <em>ta</em> covers "to shoot", "to sting", "to be spicy", "to kick" and "to pick" — <em>shoot</em> works, and something broader would be better.</li>
          <li><strong>Hard to change later.</strong> Renaming breaks every pointer aimed at it and nothing warns you. Pick something that will still fit when the meaning is written up more fully.</li>
          <li><strong>Read by other people.</strong> Wiktionary keeps lists of words sharing a part, such as "Yoruba terms prefixed with a-". A name splits that list by meaning, and your name is what appears on it.</li>
        </ul>

        <h3>Checking a suggestion before you type it</h3>
        <p>Where we can, we suggest which name a word should point at. Each suggestion says the same thing: <em>this word records its part as meaning X, and section N of the target page covers X.</em> Open both pages and confirm that.</p>
        <p>Two things can be wrong with it. The meaning recorded on the word may itself be vague or mistaken — somebody else wrote it and we take it at face value. Or the section may contain those words incidentally rather than actually meaning them.</p>
        <p>There is a third case which is not a mistake in the suggestion. Sometimes the recorded meaning matches no section at all. <a href="${ctx.pathFor('en-pade-yo-verb-no9flbpH')}">pàdé</a> records its <em>pa</em> as "to do; action verb", and none of <em>pa</em>'s seven sections says that. No pointer is right there: either the meaning written on <em>pàdé</em> is wrong, or <em>pa</em> is missing a meaning it ought to list.</p>
        <p>When you are not sure, leave it. A word with no pointer shows here as a gap. A word with the wrong pointer shows as a fact, and other tools will believe it.</p>
        <p class="task-note">This site has no Wiktionary account and makes no automated edits, now or later. Everything below is text for a person to check and type.</p>

        <h2>The queue</h2>
        <div id="tasks-list">${listHtml}</div>
      </div>
    `;

  }

  const TIER_LABEL = {
    A: 'suggested — check it',
    D: 'the page already says so',
    X: 'the page and the wording disagree',
    B1: 'several sections match',
    B2: 'no section matches',
    S: 'tone looks wrong',
    C: 'needs a Yorùbá speaker',
  };

  function contributeListHtml(data) {
    const t = data.totals || {};
    const byTier = t.byTier || {};
    const head = `<div class="tasks-summary">
      <p>${t.references} words across ${t.pagesNeedingAnchors} pages do not record which meaning they were built from. Pages are ordered by how many words each one affects.</p>
      <p>Of those words, ${byTier.A || 0} have a suggested answer to check, ${(byTier.B1 || 0) + (byTier.B2 || 0)} record a meaning that does not single out one section, and ${byTier.C || 0} record no meaning at all. A further ${byTier.S || 0} record a meaning belonging to a differently toned word, so the tone has to be settled before a pointer can be added.</p>
    </div>`;

    return head + (data.pages || []).slice(0, 40).map((page) => `
      <details class="task-page">
        <summary>
          <span class="task-word">${ctx.escapeHtml(page.page)}</span>
          <span class="task-count">${page.referenceCount} words</span>
          <span class="task-anchors">${page.anchors.filter((a) => !a.alreadyPresent).length} names to add</span>
        </summary>

        <p class="task-step">1. On <a href="${ctx.escapeHtml(page.editUrl)}" target="_blank" rel="noopener noreferrer">${ctx.escapeHtml(page.page)}</a>, add a name to the top of each etymology section:</p>
        <ul class="task-anchor-list">
          ${page.anchors.map((a) => `
            <li>
              <code>${ctx.escapeHtml(a.wikitext)}</code>
              <span class="task-note">Etymology ${ctx.escapeHtml(String(a.etymologyNumber))} — ${ctx.escapeHtml(a.definition)}${a.alreadyPresent ? ' <strong>(already there)</strong>' : ''}</span>
            </li>
          `).join('')}
        </ul>

        <p class="task-step">2. Then add the matching pointer to each word built from it:</p>
        <ul class="task-ref-list">
          ${page.references.map((r) => `
            <li class="task-ref tier-${ctx.escapeHtml(r.tier)}">
              <div class="task-ref-head">
                <a href="${ctx.escapeHtml(r.editUrl)}" target="_blank" rel="noopener noreferrer">${ctx.escapeHtml(r.word)}</a>
                <span class="task-note">${ctx.escapeHtml(r.definition)}</span>
                <span class="tier-chip">${ctx.escapeHtml(TIER_LABEL[r.tier])}</span>
              </div>
              ${r.proposedValue
                ? `<code>add ${ctx.escapeHtml(r.argument)}=${ctx.escapeHtml(r.proposedValue)}</code>`
                : `<code>add ${ctx.escapeHtml(r.argument)}=?</code>`}
              ${r.spelledElsewhere && r.tier !== 'S'
                ? `<div class="task-caution">Check the tone first: <strong>${ctx.escapeHtml(r.spelledElsewhere.spelling)}</strong>, a differently toned word on the same page, is defined as “${ctx.escapeHtml(r.spelledElsewhere.definition)}” and may be what was meant.</div>`
                : ''}
              <div class="task-why">${ctx.escapeHtml(r.why)}${r.sectionCovers && r.sectionCovers.length > 1
                ? `. That section also covers ${r.sectionCovers.slice(1).map((d) => `“${d}”`).join(', ')}`
                : ''}</div>
            </li>
          `).join('')}
          ${page.referencesOmitted ? `<li class="task-note">…and ${page.referencesOmitted} more on this page.</li>` : ''}
        </ul>
      </details>
    `).join('');
  }

  function buildingBlocksListHtml(data) {
    return (data.blocks || [])
      .map((block, i) => `
        <div class="block-card">
          <div class="block-head">
            <span class="block-rank">${i + 1}</span>
            <a class="block-word" href="${ctx.pathFor('${encodeURIComponent(block.entryId)}')}">${ctx.escapeHtml(block.form)}</a>
            <span class="sibling-meta">${ctx.escapeHtml(block.pos || '')}</span>
            <span class="block-def">${ctx.escapeHtml(block.definition)}</span>
          </div>
          <div class="block-count">builds ${block.buildsCount} words in this dictionary, including:</div>
          <div class="sibling-list">
            ${block.examples.map((ex) => `
              <a class="sibling-row" href="${ctx.pathFor('${encodeURIComponent(ex.entryId)}')}">
                <span class="sibling-word">${ctx.escapeHtml(ex.form)}</span>
                <span class="sibling-meta">${ctx.escapeHtml(ex.pos || '')}</span>
                <span class="sibling-gloss">${ctx.escapeHtml(ex.definition)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `)
      .join('');
  }
  // Order matters: it is the order of the header menu, and the order of the
  // sitemap.
  const PAGES = [
    { name: 'welcome', path: '/', html: welcomeHtml,
      title: 'Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary · Speak Nigeria',
      description:
        'A free Yorùbá–English dictionary built from Wiktionary. Search Yorùbá or English, ' +
        'in either direction, with tone marks or without.' },
    { name: 'about', path: '/about', html: aboutHtml,
      title: 'About the Dictionary — Sọ̀rọ̀ Sókè',
      description:
        'Where this Yorùbá dictionary comes from, what it does with the source data, ' +
        'and what it will not guess at.' },
    { name: 'speak-nigeria', path: '/speak-nigeria', html: speakNigeriaHtml,
      title: 'About Speak Nigeria — Sọ̀rọ̀ Sókè',
      description: 'Speak Nigeria, the nonprofit behind this Yorùbá dictionary.' },
    { name: 'language-of-connections', path: '/language-of-connections', html: connectionsHtml,
      title: 'Language of Connections — Sọ̀rọ̀ Sókè',
      description:
        'How Yorùbá builds long words from short ones, three sample vocabulary units ' +
        'chosen for how much their parts overlap, and how to teach from them.' },
    { name: 'building-blocks', path: '/building-blocks', html: buildingBlocksHtml,
      title: 'Key Building Block Words — Sọ̀rọ̀ Sókè',
      description:
        'The 25 Yorùbá roots that build more other words than any others in this ' +
        'dictionary. Learn one and you can read several more.' },
    { name: 'contribute', path: '/contribute', html: contributeHtml,
      title: 'Contribute — Sọ̀rọ̀ Sókè',
      description:
        'Some entries cannot say which word they came from. What that means, and the ' +
        'specific Wiktionary edits that would fix it.' },
  ];

  // Addresses that used to serve a page of their own. /learners and /teachers
  // were two short pages saying the same thing from two sides, and neither had
  // enough of its own to be worth a separate visit; they are one page now.
  // Kept here rather than in the redirects file, which is generated.
  const RETIRED_PAGES = [
    { from: '/learners', to: '/language-of-connections' },
    { from: '/teachers', to: '/language-of-connections' },
  ];

  return {
    PAGES,
    RETIRED_PAGES,
    byName: new Map(PAGES.map((page) => [page.name, page])),
    byPath: new Map(PAGES.map((page) => [page.path, page])),
    contributeListHtml,
    buildingBlocksListHtml,
    TIER_LABEL,
  };
}

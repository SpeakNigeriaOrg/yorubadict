// public/page-render.js
//
// The seven pages this dictionary writes itself: the welcome screen, About, About
// Speak Nigeria, For Learners, For Teachers, Key Building Blocks, and Contribute.
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
  function welcomeHtml() {
    return `
      <div class="entry-welcome">
        <h1>Ẹ káàbọ̀.</h1>
        <p>Search for a Yorùbá word with or without tone marks and underdots. Or search by an English word that appears in a definition. Everything runs locally in your browser after the first load.</p>
        <p>Try: <em>fa</em>, <em>de</em>, <em>ile</em>, or <em>pull</em>.</p>
      </div>
    `;
  }

  function aboutHtml() {
    return `
      <div class="about-content">
        <h1>About the Dictionary</h1>
        <p class="about-lede">Wiktionary's crowdsourced Yorùbá dictionary is one of the best resources online for learning Yorùbá. Not only does it have more defined words than most Yorùbá dictionaries, but it also includes details of how longer words are constructed from shorter words. Learning to recognize these compound words is a core part of learning the language. The Wiktionary website itself, though, is poorly matched to language learners, whether in terms of quick single-word lookups or language exploration. This project keeps the data and rebuilds the user experience.</p>

        <h2>Why care about etymology?</h2>
        <p>We can build a deep, comprehensive, and growing dictionary through the use of Wiktionary. We hope to not only make it easier to navigate, but encourage people to contribute — if you can't find a word in our dictionary, add it to Wiktionary! Beyond that, Yorùbá is fundamentally different from English in how it builds larger words out of smaller building-block words. People often think of etymology as an academic curiosity, but in languages like Yorùbá, being able to recognize compound words is part of fluency. It's also fun — one of the things students in our own classes love most about the language is learning how words combine to create new ones. Wiktionary is not comprehensive in these breakdowns, but it's a better source for them than anywhere else online. We make it easier to find and explore these links.</p>

        <h2>Where Wiktionary falls short</h2>
        <p>Wiktionary's own site is difficult to use. To reliably find a word in Yorùbá, you generally want to type it without tone marks, but with underdots. Other combinations generally don't work. Wiktionary will then search every one of its languages for words with that spelling, and present every single result, with definitions, etymology, informative tables, and other details for every matching word in every language. Yorùbá, starting at Y, will be down at the bottom of that page. Not very fun for language learners! Furthermore, because Wiktionary is crowdsourced, it can be messy. Key details like etymology links between words are incredibly valuable to language learners but inconsistent in their entry and presentation. Sometimes a parent word documents the words derived from it, sometimes only the derived word documents where it came from, sometimes both, sometimes neither, depending entirely on which page a contributor happened to edit. Tracing a family of related words means guessing which page has the link and searching for it by hand.</p>

        <h2>What we changed</h2>
        <ul>
          <li><strong>Cleaned and reorganized.</strong> We start from Kaikki's already-cleaned extraction of Wiktionary's raw wikitext, then apply a light additional layer of our own processing. With crowdsourced data, this will always be a work in progress, so let us know if you spot any quirks.</li>
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
          <li><a href="${ctx.pagePath('learners')}">For learners</a> — how to learn roots and read the words built from them.</li>
          <li><a href="${ctx.pagePath('teachers')}">For teachers</a> — sequencing a curriculum around roots, and when to explain a compound.</li>
          <li><a href="${ctx.pagePath('speak-nigeria')}">About Speak Nigeria</a> — the nonprofit behind this.</li>
        </ul>
      </div>
    `;
  }

  function speakNigeriaHtml() {
    return `
      <div class="about-content">
        <h1>About Speak Nigeria</h1>
        <p class="about-lede">Speak Nigeria is a nonprofit. We make free tools for learning Nigerian heritage languages.</p>

        <h2>Why we exist</h2>
        <p>Many children in Nigerian families grow up speaking only English. Parents who want to teach their own language often have nothing to teach from: no course at the right level, no games, and no dictionary a child can use.</p>
        <p>We build those and publish them free.</p>

        <h2>What we make</h2>
        <ul>
          <li><strong>Courses.</strong> Yorùbá from the beginning, in a set order.</li>
          <li><strong>Games.</strong> Practice for children learning on their own.</li>
          <li><strong>This dictionary.</strong> Every word, searchable with or without tone marks, and where each word came from.</li>
        </ul>

        <h2>How this dictionary fits</h2>
        <p>The courses teach words in a set order. The dictionary is for looking something up. It also shows where a word came from, because in Yorùbá the answer is usually another word.</p>
        <p><a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> means Earth. It is <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> (home) and <a href="${ctx.pathFor('en-aye-yo-noun-SG6kYiTR')}">ayé</a> (life). A learner who knows those two words can read the third without being taught it.</p>

        <div class="about-actions">
          <a class="about-btn primary" href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">See our Yorùbá courses</a>
          <a class="about-btn ghost" href="https://games.speaknigeria.org/" target="_blank" rel="noopener noreferrer">Play the games ↗</a>
        </div>
      </div>
    `;
  }

  function learnersHtml() {
    return `
      <div class="about-content">
        <h1>For learners</h1>
        <p class="about-lede">Yorùbá builds long words from short ones. If you know the short words, you can often work out a long word you have not been taught.</p>

        <h2>Look for the words inside a word</h2>
        <p><a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> means home. Two words built from it:</p>
        <ul>
          <li><a href="${ctx.pathFor('en-ile-iwe-yo-noun-1k3r2ULX')}">ilé-ìwé</a> — school. From <em>ilé</em> (home) and <em>ìwé</em> (book).</li>
          <li><a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> — Earth. From <em>ilé</em> (home) and <em>ayé</em> (life).</li>
        </ul>
        <p>Both are made of words you can look up separately. Each entry in this dictionary lists its parts under "Component words", and lists the words built from it under "Used in".</p>

        <h2>Guess before you look it up</h2>
        <p>When you meet a long word, find a word inside it that you already know. Decide what you think the whole word means. Then check.</p>
        <p><a href="${ctx.pathFor('en-ṣe-yo-verb-IXZV9I3e')}">ṣe</a> means to do. <a href="${ctx.pathFor('en-ṣiṣẹ-yo-verb-5qTsaA0x')}">ṣiṣẹ́</a> means work. <a href="${ctx.pathFor('en-ṣalaye-yo-verb-cgQ~Nwbp')}">ṣàlàyé</a> means to explain.</p>
        <p>Some of these are easy to predict and some are not. Either way you will remember the word better than if you had read it in a list.</p>

        <h2>Learn tone marks with the word</h2>
        <p><a href="${ctx.pathFor('en-gba-yo-verb-DCZgzqX2')}">gbà</a> means to rescue. <a href="${ctx.pathFor('en-gba-yo-verb-VAsl51P3')}">gbá</a> means to hit. The letters are the same and the tone marks are not, and they are two different words. A word learned without its tone marks is incomplete.</p>
        <p>You can still search without them. Type <em>gba</em> and you will get all eight words spelled that way, with their meanings, so you can find the one you want.</p>

        <h2>Where to go next</h2>
        <ul>
          <li><a href="${ctx.pagePath('building-blocks')}">Key building block words</a> lists the 25 roots that build the most words in this dictionary, with examples of what each one builds.</li>
          <li>Our <a href="https://speaknigeria.org/courses.html" target="_blank" rel="noopener noreferrer">courses</a> teach Yorùbá in a set order.</li>
          <li>Our <a href="https://games.speaknigeria.org/" target="_blank" rel="noopener noreferrer">games</a> are for practice.</li>
        </ul>

        <div class="about-actions">
          <a class="about-btn primary" href="${ctx.pagePath('building-blocks')}">See the building block words</a>
        </div>
      </div>
    `;
  }

  function teachersHtml() {
    return `
      <div class="about-content">
        <h1>For teachers</h1>
        <p class="about-lede">Two decisions shape how much vocabulary a student can use: which words you choose to teach, and when you explain how those words are built.</p>

        <h2>Choose roots, not a flat word list</h2>
        <p>Teach <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> (home). Then <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> (Earth). Then <a href="${ctx.pathFor('en-aye-yo-noun-SG6kYiTR')}">ayé</a> (life). The student now has three words and can see how the middle one is made.</p>
        <p>Teaching <em>ayé</em> without connecting it to <em>ilé ayé</em> leaves the student with two separate facts to memorise instead.</p>
        <p><a href="${ctx.pagePath('building-blocks')}">Key building block words</a> lists the 25 roots that build the most words in this dictionary, with examples of each. <em>ilé</em> alone appears in 56 of them.</p>

        <h2>Explain the parts the first time the word appears</h2>
        <p>Do not define <em>ilé ayé</em> as "Earth" and stop. It is two words, and a student can see it is two words. Say which two.</p>
        <p>The same applies to single words, where it is more often skipped. <a href="${ctx.pathFor('en-sọrọ-yo-verb-SuqWjjbe')}">sọ̀rọ̀</a> means to speak. It is a contraction of <em>sọ</em> ("to say") and <em>ọ̀rọ̀</em> ("word"). <a href="${ctx.pathFor('en-sọrọ_soke-yo-verb-zjLiM20R')}">sọ̀rọ̀ sókè</a> is a calque of English <em>speak up</em>: <em>sọ</em> ("to say") + <em>ọ̀rọ̀</em> ("word") + <em>sí</em> ("to") + <em>òkè</em> ("heights").</p>

        <h3>Ask the class first</h3>
        <p>Give them two words they already know and ask what the two together will mean. Take answers before you give yours.</p>
        <p>Some combinations are predictable and some are not. <em>ilé</em> and <em>ayé</em> giving Earth is not obvious in advance.</p>

        <h2>Leave the rules of combination until later</h2>
        <p>Yorùbá has rules for how words combine and for how combining changes pronunciation. Early students do not need them.</p>
        <p>What they need is to keep meeting combinations in words they already use. After enough examples, students begin to predict which words combine and how the sounds change, before anyone states a rule. Teach the rules after that, not before.</p>

        <h2>Check a breakdown before teaching it</h2>
        <p>Look the word up here first. This dictionary comes from Wiktionary, which is crowdsourced and uneven — many words have no breakdown at all. It is still more complete than any structured Yorùbá source we know of, so it is worth checking your own knowledge against.</p>
        <p>Where the source does not say which meaning a word was built from, the entry says so rather than picking one. If a word you know is missing its breakdown, you can add it to Wiktionary and it will appear here after the next refresh. The <a href="${ctx.pagePath('contribute')}">Contribute</a> page lists the cases where the missing piece is already identified.</p>

        <h2>Teach students to compare sources</h2>
        <p>There is no single authority for Yorùbá, and students should know that before they start looking things up.</p>
        <ul>
          <li><strong>This dictionary</strong> for lookups and for how words are built.</li>
          <li><strong><a href="https://glosbe.com/en/yo" target="_blank" rel="noopener noreferrer">Glosbe</a></strong> to compare several dictionaries side by side.</li>
          <li><strong>Google Translate</strong> is unreliable for Yorùbá. It is usable for a rough idea and not for anything you are teaching.</li>
        </ul>
        <p>Students who are confident online are often still poor at judging which source to trust. Show them how you decide.</p>

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
  function contributeHtml(data) {
    const listHtml = data ? contributeListHtml(data) : '<p>Loading the list…</p>';
    return `
      <div class="about-content">
        <h1>Contribute</h1>
        <p class="about-lede">Some entries in this dictionary cannot say which word they came from. This page explains why, and lists the specific edits that would fix it.</p>

        <h2>Yorùbá words are built from other words</h2>
        <p><a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> means home. <a href="${ctx.pathFor('en-aye-yo-noun-SG6kYiTR')}">ayé</a> means life. Together they make <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a>, which means Earth.</p>
        <p>Yorùbá does this constantly, and it is one of the most useful things a learner can see. So entries here show it in both directions. Open <a href="${ctx.pathFor('en-ile_aye-yo-noun-t8m1zNPj')}">ilé ayé</a> and its two parts are listed under <em>Component words</em>. Open <a href="${ctx.pathFor('en-ile-yo-noun-VQM0lVeW')}">ilé</a> and the 56 words built from it are listed under <em>Used in</em>.</p>

        <h2>Where that breaks down</h2>
        <p>To show it, we have to know which word a part came from. Usually that is clear. Sometimes it is not, because Yorùbá has many words spelled exactly alike.</p>
        <p>Seven different words are spelled <a href="${ctx.pathFor('en-pa-yo-verb-Ps~5DR-I')}">pa</a>. They mean to kill, to tell, to rub, to gain, to be in a state, to be tight, and to be bald. Fifty-four words in this dictionary are built from one of those seven, and Wiktionary does not record which one.</p>
        <p>When that happens we show the first, and the first is often wrong. It is why <a href="${ctx.pathFor('en-pade-yo-verb-no9flbpH')}">pàdé</a>, which means to meet, currently appears here as built from <em>pa</em> meaning to kill.</p>

        <h2>What would fix it</h2>
        <p>Two pieces of information are missing, and both have to be written down on Wiktionary.</p>
        <p><strong>First, each of the seven meanings of <em>pa</em> needs a name.</strong> At the moment they are only "the first section", "the second section", and so on, which is nothing a word can point at.</p>
        <p><strong>Second, each word built from <em>pa</em> needs to say which of those names it means.</strong></p>
        <p>Neither piece is difficult. Both are one short line of text. What makes them a pair is that neither works alone: a name nothing points at has no effect, and a pointer to a name that does not exist has no effect either. That is why each page below lists both.</p>

        <h2>How the two lines are written</h2>
        <p>A name goes at the top of an etymology section, using the <code>etymid</code> template:</p>
        <p><code>{{etymid|yo|kill}}</code></p>
        <p>A word built from that meaning then names it, using <code>id1</code>, <code>id2</code> and so on to say which of its parts it is talking about:</p>
        <p><code>{{compound|yo|pa|kó|t1=kill, clear|id1=kill}}</code></p>
        <p>The page for <a href="https://en.wiktionary.org/wiki/de#Yoruba" target="_blank" rel="noopener noreferrer">de</a> is already done, if you want to see a finished one. Its five meanings are named <em>tie down</em>, <em>deputize</em>, <em>wait</em>, <em>arrive</em> and <em>cover</em>.</p>

        <h2>Choosing a name for a meaning</h2>
        <p>The name is yours to pick. It identifies one etymology section, so it does not have to describe every meaning in that section, and it only has to be unique within its own page.</p>
        <ul>
          <li><strong>One or two plain words, lowercase.</strong> On <em>de</em>: <em>tie down</em>, <em>deputize</em>, <em>wait</em>, <em>arrive</em>, <em>cover</em>.</li>
          <li><strong>Enough to tell it from the other meanings on the same page.</strong> On <em>pa</em>, <em>kill</em> and <em>tell</em> are enough. <em>verb</em> would not be.</li>
          <li><strong>Broad enough for the whole section.</strong> The names suggested below come from each section's first definition, which is a starting point rather than a rule. Section 6 of <em>ta</em> covers "to shoot", "to sting", "to be spicy", "to kick" and "to pick" — <em>shoot</em> works, but a broader name would be better.</li>
          <li><strong>Hard to change later.</strong> Renaming breaks every pointer aimed at it, and nothing warns you. Pick something that will still fit if the meaning is written up more fully one day.</li>
          <li><strong>Read by other people.</strong> Wiktionary keeps lists of words that share a part — one such list is "Yoruba terms prefixed with a-". Naming a meaning splits that list by meaning, so words built from the <em>nominalizing prefix</em> sense are gathered separately from the others. Your name is what appears on the list, so read it back that way before you settle on it.</li>
        </ul>

        <h2>Checking the suggestions below</h2>
        <p>Where we can, we suggest which name a word should point at. Each suggestion says the same thing: <em>this word records its part as meaning X, and section N of the target page covers X.</em> Open both pages and confirm that.</p>
        <p>Two things can be wrong with it. The meaning recorded on the word may itself be vague or mistaken — it was written by someone else and we take it at face value. Or the section may contain those words incidentally rather than actually meaning them.</p>
        <p>There is a third case, which is not a mistake in the suggestion. Sometimes the recorded meaning matches no section at all. <a href="${ctx.pathFor('en-pade-yo-verb-no9flbpH')}">pàdé</a> records its <em>pa</em> as "to do; action verb", and none of <em>pa</em>'s seven sections says that. No pointer is right there: either the meaning written on <em>pàdé</em> is wrong, or <em>pa</em> is missing a meaning that ought to be listed. Both are worth fixing, and neither is the edit we suggest.</p>
        <p>When you are not sure, leave it. A word with no pointer shows here as a gap. A word with the wrong pointer shows as a fact, and other tools will believe it.</p>

        <h2>Wiktionary's own documentation</h2>
        <p>These pages define what the templates do. Worth reading before a first edit.</p>
        <ul>
          <li><a href="https://en.wiktionary.org/wiki/Template:etymid" target="_blank" rel="noopener noreferrer">Template:etymid</a> — naming a meaning. This is the one used below.</li>
          <li><a href="https://en.wiktionary.org/wiki/Template:senseid" target="_blank" rel="noopener noreferrer">Template:senseid</a> — naming a single definition, for when one etymology section holds several meanings and a pointer needs to tell them apart.</li>
          <li><a href="https://en.wiktionary.org/wiki/Template:affix" target="_blank" rel="noopener noreferrer">Template:affix</a> — documents <code>id1</code>, <code>id2</code> and their effect on category names. <a href="https://en.wiktionary.org/wiki/Template:compound" target="_blank" rel="noopener noreferrer">Template:compound</a> takes the same parameters.</li>
          <li><a href="https://en.wiktionary.org/wiki/Wiktionary:Entry_layout" target="_blank" rel="noopener noreferrer">Wiktionary:Entry layout</a> — how numbered etymology sections are structured, if you have not edited an entry before.</li>
        </ul>
        <p class="task-note">This site has no Wiktionary account and makes no automated edits. Everything below is text for you to check and type.</p>

        <h2>A worked example: kọ</h2>
        <p>Seven different words are spelled <a href="${ctx.pathFor('en-kọ-yo-verb-GyIdbR6y')}">kọ</a>, separated by tone. Going through them showed two separate faults, and it is worth seeing both.</p>

        <h3>The seven meanings</h3>
        <pre class="wikitext">kọ̀   to refuse, reject
kọ́   to build, construct · to learn, teach
kọ́   a negation particle
kọ́   to hang, suspend
kọ    to write
kọ    to stub, strike, hit
kọ    to recite</pre>

        <h3>Fault one: words attached to the wrong meaning</h3>
        <p>Most words built from <em>kọ</em> are about writing — <em>àkọtọ́</em> (orthography), <em>àròkọ</em> (essay), <em>àkọọ́lẹ̀</em> (written record) — and those were already right.</p>
        <p><a href="${ctx.pathFor('en-ayekootọ-yo-noun-oyCCzzpN')}">ayékòótọ́</a>, "parrot", was not. Its etymology records the component as meaning "to reject", which is <em>kọ̀</em> — but it writes the component untoned, as <em>kọ</em>, and untoned <em>kọ</em> reaches only the write, stub and recite meanings. So it landed on "to write".</p>
        <p>The fix is not a pointer. The tone mark is missing, and until that is settled there is nothing correct to point at. Cases like this are listed separately below, because adding a pointer would hide the problem rather than fix it.</p>

        <h3>Fault two: every meaning claiming the same words</h3>
        <p>Look at what each <em>kọ</em> listed under <em>Used in</em> before this:</p>
        <pre class="wikitext">to write            8 words
to stub, strike     the same 8 words
to recite           the same 8 words</pre>
        <p>All eight belong to <em>to write</em>. The other two meanings were showing a borrowed list, because words were being attached to a spelling rather than to a meaning. A reader looking up <em>kọ</em> "to stub, strike, hit" was told it builds <em>àròkọ</em>, "essay".</p>
        <p>That one was ours, not Wiktionary's, and it is fixed. Six of the eight say clearly enough which meaning they came from. Those now sit under one meaning each:</p>
        <pre class="wikitext">to write            5 words
to stub, strike     none
to recite           kọrin, "to sing"</pre>
        <p>Empty is the honest answer. Nothing is yet recorded as built from <em>kọ</em> "to stub, strike, hit".</p>
        <p>The other two — <em>ayékòótọ́</em> and <em>kọjá</em> — could belong to any of the three. We do not guess. They are listed under all three meanings, in a second section headed <em>Possibly used in</em>.</p>
        <p>That is deliberate. Picking one meaning for a word we cannot place goes wrong twice at once: the word shows up under a meaning it does not belong to, and it vanishes from the meaning it does. Listing it under every candidate goes wrong only the first way, and the heading tells you that is what you are reading.</p>
        <p>Adding the seven names to Wiktionary is what moves a word out of that second list for good.</p>

        <h3>What is left on kọ</h3>
        <p>Six words can be pointed at a meaning straight away, once the seven names exist. One needs its tone settled first. One — <a href="${ctx.pathFor('en-kọja-yo-verb-yadZ7L6K')}">kọjá</a>, "to pass beyond" — records no meaning for its <em>kọ</em> at all, so it needs someone who knows the word. All eight are listed below under <em>kọ</em>.</p>

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
    { name: 'learners', path: '/learners', html: learnersHtml,
      title: 'For Learners — Sọ̀rọ̀ Sókè',
      description:
        'How to use this dictionary if you are learning Yorùbá: tone marks, underdots, ' +
        'and searching in either direction.' },
    { name: 'teachers', path: '/teachers', html: teachersHtml,
      title: 'For Teachers — Sọ̀rọ̀ Sókè',
      description: 'How to use this Yorùbá dictionary in a classroom.' },
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

  return {
    PAGES,
    byName: new Map(PAGES.map((page) => [page.name, page])),
    byPath: new Map(PAGES.map((page) => [page.path, page])),
    contributeListHtml,
    buildingBlocksListHtml,
    TIER_LABEL,
  };
}

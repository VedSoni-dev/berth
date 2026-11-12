"use client";
// The public front door at /: your phone chats with the AI models on your Mac. Built with the taste skill's kit
// (public/assets, loaded only here) and berth's own colours; the plan is in .taste-skill/plan.md.
// type: software (site-kind software)
// deal: hero split, nav nav-centre, close close-word, footer footer-columns, rhythm space (the film lives on the GitHub Pages page), buttons solid,
//       berth's own mark, lit ground sand, radius soft, palette berth's own (start.mjs brand), type funnel,
//       grounds #phone bg-mist and #questions bg-band, effect grain-gradient held still in the hero frame
// moments: pinned-chapters in #how
// This component holds no state, so React never redraws the static markup the kit's scripts work on
// (the hero's entrance, the pinned steps). The live parts keep their own state: the hero's phone, the
// copy buttons, the dashboard window and the film.
import { useEffect } from "react";
import { PublikPitch } from "./PublikGate";
import { HeroPhone, ModelsSheet, SpeedFragment, HomeSheet, PairScreen, PhoneFirstScreen, PhoneAnswered, BerthMark } from "./landing/Phone";
import { CommandLine, CopyCommand, TerminalServe, DashboardWindow } from "./landing/Pieces";
import { HERO_CHAT } from "./landing/heroChat";

const REPO = "https://github.com/VedSoni-dev/berth";
const FONTS = "https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400..700&family=Funnel+Sans:wght@400..600&family=DM+Mono:wght@400;500&display=swap";
// the kit, in the order starter.html links it, then the page's own CSS
const KIT_CSS = ["system.css", "ui/cards.css", "motion/motion.css", "backgrounds/backgrounds.css", "layout/layout.css", "ui/base.css"];
const KIT_JS = ["system.js", "motion/motion.js", "layout/layout.js"];
// <html> carries the page's type, radius, lit ground, button look and the motion layer (system.md); the
// two classes hold the hero's words for the entrance and the moment's finished state if a script is late
const HTML_ATTRS = `(function(){var d=document.documentElement;d.setAttribute('data-type','software');d.setAttribute('data-radius','soft');d.setAttribute('data-ground','sand');d.setAttribute('data-buttons','solid');d.setAttribute('data-motion','');d.classList.add('m-enter','mo-js');setTimeout(function(){d.classList.add('m-enter-done')},700);setTimeout(function(){d.classList.add('mo-safe')},2500)})();`;

// what the model sheet looks like on a Mac with a few models pulled (Ollama's own sizes for these tags)
const MODELS = [
  { id: "qwen2.5:7b", bits: "7.6B · Q4_K_M · 4.7 GB", loaded: true },
  { id: "llama3.2:3b", bits: "3.2B · Q4_K_M · 2.0 GB" },
  { id: "gemma3:4b", bits: "4.3B · Q4_K_M · 3.3 GB" },
];

export function Landing() {
  // the kit's scripts run after React has hydrated the page, so nothing they move is hydrated twice
  useEffect(() => {
    for (const f of KIT_JS) {
      const src = `/assets/${f}`;
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const s = document.createElement("script");
      s.type = "module";
      s.src = src;
      document.body.append(s);
    }
  }, []);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: HTML_ATTRS }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS} precedence="taste-fonts" />
      {KIT_CSS.map((f) => (
        <link key={f} rel="stylesheet" href={`/assets/${f}`} precedence="taste-kit" />
      ))}
      <link rel="stylesheet" href="/assets/landing.css" precedence="taste-page" />
      <link rel="modulepreload" href="/assets/moments/moments.js" />
      <link rel="modulepreload" href="/assets/moments/lib.js" />
      <link rel="modulepreload" href="/assets/moments/pinned-chapters/moment.js" />

      <header className="nav nav--centre">
        <div className="wrap nav__bar">
          <a className="skip-link" href="#top">
            Skip to content
          </a>
          <a className="nav__logo" href="#top">
            <span className="lp-mark"><BerthMark size={22} /></span>berth
          </a>
          <nav className="nav__links" aria-label="Main">
            <div className="nav__item"><a className="nav__link" href="#phone">Phone</a></div>
            <div className="nav__item"><a className="nav__link" href="#how">Steps</a></div>
            <div className="nav__item"><a className="nav__link" href="#dashboard">Dashboard</a></div>
            <div className="nav__item"><a className="nav__link" href="#questions">Questions</a></div>
          </nav>
          <div className="nav__actions">
            <a className="nav__link" href={REPO}>GitHub</a>
            <CopyCommand />
          </div>
          <button className="nav__toggle" type="button" aria-expanded="false" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <main id="top">
        {/* HERO: split. The words left, the phone app replaying one exchange on the grain frame right. */}
        <section className="hero hero--split" data-enter aria-labelledby="hero-h">
          <div className="wrap">
            <div className="hero-text grid hero__grid">
              <div className="hero__text span-6">
                <h1 id="hero-h">Your phone chats with AI models on your Mac</h1>
                <p className="hero__lead">
                  One command on the Mac serves its Ollama models over your Wi-Fi and prints a QR code. Scan it: your phone is the screen, the Mac runs
                  the model.
                </p>
                <CommandLine />
                <div className="btn-row">
                  <CopyCommand />
                  <a className="btn btn--secondary" href="/app">
                    Open the dashboard
                  </a>
                </div>
                <p className="t-small hero__fact">Free and MIT licensed. The Mac needs Node 18 or newer and Ollama.</p>
              </div>
              <HeroPhone />
            </div>
          </div>
        </section>

        {/* PHONE: the 2x2, two boxes deep (.card--open), as two screens; every panel on the lit ground, held still */}
        <section className="section g2 bg-mist" id="phone" aria-labelledby="phone-h">
          <div className="wrap">
            <div className="group">
              <div className="section-head">
                <h2 id="phone-h">
                  What the phone app does. <span className="muted">Your Mac serves it, so there is nothing to install from a store.</span>
                </h2>
              </div>
              <div className="grid">
                <article className="card card--row card--open span-6 m-nolift">
                  <h3>Model list: every model on your Mac</h3>
                  <p>Tap the model&apos;s name to pick any model Ollama has on the Mac. One already in memory answers with no wait to load.</p>
                  <div className="panel">
                    <div className="stage stage--fade-b">
                      <div className="at-rise fit" style={{ "--fit-max": "360px", "--ax": "max(24px, 50% - 180px)", "--ay": "40px", "--ay-sm": "24px" } as React.CSSProperties}>
                        <ModelsSheet mac={HERO_CHAT.mac} models={MODELS} pick="qwen2.5:7b" />
                      </div>
                    </div>
                  </div>
                </article>
                <article className="card card--row card--open span-6 m-nolift">
                  <h3>Speed from the Mac, under every answer</h3>
                  <p>Every answer ends with its speed, the time to the first token and how many tokens it took.</p>
                  <div className="panel">
                    <div className="stage">
                      <div className="at-rise fit" style={{ "--fit-max": "360px", "--ax": "max(24px, 50% - 180px)", "--ay": "56px", "--ay-sm": "24px" } as React.CSSProperties}>
                        <SpeedFragment />
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
            <div className="grid">
              <article className="card card--row card--open span-6 m-nolift">
                <h3>Home Screen icon on your phone</h3>
                <p>Add it from the browser&apos;s Share menu and it opens full screen with berth&apos;s icon, in light or dark.</p>
                <div className="panel">
                  <div className="stage stage--fade-b">
                    <div className="at-rise fit" style={{ "--fit-max": "360px", "--ax": "max(24px, 50% - 180px)", "--ay": "40px", "--ay-sm": "24px" } as React.CSSProperties}>
                      <HomeSheet mac={HERO_CHAT.mac} />
                    </div>
                  </div>
                </div>
              </article>
              <article className="card card--row card--open span-6 m-nolift">
                <h3>Pairing code between phone and Mac</h3>
                <p>The QR code carries a pairing code, and the Mac answers nothing without it. <code>berth serve --new-token</code> unpairs every phone.</p>
                <div className="panel">
                  <div className="stage stage--fade-b">
                    <div className="at-rise fit" style={{ "--fit-max": "360px", "--ax": "max(24px, 50% - 180px)", "--ay": "40px", "--ay-sm": "24px" } as React.CSSProperties}>
                      <PairScreen mac={HERO_CHAT.mac} />
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* HOW: pinned-chapters (moments.md); three steps, a title, two lines and one drawn picture each */}
        <section className="section" id="how" style={{ "--h": 2 } as React.CSSProperties} data-moment="pinned-chapters" aria-labelledby="how-h">
          <div className="wrap mo-pc__grid">
            <div className="mo-pc__text">
              <h2 id="how-h">Set up berth in 3 steps</h2>
              <ol className="mo-pc__steps">
                <li className="mo-pc__step">
                  <h3>Run one command on your Mac</h3>
                  <p>Paste it into Terminal. berth finds Ollama, then prints a QR code and the address to open.</p>
                  <figure className="mo-pc__visual mo-pc__visual--lit lp-visual lp-visual--term">
                    <TerminalServe />
                  </figure>
                </li>
                <li className="mo-pc__step">
                  <h3>Scan the QR code with your phone</h3>
                  <p>Use the camera on the same Wi-Fi. The chat opens with the pairing code already in its address.</p>
                  <figure className="mo-pc__visual mo-pc__visual--lit lp-visual lp-visual--phone">
                    <PhoneFirstScreen />
                  </figure>
                </li>
                <li className="mo-pc__step">
                  <h3>Ask the model on your Mac</h3>
                  <p>Type a question. The answer streams in as the Mac writes it, with its speed underneath.</p>
                  <figure className="mo-pc__visual mo-pc__visual--lit lp-visual lp-visual--phone">
                    <PhoneAnswered />
                  </figure>
                </li>
              </ol>
            </div>
            <div className="mo-pc__visuals frame" />
          </div>
        </section>

        {/* DASHBOARD: the page's split, text left, the dashboard's window right on the lit ground */}
        <section className="section" id="dashboard" aria-labelledby="dashboard-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-5 stack-5">
                <h2 id="dashboard-h">The dashboard runs a model in a tab</h2>
                <p className="t-lead">No Mac at hand? Open the dashboard in Chrome or Edge and run a small model on this computer&apos;s GPU, or connect Ollama.</p>
                <ul className="rows">
                  <li><span className="rows__name">In this tab</span><p>WebGPU runs Qwen, Llama, Gemma, Phi or SmolLM, with nothing to install.</p></li>
                  <li><span className="rows__name">Ollama</span><p>A local OpenAI-compatible endpoint, model pulls and a second machine.</p></li>
                  <li><span className="rows__name">Your phone</span><p>The command to run, and whether a phone is paired.</p></li>
                </ul>
                <p>
                  <a className="link" href="/app">Open the dashboard</a>
                </p>
              </div>
              <div className="frame frame--split frame--lit span-6 start-7">
                <div className="stage">
                  <div className="at-rise fit" style={{ "--fit-max": "540px", "--ax": "max(24px, 50% - 270px)", "--ay": "56px", "--ay-sm": "24px" } as React.CSSProperties}>
                    <DashboardWindow />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* QUESTIONS: every answer open, the limits said plainly; the publik pitch beside them */}
        <section className="section bg-band" id="questions" aria-labelledby="questions-h">
          <div className="wrap">
            <div className="grid grid--top">
              <div className="span-5 stack-5">
                <h2 id="questions-h">Questions</h2>
                <p className="t-lead muted">What berth needs, what it can&apos;t do yet, and why it costs nothing.</p>
                <PublikPitch appName="berth" className="lp-pitch" />
                <p className="lp-soon">berth is coming to publik: its listing goes up after 19 November 2026. Until then the dashboard opens with no sign-in.</p>
              </div>
              <div className="faq span-6 start-7">
                <div className="faq__item">
                  <h3>Tailscale, for your phone away from home</h3>
                  <p>berth has no relay of its own. Put the Mac and the phone on Tailscale, then open the Mac&apos;s Tailscale address with :7770. The Mac has to be awake.</p>
                </div>
                <div className="faq__item">
                  <h3>The Mac: Node 18 and Ollama</h3>
                  <p>Node 18 or newer, and Ollama with a model pulled, such as <code>ollama pull llama3.2</code>. berth adds no dependencies.</p>
                </div>
                <div className="faq__item">
                  <h3>Our servers: none between phone and Mac</h3>
                  <p>No. The phone app, the proxy to Ollama and the pairing check all run on your Mac, over your Wi-Fi.</p>
                </div>
                <div className="faq__item">
                  <h3>Not done yet: pooling memory across Macs</h3>
                  <p>Pooling memory across machines to run one bigger model, a menu-bar app, and a relay. Each Mac runs whole models.</p>
                </div>
                <div className="faq__item">
                  <h3>Android phones and .local addresses</h3>
                  <p>Many Android phones can&apos;t open .local names. Run <code>berth serve --ip</code> and scan the new code.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer closing" id="contact" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--word">
            <div className="section-head--split">
              <div>
                <h2 id="close-h">Start berth on your Mac</h2>
                <p className="t-lead">
                  Paste it into Terminal: <code className="lp-code">npx github:VedSoni-dev/berth serve</code>
                </p>
              </div>
              <CopyCommand />
            </div>
            <p className="close__word" aria-hidden="true">
              berth
            </p>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="span-4 stack-4">
                <a className="nav__logo" href="#top">
                  <span className="lp-mark"><BerthMark size={22} /></span>berth
                </a>
                <p className="footer__lede">Your phone, the models on your Mac.</p>
              </div>
              <div className="span-2 footer__col">
                <h3>berth</h3>
                <ul>
                  <li><a href="#phone">Phone</a></li>
                  <li><a href="#how">Steps</a></li>
                  <li><a href="#questions">Questions</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h3>Dashboard</h3>
                <ul>
                  <li><a href="#dashboard">Dashboard</a></li>
                  <li><a href="/app">Open the dashboard</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h3>Code</h3>
                <ul>
                  <li><a href={REPO}>GitHub</a></li>
                  <li><a href={`${REPO}/issues`}>Issues</a></li>
                  <li><a href={`${REPO}/blob/main/LICENSE`}>MIT licence</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h3>More</h3>
                <ul>
                  <li><a href="https://publikhq.com">publik</a></li>
                  <li><a href="https://x.com/forkthis_ai">@forkthis_ai</a></li>
                </ul>
              </div>
            </div>
            <div className="footer__legal">
              <span>
                &copy; 2026 berth &nbsp; Free and open source, MIT &nbsp; Built by <a href="https://x.com/forkthis_ai">@forkthis_ai</a>
              </span>
              <div className="socials" />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

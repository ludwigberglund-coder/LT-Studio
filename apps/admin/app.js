import {downloadJson, escapeHtml, loadJson, readLocalJson, safeHref, writeLocalJson} from '../shared/content.js';
import {handleMoneyClick, handleMoneyInput, moneyView} from './money-view.js';
import {accessView, configureAccess, handleAccessInput} from './access-view.js';
import {configureJournal, handleJournalClick, handleJournalInput, handleJournalSubmit, journalView} from './journal-view.js';

const PREVIEW_KEY = 'rollands-site-content-preview-v1';
const app = document.getElementById('admin-app');
let company;
let publishedSite;
let adminContent;
let decisions;
let accessConfig;
let draftSite;
const adminMotionSeen=new WeakSet();
function adminReducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
function animateAdminUi(){
  if(adminReducedMotion())return;
  let index=0;
  document.querySelectorAll('.metric-card,.panel,.module-card,.workflow-card,.access-role-card').forEach(element=>{
    if(adminMotionSeen.has(element))return;
    adminMotionSeen.add(element);
    element.animate(
      [{opacity:.7,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:340,delay:Math.min(index++,8)*34,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}
    );
  });
}

const ADMIN_ICONOIR=Object.freeze({
  overview:'<path d="M9 21H7C4.79086 21 3 19.2091 3 17V10.7076C3 9.30887 3.73061 8.01175 4.92679 7.28679L9.92679 4.25649C11.2011 3.48421 12.7989 3.48421 14.0732 4.25649L19.0732 7.28679C20.2694 8.01175 21 9.30887 21 10.7076V17C21 19.2091 19.2091 21 17 21H15M9 21V17C9 15.3431 10.3431 14 12 14C13.6569 14 15 15.3431 15 17V21M9 21H15"/>',
  content:'<path d="M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4ZM8 10H16M8 18H16M8 14H12M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20"/>',
  money:'<path d="M1 21V3C1 1.89543 1.89543 1 3 1H21C22.1046 1 23 1.89543 23 3V21C23 22.1046 22.1046 23 21 23H3C1.89543 23 1 22.1046 1 21ZM15 7H19M15 15.5H19M15 18.5H19M5 7H9M7 5V9M5.58609 18.4142L8.41452 15.5858M5.58609 15.5858L8.41452 18.4142"/>',
  access:'<path d="M1 20V19C1 15.134 4.13401 12 8 12C11.866 12 15 15.134 15 19V20M13 14C13 11.2386 15.2386 9 18 9C20.7614 9 23 11.2386 23 14V14.5M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12ZM18 9C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6C15 7.65685 16.3431 9 18 9Z"/>',
  journal:'<path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143M6 17H20M6 21H20M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17M9 7H15"/>',
  modules:'<path d="M20 6V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V6C4 4.89543 4.89543 4 6 4H18C19.1045 4 20 4.89543 20 6ZM12 9V4"/>',
  decisions:'<path d="M7 12.5L10 15.5L17 8.5M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/>'
});
function adminIcon(name){return `<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false">${ADMIN_ICONOIR[name]||ADMIN_ICONOIR.content}</svg></span>`}

function currentView() {
  const match = location.hash.match(/^#\/([a-z-]+)/);
  return match ? match[1] : 'overview';
}

function statusClass(tone) {
  return ['ready', 'progress', 'planned'].includes(tone) ? tone : 'planned';
}

function navigation(view) {
  return adminContent.navigation.map(item => `
    <a class="nav-item ${view === item.id ? 'active' : ''}" href="#/${escapeHtml(item.id)}">
      ${adminIcon(item.id)}
      <span>${escapeHtml(item.label)}</span>
    </a>
  `).join('');
}

function layout(view, title, description, content, actions = '') {
  return `
    <div class="admin-shell">
      <aside class="sidebar">
        <a class="admin-brand" href="#/overview">
          <strong>${escapeHtml(adminContent.productName)}</strong>
          <small>${escapeHtml(adminContent.environment)}</small>
        </a>
        <nav>${navigation(view)}</nav>
        <div class="sidebar-note">
          <strong>GitHub är källan</strong>
          <span>Demoändringar blir publika först när en ändring har godkänts och slagits ihop till main.</span>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div>
            <span class="crumb">Rollands / ${escapeHtml(title)}</span>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="top-actions">${actions}<a class="button ghost" href="../" target="_blank">Öppna webbplats</a></div>
        </header>
        <div class="content-area">${content}</div>
      </main>
    </div>
  `;
}

function overviewView() {
  const cards = [
    ['Publicering', 'GitHub Pages', 'Varje godkänd ändring i main bygger om demon automatiskt.'],
    ['Penningmodell', 'Heltal i ören', 'Nya beräkningar använder en gemensam exakt kärna utan flyttalsfel.'],
    ['Behörighet', 'Default deny', 'Personlig identitet, företagsmedlemskap och kritiska arbetsflöden använder en central regelmotor.'],
    ['Bokföringskärna', 'Spårbar rättelse', 'Verifikationer balanseras, numreras och rättas utan överskrivning.']
  ].map(([label, value, description]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(description)}</p>
    </article>
  `).join('');

  const roadmap = adminContent.roadmap.map(item => `
    <li>
      <span>${escapeHtml(item.step)}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.status)}</small></div>
    </li>
  `).join('');

  const principles = adminContent.principles.map(item => `<li>${escapeHtml(item)}</li>`).join('');

  return layout('overview', 'Översikt', 'En långsiktig grund där innehåll är enkelt att ändra och systemet kan växa modulärt.', `
    <section class="metrics-grid">${cards}</section>
    <section class="two-column">
      <article class="panel">
        <div class="panel-heading"><div><span class="kicker">Byggordning</span><h2>Stegvis ombyggnad</h2></div></div>
        <ol class="roadmap">${roadmap}</ol>
      </article>
      <article class="panel">
        <div class="panel-heading"><div><span class="kicker">Arbetssätt</span><h2>Regler som håller över tid</h2></div></div>
        <ul class="principles">${principles}</ul>
      </article>
    </section>
    <section class="panel callout">
      <div><span class="kicker">Verifikations- och periodmotor</span><h2>Prova balansering, periodlås och motverifikationer</h2><p>Den nya bokföringskärnan använder både öresmodellen och reglerna för personlig identitet. Alla ändringar i demon sparas endast i den egna webbläsaren.</p></div>
      <a class="button primary" href="#/journal">Öppna verifikationsdemon</a>
    </section>
    <section class="panel callout">
      <div><span class="kicker">Exakta ekonomivärden</span><h2>Testa belopp och blandad moms</h2><p>Öreskalkylatorn använder samma fristående penningmodell som fakturering, lager och bokföring bygger på.</p></div>
      <a class="button primary" href="#/money">Öppna öreskalkylatorn</a>
    </section>
    <section class="panel callout">
      <div><span class="kicker">Företagsisolering</span><h2>Granska inloggning och företagsåtkomst</h2><p>Alla företagsmedlemmar har samma funktioner. Separata kontroller kräver två olika personer i vissa arbetsflöden.</p></div>
      <a class="button primary" href="#/access">Visa åtkomstmodellen</a>
    </section>
    <section class="panel callout">
      <div><span class="kicker">Befintlig referens</span><h2>Den tidigare demon finns kvar under migreringen</h2><p>Vi ersätter inte fungerande flöden blint. Varje ny modul jämförs mot referensen innan den gamla tas bort.</p></div>
      <a class="button primary" href="../legacy/#/overview" target="_blank">Öppna tidigare systemdemo</a>
    </section>
  `);
}

function editorField(label, path, value, multiline = false) {
  const control = multiline
    ? `<textarea data-content-path="${escapeHtml(path)}" rows="4">${escapeHtml(value)}</textarea>`
    : `<input data-content-path="${escapeHtml(path)}" value="${escapeHtml(value)}">`;
  return `<label class="field"><span>${escapeHtml(label)}</span>${control}</label>`;
}

function contentView() {
  const serviceFields = draftSite.services.items.map((item, index) => `
    <fieldset class="service-editor">
      <legend>Tjänst ${index + 1}</legend>
      ${editorField('Rubrik', `services.items.${index}.title`, item.title)}
      ${editorField('Beskrivning', `services.items.${index}.description`, item.description, true)}
    </fieldset>
  `).join('');

  const content = `
    <section class="editor-layout">
      <form id="content-form" class="panel editor-form">
        <div class="panel-heading"><div><span class="kicker">Enkel redigering</span><h2>Webbplatsens huvudtexter</h2><p>Ändringarna sparas endast som lokal förhandsvisning tills filen läggs in i GitHub.</p></div></div>
        <div class="form-grid">
          ${editorField('Liten rubrik ovanför huvudrubriken', 'hero.eyebrow', draftSite.hero.eyebrow)}
          ${editorField('Huvudrubrik', 'hero.title', draftSite.hero.title, true)}
          ${editorField('Ingress', 'hero.body', draftSite.hero.body, true)}
          ${editorField('Kontaktens rubrik', 'contact.title', draftSite.contact.title)}
          ${editorField('Kontaktens text', 'contact.body', draftSite.contact.body, true)}
        </div>
        <h3>Erbjudanden</h3>
        <div class="service-editors">${serviceFields}</div>
        <div class="form-actions">
          <button class="button primary" type="submit">Spara lokal förhandsvisning</button>
          <button class="button ghost" type="button" data-action="copy-json">Kopiera JSON</button>
          <button class="button ghost" type="button" data-action="download-json">Ladda ned site.json</button>
          <button class="button danger" type="button" data-action="reset-preview">Återställ lokalt utkast</button>
        </div>
        <p id="editor-message" class="editor-message" aria-live="polite"></p>
      </form>
      <aside class="panel help-panel">
        <span class="kicker">Så publicerar ni</span>
        <h2>Två säkra vägar</h2>
        <ol>
          <li><strong>Små ändringar:</strong> öppna filen i GitHub, klicka på pennan och ändra texten.</li>
          <li><strong>Större ändringar:</strong> förhandsvisa här, ladda ned filen och ersätt innehållet i GitHub.</li>
        </ol>
        <a class="button primary full" href="https://github.com/ludwigberglund-coder/Rollands/edit/main/content/site.json" target="_blank" rel="noopener">Redigera site.json i GitHub</a>
        <a class="button ghost full" href="../?preview=1" target="_blank">Öppna lokal förhandsvisning</a>
        <p class="fine-print">Lägg aldrig kunduppgifter, fakturor, bankdata eller lösenord i innehållsfilerna.</p>
      </aside>
    </section>
  `;
  return layout('content', 'Webbplatsinnehåll', 'Ändra vanliga texter utan att röra designen eller systemkoden.', content);
}

function modulesView() {
  const modules = adminContent.modules.map(module => `
    <article class="module-card">
      <div class="module-top">
        <span class="status ${statusClass(module.tone)}">${escapeHtml(module.status)}</span>
        <span class="module-id">${escapeHtml(module.id)}</span>
      </div>
      <h2>${escapeHtml(module.title)}</h2>
      <p>${escapeHtml(module.description)}</p>
      ${module.href !== '#' ? `<a href="${escapeHtml(safeHref(module.href))}" ${module.href.startsWith('#') ? '' : 'target="_blank"'}>Öppna modul</a>` : '<span class="disabled-link">Inte aktiverad ännu</span>'}
    </article>
  `).join('');
  return layout('modules', 'Systemmoduler', 'Varje verksamhetsområde byggs som en avgränsad modul med egna regler och tester.', `<section class="module-grid">${modules}</section>`);
}

function decisionLabel(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return value?.value || value?.mode || value?.type || value?.decision || 'Fastställt';
}

function decisionsView() {
  const rows = [
    ['Räkenskapsår', decisions.accounting.fiscalYear],
    ['Regelverk', decisions.accounting.framework],
    ['Momsperiod', decisions.accounting.vatPeriod],
    ['Penningprecision', `${decisions.accounting.moneyPrecision.storageUnit} som lagringsenhet`],
    ['Lön', decisions.payroll],
    ['Lager', decisions.inventory]
  ].map(([label, value]) => `
    <tr><th>${escapeHtml(label)}</th><td>${escapeHtml(decisionLabel(value))}</td></tr>
  `).join('');

  return layout('decisions', 'Verksamhetsbeslut', 'Fastställda riktningar för hur det nya systemet ska byggas.', `
    <section class="panel">
      <div class="panel-heading"><div><span class="kicker">Demo Handel AB</span><h2>Beslut som styr arkitekturen</h2><p>Vissa myndighetsuppgifter är markerade för kontroll före skarp drift.</p></div></div>
      <div class="table-wrap"><table><tbody>${rows}</tbody></table></div>
    </section>
  `);
}

function setValueAtPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
    cursor = cursor[key];
  }
  const finalPart = parts.at(-1);
  cursor[/^\d+$/.test(finalPart) ? Number(finalPart) : finalPart] = value;
}

async function copyJson() {
  const text = `${JSON.stringify(draftSite, null, 2)}\n`;
  await navigator.clipboard.writeText(text);
  showMessage('JSON-innehållet är kopierat.');
}

function showMessage(message, error = false) {
  const element = document.getElementById('editor-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function render() {
  const view = currentView();
  if (view === 'content') app.innerHTML = contentView();
  else if (view === 'money') app.innerHTML = layout('money', 'Öreskalkylator', 'Testa den gemensamma penningmodellen med exakta belopp och blandad moms.', moneyView());
  else if (view === 'access') app.innerHTML = layout('access', 'Inloggning och företagsmedlemskap', 'Granska personlig inloggning, MFA, företagsisolering och personliga kontrollsteg.', accessView());
  else if (view === 'journal') app.innerHTML = layout('journal', 'Verifikationer och perioder', 'Prova balanserade poster, löpnummer, periodlås och spårbara motverifikationer.', journalView());
  else if (view === 'modules') app.innerHTML = modulesView();
  else if (view === 'decisions') app.innerHTML = decisionsView();
  else app.innerHTML = overviewView();
  animateAdminUi();
}

function bindEvents() {
  window.addEventListener('hashchange', render);
  document.addEventListener('input', event => {
    if (handleJournalInput(event.target, render)) return;
    if (handleAccessInput(event.target, render)) return;
    if (handleMoneyInput(event.target)) return;
    const path = event.target.dataset.contentPath;
    if (!path) return;
    setValueAtPath(draftSite, path, event.target.value);
  });
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-journal-form]')) {
      event.preventDefault();
      handleJournalSubmit(event.target, render);
      return;
    }
    if (event.target.id !== 'content-form') return;
    event.preventDefault();
    writeLocalJson(PREVIEW_KEY, draftSite);
    showMessage('Den lokala förhandsvisningen är sparad. Öppna den med knappen till höger.');
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action], [data-journal-action]');
    if (!button) return;
    if (handleJournalClick(button, render)) return;
    if (handleMoneyClick(button, render)) return;
    const action = button.dataset.action;
    try {
      if (action === 'copy-json') await copyJson();
      if (action === 'download-json') {
        downloadJson('site.json', draftSite);
        showMessage('site.json har laddats ned.');
      }
      if (action === 'reset-preview') {
        localStorage.removeItem(PREVIEW_KEY);
        draftSite = structuredClone(publishedSite);
        render();
        showMessage('Det lokala utkastet är återställt.');
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

async function boot() {
  try {
    if (!globalThis.RollandsMoney) throw new Error('Öresmodulen kunde inte laddas.');
    if (!globalThis.RollandsAccessControl) throw new Error('Behörighetsmodulen kunde inte laddas.');
    if (!globalThis.RollandsJournal) throw new Error('Verifikationsmotorn kunde inte laddas.');
    [company, publishedSite, adminContent, decisions, accessConfig] = await Promise.all([
      loadJson('../content/company.json'),
      loadJson('../content/site.json'),
      loadJson('../content/admin.json'),
      loadJson('../config/rolands-business-decisions.json'),
      loadJson('../config/access-control.json')
    ]);
    configureAccess(accessConfig);
    configureJournal(accessConfig);
    draftSite = readLocalJson(PREVIEW_KEY) || structuredClone(publishedSite);
    bindEvents();
    render();
  } catch (error) {
    app.innerHTML = `<main class="loading error"><h1>Kunde inte starta projektadmin</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

boot();

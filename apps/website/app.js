import {escapeHtml, loadJson, readLocalJson, safeHref} from './shared/content.js';

const PREVIEW_KEY = 'rollands-site-content-preview-v1';
const COMPANY_PREVIEW_KEY = 'rollands-company-content-preview-v1';
const app = document.getElementById('app');

const SITE_ICONOIR=Object.freeze({
  menu:'<path d="M3 5H21M3 12H21M3 19H21"/>',
  check:'<path d="M5 13L9 17L19 7"/>',
  mail:'<path d="M7 9L12 12.5L17 9M2 17V7C2 5.89543 2.89543 5 4 5H20C21.1046 5 22 5.89543 22 7V17C22 18.1046 21.1046 19 20 19H4C2.89543 19 2 18.1046 2 17Z"/>',
  mapPin:'<path d="M20 10C20 14.4183 12 22 12 22C12 22 4 14.4183 4 10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10Z"/><path d="M12 11C12.5523 11 13 10.5523 13 10C13 9.44772 12.5523 9 12 9C11.4477 9 11 9.44772 11 10C11 10.5523 11.4477 11 12 11Z" fill="currentColor"/>'
});
function siteIcon(name){return `<span class="site-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false">${SITE_ICONOIR[name]||''}</svg></span>`}

function renderNavigation(items) { return items.map(item => `<a href="${escapeHtml(safeHref(item.href))}">${escapeHtml(item.label)}</a>`).join(''); }
function renderServices(services) { return services.items.map(item => `<article class="service-card"><span class="service-number">${escapeHtml(item.symbol)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`).join(''); }
function renderHighlights(items) { return items.map(item => `<div class="highlight"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join(''); }
function renderStoryPoints(items) { return items.map(item => `<li>${siteIcon('check')}<span>${escapeHtml(item)}</span></li>`).join(''); }
function renderHours(items) { return items.map(item => `<div class="hours-row"><span>${escapeHtml(item.days)}</span><strong>${escapeHtml(item.hours)}</strong></div>`).join(''); }

const siteMotionSeen=new WeakSet();
function reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
function animateSite(){
  if(reducedMotion())return;
  let index=0;
  document.querySelectorAll('.hero-copy > *, .hero-visual, .service-card, .story-panel, .story-list li, .contact-grid > *').forEach(element=>{
    if(siteMotionSeen.has(element))return;
    siteMotionSeen.add(element);
    element.animate(
      [{opacity:.65,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:420,delay:Math.min(index++,10)*38,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}
    );
  });
}
function render(company, site, previewMode) {
  document.title = site.meta.title;
  document.querySelector('meta[name="description"]').setAttribute('content', site.meta.description);
  app.innerHTML = `
    ${previewMode === 'private' ? '<div class="preview-banner">Privat förhandsvisning av sparat utkast. Inget innehåll hämtas från webbläsarens lokala lagring.</div>' : previewMode ? '<div class="preview-banner">Lokal förhandsvisning från CMS. Inga ändringar är publicerade på den riktiga webbplatsen.</div>' : ''}
    <header class="site-header"><a class="brand" href="#hem" aria-label="Demo Saluhall – startsida"><span>${escapeHtml(company.displayName)}</span><small>${escapeHtml(company.address?.city||'Göteborg')}</small></a><button class="menu-button site-with-icon" type="button" aria-expanded="false" aria-controls="site-navigation">${siteIcon('menu')}<span>Meny</span></button><nav id="site-navigation" class="site-navigation" aria-label="Huvudmeny">${renderNavigation(site.navigation)}</nav><a class="header-action site-with-icon" href="#kontakt">${siteIcon('mail')}<span>Kontakt</span></a></header>
    <main id="main">
      <section id="hem" class="hero section-shell"><div class="hero-copy"><p class="eyebrow">${escapeHtml(site.hero.eyebrow)}</p><h1>${escapeHtml(site.hero.title)}</h1><p class="lead">${escapeHtml(site.hero.body)}</p><div class="actions"><a class="button primary" href="${escapeHtml(safeHref(site.hero.primaryCta.href))}">${escapeHtml(site.hero.primaryCta.label)}</a><a class="button secondary" href="${escapeHtml(safeHref(site.hero.secondaryCta.href))}">${escapeHtml(site.hero.secondaryCta.label)}</a></div><div class="highlights">${renderHighlights(site.highlights)}</div></div><div class="hero-visual" aria-label="Illustration av frukt och grönsaker"><div class="visual-card visual-main"><span class="visual-label">Rollands</span><strong>Frukt &amp; grönt</strong><small>${escapeHtml(company.address?.city||'Göteborg')}</small></div><div class="produce produce-orange"></div><div class="produce produce-green"></div><div class="produce produce-red"></div><div class="leaf leaf-one"></div><div class="leaf leaf-two"></div><div class="visual-note">Butik · Företag · Service</div></div></section>
      <section id="erbjudande" class="services section-block"><div class="section-shell"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(site.services.eyebrow)}</p><h2>${escapeHtml(site.services.title)}</h2></div><p>${escapeHtml(site.services.body)}</p></div><div class="service-grid">${renderServices(site.services)}</div></div></section>
      <section id="om" class="story section-block"><div class="section-shell story-grid"><div class="story-panel"><p class="eyebrow">${escapeHtml(site.story.eyebrow)}</p><h2>${escapeHtml(site.story.title)}</h2><p>${escapeHtml(site.story.body)}</p></div><ul class="story-list">${renderStoryPoints(site.story.points)}</ul></div></section>
      <section id="kontakt" class="contact section-block"><div class="section-shell contact-grid"><div><p class="eyebrow light">${escapeHtml(site.contact.eyebrow)}</p><h2>${escapeHtml(site.contact.title)}</h2><p>${escapeHtml(site.contact.body)}</p><div class="actions"><a class="button light-button" href="tel:${escapeHtml(company.contact.phoneHref)}">Ring ${escapeHtml(company.contact.phone)}</a><a class="button outline-light" href="mailto:${escapeHtml(company.contact.email)}">Skicka e-post</a></div></div><div class="contact-card"><div><span>Besöksadress</span><strong>${escapeHtml(company.address.full)}</strong></div><div><span>E-post</span><a href="mailto:${escapeHtml(company.contact.email)}">${escapeHtml(company.contact.email)}</a></div><div><span>Telefon</span><a href="tel:${escapeHtml(company.contact.phoneHref)}">${escapeHtml(company.contact.phone)}</a></div><div class="hours">${renderHours(site.contact.openingHours)}</div><a class="map-link site-with-icon" href="${escapeHtml(safeHref(company.links.maps))}" target="_blank" rel="noopener">${siteIcon('mapPin')}<span>Visa på karta</span></a></div></div></section>
    </main>
    <footer class="site-footer"><div><strong>${escapeHtml(company.displayName)}</strong><span>${escapeHtml(site.footer.tagline)}</span></div><div class="footer-links"><span>Org.nr ${escapeHtml(company.orgNumber)}</span><a href="${previewMode === 'private' ? '/portal/website.html' : './admin/#/content'}">${escapeHtml(site.footer.adminLabel)}</a></div></footer>`;
  const menuButton=document.querySelector('.menu-button'),navigation=document.getElementById('site-navigation');
  menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')==='true';menuButton.setAttribute('aria-expanded',String(!open));navigation.classList.toggle('open',!open)});
  navigation.addEventListener('click',event=>{if(event.target.closest('a')){menuButton.setAttribute('aria-expanded','false');navigation.classList.remove('open')}});
  animateSite();
}

async function boot() {
  try {
    if(location.pathname==='/website-preview/'){
      const response=await fetch('/api/v1/website/cms',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error('Privat f\u00f6rhandsvisning kr\u00e4ver en aktiv session och webbplatsbeh\u00f6righet.');
      const data=await response.json();
      render(data.state.draft.company,data.state.draft.site,'private');
      return;
    }
    const [publishedCompany,publishedSite]=await Promise.all([loadJson('./content/company.json'),loadJson('./content/site.json')]);
    const previewMode=new URLSearchParams(location.search).get('preview')==='1';
    const localSite=previewMode?readLocalJson(PREVIEW_KEY):null;
    const localCompany=previewMode?readLocalJson(COMPANY_PREVIEW_KEY):null;
    render(localCompany||publishedCompany,localSite||publishedSite,Boolean(localSite||localCompany));
  } catch (error) { app.innerHTML=`<main class="loading-shell error-shell"><p class="eyebrow">Demo Saluhall</p><h1>Webbplatsen kunde inte laddas</h1><p>${escapeHtml(error.message)}</p></main>`; }
}
boot();

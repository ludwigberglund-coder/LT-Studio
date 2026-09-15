import {escapeHtml, loadJson, readLocalJson, safeHref} from './shared/content.js';

const PREVIEW_KEY = 'rollands-site-content-preview-v1';
const app = document.getElementById('app');

function renderNavigation(items) {
  return items.map(item => `<a href="${escapeHtml(safeHref(item.href))}">${escapeHtml(item.label)}</a>`).join('');
}

function renderServices(services) {
  return services.items.map(item => `
    <article class="service-card">
      <span class="service-number">${escapeHtml(item.symbol)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description)}</p>
    </article>
  `).join('');
}

function renderHighlights(items) {
  return items.map(item => `
    <div class="highlight">
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.label)}</span>
    </div>
  `).join('');
}

function renderStoryPoints(items) {
  return items.map(item => `<li><span aria-hidden="true">✓</span>${escapeHtml(item)}</li>`).join('');
}

function renderHours(items) {
  return items.map(item => `
    <div class="hours-row">
      <span>${escapeHtml(item.days)}</span>
      <strong>${escapeHtml(item.hours)}</strong>
    </div>
  `).join('');
}

function render(company, site, previewMode) {
  document.title = site.meta.title;
  document.querySelector('meta[name="description"]').setAttribute('content', site.meta.description);

  app.innerHTML = `
    ${previewMode ? '<div class="preview-banner">Lokal förhandsvisning från projektadmin. Inga ändringar är publicerade.</div>' : ''}
    <header class="site-header">
      <a class="brand" href="#hem" aria-label="Rollands Saluhall – startsida">
        <span>${escapeHtml(company.displayName)}</span>
        <small>Billdal</small>
      </a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-navigation">Meny</button>
      <nav id="site-navigation" class="site-navigation" aria-label="Huvudmeny">
        ${renderNavigation(site.navigation)}
      </nav>
      <a class="header-action" href="#kontakt">Kontakt</a>
    </header>

    <main id="main">
      <section id="hem" class="hero section-shell">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(site.hero.eyebrow)}</p>
          <h1>${escapeHtml(site.hero.title)}</h1>
          <p class="lead">${escapeHtml(site.hero.body)}</p>
          <div class="actions">
            <a class="button primary" href="${escapeHtml(safeHref(site.hero.primaryCta.href))}">${escapeHtml(site.hero.primaryCta.label)}</a>
            <a class="button secondary" href="${escapeHtml(safeHref(site.hero.secondaryCta.href))}">${escapeHtml(site.hero.secondaryCta.label)}</a>
          </div>
          <div class="highlights">${renderHighlights(site.highlights)}</div>
        </div>
        <div class="hero-visual" aria-label="Illustration av frukt och grönsaker">
          <div class="visual-card visual-main">
            <span class="visual-label">Rollands</span>
            <strong>Frukt &amp; grönt</strong>
            <small>Billdal</small>
          </div>
          <div class="produce produce-orange"></div>
          <div class="produce produce-green"></div>
          <div class="produce produce-red"></div>
          <div class="leaf leaf-one"></div>
          <div class="leaf leaf-two"></div>
          <div class="visual-note">Butik · Företag · Service</div>
        </div>
      </section>

      <section id="erbjudande" class="services section-block">
        <div class="section-shell">
          <div class="section-heading">
            <div>
              <p class="eyebrow">${escapeHtml(site.services.eyebrow)}</p>
              <h2>${escapeHtml(site.services.title)}</h2>
            </div>
            <p>${escapeHtml(site.services.body)}</p>
          </div>
          <div class="service-grid">${renderServices(site.services)}</div>
        </div>
      </section>

      <section id="om" class="story section-block">
        <div class="section-shell story-grid">
          <div class="story-panel">
            <p class="eyebrow">${escapeHtml(site.story.eyebrow)}</p>
            <h2>${escapeHtml(site.story.title)}</h2>
            <p>${escapeHtml(site.story.body)}</p>
          </div>
          <ul class="story-list">${renderStoryPoints(site.story.points)}</ul>
        </div>
      </section>

      <section id="kontakt" class="contact section-block">
        <div class="section-shell contact-grid">
          <div>
            <p class="eyebrow light">${escapeHtml(site.contact.eyebrow)}</p>
            <h2>${escapeHtml(site.contact.title)}</h2>
            <p>${escapeHtml(site.contact.body)}</p>
            <div class="actions">
              <a class="button light-button" href="tel:${escapeHtml(company.contact.phoneHref)}">Ring ${escapeHtml(company.contact.phone)}</a>
              <a class="button outline-light" href="mailto:${escapeHtml(company.contact.email)}">Skicka e-post</a>
            </div>
          </div>
          <div class="contact-card">
            <div>
              <span>Besöksadress</span>
              <strong>${escapeHtml(company.address.full)}</strong>
            </div>
            <div>
              <span>E-post</span>
              <a href="mailto:${escapeHtml(company.contact.email)}">${escapeHtml(company.contact.email)}</a>
            </div>
            <div>
              <span>Telefon</span>
              <a href="tel:${escapeHtml(company.contact.phoneHref)}">${escapeHtml(company.contact.phone)}</a>
            </div>
            <div class="hours">${renderHours(site.contact.openingHours)}</div>
            <a class="map-link" href="${escapeHtml(safeHref(company.links.maps))}" target="_blank" rel="noopener">Visa på karta →</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div>
        <strong>${escapeHtml(company.displayName)}</strong>
        <span>${escapeHtml(site.footer.tagline)}</span>
      </div>
      <div class="footer-links">
        <span>Org.nr ${escapeHtml(company.orgNumber)}</span>
        <a href="./admin/#/content">${escapeHtml(site.footer.adminLabel)}</a>
      </div>
    </footer>
  `;

  const menuButton = document.querySelector('.menu-button');
  const navigation = document.getElementById('site-navigation');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    navigation.classList.toggle('open', !open);
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) {
      menuButton.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('open');
    }
  });
}

async function boot() {
  try {
    const [company, publishedSite] = await Promise.all([
      loadJson('./content/company.json'),
      loadJson('./content/site.json')
    ]);
    const previewMode = new URLSearchParams(location.search).get('preview') === '1';
    const localPreview = previewMode ? readLocalJson(PREVIEW_KEY) : null;
    render(company, localPreview || publishedSite, Boolean(localPreview));
  } catch (error) {
    app.innerHTML = `
      <main class="loading-shell error-shell">
        <p class="eyebrow">Rollands Saluhall</p>
        <h1>Webbplatsen kunde inte laddas</h1>
        <p>${escapeHtml(error.message)}</p>
      </main>
    `;
  }
}

boot();

import {escapeHtml} from '../shared/content.js';
let config;
export function configureAccess(value) {config=value;}
export function handleAccessInput() {}
export function accessView() {
  return `<section class="panel"><h2>Personlig inloggning och företagsmedlemskap</h2><p>Alla inloggade medlemmar i samma företag har samma behörighet. MFA krävs för alla. Varje åtgärd loggas med personlig användaridentitet.</p><p>Servern kontrollerar aktuell session, aktivt företagsmedlemskap och att objektet tillhör samma företag. Denna demo ger ingen åtkomst till företagsdata.</p><h3>Kontroll av olika personer</h3><p>Följande kontroller gäller lika för alla medlemmar och bygger på vem som utförde föregående steg.</p><ul>${config.workflows.map(w=>`<li>${escapeHtml(w.label)}: ${escapeHtml(w.reason)}</li>`).join('')}</ul></section>`;
}

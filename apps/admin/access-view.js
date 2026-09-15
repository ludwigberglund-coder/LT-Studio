import {escapeHtml} from '../shared/content.js';

let accessConfig;
let accessModel;
let selectedRoleId = '';
let selectedPermissionId = '';
let selectedWorkflowId = '';
let separationMode = 'different';

function accessApi() {
  if (!globalThis.RollandsAccessControl) throw new Error('Behörighetsmodulen kunde inte laddas.');
  return globalThis.RollandsAccessControl;
}

export function configureAccess(config) {
  accessConfig = config;
  accessModel = accessApi().createModel(config);
  selectedRoleId = config.roles[0]?.id || '';
  selectedPermissionId = config.permissions[0]?.id || '';
  selectedWorkflowId = config.workflows[0]?.id || '';
}

function permissionLabel(permissionId) {
  return accessModel.permissionsById.get(permissionId)?.label || permissionId;
}

function permissionRisk(permissionId) {
  return accessModel.permissionsById.get(permissionId)?.risk || 'read';
}

function roleOptions() {
  return accessConfig.roles.map(role => `
    <option value="${escapeHtml(role.id)}" ${role.id === selectedRoleId ? 'selected' : ''}>${escapeHtml(role.label)}</option>
  `).join('');
}

function permissionOptions() {
  return accessConfig.permissions.map(permission => `
    <option value="${escapeHtml(permission.id)}" ${permission.id === selectedPermissionId ? 'selected' : ''}>${escapeHtml(permission.category)} · ${escapeHtml(permission.label)}</option>
  `).join('');
}

function workflowOptions() {
  return accessConfig.workflows.map(workflow => `
    <option value="${escapeHtml(workflow.id)}" ${workflow.id === selectedWorkflowId ? 'selected' : ''}>${escapeHtml(workflow.label)}</option>
  `).join('');
}

function permissionSimulator() {
  const actor = {id: 'demo-user', roles: selectedRoleId ? [selectedRoleId] : []};
  const decision = accessApi().authorize(accessModel, actor, selectedPermissionId);
  const permission = accessModel.permissionsById.get(selectedPermissionId);

  return `
    <article class="panel access-simulator">
      <div class="panel-heading">
        <div>
          <span class="kicker">Default deny</span>
          <h2>Testa en roll mot en behörighet</h2>
          <p>Kontrollen använder samma domänmodul som framtida API-anrop ska använda.</p>
        </div>
      </div>
      <div class="access-form-grid">
        <label class="field">
          <span>Roll</span>
          <select data-access-role>${roleOptions()}</select>
        </label>
        <label class="field">
          <span>Behörighet</span>
          <select data-access-permission>${permissionOptions()}</select>
        </label>
      </div>
      <div class="access-decision ${decision.allowed ? 'allowed' : 'denied'}">
        <strong>${decision.allowed ? 'Tillåten' : 'Nekad'}</strong>
        <span>${escapeHtml(decision.reason)}</span>
        <small>${escapeHtml(permission?.id || selectedPermissionId)} · risk ${escapeHtml(permission?.risk || 'okänd')}</small>
      </div>
    </article>
  `;
}

function workflowSimulator() {
  const workflow = accessModel.workflowsById.get(selectedWorkflowId);
  if (!workflow) return '';

  const assignments = {};
  workflow.fields.forEach((field, index) => {
    assignments[field.id] = separationMode === 'same' ? 'person-a' : `person-${index + 1}`;
  });
  const actorId = assignments[workflow.fields.at(-1).id] || 'person-2';
  const actor = {id: actorId, roles: selectedRoleId ? [selectedRoleId] : []};
  const decision = accessApi().evaluateWorkflowAction(accessModel, actor, workflow.id, assignments);

  return `
    <article class="panel access-simulator">
      <div class="panel-heading">
        <div>
          <span class="kicker">Attestseparation</span>
          <h2>Testa ett kritiskt arbetsflöde</h2>
          <p>Rätt roll räcker inte när samma person har utfört båda kritiska stegen.</p>
        </div>
      </div>
      <div class="access-form-grid">
        <label class="field">
          <span>Arbetsflöde</span>
          <select data-access-workflow>${workflowOptions()}</select>
        </label>
        <label class="field">
          <span>Aktörer</span>
          <select data-access-separation>
            <option value="different" ${separationMode === 'different' ? 'selected' : ''}>Två olika personer</option>
            <option value="same" ${separationMode === 'same' ? 'selected' : ''}>Samma person i båda stegen</option>
          </select>
        </label>
      </div>
      <div class="workflow-actors">
        ${workflow.fields.map(field => `<span><b>${escapeHtml(field.label)}</b>${escapeHtml(assignments[field.id])}</span>`).join('')}
      </div>
      <div class="access-decision ${decision.allowed ? 'allowed' : 'denied'}">
        <strong>${decision.allowed ? 'Godkänd' : 'Stoppad'}</strong>
        <span>${escapeHtml(decision.reason)}</span>
        <small>Kräver ${escapeHtml(workflow.requiredPermission)}</small>
      </div>
    </article>
  `;
}

function roleCards() {
  const mfaRoles = new Set(accessConfig.policy.mfaRequiredRoles || []);
  return accessConfig.roles.map(role => `
    <article class="access-role-card">
      <div class="access-role-top">
        <span class="status ${mfaRoles.has(role.id) ? 'progress' : 'ready'}">${mfaRoles.has(role.id) ? 'MFA krävs' : 'Standardkonto'}</span>
        <span>${role.permissions.length} behörigheter</span>
      </div>
      <h3>${escapeHtml(role.label)}</h3>
      <p>${escapeHtml(role.description)}</p>
      <div class="permission-chips">
        ${role.permissions.map(permissionId => `
          <span class="permission-chip ${escapeHtml(permissionRisk(permissionId))}" title="${escapeHtml(permissionId)}">${escapeHtml(permissionLabel(permissionId))}</span>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function workflowCards() {
  return accessConfig.workflows.map(workflow => `
    <article class="workflow-card">
      <span class="status planned">Två personer</span>
      <h3>${escapeHtml(workflow.label)}</h3>
      <p>${escapeHtml(workflow.reason)}</p>
      <div class="workflow-chain">
        ${workflow.fields.map((field, index) => `${index ? '<i>→</i>' : ''}<span>${escapeHtml(field.label)}</span>`).join('')}
      </div>
      <small>Kritisk behörighet: ${escapeHtml(workflow.requiredPermission)}</small>
    </article>
  `).join('');
}

export function accessView() {
  if (!accessModel) return '<section class="panel"><p>Behörighetskonfigurationen är inte laddad.</p></section>';
  const summary = accessModel.report.summary;

  return `
    <section class="metrics-grid access-metrics">
      <article class="metric-card"><span>Roller</span><strong>${summary.roles}</strong><p>Avgränsade arbetsroller utan generell superanvändare.</p></article>
      <article class="metric-card"><span>Behörigheter</span><strong>${summary.permissions}</strong><p>Namngivna rättigheter som kan kontrolleras i API och gränssnitt.</p></article>
      <article class="metric-card"><span>Kritiska rättigheter</span><strong>${summary.criticalPermissions}</strong><p>Åtgärder som kräver förstärkt kontroll och loggning.</p></article>
      <article class="metric-card"><span>Separationsflöden</span><strong>${summary.workflows}</strong><p>Arbetsflöden där samma person inte får göra båda stegen.</p></article>
    </section>

    <section class="panel access-boundary">
      <div>
        <span class="kicker">Viktig säkerhetsgräns</span>
        <h2>Reglerna är klara – verklig inloggning kommer i backend</h2>
        <p>GitHub Pages kan visa och testa rollmodellen men är inte en säker inloggningsmiljö. Personliga konton, sessionshantering, MFA och serverkontroll kopplas in när API och produktionsdatabas byggs.</p>
      </div>
      <span class="status progress">Förproduktionsregelverk</span>
    </section>

    <section class="two-column access-simulators">
      ${permissionSimulator()}
      ${workflowSimulator()}
    </section>

    <section class="panel access-section">
      <div class="panel-heading">
        <div><span class="kicker">Rollmatris</span><h2>Minsta möjliga åtkomst per arbetsuppgift</h2><p>Rollerna ändras centralt i config/access-control.json och valideras automatiskt före publicering.</p></div>
      </div>
      <div class="access-role-grid">${roleCards()}</div>
    </section>

    <section class="panel access-section">
      <div class="panel-heading">
        <div><span class="kicker">Fyrögonprincip</span><h2>Kritiska arbetsflöden</h2><p>Dessa regler gäller även om en användare har flera roller.</p></div>
      </div>
      <div class="workflow-grid">${workflowCards()}</div>
    </section>
  `;
}

export function handleAccessInput(target, render) {
  if (target?.dataset?.accessRole !== undefined) {
    selectedRoleId = target.value;
    render();
    return true;
  }
  if (target?.dataset?.accessPermission !== undefined) {
    selectedPermissionId = target.value;
    render();
    return true;
  }
  if (target?.dataset?.accessWorkflow !== undefined) {
    selectedWorkflowId = target.value;
    render();
    return true;
  }
  if (target?.dataset?.accessSeparation !== undefined) {
    separationMode = target.value === 'same' ? 'same' : 'different';
    render();
    return true;
  }
  return false;
}

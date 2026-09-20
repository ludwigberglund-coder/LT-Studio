'use strict';

(function registerAccessControl(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RollandsAccessControl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAccessControlDomain() {
  const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
  const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;
  const FIELD_IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

  function accessError(message, code = 'INVALID_ACCESS_CONFIG', details = undefined) {
    const error = new Error(message);
    error.name = 'AccessControlError';
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function duplicates(values) {
    const seen = new Set();
    const found = new Set();
    for (const value of values) {
      if (seen.has(value)) found.add(value);
      seen.add(value);
    }
    return [...found];
  }

  function nonEmptyText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function validateConfig(config) {
    const errors = [];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return {ok: false, errors: ['Behörighetskonfigurationen måste vara ett objekt.'], summary: {}};
    }

    if (config.version !== 2) errors.push('version måste vara 2.');
    if (config.policy?.defaultDecision !== 'deny') errors.push('policy.defaultDecision måste vara deny.');
    if (config.policy?.requireMfa !== true) errors.push('MFA krävs för alla användare.');
    if (config.policy?.requirePersonalAccounts !== true) errors.push('policy.requirePersonalAccounts måste vara true.');

    if (!Array.isArray(config.permissions) || config.permissions.length === 0) {
      errors.push('permissions måste innehålla minst en behörighet.');
    }
    if (!Array.isArray(config.workflows) || config.workflows.length === 0) {
      errors.push('workflows måste innehålla minst ett separationsflöde.');
    }

    const permissionIds = (config.permissions || []).map(permission => permission?.id);
    for (const duplicate of duplicates(permissionIds)) errors.push(`Dubblerad behörighet: ${duplicate}.`);
    const permissionSet = new Set(permissionIds);

    for (const [index, permission] of (config.permissions || []).entries()) {
      const prefix = `permissions[${index}]`;
      if (!PERMISSION_PATTERN.test(permission?.id || '')) errors.push(`${prefix}.id har ogiltigt format.`);
      if (!nonEmptyText(permission?.label)) errors.push(`${prefix}.label måste vara text.`);
      if (!nonEmptyText(permission?.category)) errors.push(`${prefix}.category måste vara text.`);
      if (!['read', 'write', 'critical'].includes(permission?.risk)) errors.push(`${prefix}.risk måste vara read, write eller critical.`);
    }

    const workflowIds = (config.workflows || []).map(workflow => workflow?.id);
    for (const duplicate of duplicates(workflowIds)) errors.push(`Dubblerat arbetsflöde: ${duplicate}.`);

    for (const [index, workflow] of (config.workflows || []).entries()) {
      const prefix = `workflows[${index}]`;
      if (!IDENTIFIER_PATTERN.test(workflow?.id || '')) errors.push(`${prefix}.id har ogiltigt format.`);
      if (!nonEmptyText(workflow?.label)) errors.push(`${prefix}.label måste vara text.`);
      if (!nonEmptyText(workflow?.reason)) errors.push(`${prefix}.reason måste vara text.`);
      if (!permissionSet.has(workflow?.requiredPermission)) errors.push(`${prefix}.requiredPermission är okänd.`);
      if (workflow?.distinctActors !== true) errors.push(`${prefix}.distinctActors måste vara true.`);
      if (!Array.isArray(workflow?.fields) || workflow.fields.length < 2) {
        errors.push(`${prefix}.fields måste innehålla minst två aktörsfält.`);
        continue;
      }
      const fieldIds = workflow.fields.map(field => field?.id);
      for (const duplicate of duplicates(fieldIds)) errors.push(`${prefix}.fields innehåller dubbletten ${duplicate}.`);
      for (const [fieldIndex, field] of workflow.fields.entries()) {
        if (!FIELD_IDENTIFIER_PATTERN.test(field?.id || '')) errors.push(`${prefix}.fields[${fieldIndex}].id har ogiltigt format.`);
        if (!nonEmptyText(field?.label)) errors.push(`${prefix}.fields[${fieldIndex}].label måste vara text.`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      summary: {
        permissions: config.permissions?.length || 0,
        workflows: config.workflows?.length || 0,
        criticalPermissions: (config.permissions || []).filter(permission => permission?.risk === 'critical').length
      }
    };
  }

  function createModel(config) {
    const report = validateConfig(config);
    if (!report.ok) throw accessError(`Ogiltig behörighetskonfiguration: ${report.errors[0]}`, 'INVALID_ACCESS_CONFIG', report);

    const permissionsById = new Map(config.permissions.map(permission => [permission.id, Object.freeze({...permission})]));
    const workflowsById = new Map(config.workflows.map(workflow => [workflow.id, Object.freeze({
      ...workflow,
      fields: Object.freeze(workflow.fields.map(field => Object.freeze({...field})))
    })]));

    return Object.freeze({
      config,
      report,
      permissionsById,
      workflowsById
    });
  }

  function asModel(modelOrConfig) {
    if (modelOrConfig?.permissionsById instanceof Map) return modelOrConfig;
    return createModel(modelOrConfig);
  }

  function normalizeActor(actor) {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return null;
    const id = typeof actor.id === 'string' ? actor.id.trim() : '';
    const companyId = typeof actor.companyId === 'string' ? actor.companyId.trim() : '';
    return {id, companyId, authenticated:actor.authenticated === true, membershipActive:actor.membershipActive === true, disabled:actor.disabled === true};
  }

  // Only server-created actors from a current session/membership may cross this boundary.
  // Object ownership must additionally be checked by company-scoped data access.
  function authorize(modelOrConfig, actor, permissionId) {
    const model = asModel(modelOrConfig);
    const current = normalizeActor(actor);
    let code = 'ALLOWED', reason = 'Personlig användare med aktivt företagsmedlemskap.';
    if (!model.permissionsById.has(permissionId)) {code='UNKNOWN_PERMISSION';reason='Åtgärden är inte definierad.';}
    else if (!current?.id || !current.authenticated) {code='MISSING_IDENTITY';reason='Personlig inloggning krävs.';}
    else if (current.disabled) {code='ACCOUNT_DISABLED';reason='Användarkontot är inaktiverat.';}
    else if (!current.companyId || !current.membershipActive) {code='COMPANY_ACCESS_DENIED';reason='Aktivt företagsmedlemskap krävs.';}
    return {allowed:code==='ALLOWED',code,reason,permissionId,actorId:current?.id,companyId:current?.companyId};
  }

  function permissionsForActor(modelOrConfig, actor) {
    const model = asModel(modelOrConfig);
    return new Set([...model.permissionsById.keys()].filter(id => authorize(model,actor,id).allowed));
  }

  function requirePermission(modelOrConfig, actor, permissionId) {
    const decision = authorize(modelOrConfig, actor, permissionId);
    if (!decision.allowed) throw accessError(decision.reason, 'ACCESS_DENIED', decision);
    return decision;
  }

  function checkWorkflowSeparation(modelOrConfig, workflowId, assignments) {
    const model = asModel(modelOrConfig);
    const workflow = model.workflowsById.get(workflowId);
    if (!workflow) {
      return {ok: false, code: 'UNKNOWN_WORKFLOW', errors: ['Arbetsflödet är inte definierat.'], workflowId};
    }

    const source = assignments && typeof assignments === 'object' ? assignments : {};
    const errors = [];
    const actors = [];
    for (const field of workflow.fields) {
      const actorId = typeof source[field.id] === 'string' ? source[field.id].trim() : '';
      if (!actorId) errors.push(`${field.label} saknas.`);
      else actors.push({field: field.id, label: field.label, actorId});
    }

    if (workflow.distinctActors) {
      const grouped = new Map();
      for (const actor of actors) {
        const fields = grouped.get(actor.actorId) || [];
        fields.push(actor.label);
        grouped.set(actor.actorId, fields);
      }
      for (const [actorId, labels] of grouped) {
        if (labels.length > 1) errors.push(`${labels.join(' och ')} får inte utföras av samma person (${actorId}).`);
      }
    }

    return {
      ok: errors.length === 0,
      code: errors.length ? 'SEPARATION_OF_DUTIES_FAILED' : 'SEPARATION_OK',
      errors,
      workflowId,
      requiredPermission: workflow.requiredPermission,
      actors
    };
  }

  function evaluateWorkflowAction(modelOrConfig, actor, workflowId, assignments) {
    const model = asModel(modelOrConfig);
    const workflow = model.workflowsById.get(workflowId);
    if (!workflow) {
      return {
        allowed: false,
        code: 'UNKNOWN_WORKFLOW',
        reason: 'Arbetsflödet är inte definierat.',
        workflowId
      };
    }

    const permission = authorize(model, actor, workflow.requiredPermission);
    const separation = checkWorkflowSeparation(model, workflowId, assignments);
    const allowed = permission.allowed && separation.ok;
    const reason = !permission.allowed
      ? permission.reason
      : !separation.ok
        ? separation.errors[0]
        : 'Behörighet och attestseparation är godkända.';

    return {
      allowed,
      code: allowed ? 'ALLOWED' : (!permission.allowed ? permission.code : separation.code),
      reason,
      workflowId,
      permission,
      separation
    };
  }

  return Object.freeze({
    PERMISSION_PATTERN,
    IDENTIFIER_PATTERN,
    FIELD_IDENTIFIER_PATTERN,
    validateConfig,
    createModel,
    permissionsForActor,
    authorize,
    requirePermission,
    checkWorkflowSeparation,
    evaluateWorkflowAction
  });
});

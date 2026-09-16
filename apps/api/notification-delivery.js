'use strict';

const Queues = require('./queues.js');

function deliveryError(message, code = 'DELIVERY_ERROR', statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertSender(sender) {
  if (!sender || typeof sender.sendEmail !== 'function') throw deliveryError('En e-postleverantör med sendEmail krävs.', 'MISSING_EMAIL_PROVIDER');
  return sender;
}

async function processOne(db, sender, {workerId, now = new Date().toISOString()} = {}) {
  assertSender(sender);
  const claimed = Queues.claimNextNotification(db, {workerId, now});
  if (!claimed) return {processed:false, notification:null};
  try {
    const result = await sender.sendEmail({
      to: claimed.recipient,
      subject: claimed.subject,
      text: claimed.bodyText,
      attachments: claimed.attachments,
      idempotencyKey: claimed.idempotencyKey
    });
    if (!result || result.accepted !== true) throw deliveryError(result?.error || 'E-postleverantören bekräftade inte utskicket.', 'EMAIL_NOT_ACCEPTED');
    const sent = Queues.markNotificationSent(db, {
      notificationId: claimed.id,
      workerId,
      providerMessageId: result.messageId || '',
      sentAt: result.sentAt || now
    });
    return {processed:true, notification:sent};
  } catch (error) {
    const failed = Queues.markNotificationFailed(db, {
      notificationId: claimed.id,
      workerId,
      errorMessage: error?.message || 'Okänt leveransfel',
      now
    });
    return {processed:true, notification:failed, error};
  }
}

async function drain(db, sender, {workerId, maxMessages = 20, nowFactory = () => new Date().toISOString()} = {}) {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 100) throw deliveryError('maxMessages måste vara mellan 1 och 100.', 'INVALID_BATCH_SIZE', 422);
  const results = [];
  for (let index = 0; index < maxMessages; index += 1) {
    const result = await processOne(db, sender, {workerId, now:nowFactory()});
    if (!result.processed) break;
    results.push(result);
  }
  return results;
}

module.exports = Object.freeze({processOne, drain, assertSender});

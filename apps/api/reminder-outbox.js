'use strict';

function initializeReminderOutbox(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_invoice_reminder_outbox
    AFTER INSERT ON invoice_reminders
    BEGIN
      INSERT INTO notification_outbox(
        id,company_id,entity_type,entity_id,channel,recipient,subject,body_text,attachments_json,idempotency_key,
        status,attempts,max_attempts,next_attempt_at,created_by,created_at,updated_at,last_error
      )
      SELECT
        'notify_' || lower(hex(randomblob(16))),
        NEW.company_id,
        'invoice-reminder',
        NEW.id,
        'email',
        coalesce(trim(c.email),''),
        CASE WHEN NEW.kind='escalation' THEN 'Betalningskrav – faktura ' ELSE 'Betalningspåminnelse – faktura ' END || i.invoice_number,
        'Hej ' || c.name || char(10) || char(10) ||
        'Vi saknar betalning för faktura ' || i.invoice_number || '.' || char(10) ||
        'Förfallodatum: ' || i.due_date || char(10) ||
        'Utestående kapital: ' || printf('%.2f', NEW.principal_ore / 100.0) || ' SEK' || char(10) ||
        CASE WHEN NEW.interest_ore>0 THEN 'Dröjsmålsränta: ' || printf('%.2f', NEW.interest_ore / 100.0) || ' SEK' || char(10) ELSE '' END ||
        CASE WHEN NEW.reminder_fee_ore>0 THEN 'Påminnelseavgift: ' || printf('%.2f', NEW.reminder_fee_ore / 100.0) || ' SEK' || char(10) ELSE '' END ||
        CASE WHEN NEW.business_compensation_ore>0 THEN 'Förseningsersättning: ' || printf('%.2f', NEW.business_compensation_ore / 100.0) || ' SEK' || char(10) ELSE '' END ||
        'Totalt enligt påminnelseunderlaget: ' || printf('%.2f', NEW.total_due_ore / 100.0) || ' SEK' || char(10) || char(10) ||
        'Ange fakturanummer/OCR ' || coalesce(i.ocr,i.invoice_number) || ' vid betalning.',
        '[]',
        'invoice-reminder:' || NEW.id,
        CASE WHEN c.email IS NULL OR trim(c.email)='' THEN 'blocked' ELSE 'queued' END,
        0,
        5,
        NEW.created_at,
        NEW.user_id,
        NEW.created_at,
        NEW.created_at,
        CASE WHEN c.email IS NULL OR trim(c.email)='' THEN 'Kundens e-postadress saknas. Lägg till adress och skapa ett nytt kontrollerat utskick.' ELSE NULL END
      FROM invoices i
      JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
      WHERE i.id=NEW.invoice_id AND i.company_id=NEW.company_id;
    END;
  `);
}

module.exports = Object.freeze({initializeReminderOutbox});

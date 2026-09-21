'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const SIE = require('../lib/sie4i.js');

function store() {
  return {
    business: {name: 'Rollands Frukt & Grönt Aktiebolag', orgNumber: '556406-5059', companyType: 'AB'},
    journal: [
      {
        id: 'ver_A24', series: 'A', number: 'A24', date: '2026-09-14', description: 'Försäljning äpplen',
        rows: [
          {account: '1930 Företagskonto/checkkonto/affärskonto', debit: 112, credit: 0},
          {account: '3052 Försäljning varor, 12 % moms', debit: 0, credit: 100},
          {account: '2621 Utgående moms 12 %', debit: 0, credit: 12}
        ]
      }
    ]
  };
}

test('SIE 4I innehåller obligatorisk identifikation, konton och balanserad verifikation', () => {
  const text = SIE.buildSie4iText(store(), {generatedAt: '2026-09-15', signature: 'TEST'});
  assert.ok(text.startsWith('#FLAGGA 0\n'));
  assert.match(text, /#PROGRAM "Rollands Ekonomi" 0\.1\.0/);
  assert.match(text, /#FORMAT PC8/);
  assert.match(text, /#GEN 20260915 TEST/);
  assert.match(text, /#SIETYP 4/);
  assert.match(text, /#FNAMN "Rollands Frukt & Grönt Aktiebolag"/);
  assert.match(text, /#ORGNR 556406-5059/);
  assert.match(text, /#RAR 0 20260101 20261231/);
  assert.match(text, /#KONTO 1930 /);
  assert.match(text, /#KONTO 2621 /);
  assert.match(text, /#KONTO 3052 /);
  assert.match(text, /#VER "A" "24" 20260914 "Försäljning äpplen"/);
  assert.match(text, /#TRANS 1930 \{\} 112\.00 ""/);
  assert.match(text, /#TRANS 3052 \{\} -100\.00 ""/);
  assert.match(text, /#TRANS 2621 \{\} -12\.00 ""/);
});

test('SIE 4I formaterar heltalsören exakt utan flyttalsavrundning', () => {
  const data = {
    business:{name:'Örestest AB',orgNumber:'559999-0001',companyType:'AB'},
    journal:[{
      id:'entry-1',series:'A',number:'A1',date:'2026-09-15',description:'Örestest',
      rows:[
        {account:'1930',debitOre:12550,creditOre:0},
        {account:'3051',debitOre:0,creditOre:10040},
        {account:'2611',debitOre:0,creditOre:2510}
      ]
    }]
  };
  const text=SIE.buildSie4iText(data,{generatedAt:'2026-09-15',fiscalYear:'2026',companyType:'AB'});
  assert.match(text,/#TRANS 1930 \{\} 125\.50 ""/);
  assert.match(text,/#TRANS 3051 \{\} -100\.40 ""/);
  assert.match(text,/#TRANS 2611 \{\} -25\.10 ""/);
});

test('PC8-export kodar svenska tecken i stället för UTF-8', () => {
  const encoded = SIE.buildSie4i(store(), {generatedAt: '2026-09-15'});
  const utf8 = Buffer.from('Grönt', 'utf8');
  assert.equal(encoded.includes(utf8), false);
  assert.equal(encoded.includes(Buffer.from([0x94])), true); // ö i Codepage 437
  assert.equal(encoded.at(-1), 0x0a);
});

test('SIE-export stoppar obalanserade verifikationer', () => {
  const data = store();
  data.journal[0].rows[0].debit = 111;
  assert.throws(() => SIE.buildSie4i(data, {generatedAt: '2026-09-15'}), /balanserar inte/);
});

test('SIE-export stoppar tecken som inte kan representeras i PC8', () => {
  const data = store();
  data.business.name = 'Rollands 🍎 AB';
  assert.throws(() => SIE.buildSie4i(data, {generatedAt: '2026-09-15'}), error => error.code === 'SIE_UNSUPPORTED_CHARACTER');
});

test('SIE-export stoppar konton som inte börjar med fyra siffror', () => {
  const data = store();
  data.journal[0].rows[0].account = 'BANK';
  assert.throws(() => SIE.buildSie4i(data, {generatedAt: '2026-09-15'}), /fyra siffror/);
});

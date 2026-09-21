'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Receivables=require('../packages/receivables/customer-receivables.js');

const rates={
  version:'year-rounding-test',
  verifiedAt:'2026-09-21',
  interestActMarginBasisPoints:800,
  referenceRates:[
    {validFrom:'2024-01-01',basisPoints:200},
    {validFrom:'2024-07-01',basisPoints:200},
    {validFrom:'2025-01-01',basisPoints:200}
  ]
};

test('ränteberäkning delar korrekt vid årsskifte och använder rätt antal dagar per år',()=>{
  const result=Receivables.statutoryInterest(1_000_000,'2024-12-31','2025-01-02',rates);
  assert.equal(result.days,2);
  assert.equal(result.segments.length,2);
  assert.deepEqual(
    result.segments.map(segment=>({
      from:segment.from,
      to:segment.to,
      days:segment.days,
      interestOre:segment.interestOre
    })),
    [
      {from:'2024-12-31',to:'2025-01-01',days:1,interestOre:273},
      {from:'2025-01-01',to:'2025-01-02',days:1,interestOre:274}
    ]
  );
  assert.equal(result.interestOre,547);
});

test('helt skottår använder 366 dagar och ger exakt ett års ränta trots halvårsgräns',()=>{
  const result=Receivables.statutoryInterest(1_000_000,'2024-01-01','2025-01-01',rates);
  assert.equal(result.days,366);
  assert.equal(result.segments.length,2);
  assert.equal(result.segments[0].days,182);
  assert.equal(result.segments[1].days,184);
  assert.equal(result.interestOre,100_000);
});

test('öresavrundning är deterministisk och rundar exakt halvt öre uppåt',()=>{
  const below=Receivables.statutoryInterest(1_824,'2025-01-01','2025-01-02',rates);
  const half=Receivables.statutoryInterest(1_825,'2025-01-01','2025-01-02',rates);
  assert.equal(below.interestOre,0);
  assert.equal(half.interestOre,1);
});

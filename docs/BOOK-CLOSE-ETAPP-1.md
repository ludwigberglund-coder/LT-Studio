# Bokslut – Etapp 1: inventering och säker första arbetsyta

Huvudärende: [#745](https://github.com/ludwigberglund-coder/LT-Studio/issues/745). Utgångspunkt: main 52e273d (12 oktober 2026).

## Inventering från aktuella källor

| Område | Befintlig grund | Bedömning inför bokslut |
| --- | --- | --- |
| Verifikationer och periodlås | Aktiv Supabase-UAT, bokföringsbuntar, periodskydd | Delvis: serverbevis för komplett helt år saknas |
| Månadsavstämning | apps/portal/month-close-guide.js, docs/MONTH-END-GUIDE.md | Delvis: serverantal för tre mängder, ej total årsavstämning |
| Bank / oplacerade betalningar | Aktiv UAT-modul och serverflöden | Delvis: kräver kontrollerat bankunderlag per bokslutsdag |
| Kund- / leverantörsreskontra | Aktiv UAT-modul | Delvis: kontosaldo 1510/2440 måste verifieras serverbaserat mot alla öppna poster |
| Moms | docs/VAT-PILOT-CONTROL.md | Delvis: specialfall och 2650 får inte tyst godkännas |
| Underlag | Supabase Storage och dokumentmodul | Delvis: inga fullständiga bokslutsbilagor |
| Ingående balans | docs/OPENING-BALANCE-IMPORT.md | Legacy-/pilotväg: får inte antas täcka UAT och brutet år |
| SIE | docs/SIE-EXPORT.md | Legacy privat SQLite, inte verifierad live Supabase-export |
| Årsredovisning och INK2 | Planerade i #745 | Ej verifierad stöd i denna etapp |
| Versionsstyrd K2-regelmotor | Planerad i #745 | Ej implementerad i denna etapp |

## Läsbar första arbetsyta

`apps/portal/bokslut.html` visar vägledning till sex redan befintliga moduler med status **Inte verifierad**. Ingen saldoavstämning utförs och ingenting bokförs, godkänns eller låses. Sidan kräver aktiv Supabase-session och valt företag utom i uttryckligt demoläge. Sidans synlighet är inte en säkerhetsgräns; inga nya dataendpoints eller databasbehörigheter skapas.

## Regel-/stödmatrix för kommande etapper

| Företag / fall | Stöd nu | Blockering för automatisk färdigstatus |
| --- | --- | --- |
| Mindre aktiebolag, berättigat till K2, år som börjar 2026 | Vägledning enbart | Kräver verifierat regelverk, året, fullständigt underlag och avstämningar |
| Aktiebolag med brutet år | Vägledning enbart | Årets start/slut och tillämplig regelversion måste härledas korrekt |
| K1, K3, enskild firma, HB/KB, förening, koncern | Ej stöd för automatiskt bokslut | Expertgranskning och separat verifierade regelprofiler |
| Moms-specialfall, lager, anställda, fastigheter | Ej helautomatiskt bokslut | Separata bilagor, värderingar och redovisningsregler krävs |

Regelversioner ska framöver ha giltighetsperiod, officiell källa och regressionsprov. Ingen juridisk slutsats dras enbart av ett användarvalt K2-värde.

## Nästa tekniska etapp

1. En serverbaserad, tenantbegränsad läsmodell med konsistent datamängd för valt helt räkenskapsår, inte PostgREST:s första 1000 rader.
2. Verifierbara kontroller av balans, IB/UB, underlag, öppna buntar, bank 1930, reskontra 1510/2440 och moms – med `verified`, `deviation`, `unknown`, `not_applicable`.
3. Källbevis, tidpunkt, räknade rader, regelversion och synlig anledning till spärr. Testsäkrad isolering mellan två syntetiska företag.
4. Först därefter förslag till periodisering och avskrivningar via befintliga attestflöden.

## Säkerhetskriterier

- Ingen frontend-summering får ensam markera bokslut som klart.
- Ingen bankstatus får vara grön utan kontrollerat utomstående bankunderlag.
- Ingen ekonomikod skriver om eller raderar befintliga verifikationer.
- Ingen deklaration eller årsredovisning får visas som inskickad utan faktisk kvittens.
- Utveckling och test sker med syntetisk data och utan nya betaltjänster.

Referenser: AGENTS.md, docs/CURRENT-ARCHITECTURE.md, docs/MONTH-END-GUIDE.md, docs/VAT-PILOT-CONTROL.md, docs/SIE-EXPORT.md, docs/OPENING-BALANCE-IMPORT.md och issue #745. Före kodning av redovisningsregler måste tillämpbar BFN-version och myndighetsvägledning omverifieras.

# LT Studio -> Fortnox-niva: produktroadmap

Status: 2026-10-07  
Utgangspunkt: senaste `main` och den befintliga korttidsplanen i issue #630.

## Syfte

Målet ar inte att kopiera varje Fortnox-produkt.

Målet ar att LT Studio ska kunna ersatta Fortnox for ett normalt mindre svenskt aktiebolag genom att vara starkt pa:

- lopande bokforing,
- kund- och leverantorsfloden,
- bank och betalningar,
- moms och rapportering,
- dokument och revisionsspar,
- enkel automation,
- saker fleranvandardrift.

Denna roadmap beskriver vad som ska byggas efter att production-readiness-gates i #630 ar uppfyllda.

## Viktig ordningsregel

Nya stora ekonomimoduler far inte ga fore stabilisering.

Ordningen ar:

1. production readiness,
2. bank och avstamning,
3. automatiserad leverantorshantering,
4. rapporter och skatt/moms,
5. forsäljnings- och utlaggsfloden,
6. bredare sidomoduler.

GitHub ar source of truth for kod, migrationer, tester och dokumentation. Permanenta Supabase-andringar ska alltid ha motsvarande versionsstyrd andring i GitHub.

## Nulage

LT Studio har redan en betydande del av ekonomikar­nan:

- kundfakturor och kreditfakturor,
- kundreskontra,
- leverantorsfakturor och leverantorsreskontra,
- buntar och godkannandefloden,
- manuella kundinbetalningar,
- faktura-PDF och dokumentarkiv,
- kontoplan och bokforingsfloden,
- Supabase PostgreSQL,
- Auth, MFA, RLS och Realtime,
- foretagsisolering,
- privata dokument,
- admin/operator-yta,
- revisions- och sakerhetsarbete.

Det som framfor allt aterstar ar produktionsmognad, bankintegration, automatiserad dokumenttolkning, bredare rapportering och vissa kringfloden.

---

# P0 - maste vara klart innan "Fortnox-ersattare"

## 1. Production readiness och verkliga ekonomidata

Detta styrs i forsta hand av #630 och tillhorande readiness-dokument.

### Mal

LT Studio ska kunna koras med riktiga ekonomidata utan att vi medvetet accepterar kanda blockerande risker.

### Krav for klart

- GitHub och hostad Supabase ar verifierat synkade.
- Restore fran backup ar faktiskt testad.
- Tenant-/foretagsisolering ar verifierad.
- Login, MFA, logout och sessionshantering ar testad end-to-end.
- Kritiska ekonomifloden har browser-/integrationstester.
- Monitoring och incidentflode finns.
- Releasebevis kan knytas till en exakt `main`-commit.
- Kanda blockerande sakerhetsvarningar ar losta eller uttryckligen accepterade med dokumenterat beslut.

### Varfor forst

Om grundbokforingen ar korrekt men systemet inte gar att aterstalla eller sakert drifta ar det fortfarande inte ett verkligt alternativ till ett etablerat ekonomisystem.

---

# P1 - de tio viktigaste produktstegen

## 2. Riktig bankkoppling

### Mal

Bankhandelser ska komma in automatiskt och kunna anvandas i kund-, leverantors- och avstamningsfloden.

### Bygg

- provider-granssnitt som inte laser oss till en bankleverantor,
- import av konton och transaktioner,
- idempotens sa samma bankhandelse aldrig bokfors tva ganger,
- tenant-isolering,
- auditlogg,
- sandbox/fake-bank for CI,
- separat produktionsgate for riktiga bankuppgifter.

### Klart nar

En bankhandelse kan ga fran import till bokford eller granskningsklar post utan manuell dubbelregistrering.

---

## 3. Automatisk bankavstamning och kundinbetalningar

### Mal

Systemet ska automatiskt hitta sannolik faktura eller bokforingspost for en bankhandelse.

### Prioriterad matchning

1. exakt OCR,
2. exakt fakturanummer,
3. belopp = exakt restbelopp,
4. kund + belopp + datum,
5. AI-forslag endast nar deterministiska regler inte racker.

### Klart nar

Entydiga kundinbetalningar kan forberedas automatiskt och anvandaren bara granskar undantag.

Ingen AI-modell far skriva direkt till huvudboken.

---

## 4. Automatisk leverantorsfakturahantering

### Mal

Leverantorsfakturor ska ga fran dokument till granskningsklar bokforing med sa lite manuell inmatning som mojligt.

### Flode

```text
faktura in
-> original sparas
-> dokumenttolkning/OCR
-> leverantor + fakturanummer + datum + belopp + moms + betalningsuppgifter
-> dubblettkontroll
-> konteringsforslag
-> attest
-> bokforing
-> betalningsforslag
```

### Klart nar

En normal leverantorsfaktura kan hanteras utan att anvandaren manuellt skriver om uppgifter som redan finns pa fakturan.

Detta ska byggas vidare pa principerna i `docs/AUTOMATION-ROADMAP.md`.

---

## 5. E-faktura / Peppol

### Mal

LT Studio ska kunna ta emot och senare skicka strukturerade e-fakturor.

### Etapper

1. inkommande e-faktura,
2. mappning mot leverantorsreskontra,
3. utgaende e-faktura,
4. leveransstatus och felhantering.

### Klart nar

En inkommande strukturerad faktura kan skapa ett granskningsklart leverantorsunderlag utan OCR.

---

## 6. Rapporter som tacker normal drift

### Miniminiva

- resultatrapport,
- balansrapport,
- huvudbok,
- verifikationslista,
- kundreskontralista,
- leverantorsreskontralista,
- momsrapport,
- periodjamforelse,
- export till CSV/PDF,
- drill-down fran rapportsiffra till verifikation och dokument.

### Klart nar

Foretagaren och redovisningskonsulten kan folja ekonomin utan att behova exportera rådata for grundlaggande analys.

---

## 7. Moms, periodstangning och deklarationsunderlag

### Mal

Systemet ska kunna skapa ett tydligt och kontrollerbart underlag for svensk momsredovisning.

### Bygg

- momsperioder,
- momsavstamning,
- avvikelsekontroller,
- lasning av avslutad period,
- rattelseflode utan historikforlust,
- deklarationsunderlag,
- tydligt revisionsspar.

### Klart nar

En momsperiod kan ga fran oppen period till kontrollerat deklarationsunderlag med sparbar historik.

---

## 8. Offert -> order -> faktura

### Mal

Foretagaren ska slippa registrera samma affar flera ganger.

### Flode

```text
offert
-> accepterad
-> order
-> leverans/fakturering
-> kundfaktura
-> reskontra
-> betalning
```

### Senare stod

- delfakturering,
- samlingsfakturering,
- aterkommande fakturor,
- kredit fran ursprungsfaktura.

### Klart nar

En normal forsaljning kan foljas fran forsta offert till betald faktura.

---

## 9. Kvitton och utlagg

### Mal

Kvitton ska kunna registreras snabbt fran telefon eller webblasare.

### Flode

```text
foto/PDF
-> dokumenttolkning
-> datum + handlare + belopp + moms
-> konteringsforslag
-> attest
-> bokforing
-> arkiv
```

### Klart nar

Ett vanligt kvitto kan bokforas utan att anvandaren manuellt skriver av hela kvittot.

En separat native mobilapp ar inte ett krav i forsta versionen; en bra mobilanpassad webbvy racker.

---

## 10. Bokslutsnara funktioner

### Mal

Minska beroendet av externa manuella arbetsfiler vid period- och arsavslut.

### Prioritet

- periodiseringar,
- upplupna kostnader/intakter,
- avskrivningsunderlag,
- kontoavstamningar,
- arsvis kontrollista,
- bilagor till balanskonton.

Full deklarations-/arsredovisningsprodukt ar en separat stor etapp och ska inte smygas in i denna leverans.

---

## 11. Lon - endast efter att ekonomikar­nan ar stabil

Det finns redan lonerelaterad kod i repositoryt, men lon ska inte prioriteras fore bank, leverantorsautomation, rapportering och moms.

### For att kalla lon "produktionsklar" kravs bland annat

- anstalldaregister,
- lonarter,
- skatt och arbetsgivaravgifter,
- semester,
- lonbesked,
- AGI-underlag,
- bokforingskoppling,
- betalningsunderlag,
- behorigheter,
- full historik och rattelser.

Lon ar juridiskt och ekonomiskt kansligt. Funktionen ska betraktas som separat produktionsdomän med egna gates.

---

# P2 - efter att karnan kan ersatta Fortnox i vardagen

## 12. Lager

Repositoryt innehaller redan lagerrelaterad backendkod. Nasta steg ar att avgora om lager ar en strategisk malgruppsfunktion eller endast ett tillagg.

For full modul behovs bland annat:

- lagerstallen,
- in-/utleverans,
- lagervarde,
- inventering,
- koppling till order/faktura,
- korrigeringar med historik.

## 13. Anlaggningsregister

- tillgangar,
- anskaffningsvarde,
- avskrivningsplan,
- automatiska avskrivningsverifikationer,
- utrangering/forsaljning,
- rapporter.

## 14. Tid och projekt

Endast om malgruppen faktiskt behover det:

- tidrapportering,
- projekt,
- kostnadsbarare,
- fakturering fran tid,
- projektresultat.

## 15. Integrationsekosystem

Nar interna domankontrakt ar stabila:

- dokumenterat API,
- webhooks,
- externa integrationer,
- scopes/behörigheter,
- rate limits,
- auditlogg,
- sandbox.

---

# Vad vi inte ska prioritera nu

Foljande kan finnas hos stora ekonomiplattformar men ar inte nodvandigt for att LT Studio ska bli ett starkt system for mindre AB:

- fakturakop/finansiering,
- kreditupplysning som egen produkt,
- foretagskort som egen finansiell produkt,
- stort marketplace,
- avancerad HR,
- fullstandig native mobilapp,
- alla branschspecifika specialmoduler.

De kan laggas till senare om riktiga kunder visar att de behovs.

---

# Leveransordning

Den rekommenderade ordningen efter #630 ar:

| Ordning | Leverans | Prioritet |
| --- | --- | --- |
| 1 | Production readiness | P0 |
| 2 | Bankkopplingsgrund | P1 |
| 3 | Automatisk bankavstamning/kundinbetalning | P1 |
| 4 | Leverantorsfaktura-OCR och konteringsforslag | P1 |
| 5 | E-faktura / Peppol | P1 |
| 6 | Rapporter | P1 |
| 7 | Moms och periodstangning | P1 |
| 8 | Offert/order/aterkommande fakturering | P1 |
| 9 | Kvitton och utlagg | P1 |
| 10 | Bokslutsnara funktioner | P1 |
| 11 | Lon production readiness | P2 |
| 12 | Lager/anlaggning/tid | P2 |
| 13 | Externt integrationsekosystem | P2 |

---

# Definition av "LT Studio kan ersatta Fortnox for var malgrupp"

Vi ska inte anvanda marknadsforingssprak som "ersatter Fortnox" innan detta kan visas i en riktig UAT/pilot.

Minimigaten ar:

- riktiga kund- och leverantorsfloden fungerar,
- bankhandelser kan importeras och stammas av,
- momsunderlag kan tas fram,
- centrala rapporter stammer,
- dokument kan sparas och aterfinnas,
- bokforingshistorik kan inte tyst skrivas om,
- fler anvandare kan arbeta sakert i samma foretag,
- backup och restore ar verifierade,
- kritiska floden har automatiska tester,
- en pilot kan koras utan manuella databasfixar.

Nar dessa punkter ar verifierade kan vi gora en separat gap-analys mot Fortnox igen och besluta vilka P2-moduler som faktiskt ger kundvarde.

---

# Arbetsregel for varje roadmap-punkt

Varje funktion ska folja:

```text
senaste main
-> liten avgransad branch
-> implementation
-> tester
-> PR
-> Quality/CodeQL
-> merge
-> GitHub Pages UAT
-> manuell verifiering
-> dokumenterat bevis
```

For Supabase:

```text
migration/function i GitHub forst
-> clean rebuild-test
-> apply/deploy
-> security/performance check
-> UAT
-> dokumentation
```

Inga permanenta produktions- eller UAT-andringar ska endast leva i Supabase-dashboarden.

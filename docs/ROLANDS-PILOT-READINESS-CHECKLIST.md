# ROLANDS PILOT READINESS CHECKLIST

Senast granskad: 2026-09-20. Företag: Rolands Frukt o Grönt Aktiebolag, 556406-5059.

**Samlat beslut: ❌ Inte klar för pilot med verkliga verksamhets- eller bokföringsdata.** Detta är en nulägeschecklista, inte ett slutintyg. Se [audit och bevis](PRODUCTION-READINESS-AUDIT-2026-09-18.md) och [uppföljning om historik och rättelser, PR 66](HISTORY-PROTECTION.md).

✅ Klar = den uttryckligen avgränsade kontrollen är implementerad och testad. 🟡 Delvis klar = kod eller vissa prov finns men viktiga bevis saknas. ❌ Inte klar = saknas, är blockerad eller är inte verifierad i avsedd drift.

| Kritiskt område | Status | Bevis eller vad som återstår |
|---|---|---|
| GitHub som källa, spårbara ändringar | ✅ Klar | Baseline c8bb496; separata grenar/PR:er med kontroller före sammanslagning. |
| Atomisk lagring av en verifikation | ✅ Klar | PR 62; fel vid andra raden återställer huvud, rader och nummerserie. PR 66 testar även fel i förseglingen. |
| Identiska/ändrade återförsök på journalnivå | ✅ Klar | PR 62; identiskt återanvänder, ändrat innehåll nekas. |
| Dubbelklick/idempotens i alla affärsflöden | 🟡 Delvis klar | PR 91 jämför innehållet bakom kundfakturans/kreditens request-ID och stoppar ändrade återförsök; nummerreservationen gör PDF-fel säkert återupptagbara. Övriga mutationer måste fortfarande verifieras systematiskt. |
| Deklarerade företagsrelationer i SQLite | ✅ Klar | PR 63; kontroll vid start och spärrar för INSERT/UPDATE. Befintlig ogiltig historik stoppar start utan att tas bort. |
| Fullständig företagsisolering och IDOR | 🟡 Delvis klar | Vanlig företagsfiltrering, 14 routefamiljers anonyma anrop och flera objektprov; hela identitets-/företags-/metodmatrisen och polymorfa länkar återstår. |
| Inloggning, sessionscookie, MFA och CSRF | 🟡 Delvis klar | PR 73: 60 min idle-timeout, 8 h absolut sluttid och engångsförbrukning av TOTP-steg är testade; aktuellt företagsmedlemskap kontrolleras på servern vid varje anrop. Kontorecovery, processöverskridande brute-force-skydd, nyckelrotation och driftprov återstår. |
| Oföränderliga bokföringsposter och audit-logg | 🟡 Delvis klar | PR 66: databasspärrar, journalförsegling och kontroller vid start/läsning/restore; auditlogg kan inte skrivas om genom vanlig databasoperation. Oberoende revisionsankare, full arkivtäckning och verklig driftverifiering återstår. |
| Rättelse med bibehållen originalhistorik | 🟡 Delvis klar | PR 66: atomisk manuell rättelse med moms, originalkoppling och audit. Osäkra fristående rättelser av automatiska poster och 151x/244x nekas. Komplett rättelse som uppdaterar reskontra och betalningsstatus tillsammans återstår. |
| Moms i faktura och leverantörsbokföring | 🟡 Delvis klar | Beräkning/konton och normal inhemsk kontering finns. Komplett regel- och scenarioverifiering återstår. |
| Momsavstämning mot bokförd huvudbok | 🟡 Delvis klar | PR 71: huvudbelopp kommer nu från bokförda momskonton och källanknutna kund-/leverantörsfakturor stäms av mot verifikation. Full deklarationslogik, specialfall och periodavslut återstår. |
| Aktuella momssatser, tidpunkt och klassificering | 🟡 Delvis klar | Kundfakturor kräver verifierad försäljningstyp: livsmedel 12 % t.o.m. 2026-03-31 och 6 % från 2026-04-01, restaurang/catering 12 %, övrigt normalfall 25 %. Backend härleder sats och stoppar motsägande konto/sats. EU/import/momsfritt/krediter över regeländring och regler efter 2026-12-31 återstår. |
| Dröjsmålsränta och betalningspåminnelser | 🟡 Delvis klar | PR 70: delbetalningsdagar och verifierade halvår styr beräkningen, ofullständig/komplex historik blockeras och regelversion sparas. Källanknuten kredit-/justeringshistorik samt dokumenterad rättslig startgrund per kundtyp återstår. |
| Fakturadatum, förfallodatum, separat bokföringsdatum | 🟡 Delvis klar | Fält finns åtskilda. PR 66 låser ursprungliga datum när kundfakturans underlag arkiverats. PDF, leveransdatum och riktiga backendflöden ska verifieras tillsammans. |
| Återanvändning av kunddata och inget artikelnummerkrav | 🟡 Delvis klar | Backend hämtar köpare från kundregister; betalningsvillkor/referenser och hela UAT behöver kompletteras. |
| PDF-visning i pilotens attest/fakturering | 🟡 Delvis klar | Privat vendor-resurs, iframe och objektbehörighet är testade. PR 91 bevarar dessutom exakt genererade PDF-bytes för utfärdad kund- och kreditfaktura och serverar dem företagsisolerat efter hashkontroll. Full Rolands-UAT i avsedd drift återstår. |
| Kundfordringar, leverantörsskulder, ingående balanser | 🟡 Delvis klar | PR 75 stämmer av aktuellt kundreskontrasaldo mot konto 1510 och flaggar saknad/avvikande källverifikation. PR 76 stämmer av bokförda leverantörsskulder mot konto 2440 och särredovisar ej bokförda leverantörsfakturor. Inga differenser rättas automatiskt. Inga verifierade ingående balans-importer eller kompletta källanknutna rättelseflöden finns ännu. |
| Lokalt tekniskt backup-/restore-verktyg | 🟡 Delvis klar | PR 64 har utökad verifiering och verkliga CLI-prov. PR 66 verifierar även befintliga journalförseglingar. Det är inte ett helt återställningsprov av driftmiljön. |
| Krypterad extern backup, retention och larm | ❌ Inte klar | Inget verifierat leverantörs-/konfigurationsbevis. |
| Arkivering av original och långsiktig läsbarhet | 🟡 Delvis klar | PR 91 arkiverar exakt utfärdad kund-/kredit-PDF oföränderligt i den privata databasen, med SHA-256 och verifierad återläsning. Extern långtidslagring, retention, arkivexport/återläsning över hela bevarandetiden och driftavtal återstår. |
| Health/readiness, driftlogg och fungerande larm | ❌ Inte klar | Teknisk grund finns men disk-/DB-/timeout- och larmscenarier saknas. |
| Secrets-hantering och historikskanning | 🟡 Delvis klar | Platshållare i exempelkonfiguration; snapshot-skanning utan tydliga tokenfynd. Full Git-historik och faktisk drift måste kontrolleras. |
| Miljöspärr och separation demo/pilot/produktion | 🟡 Delvis klar | PR 67: bindande startkontroll, privata lagringssökvägar, servernekat demo-query och inga demo-/legacyhjälpfiler. Granskning av befintliga data och verklig drift återstår. |
| Betalningsöversikt dag/vecka/månad/kvartal | 🟡 Delvis klar | Delvyer finns; en konsekvent filtrerad privat översikt ska sluttestas. |
| Filtrerad Excel-kompatibel export | ❌ Inte klar | Fullständighet, samma filter som vyn och formelinjektionsskydd återstår att verifiera. |
| Arbetslista och begriplig återkoppling | 🟡 Delvis klar | PR 99 gör huvudöversikten till en faktisk arbetslista byggd från kundreskontra, leverantörsfakturor, bank, automation, leverantörsändringar, lager och periodupplåsningar. API-fel visas som ofullständig arbetslista i stället för falska nollvärden. Modulkatalogen ligger kvar sekundärt. Full UAT av direktlänkar och statusmeddelanden återstår. |
| Obligatoriska releasekontroller och rollback | 🟡 Delvis klar | CI finns; branch/ruleset, produktionsflöde och databasrollback behöver driftsbevis. |
| Rolands nio UAT-scenarier mot pilotserver | ❌ Inte klar | Befintliga demo- och kodtester ersätter inte ett signerat pilot-UAT. |
| K2/K3, momsperiod och bolagsspecifika inställningar | ❌ Inte klar | Målinställningar finns; faktisk årsredovisning och registrerad redovisningsperiod ska styrkas. |
| Driftansvarig, dataskydd, support och pilotstopp | ❌ Inte klar | Ansvar, avtal, återgång och incidentrutin ska beslutas innan riktiga data används. |

## Webbplatsutkast och privat förhandsvisning

Den privata CMS-vägen har versionskontroll och atomisk audit-loggning. Sparande ändrar inte publicerat innehåll; förhandsvisningen använder serverdata efter behörighetskontroll. Publicering i CMS är inte anslutning till extern webbdrift. Se [kontroller och begränsningar](PRIVATE-RUNTIME-AND-PREVIEW.md).

## Godkännande av nästa steg

Tekniskt ansvarig och redovisningsansvarig ska stänga relevanta BLOCKER-rader med testbevis, exakt releaseversion och datum. Därefter genomför Rolands UAT med fiktiva/avidentifierade data i den tänkta driftmiljön. Först efter godkända bevis fattas ett uttryckligt beslut om begränsad pilot, datamängd, användare, varaktighet och stoppkriterier.

Detta arbete ansluter inte e-post eller bank och slår inte på självständig AI-bokföring. Ett godkännande av ett förslag måste alltid beskriva den faktiskt genomförda åtgärden.

## Verifierad uppföljning 2026-09-20 – betalningsåterförsök

Bas: `3c69c0266b1e3be0b052c708826561e732876c66`. Ett regressionstest reproducerade att leverantörsbetalningens redan bokförda resultat återlämnades även när återförsöket ändrade bokföringsdatum eller utelämnade bankreferensen. Backend jämför nu både normaliserad referens och effektivt bokföringsdatum med den sparade betalningen/verifikationen och svarar 409 vid avvikelse. Tio identiska försök skapar bara en betalningsverifikation och en audit-händelse. De 11 berörda betalnings-/leverantörsbokföringstesterna passerar på Node 24.19.0. Detta stänger endast denna lucka i P12; den fullständiga mutationsmatrisen och drift-UAT återstår. **NO-GO kvarstår.**

## Ny användarmodell 2026-09-20

Rollfält och rolltilldelning har ersatts med personligt företagsmedlemskap. MFA krävs för alla. De automatiska medlemskaps- och migrationsproven finns i `company-membership-http.test.js`, `membership-migration.test.js` och `access-control.test.js`. Se [migration, kontroller och begränsningar](ACCESS-CONTROL.md). Full CI måste passera före merge. Den fullständiga IDOR-matrisen och faktisk pilot-UAT är fortsatt delvis/inte klara; inga sådana rader markeras gröna av detta arbete.


## Verifierad uppföljning 2026-09-20 – arbetslista

PR 99 rättar först ett konkret dashboardfel där den privata översikten anropade den icke-existerande `/receivables/invoices` i stället för `/receivables`, samtidigt som felet tidigare doldes av tom `catch`. Dashboarden läser nu faktiska privata köer för kundreskontra, leverantörsfakturor, bankmatchning, automationsgranskning, leverantörsändringar, lagerjusteringar och periodupplåsningar. Förfallna kundfakturor och belopp beräknas från verklig reskontradata. Om någon kö inte kan läsas visas en tydlig varning och nollvärdet får inte tolkas som att arbetet är klart. Konkreta uppgifter visas före den sekundära modulkatalogen. **NO-GO kvarstår tills UAT och övriga blockerare är stängda.**

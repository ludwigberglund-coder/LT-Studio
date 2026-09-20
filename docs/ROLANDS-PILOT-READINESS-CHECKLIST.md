# ROLANDS PILOT READINESS CHECKLIST

Senast granskad: 2026-09-20. Företag: Rolands Frukt o Grönt Aktiebolag, 556406-5059.

**Samlat beslut: ❌ Inte klar för pilot med verkliga verksamhets- eller bokföringsdata.** Detta är en nulägeschecklista, inte ett slutintyg. Se [audit och bevis](PRODUCTION-READINESS-AUDIT-2026-09-18.md) och [uppföljning om historik och rättelser, PR 66](HISTORY-PROTECTION.md).

✅ Klar = den uttryckligen avgränsade kontrollen är implementerad och testad. 🟡 Delvis klar = kod eller vissa prov finns men viktiga bevis saknas. ❌ Inte klar = saknas, är blockerad eller är inte verifierad i avsedd drift.

| Kritiskt område | Status | Bevis eller vad som återstår |
|---|---|---|
| GitHub som källa, spårbara ändringar | ✅ Klar | Baseline c8bb496; separata grenar/PR:er med kontroller före sammanslagning. |
| Atomisk lagring av en verifikation | ✅ Klar | PR 62; fel vid andra raden återställer huvud, rader och nummerserie. PR 66 testar även fel i förseglingen. |
| Identiska/ändrade återförsök på journalnivå | ✅ Klar | PR 62; identiskt återanvänder, ändrat innehåll nekas. |
| Dubbelklick/idempotens i alla affärsflöden | 🟡 Delvis klar | PR 91 skyddar kundfaktura/kredit. PR 110 verifierar dessutom bankimport, leverantörsfaktura, dokumentarkiv och bokföringsrättelse mot dubbla beständiga objekt. Full mutationsinventering återstår. |
| Deklarerade företagsrelationer i SQLite | ✅ Klar | PR 63; kontroll vid start och spärrar för INSERT/UPDATE. Befintlig ogiltig historik stoppar start utan att tas bort. |
| Fullständig företagsisolering och IDOR | 🟡 Delvis klar | PR 107 utökar objektmatrisen med andra-företags-ID för leverantörsfaktura/PDF, verifikation och dokument samt mutationer med giltig session + CSRF. Hela route/metodmatrisen och polymorfa länkar återstår. |
| Inloggning, sessionscookie, MFA och CSRF | 🟡 Delvis klar | PR 73: 60 min idle-timeout, 8 h absolut sluttid och engångsförbrukning av TOTP-steg är testade; aktuellt företagsmedlemskap kontrolleras på servern vid varje anrop. Kontorecovery, processöverskridande brute-force-skydd, nyckelrotation och driftprov återstår. |
| Oföränderliga bokföringsposter och audit-logg | 🟡 Delvis klar | PR 66: databasspärrar, journalförsegling och kontroller vid start/läsning/restore; auditlogg kan inte skrivas om genom vanlig databasoperation. Oberoende revisionsankare, full arkivtäckning och verklig driftverifiering återstår. |
| Rättelse med bibehållen originalhistorik | 🟡 Delvis klar | PR 66: atomisk manuell rättelse med moms, originalkoppling och audit. Osäkra fristående rättelser av automatiska poster och 151x/244x nekas. Komplett rättelse som uppdaterar reskontra och betalningsstatus tillsammans återstår. |
| Moms i faktura och leverantörsbokföring | 🟡 Delvis klar | Normal inhemsk kontering finns. PR 109 verifierar blandad 25/12/6 % i samma kundfaktura och källavstämning mot respektive momskonto. EU/import/momsfritt och övriga specialfall återstår. |
| Momsavstämning mot bokförd huvudbok | 🟡 Delvis klar | PR 109 gör källavstämningen fail-closed vid saknad verifikation, fel bokföringsdatum eller momsbeloppsdifferens. Full deklarationslogik, specialfall och periodavslut återstår. |
| Aktuella momssatser, tidpunkt och klassificering | 🟡 Delvis klar | Kundfakturor kräver verifierad försäljningstyp: livsmedel 12 % t.o.m. 2026-03-31 och 6 % från 2026-04-01, restaurang/catering 12 %, övrigt normalfall 25 %. Backend härleder sats och stoppar motsägande konto/sats. EU/import/momsfritt/krediter över regeländring och regler efter 2026-12-31 återstår. |
| Dröjsmålsränta och betalningspåminnelser | 🟡 Delvis klar | PR 70: delbetalningsdagar och verifierade halvår styr beräkningen, ofullständig/komplex historik blockeras och regelversion sparas. Källanknuten kredit-/justeringshistorik samt dokumenterad rättslig startgrund per kundtyp återstår. |
| Fakturadatum, förfallodatum, separat bokföringsdatum | 🟡 Delvis klar | Fält finns åtskilda. PR 108 verifierar den text som faktiskt ritas i kund-PDF:n: fakturadatum + förfallodatum visas, avvikande bokföringsdatum visas inte. Leveransdatum och full UAT återstår. |
| Återanvändning av kunddata och inget artikelnummerkrav | 🟡 Delvis klar | Backend hämtar köpare från kundregister; betalningsvillkor/referenser och hela UAT behöver kompletteras. |
| PDF-visning i pilotens attest/fakturering | 🟡 Delvis klar | Privat vendor-resurs, iframe och objektbehörighet är testade. PR 91 bevarar dessutom exakt genererade PDF-bytes för utfärdad kund- och kreditfaktura och serverar dem företagsisolerat efter hashkontroll. Full Rolands-UAT i avsedd drift återstår. |
| Kundfordringar, leverantörsskulder, ingående balanser | 🟡 Delvis klar | PR 75 stämmer av aktuellt kundreskontrasaldo mot konto 1510 och flaggar saknad/avvikande källverifikation. PR 76 stämmer av bokförda leverantörsskulder mot konto 2440 och särredovisar ej bokförda leverantörsfakturor. Inga differenser rättas automatiskt. Inga verifierade ingående balans-importer eller kompletta källanknutna rättelseflöden finns ännu. |
| Lokalt tekniskt backup-/restore-verktyg | 🟡 Delvis klar | PR 64 har utökad verifiering och verkliga CLI-prov. PR 66 verifierar befintliga journalförseglingar. PR 94 verifierar dessutom SHA-256, storlek och filsignatur för alla färdiga dokumentblobbar i backupen. Det är fortfarande inte ett helt återställningsprov av driftmiljön. |
| Krypterad extern backup, retention och larm | 🟡 Delvis klar | PR 116 skapar autentiserat krypterad `.sqlite.enc` med separat backupnyckel och verifierar restore direkt från krypterad artefakt. Extern leverantör/kopiering, retention i drift och larmbevis återstår. |
| Arkivering av original och långsiktig läsbarhet | 🟡 Delvis klar | PR 91 arkiverar exakt utfärdad kund-/kredit-PDF oföränderligt i den privata databasen. PR 94 gör det allmänna dokumentarkivet fail-closed vid avvikande SHA-256, storlek eller filsignatur och tar med samma kontroll i restore-verifieringen. Extern långtidslagring, retention, arkivexport/återläsning över hela bevarandetiden och driftavtal återstår. |
| Health/readiness, driftlogg och fungerande larm | 🟡 Delvis klar | PR 95 separerar liveness/readiness och kontrollerar DB-läsning, skrivbarhet, diskutrymme samt färsk lokal backup med checksumma i pilot/produktion. Extern övervakning, central logginsamling och larm återstår. |
| Secrets-hantering och historikskanning | 🟡 Delvis klar | PR 112 skannar full Git-historik i CI efter högkonfidensmönster utan att logga hemliga värden. Secret manager, faktisk nyckelrotation och driftmiljö återstår. |
| Miljöspärr och separation demo/pilot/produktion | 🟡 Delvis klar | PR 67: bindande startkontroll, privata lagringssökvägar, servernekat demo-query och inga demo-/legacyhjälpfiler. Granskning av befintliga data och verklig drift återstår. |
| Betalningsöversikt dag/vecka/månad/kvartal | 🟡 Delvis klar | PR 106 samlar in-/utbetalningar i privat vy med dag, ISO-vecka, månad och kvartal samt in/ut/netto-summor. Fler detaljfilter, sortering och browser-UAT återstår. |
| Filtrerad Excel-kompatibel export | 🟡 Delvis klar | PR 105 lägger autentiserade Excel-kompatibla CSV-exporter för reskontror, fakturor, in-/utbetalningar, verifikationer, kontotransaktioner och momsunderlag med filtervalidering och formelinjektionsskydd. Portalens filterkoppling och full browser-UAT återstår. |
| Arbetslista och begriplig återkoppling | 🟡 Delvis klar | Flera vyer finns; godkänd får inte kallas bokförd, fel får inte döljas som nollvärden. |
| Obligatoriska releasekontroller och rollback | 🟡 Delvis klar | CI finns; branch/ruleset, produktionsflöde och databasrollback behöver driftsbevis. |
| Rolands nio UAT-scenarier mot pilotserver | ❌ Inte klar | Befintliga demo- och kodtester ersätter inte ett signerat pilot-UAT. |
| K2/K3, momsperiod och bolagsspecifika inställningar | 🟡 Delvis klar | PR 111 skiljer verifierade fakta från målbeslut. Kalenderår har offentligt stöd; K2 och månadsvis moms är uttryckligen target-unverified tills signerad årsredovisning respektive Skatteverket kontrollerats. |
| Driftansvarig, dataskydd, support och pilotstopp | 🟡 Delvis klar | PR 113 gör en extern operationsfil obligatorisk i pilot/produktion och kräver ansvar, incident/supportväg, rollbackprocess, offsite-backupdestination, retention och explicit pilotgodkännande. Verkliga personer/avtal måste fortfarande fyllas i privat. |

## Webbplatsutkast och privat förhandsvisning

Den privata CMS-vägen har versionskontroll och atomisk audit-loggning. Sparande ändrar inte publicerat innehåll; förhandsvisningen använder serverdata efter behörighetskontroll. Publicering i CMS är inte anslutning till extern webbdrift. Se [kontroller och begränsningar](PRIVATE-RUNTIME-AND-PREVIEW.md).

## Godkännande av nästa steg

Tekniskt ansvarig och redovisningsansvarig ska stänga relevanta BLOCKER-rader med testbevis, exakt releaseversion och datum. Därefter genomför Rolands UAT med fiktiva/avidentifierade data i den tänkta driftmiljön. Först efter godkända bevis fattas ett uttryckligt beslut om begränsad pilot, datamängd, användare, varaktighet och stoppkriterier.

Detta arbete ansluter inte e-post eller bank och slår inte på självständig AI-bokföring. Ett godkännande av ett förslag måste alltid beskriva den faktiskt genomförda åtgärden.

## Verifierad uppföljning 2026-09-20 – betalningsåterförsök

Bas: `3c69c0266b1e3be0b052c708826561e732876c66`. Ett regressionstest reproducerade att leverantörsbetalningens redan bokförda resultat återlämnades även när återförsöket ändrade bokföringsdatum eller utelämnade bankreferensen. Backend jämför nu både normaliserad referens och effektivt bokföringsdatum med den sparade betalningen/verifikationen och svarar 409 vid avvikelse. Tio identiska försök skapar bara en betalningsverifikation och en audit-händelse. De 11 berörda betalnings-/leverantörsbokföringstesterna passerar på Node 24.19.0. Detta stänger endast denna lucka i P12; den fullständiga mutationsmatrisen och drift-UAT återstår. **NO-GO kvarstår.**

## Ny användarmodell 2026-09-20

PR 93 är sammanslagen till `main`: rollfält och rolltilldelning har ersatts med personligt företagsmedlemskap och MFA krävs för alla. De automatiska medlemskaps- och migrationsproven finns i `company-membership-http.test.js`, `membership-migration.test.js` och `access-control.test.js`. Se [migration, kontroller och begränsningar](ACCESS-CONTROL.md). Den fullständiga IDOR-matrisen och faktisk pilot-UAT är fortsatt delvis/inte klara; inga sådana rader markeras gröna av detta arbete.


## Verifierad uppföljning 2026-09-20 – dokumentintegritet vid läsning och restore

PR 94 lägger fail-closed-kontroll på det allmänna dokumentarkivet. Ett färdigställt dokument får bara lämnas ut om lagrad SHA-256, storlek och filsignatur fortfarande matchar de sparade bytesen. `pilot:restore:verify` kontrollerar samma egenskaper för varje färdigt arkivdokument i backupkopian. Regressionstester skadar avsiktligt dokumentblobben respektive storleksmetadata och kräver integritetsfel. Detta förbättrar lokalt arkiv- och restorebevis men ersätter inte extern krypterad backup, retention, verklig återställningsövning eller långtidsarkiv. **NO-GO kvarstår.**


## Konsoliderad status 2026-09-20 efter PR 95–113

`main` innehåller nu PR 95, 96 och 105–113. Denna uppdatering korrigerar checklistan så den motsvarar faktisk kod och verifierade GitHub Actions-resultat. Inga delvis klara områden har markerats gröna enbart på grund av kod; driftbevis, full browser-UAT, extern backup/monitorering och primärkällekontroller kvarstår där de uttryckligen anges. **Samlat beslut är fortsatt NO-GO.**


## Verifierad uppföljning 2026-09-20 – krypterad backup

PR 116 är sammanslagen till `main`. Backupverktyget kan skapa en separat AES-256-GCM-krypterad `.sqlite.enc` med unik salt/IV och egen SHA-256. Pilot/produktion kräver en separat stark `ROLLANDS_BACKUP_ENCRYPTION_KEY`. Restore kan ta den krypterade filen direkt och skapar ingen användbar restore-target vid fel nyckel, manipulerad ciphertext eller misslyckad SQLite/tenant/journal/dokumentverifiering. Detta bevisar kryptering och återläsning i kod, men inte att en extern lagringsleverantör, retention eller larm är driftsatt. **NO-GO kvarstår.**

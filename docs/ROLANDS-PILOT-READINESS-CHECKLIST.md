# ROLANDS PILOT READINESS CHECKLIST

Senast granskad: 2026-09-21. Företag: Rolands Frukt o Grönt Aktiebolag, 556406-5059.

**Samlat beslut: ❌ Inte klar för pilot med verkliga verksamhets- eller bokföringsdata.** Detta är en nulägeschecklista, inte ett slutintyg. Se [audit och bevis](PRODUCTION-READINESS-AUDIT-2026-09-18.md) och [uppföljning om historik och rättelser, PR 66](HISTORY-PROTECTION.md).

✅ Klar = den uttryckligen avgränsade kontrollen är implementerad och testad. 🟡 Delvis klar = kod eller vissa prov finns men viktiga bevis saknas. ❌ Inte klar = saknas, är blockerad eller är inte verifierad i avsedd drift.

| Kritiskt område | Status | Bevis eller vad som återstår |
|---|---|---|
| GitHub som källa, spårbara ändringar | 🟡 Delvis klar | Branch → PR → CI används och `Quality and security checks` kör full test-/browserkedja. Verifiering 2026-09-21 visar dock `main` som `protected: false` och inga repository rulesets. BLOCKER #226 kräver tekniskt PR-/CI-skydd innan pilot. |
| Atomisk lagring av en verifikation | ✅ Klar | PR 62; fel vid andra raden återställer huvud, rader och nummerserie. PR 66 testar även fel i förseglingen. |
| Identiska/ändrade återförsök på journalnivå | ✅ Klar | PR 62; identiskt återanvänder, ändrat innehåll nekas. |
| Dubbelklick/idempotens i alla affärsflöden | 🟡 Delvis klar | Kundfaktura/kredit och tidigare kärnflöden är skyddade. PR 212 härdar bank, leverantörsbokföring, betalningsförberedelse/-bekräftelse och lön; PR 217 gör lagermutationer retry-säkra; PR 221 gör leverantörsändringar och flera beslut retry-säkra. Fortsatt mutationsinventering krävs när nya skrivflöden tillkommer. |
| Deklarerade företagsrelationer i SQLite | ✅ Klar | PR 63; kontroll vid start och spärrar för INSERT/UPDATE. Befintlig ogiltig historik stoppar start utan att tas bort. |
| Fullständig företagsisolering och IDOR | 🟡 Delvis klar | PR 206 spärrar polymorfa dokumentlänkar mot fel företag och PR 209 utökar den metodmedvetna HTTP-IDOR-matrisen. PR 223 kör dessutom kund nummer två genom riktig kundfaktura, PDF och bokföring och kräver 404 från företag A. Startup-regler klassificerar privata tabeller efter tenant-scope. Nya routes/objekttyper måste fortsatt omfattas av samma blockerande matris. |
| Inloggning, sessionscookie, MFA och CSRF | 🟡 Delvis klar | PR 73 verifierar sessionstider, MFA och CSRF. PR 123 gör inloggningsspärren persistent i SQLite över serveromstart. PR 124 ger atomisk rotation av MFA-masterkey och PR 127 tvåpersons kontorecovery med lösenords-/MFA-rotation, sessionsåterkallelse och audit. Verkliga drift-/recoveryövningar återstår. |
| Oföränderliga bokföringsposter och audit-logg | 🟡 Delvis klar | PR 66: databasspärrar, journalförsegling och kontroller vid start/läsning/restore; auditlogg kan inte skrivas om genom vanlig databasoperation. Oberoende revisionsankare, full arkivtäckning och verklig driftverifiering återstår. |
| Rättelse med bibehållen originalhistorik | 🟡 Delvis klar | PR 66: atomisk manuell rättelse med moms, originalkoppling och audit; osäkra fristående rättelser av automatiska poster och 151x/244x nekas. Källanknuten leverantörsbetalningsrättelse återför betalningsverifikation och öppnar 2440/reskontran igen med bevarad bank-/försökshistorik. Kundinbetalningar kan bokföras från mänskligt godkänd bankmatchning och omföras mellan fullt reglerade kundfakturor med separat 1510↔1510-verifikation, oföränderlig omföringshistorik och oförändrad 1930-bankpost. Räntehistoriken förstår även payment-reversal. Direkt omföring av ett fortfarande öppet delsaldo samt kredit efter delbetalning återstår och är fail-closed. |
| Moms i faktura och leverantörsbokföring | 🟡 Delvis klar | Normal inhemsk kontering finns. PR 109 verifierar blandad 25/12/6 % i samma kundfaktura och källavstämning mot respektive momskonto. EU/import/momsfritt och övriga specialfall återstår. |
| Momsavstämning mot bokförd huvudbok | 🟡 Delvis klar | PR 109 gör källavstämningen fail-closed vid saknad verifikation, fel bokföringsdatum eller momsbeloppsdifferens. Full deklarationslogik, specialfall och periodavslut återstår. |
| Aktuella momssatser, tidpunkt och klassificering | 🟡 Delvis klar | Kundfakturor kräver verifierad försäljningstyp: livsmedel 12 % t.o.m. 2026-03-31 och 6 % från 2026-04-01, restaurang/catering 12 %, övrigt normalfall 25 %. Backend härleder sats och stoppar motsägande konto/sats. EU/import/momsfritt/krediter över regeländring och regler efter 2026-12-31 återstår. |
| Dröjsmålsränta och betalningspåminnelser | 🟡 Delvis klar | PR 70: delbetalningsdagar och verifierade halvår styr beräkningen, ofullständig/komplex historik blockeras och regelversion sparas. Källanknuten kredit-/justeringshistorik samt dokumenterad rättslig startgrund per kundtyp återstår. |
| Fakturadatum, förfallodatum, separat bokföringsdatum | 🟡 Delvis klar | Fält finns åtskilda. PR 108 verifierar den text som faktiskt ritas i kund-PDF:n: fakturadatum + förfallodatum visas, avvikande bokföringsdatum visas inte. Leveransdatum och full UAT återstår. |
| Återanvändning av kunddata och inget artikelnummerkrav | 🟡 Delvis klar | Backend hämtar köpare från kundregister; betalningsvillkor/referenser och hela UAT behöver kompletteras. |
| PDF-visning i pilotens attest/fakturering | 🟡 Delvis klar | Privat vendor-resurs, iframe och objektbehörighet är testade. PR 91 bevarar dessutom exakt genererade PDF-bytes för utfärdad kund- och kreditfaktura och serverar dem företagsisolerat efter hashkontroll. Full Rolands-UAT i avsedd drift återstår. |
| Kundfordringar, leverantörsskulder, ingående balanser | 🟡 Delvis klar | PR 75 stämmer av kundreskontrasaldo mot 1510 och PR 76 bokförda leverantörsskulder mot 2440. En mänskligt godkänd kundinbetalningsmatchning kan nu genomföras atomiskt som 1930 debet/1510 kredit för både hel- och delbetalning. Delbetalning minskar restbeloppet utan ny specialstatus, senare betalning kan slutreglera samma faktura och reskontrans räntehistorik följer betalning + återföring. Fel allokering av fullt reglerad betalning kan omföras mellan två fakturor utan att ändra den verkliga bankinbetalningen. En strikt ingående-balansimport finns för balanskonton i klass 1–2 och blockerar 1510/2440 utan detaljreskontra. Öppna kund-/leverantörsposter vid start, kredit efter delbetalning och mer komplex delreskontrarättelse återstår. |
| Lokalt tekniskt backup-/restore-verktyg | 🟡 Delvis klar | SQLite, journal och dokumentintegritet verifieras och krypterad backup kan återställas till isolerad kopia. Restore-kontrollen verifierar dessutom alla tre privata SQLite-filflöden med central objektmetadata/SHA-kontroll och schema-2-evidens som readiness kan kräva. Verkligt återställningsprov i avsedd driftmiljö återstår. |
| Krypterad extern backup, retention och larm | 🟡 Delvis klar | PR 116 skapar autentiserat krypterad `.sqlite.enc`. PR 117 ger dry-run-first retention med explicit `--apply`. PR 119 kräver färskt restore-drill-bevis och PR 122 kräver färskt externt monitorerings-/larmbevis i readiness. Faktisk extern lagring, körd retention och verkligt larmtest återstår. |
| Arkivering av original och långsiktig läsbarhet | 🟡 Delvis klar | Exakt utfärdad kund-/kredit-PDF och dokumentintegritet är skyddade. PR 200 inventerar och SHA-verifierar alla tre privata filflöden, PR 202/204/208 ger recoverable ledger, idempotent planering och verifierad async copy-worker, och PR 213 ger en fail-closed R2 EU-stagingadapter. Ordinarie runtime läser fortfarande SQLite; verklig stagingmigrering, restore av extern objektlagring, retention och produktions-cutover återstår. |
| Health/readiness, driftlogg och fungerande larm | 🟡 Delvis klar | DB, skrivbarhet, disk och backup kontrolleras. Restore-readiness kräver schema-2-evidens där privatobjektschemat är komplett, alla privata SQLite-objekt är verifierade och summeringarna är konsistenta; äldre schema-1-bevis nekas. LT Studio har dessutom en separat read-only `/operator/`-admin med MFA, egen operatörssession, detaljerade readiness-kontroller och redigerade säkerhetsvarningar. Extern HTTPS-monitorering/larmgate finns, men central logginsamling och verkligt driftbevis återstår. |
| Secrets-hantering och historikskanning | 🟡 Delvis klar | PR 112 skannar full Git-historik i CI. PR 116 kräver separat backupkrypteringsnyckel och PR 124 ger atomisk rotation av `ROLLANDS_AUTH_ENCRYPTION_KEY` för lagrade MFA-hemligheter med fail-closed förkontroll. Verklig secret manager, genomförd rotation i drift och nyckelretention återstår. |
| Miljöspärr och separation demo/staging/pilot/produktion | 🟡 Delvis klar | Privat staging är nu en uttryckligt skyddad runtime med samma tekniska säkerhetskrav/readiness-gates som pilot, men utan krav på det slutliga pilotbeslutet. `pilot`/`production` kräver däremot `approvedForPilot:true` och giltigt `approvedAt`. Demo-query och demo-/legacyhjälpfiler är fortsatt spärrade. Verklig stagingdrift och UAT återstår. |
| Betalningsöversikt dag/vecka/månad/kvartal | 🟡 Delvis klar | PR 106 samlar in-/utbetalningar i privat vy med dag, ISO-vecka, månad och kvartal samt in/ut/netto-summor. Fler detaljfilter, sortering och browser-UAT återstår. |
| Filtrerad Excel-kompatibel export | 🟡 Delvis klar | PR 105 lägger autentiserade Excel-kompatibla CSV-exporter för reskontror, fakturor, in-/utbetalningar, verifikationer, kontotransaktioner och momsunderlag med filtervalidering och formelinjektionsskydd. Portalens filterkoppling och full browser-UAT återstår. |
| Arbetslista och begriplig återkoppling | 🟡 Delvis klar | Flera vyer finns; godkänd får inte kallas bokförd, fel får inte döljas som nollvärden. |
| Obligatoriska releasekontroller och rollback | 🟡 Delvis klar | Full CI finns och används före merge, men GitHub tvingar ännu inte fram den: `main` är oskyddad och rulesets saknas. BLOCKER #226 måste stängas. Release-/rollbackverktyg behöver dessutom verkligt staging-/produktionsbevis. |
| Kund nummer två end-to-end | 🟡 Delvis klar | PR 223 verifierar verifierad svensk faktureringsidentitet och ett komplett företag-B-flöde genom kundregister → kundfaktura → arkiverad PDF → bokföring → tenant-isolerad läsning. Befintliga tester täcker även flera andra kärnmoduler. Riktig staging, backup/restore och UAT för kund nummer två återstår. |
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


## Verifierad uppföljning 2026-09-20 – auth och driftbevis

Checklistan är synkad mot mergade PR 117, 119, 122, 123, 124 och 127. Det innebär kodbevis för retention, restore-drill, extern monitorerings-/larmgate, persistent inloggningsspärr, atomisk MFA-masterkey-rotation och tvåpersons kontorecovery. Ingen av dessa kodkontroller ersätter verkliga driftövningar, extern leverantörskonfiguration eller full Rolands-UAT. **Samlat beslut är fortsatt NO-GO.**


## Konsoliderad status 2026-09-21

Den tekniska basen har flyttats tydligt framåt sedan checklistans tidigare 2026-09-20-läge:

- central privat objektlagringsfactory och fail-fast provider-val är mergade,
- verifierbart migrationsmanifest, recoverable copy-ledger, idempotent copy-planerare och async copy-worker är mergade,
- en R2 EU-adapter finns endast för explicit staging och ordinarie runtime är fortsatt SQLite,
- IDOR-/tenant-matrisen och polymorfa dokumentrelationer har stärkts,
- finansiella, lager- och leverantörsrelaterade retries har stärkts,
- kund nummer två kan i CI ställa ut egen faktura med verifierad företagsidentitet, PDF och bokföring utan korsläsning,
- separat LT Studio-operatörsautentisering, isolerat operator-API och read-only `/operator/`-admin är mergade med MFA, egen session/audit, företagsöversikt, detaljerade readiness-kontroller och redigerade säkerhetsvarningar,
- en operativ försäljningsrapport med tenant-isolerad export är mergad.

Detta ändrar **inte** det samlade pilotbeslutet. **NO-GO kvarstår** tills minst verklig staging/restore/monitorering, GitHub branch protection/ruleset enligt BLOCKER #226, nödvändiga driftuppgifter och signerat Rolands-UAT är verifierade.

Öppna PR:er räknas inte som färdigt bevis förrän de är mergade och deras CI-resultat är godkänt.

### Utvecklingsbedömning efter LT Studio-admin

Som arbetsbedömning är den tekniska plattformen nu ungefär **80 % av vägen till en kontrollerad första Rolands-pilot**. Detta är inte en formell revisionspoäng eller ett pilotgodkännande. Bedömningen väger in att kärnflöden, tenant-isolering, säker inloggning, bokföringsskydd, rapporter och central read-only driftadmin är långt utvecklade, medan verklig staging, extern backup/restore/monitorering, GitHub-skydd och signerat Rolands-UAT fortfarande är blockerande återstående arbete.

**NO-GO kvarstår** tills dessa drift- och UAT-bevis är verifierade.


## Verifierad uppföljning 2026-09-21 – privat objektintegritet i restore

Restore-verifieringen använder samma provider-neutrala privata objektinventering som lagringsmigreringen och läser backupkopian skrivskyddat. Alla nuvarande SQLite-baserade privata filtyper måste kunna återläsas med giltig MIME, storlek och SHA-256: allmänna dokument, leverantörsfakturors PDF-original och arkiverade kundfaktura-PDF:er. Restore-drill skriver schema-2-evidens med komplett privatobjektschema, antal, verifierat antal och bytes per objekttyp; readiness nekar äldre eller inkonsistenta evidensfiler.

Detta bevisar **inte** restore från R2 eller framtida extern objektlagring och ersätter inte en verklig staging-/katastrofövning. **NO-GO kvarstår.**


## Verifierad uppföljning 2026-09-21 – staging före pilotbeslut

Miljömodellen skiljer nu tekniskt staginggodkännande från det slutliga pilotbeslutet. `ROLLANDS_ENV=staging` behandlas som skyddad privat runtime och kräver permanent privat databas, säkra cookies, hemligheter, demo avstängt och samma readiness-gates. En komplett privat operationsfil krävs, men `approvedForPilot` får vara `false` medan restore/monitorering/UAT genomförs. När beslut om riktig pilot fattats kräver `ROLLANDS_ENV=pilot` eller `production` fortfarande `approvedForPilot:true` och ett giltigt godkännandedatum.

Detta tar bort en tidigare cirkel i preflightflödet men är **inte** ett pilotgodkännande. **NO-GO kvarstår** tills verkliga stagingbevis, GitHub-skydd och signerad UAT är klara.

# ROLANDS PILOT READINESS CHECKLIST

Senast granskad: 2026-09-21. Företag: Rolands Frukt o Grönt Aktiebolag, 556406-5059.

**Samlat beslut: ❌ Inte klar för pilot med verkliga verksamhets- eller bokföringsdata.** Detta är en nulägeschecklista, inte ett slutintyg. Se [audit och bevis](PRODUCTION-READINESS-AUDIT-2026-09-18.md) och [uppföljning om historik och rättelser, PR 66](HISTORY-PROTECTION.md).

✅ Klar = den uttryckligen avgränsade kontrollen är implementerad och testad. 🟡 Delvis klar = kod eller vissa prov finns men viktiga bevis saknas. ❌ Inte klar = saknas, är blockerad eller är inte verifierad i avsedd drift.

| Kritiskt område | Status | Bevis eller vad som återstår |
|---|---|---|
| GitHub som källa, spårbara ändringar | 🟡 Delvis klar | Branch → PR → CI används och `Quality and security checks` kör full test-/browserkedja. Verifiering 2026-09-21 visar dock `main` som `protected: false` och inga repository rulesets. BLOCKER #226 kräver tekniskt PR-/CI-skydd innan pilot. |
| Atomisk lagring av en verifikation | ✅ Klar | PR 62; fel vid andra raden återställer huvud, rader och nummerserie. PR 66 testar även fel i förseglingen. |
| Identiska/ändrade återförsök på journalnivå | ✅ Klar | PR 62; identiskt återanvänder, ändrat innehåll nekas. |
| Dubbelklick/idempotens i alla affärsflöden | 🟡 Delvis klar | Kundfaktura/kredit och tidigare kärnflöden är skyddade. PR 212 härdar bank, leverantörsbokföring, betalningsförberedelse/-bekräftelse och lön; betalningsförberedelsens API-audit är nu också idempotent: identiska retries återanvänder samma betalning utan ny audit, medan ändrat datum/konto stoppas. PR 217 gör lagermutationer retry-säkra och PR 221 leverantörsändringar/flera beslut retry-säkra. Fortsatt mutationsinventering krävs när nya skrivflöden tillkommer. |
| Deklarerade företagsrelationer i SQLite | ✅ Klar | PR 63; kontroll vid start och spärrar för INSERT/UPDATE. Befintlig ogiltig historik stoppar start utan att tas bort. |
| Fullständig företagsisolering och IDOR | 🟡 Delvis klar | PR 206 spärrar polymorfa dokumentlänkar mot fel företag och PR 209 utökar den metodmedvetna HTTP-IDOR-matrisen. PR 223 kör dessutom kund nummer två genom riktig kundfaktura, PDF och bokföring och kräver 404 från företag A. HTTP-regressioner täcker även dokumentarkiv, leverantörsregister och lönepostning över företagsgränsen och verifierar att inga felaktiga mutationer/auditposter skapas. Startup-regler klassificerar privata tabeller efter tenant-scope. Nya routes/objekttyper måste fortsatt omfattas av samma blockerande matris. |
| Inloggning, sessionscookie, MFA och CSRF | 🟡 Delvis klar | PR 73 verifierar sessionstider, MFA och CSRF. PR 123 gör inloggningsspärren persistent i SQLite över serveromstart. PR 124 ger atomisk rotation av MFA-masterkey och PR 127 tvåpersons kontorecovery med lösenords-/MFA-rotation, sessionsåterkallelse och audit. Verkliga drift-/recoveryövningar återstår. |
| Oföränderliga bokföringsposter och audit-logg | 🟡 Delvis klar | PR 66 skyddar journalhistorik och vanliga `audit_events`. Den nya audit-anchor-etappen skyddar även `security_events` och `platform_operator_audit_events` som append-only och kan skapa ett deterministiskt read-only SHA-256-ankare över alla tre strömmarna. Ankaret kan laddas upp under innehållsadresserad nyckel till en separat privat R2 EU-bucket med separat access key och full read-back-verifiering. Verklig återkommande körning, separat credential-scope i drift och oberoende kontroll av de externa ankarobjekten återstår. |
| Rättelse med bibehållen originalhistorik | 🟡 Delvis klar | PR 66: atomisk manuell rättelse med moms, originalkoppling och audit; osäkra fristående rättelser av automatiska poster och 151x/244x nekas. Källanknuten leverantörsbetalningsrättelse återför betalningsverifikation och öppnar 2440/reskontran igen med bevarad bank-/försökshistorik. Kundinbetalningar kan bokföras från mänskligt godkänd bankmatchning och omföras mellan fullt reglerade kundfakturor med separat 1510↔1510-verifikation, oföränderlig omföringshistorik och oförändrad 1930-bankpost. Räntehistoriken förstår payment-reversal. Kreditmotorn verifierar nu betalnings-/återföringshistoriken och tillåter helkredit efter helt återförd betalning, men blockerar kredit när ett nettobetalt belopp återstår eftersom verifierat kundåterbetalningskonto saknas (#254). Direkt omföring av öppet delsaldo återstår. |
| Moms i faktura och leverantörsbokföring | 🟡 Delvis klar | Kundfakturans svenska normalfall och blandad 25/12/6 % är verifierade. Leverantörsregistreringen är nu fail-closed: den automatiska pilotvägen kräver uttrycklig `se-domestic-full-input-vat`, positiv moms, sparar klassningen på fakturan och spärrar bokföring om klassningen saknas. EU, import, omvänd moms, momsfritt, noll moms, begränsad avdragsrätt och andra specialfall återstår. |
| Momsavstämning mot bokförd huvudbok | 🟡 Delvis klar | PR 109 gör källavstämningen fail-closed vid saknad verifikation, fel bokföringsdatum eller momsbeloppsdifferens. Regressioner verifierar även negativ originalmoms från kredit över 12→6 %-gränsen, ej stödda specialmomskonton och att aktivitet på 2650 stoppar deklarationsklar status. Full deklarationslogik, specialfall och periodavslut återstår. |
| Aktuella momssatser, tidpunkt och klassificering | 🟡 Delvis klar | Kundfakturor kräver verifierad försäljningstyp: livsmedel 12 % t.o.m. 2026-03-31 och 6 % 2026-04-01–2027-12-31, restaurang/catering 12 % och övrigt normalfall 25 % genom 2027. Backend härleder sats och stoppar motsägande konto/sats. Helkredit över 12→6 %-gränsen behåller originalets momssats och momskonto. Datum från 2028 blockeras tills regelverket verifierats på nytt. EU/import/momsfritt, delkrediter och övriga specialfall återstår. |
| Dröjsmålsränta och betalningspåminnelser | 🟡 Delvis klar | PR 70: delbetalningsdagar och verifierade halvår styr beräkningen, ofullständig/komplex historik blockeras och regelversion sparas. Automatisk ränta är nu dessutom fail-closed: för systemutställda positiva kundfakturor krävs ett SHA-verifierat arkiverat original där fakturanummer, fakturadatum, förfallodatum och betalningsvillkor matchar; räntegrunden och dess evidenskälla sparas på påminnelsen. Importerade/äldre fakturor utan sådant bevis kan påminnas utan ränta men automatisk ränta blockeras. Källanknuten kredit-/justeringshistorik och övriga rättsliga startfall utanför i förväg bestämd förfallodag återstår. |
| Fakturadatum, förfallodatum, separat bokföringsdatum | 🟡 Delvis klar | Fält finns åtskilda. PR 108 verifierar den text som faktiskt ritas i kund-PDF:n: fakturadatum + förfallodatum visas, avvikande bokföringsdatum visas inte. Leveransdatum och full UAT återstår. |
| Återanvändning av kunddata och inget artikelnummerkrav | 🟡 Delvis klar | Backend hämtar köpare från kundregister; betalningsvillkor/referenser och hela UAT behöver kompletteras. |
| PDF-visning i pilotens attest/fakturering | 🟡 Delvis klar | Privat vendor-resurs, iframe och objektbehörighet är testade. PR 91 bevarar dessutom exakt genererade PDF-bytes för utfärdad kund- och kreditfaktura och serverar dem företagsisolerat efter hashkontroll. Full Rolands-UAT i avsedd drift återstår. |
| Kundfordringar, leverantörsskulder, ingående balanser | 🟡 Delvis klar | PR 75 stämmer av kundreskontrasaldo mot 1510 och PR 76 bokförda leverantörsskulder mot 2440. Mänskligt godkänd kundinbetalningsmatchning bokför hel- och delbetalning atomiskt som 1930 debet/1510 kredit; senare betalning kan slutreglera samma faktura och räntehistoriken följer betalning + återföring. Fel allokering av fullt reglerad betalning kan omföras mellan fakturor utan att ändra bankposten. Kreditflödet stämmer nu av hela betalningshistoriken före kredit: nettobetalt belopp blockeras utan beslutat kundskuld-/återbetalningskonto, medan helt återförd betalning kan följas av säker helkredit. En strikt ingående-balansimport finns för vanliga balanskonton och blockerar 1510/2440 utan detaljreskontra. Read-only systembytespreview kontrollerar att öppna kundposter exakt motsvarar 1510, öppna leverantörsposter exakt motsvarar 2440, att paketet balanserar och att masterdata hör till rätt företag utan att skriva affärsdata. Själva atomiska importen av öppna startposter, kundåterbetalningskonto (#254) och mer komplex delreskontrarättelse återstår. |
| Lokalt tekniskt backup-/restore-verktyg | 🟡 Delvis klar | SQLite, journal och dokumentintegritet verifieras och krypterad backup kan återställas till isolerad kopia. Restore-kontrollen verifierar dessutom alla tre privata SQLite-filflöden med central objektmetadata/SHA-kontroll och schema-2-evidens som readiness kan kräva. Därutöver finns nu en stagingbegränsad R2 restore-drill som först laddar ned den krypterade backupen från R2 och därefter kör samma isolerade verifiering utan att ersätta produktionsdatabasen. Verklig körning i avsedd stagingmiljö återstår. |
| Krypterad extern backup, retention och larm | 🟡 Delvis klar | Krypterad `.sqlite.enc`, lokal retention, restore-drill och monitoreringsgate finns. R2 EU-offsite-adaptern skickar endast verifierad `.enc` + checksumma under immutable SHA-nyckel och kräver full remote read-back innan evidens skrivs. `staging:evidence:verify` binder nu ihop R2-audit, offsite-backup, lokal restore, R2-download+restore och larm. Samma konsistenskontroll ingår dessutom i serverns staging-readiness: audit måste gälla nu konfigurerad objektbucket och offsite/lokal restore/R2-restore måste avse exakt samma krypterade backupfil, SHA-256 och storlek i nu konfigurerad backupbucket. Faktisk återkommande offsite-körning, fjärretention/raderingsskydd och verkligt larm återstår. |
| Arkivering av original och långsiktig läsbarhet | 🟡 Delvis klar | Exakt utfärdad kund-/kredit-PDF och dokumentintegritet är skyddade. PR 200 inventerar och SHA-verifierar alla tre privata filflöden, PR 202/204/208 ger recoverable ledger, idempotent planering och verifierad async copy-worker, PR 213 ger en fail-closed R2 EU-stagingadapter och #258 lägger read-only audit av samtliga aktuella stagingkopior med ny storleks-/SHA-256-verifiering och privat evidens utanför Git. Ordinarie runtime läser fortfarande SQLite; verklig R2-körning med staging-credentials, restore från extern objektlagring, retention och produktions-cutover återstår. |
| Health/readiness, driftlogg och fungerande larm | 🟡 Delvis klar | DB, skrivbarhet, disk och backup kontrolleras. I staging kräver readiness nu även färsk R2-objektaudit och verifierad restore direkt från R2. `/api/v1/readiness/core` kontrollerar alla tekniska beroenden utom monitoreringsbeviset självt, så extern monitorering kan bootstrapas utan cirkel; full `/api/v1/readiness` kräver därefter också färskt monitorerings-/larmbevis. Restore-readiness kräver komplett privatobjektintegritet. LT Studio har dessutom separat read-only `/operator/`-admin med MFA. Central logginsamling och verkligt drift-/larmbevis återstår. |
| Secrets-hantering och historikskanning | 🟡 Delvis klar | PR 112 skannar full Git-historik i CI. PR 116 kräver separat backupkrypteringsnyckel och PR 124 ger atomisk rotation av `ROLLANDS_AUTH_ENCRYPTION_KEY` för lagrade MFA-hemligheter med fail-closed förkontroll. Verklig secret manager, genomförd rotation i drift och nyckelretention återstår. |
| Miljöspärr och separation demo/staging/pilot/produktion | 🟡 Delvis klar | Privat staging är nu en uttryckligt skyddad runtime med samma tekniska säkerhetskrav/readiness-gates som pilot, men utan krav på det slutliga pilotbeslutet. `staging:preflight` verifierar konfigurationen fail-closed och `staging:evidence:verify` kräver en sammanhängande kedja av färska driftbevis. `pilot`/`production` kräver däremot `approvedForPilot:true` och giltigt `approvedAt`. Demo-query och demo-/legacyhjälpfiler är fortsatt spärrade. Staging-signoff-gaten binder nu färska driftbevis och godkänd UAT till exakt release-commit; verklig stagingkörning och UAT återstår. |
| Betalningsöversikt dag/vecka/månad/kvartal | 🟡 Delvis klar | PR 106 samlar in-/utbetalningar i privat vy med dag, ISO-vecka, månad och kvartal samt in/ut/netto-summor. Chromium-test verifierar nu riktning, status, söktext, konto och sortering i den synliga vyn samt att samma filter används av exporten. Full Rolands-UAT och eventuella ytterligare detaljfilter återstår. |
| Filtrerad Excel-kompatibel export | 🟡 Delvis klar | PR 105 lägger autentiserade Excel-kompatibla CSV-exporter för reskontror, fakturor, in-/utbetalningar, verifikationer, kontotransaktioner och momsunderlag med filtervalidering och formelinjektionsskydd. Betalningsöversiktens Chromium-test verifierar mode, datum, riktning, status, söktext, konto, sortering och ordning. PR #294 browserverifierar dessutom de fyra exportknappar som finns i rapportvyn: försäljning, inköp per leverantör, kundfordringsålder och leverantörsskuldsålder; valt datum/rapportdatum måste följa med exakt och den nedladdade CSV-filen kontrolleras mot tenantdata. API-exporter som ännu inte exponeras som egna UI-knappar är backendtestade men saknar motsvarande användarstyrd browser-UAT. |
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


## Verifierad koduppföljning 2026-09-21 – räntegrund för systemutställd faktura

Automatisk dröjsmålsränta får inte längre utgå enbart från att databasen innehåller ett `dueDate`. Backend kräver för den automatiska vägen ett integritetskontrollerat arkiverat fakturaunderlag som systemet självt har skapat. Fakturanummer, fakturadatum och förfallodatum måste matcha reskontran, betalningsvillkor måste finnas och underlaget måste ha arkiverats senast på förfallodagen. Den verifierade grunden sparas tillsammans med påminnelsens ränteunderlag och auditspår.

Saknas detta bevis blockeras räntan fail-closed med en särskild felkod, medan en betalningspåminnelse utan ränta fortfarande kan registreras. Detta minskar risken att importerade eller äldre poster felaktigt behandlas som om förfallodagen säkert varit bestämd i förväg.

BLOCKER #65 hålls fortsatt öppen för källanknuten kredit-/justeringshistorik och andra rättsliga startfall som ännu inte stöds automatiskt. **NO-GO kvarstår.**


## Verifierad koduppföljning 2026-09-21 – rapportexporter i browser

PR #294 lägger ett separat Chromium-flöde i ordinarie CI för de exportknappar som visas i den privata rapportvyn. Testet använder riktig session och tenantdata, byter mellan försäljning, inköp, kundfordringsålder och leverantörsskuldsålder, ändrar datumfilter, verifierar export-URL:ens parametrar, laddar ned den faktiska CSV-filen och kontrollerar filnamn samt innehåll. Ingen produktionslogik ändrades.

Detta stänger browserluckan för rapportvyns synliga exportknappar. Övriga API-exporttyper är fortsatt backendtestade men ska inte beskrivas som UI-verifierade innan de har en faktisk användaryta eller ett separat browserflöde.

# Production Readiness Phase 1 – Rolands / LT Studio

Datum: 2026-09-18. Beslut: **NO-GO för pilot med verklig ekonomisk information tills öppna BLOCKER-punkter är lösta.** Detta är en teknisk granskning med regelkontroll, inte ett intyg om fullständig juridisk efterlevnad.

## Underlag och avgränsning

Granskningen började från GitHubs då senaste `main`, `c8bb49618e68b31bb41c98faab9bff3654f5f246`, inte från gamla chattbeskrivningar eller ofärdiga funktionsgrenar. Källarkivet kom från CI 35285878933, artifact 10524476199. SHA-256: `7a11cb889d6e6d7f925983a56c33c940396acb3130329ee71335ed4f163ea25a`.

Kod, databasschema, API-ruttrar, redovisningsflöden, driftkommandon och CI har undersökts. Felprov har körts i isolerade databaser med påhittade uppgifter. Inga riktiga företagsdata eller produktionsdatabaser har ändrats. Det återstår full genomgång av varje knapp, varje kombination av roll/API-metod och verklig hostingmiljö. En grön testkedja är inte ett bevis för sådant testerna inte täcker.

Efter första ändringarna verifierades även källarkivet från PR 63, CI 35311699321, artifact 10533448792. SHA-256: `ad45b02f3565a3d551c45013fdd2412604bd81a6333e4e9e1d86e65b253d029e`.

## Hur systemet faktiskt är byggt

| Del | Nuvarande teknik och ansvar |
|---|---|
| Publik webb | `apps/website`, statisk HTML/CSS/JavaScript. GitHub Pages publicerar ett separat demobygge. |
| Företagsportal | `apps/portal`, flera sidor med API-läge och webbläsarbaserad demo. Dessa driftlägen måste hållas isär. |
| Skyddad backend | `apps/api/server.js`, Node.js 24, HTTP-API, personliga sessioner, MFA och rollkontroller. `npm start` startar denna server. |
| Företagsdata | SQLite med främmande nycklar, WAL och FULL-synkronisering. Dokumentfiler kan lagras som binärt innehåll. Kundfakturans arkiv lagrar ett JSON-underlag med hash; det är inte samma sak som att bevara exakt utsänd PDF. |
| Bokföring | `apps/api/accounting-store.js` är den persistenta lagringen. `packages/accounting/journal.js` är en annan domänimplementation; dess skydd får inte automatiskt tillskrivas API-databasen. |
| Äldre system | Rotens `server.js`, JSON-lager och `public/` finns kvar som referens. `legacy:start` är inte pilotservern. |
| Externa kopplingar | Bank, e-post och extern AI är inte verifierat anslutna. Granskade förslag betyder inte att pengar har skickats eller att en verifikation har skapats. |

SQLite behöver inte ersättas enbart för att en begränsad pilot planeras. Däremot krävs korrekt transaktionshantering, en dokumenterad driftmodell, lastprov, behörigheter och verifierad återställning. En framtida flerinstansdrift kräver ett nytt databas-/driftbeslut.

## Prioriterat riskregister

BLOCKER = måste åtgärdas eller säkert uteslutas ur ett uttryckligen godkänt pilotomfång. HIGH = bör lösas före pilot. MEDIUM = kan hanteras i en kontrollerad pilot. LOW = kan vänta. Ofärdig moms eller förstörd redovisningshistorik får inte accepteras genom att endast skriva en varning.

| ID | Allvar | Konkret fynd, källa och nästa kontroll | Status |
|---|---|---|---|
| P01 | BLOCKER | `accounting-store.postEntry` lämnade huvud, en rad och förbrukat nummer vid injicerat fel på andra raden utan yttre transaktion. Flera anropare hade redan yttre transaktion, men den gemensamma lagringsgränsen var osäker. | Rättat i [PR 62](https://github.com/ludwigberglund-coder/Rollands/pull/62). Savepoint återställer allt och behåller yttre transaktionsansvar. |
| P02 | BLOCKER | `database.createInvoice` kunde lagra företag A + kund från B; läsande join dolde den felaktiga posten. Reproducerat i databasprov, **inte bevis på en HTTP-dataläcka**. | Deklarerade företagsrelationer skyddas i [PR 63](https://github.com/ludwigberglund-coder/Rollands/pull/63). Polymorfa `entity_id`/`source_id` och fullständig API-matris återstår. |
| P03 | BLOCKER | Bokföringshistorik, fakturaunderlag och audit behövde skydd mot efterhandsändring. | Delvis rättat i PR 66: journalförsegling, append-only audit/fakturaunderlag och kontroll vid läsning/start/restore. Den här räntehärdningen gör även godkända reskontratransaktioner och påminnelseunderlag append-only. Oberoende revisionsankare och full arkivtäckning återstår. |
| P04 | BLOCKER | En fristående motverifikation av faktura-/betalningsposter kan skilja 1510/2440 från reskontran om källobjektet inte rättas samtidigt. | Delvis rättat i PR 66: osäkra generella rättelser av automatiska poster och 151x/244x blockeras. Kompletta källanknutna rättelser som uppdaterar bokföring och reskontra tillsammans återstår. |
| P05 | BLOCKER | `reports.vatControl` räknar kundfakturor efter bokföringsdatum och leverantörsfakturor efter fakturadatum, även ännu obokförda. Detta är inte full avstämning av bokförd moms. `declarationReady:false` är korrekt men löser inte behovet. | Öppet. Stäm av momskoder, underlag och bokförda momskonton; inkludera rättelser och manuella poster. |
| P06 | BLOCKER | `packages/invoicing/invoice.js` har 6/12/25/0 och kontokopplingar men saknar komplett datum-/varuklassificering. Frakt/avgifter får inte få fel moms genom en generell standard. Blandad moms, undantag och begränsad avdragsrätt måste vara korrekt stödda eller spärrade. | Öppet. Se regelkontroll och momstester nedan. Ingen generell ändring av alla 12-procentsrader till 6 procent. |
| P07 | BLOCKER | Privat PDF-visning och CMS-förhandsvisning fungerade inte konsekvent mot den riktiga API-servern. | Delvis rättat i PR 68: autentiserad leverantörs-PDF, kund-PDF och privat CMS sparning/förhandsvisning körs nu i Chromium mot riktig API + SQLite med CSP aktiv. Exakt långtidsarkivering av utfärdad kund-PDF och full Rolands-UAT återstår. |
| P08 | BLOCKER | Demo och pilot kunde tidigare blandas på privatservern. | Delvis rättat i PR 67–68: bindande startkontroll, privata lagringssökvägar, demo-query nekas på privatservern och privata browserflöden testas utan demo. Verklig hosting-/proxykonfiguration och befintlig data måste fortfarande verifieras före pilot. |
| P09 | BLOCKER | Backup finns som lokalt kommando, men krypterad extern destination, schemaläggning, retention, nyckelåterhämtning och faktisk återställning hos driftleverantör saknar verifierade driftbevis. | Delvis: [PR 64](https://github.com/ludwigberglund-coder/Rollands/pull/64) förstärker kontrollen och kör verkliga CLI-prov med testdata. Extern katastrofåterställning återstår. |
| P10 | BLOCKER | Bevarande av exakt utfärdat kundfakturaunderlag, behandlingshistorik, säker läsbarhet och arkivåtkomst över lagringstiden är inte färdigverifierat. Ett digitalt fingeravtryck räcker inte ensamt. | Öppet. Arkivplan, kontrollerad export, återläsning och driftavtal krävs. |
| P23 | BLOCKER | Dröjsmålsräntan använde tidigare dagens restbelopp över hela perioden och den sista kända referensräntan kunde fortsätta efter verifierat kalenderhalvår. Det kunde ge samma ränta för en tidig och en sen delbetalning. | Räntehärdning på arbetsgren: räntan delas vid verkliga betalningar/krediter, saldohistoriken måste stämma exakt, varje referensränta har explicit slutdatum, utfärdad fakturas förfallodag måste styrkas av oföränderligt underlag och reminder-requests är server-idempotenta. Se [INTEREST-AND-REMINDER-PILOT.md](INTEREST-AND-REMINDER-PILOT.md). Full CI/merge krävs innan denna del kan räknas som införd. |
| P11 | HIGH | `app.js` förlänger sessioner löpande. `auth.js` verifierar TOTP utan förbrukningsregister. Ändrade roller och återautentisering måste provas; försöksspärr är processlokal och knuten till IP/användarnamn. | Öppet. Absolut/idle-timeout, återkallning, MFA-replay, brute-force och omstartstester. |
| P12 | HIGH | Kundfakturans `issueInvoice` återanvänder ett request-ID innan det nya innehållet jämförs. Journalens nya retry-skydd når inte detta tidiga returvärde. | Delvis: PR 62 säkrar journalnivån. Digest och konflikttest behövs även för faktura, kredit, betalning och attest. |
| P13 | HIGH | `/health` säger att tjänsten lever utan full lagrings-/skrivbarhetskontroll. Filströmmars fel och samlad API-felhantering behöver stärkas. Det finns inget verifierat larmflöde. | Öppet. Readiness, timeout, disk-full, DB-fel, strukturerad säker loggning och provlarm. |
| P14 | HIGH | Grön demo-CI kan dölja fel i verklig drift. `main` rapporterades oskyddad av branch-API:t; full ruleset-kontroll är inte gjord. Pages kör separat från huvudkedjans webbläsarsteg. | Öppet. Obligatoriska releasekontroller, låsta versionsval, staging, rollback och godkännande. |
| P15 | HIGH | Nuvarande snapshot gav inga högsäkerhetsträffar för privata nycklar/typiska leverantörstokens, men hela Git-historiken har **inte** secrets-skannats. Testvärden/platshållare är inte verifierade produktionsnycklar. | Öppet: full historikskanning och rotation om en riktig hemlighet identifieras. Ingen rotation har utförts här. |
| P16 | HIGH | Det finns demoflöden som inte motsvaras av färdiga privata API-flöden, exempelvis kreditering och genomförande av vissa matchningsförslag. Godkännande får inte beskrivas som bokföring utan verifierad post. | Öppet. Funktions-/miljömatris och tydligt avstängda unsupported åtgärder. |
| P17 | HIGH | Alla roller/metoder/objekt är inte täckta av IDOR-test. Befintlig CI listar testfiler uttryckligen och missar bland annat `password-rotation.test.js` och `portal-navigation-access.test.js`. | Delvis: sex nya tenant-tester och 14 HTTP-routefamiljers inloggningskrav. Utöka upptäckt och matris. |
| P18 | HIGH | Alla knappflöden, snabba dubbelklick, avbruten anslutning, återladdning och motstridiga samtidiga användarändringar är inte genomtestade mot riktig backend. | Öppet. Automation måste prova både lyckat svar och nätverksfel utan falsk framgång. |
| P19 | HIGH | Filtrerad Excel-kompatibel export och betalningsöversikt över dag/vecka/månad/kvartal är inte verifierade genomgående mot privata API:er. | Öppet. Testa samma urval och totalsumma i vy/export samt skydd mot kalkylbladsformler. |
| P20 | MEDIUM | Flera vyer gör extra anrop per faktura/verifikation. Begränsningar på antal poster kan påverka stora listor. | Öppet. Mät med realistiska datamängder, testa fullständighet, paginering och export. |
| P21 | MEDIUM | Kunduppgifter återanvänds delvis men betalningsvillkor/referenser behöver konsekvent registerstöd. Nuvarande fakturamodell gör obligatorisk öresutjämning till hela kronor. | Öppet. Tydlig avrundningspolicy och testad fakturaskärm, inte en tyst beloppsändring. |
| P22 | LOW | Äldre dokumentation, terminologi och layout kan ge fel uppfattning om vad som är redo. | README uppdateras här; ytterligare estetiska förbättringar väntar. |

## Svensk regelkontroll – påverkan på systemet

Primärkällorna nedan kontrollerades 2026-09-18. Företagets faktiska momsperiod och regelverk ska dessutom styrkas av Rolands underlag; tidigare rekommendationer är inte myndighetsbeslut.

- **Bokföringslagen:** 5 kap. 1–7, 9 och 11 §§ samt 7 kap. kräver ordnad bokföring, verifikationer, spårbara rättelser och bevarande. Systemåtgärd: knyt underlag, reskontra och nya rättelseposter till originalet; bevara vem/när och behandlingshistorik. [Lagtext](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/).
- **BFNAR 2013:2:** särskilt 2.1, 2.17–2.18 och 5.9. Datorbaserad rättelse görs med särskild rättelsepost. Serier ska kunna följas utan luckor; flera serier är möjliga. Omstart på 1 varje kalenderår är vårt nuvarande modellval, inte ett universellt lagkrav. [Vägledning](https://www.bfn.se/wp-content/uploads/vl13-2-bokforing.pdf).
- **Fakturakrav:** mervärdesskattelagen 17 kap., särskilt 22 och 24 §§, påverkar löpnummer, fakturadatum, parter, momsregistrering, specifikation, beskattningsunderlag, moms och kreditreferens. Leverans-/tjänstedatum behövs när relevant. Förfallodatum är ett uttryckligt produktkrav och betalningsvillkor; det ska inte felaktigt beskrivas som ett generellt krav i listan för fullständig momsfaktura. [Mervärdesskattelagen](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/).
- **Aktuell livsmedelsmoms:** 6 procent från 2026-04-01 till och med 2027-12-31; restaurangtjänster är fortsatt 12 procent. Systemåtgärd: klassificera försäljningen och relevant beskattningstidpunkt; bevara ursprunglig skattebehandling vid kreditering. [Skatteverket](https://www.skatteverket.se/omoss/pressochmedia/nyheter/2026/nyheter/livsmedelsmomsensankstill6procent.5.70685bee19c85dd5dd0a3f.html).
- **Arkivering:** normalt sju år efter utgången av kalenderåret då räkenskapsåret avslutades. Papper får under förutsättningar förstöras efter säker överföring; digitalisering är inte ett frikort att förlora originalinformationen. Systemåtgärd: dokumentera format, överföringskontroll, läsbarhet och lagringsplats. [BFN](https://www.bfn.se/fragor-och-svar/arkivering/).
- **K2/K3:** ändrade årsredovisningsregler gäller för räkenskapsår som börjar efter 2025-12-31; K2:s tillämpningsområde måste kontrolleras, inte bara företagets storlek. [Versionsguide](https://www.bfn.se/vilken-version-av-k-regelverken-ska-jag-tillampa/) och [ändringar från 2026](https://www.bfn.se/fragor-och-svar/andringar-i-k2-och-k3-fran-2026/).
- **Personuppgifter:** åtkomst ska avgränsas efter arbetsuppgift och känsliga loggar skyddas. Företagsisolering är inte hela GDPR-arbetet. Biträdesavtal, lagringsplats, behörighetsuppföljning och incidentrutin återstår. [IMY om behörighetsstyrning](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/informationssakerhet/behorighetsstyrning/).

Månadsvis periodlås och fyrögonattest är våra kontrollregler. De ersätter inte lagkraven och ska inte framställas som generella uttryckliga lagkrav för varje enskild faktura.

### Momstester som krävs innan P05/P06 stängs

Testa minst: livsmedel före/efter skatteändringen, restaurangtjänst kontra hämtmat, blandade satser, relevanta fraktkostnader, delvis avdragsgill ingående moms, omvänd betalningsskyldighet, momsfritt med rätt grund, kredit av äldre faktura, rättelse, ören och manuella momsverifikationer. Vid faktureringsmetoden ska betalningen reglera den redan bokförda fordran/skulden utan att momsen bokförs en gång till. Varje förväntad kontering ska jämföras med huvudbok och reskontra. Funktioner utan verifierad skatteregel måste stoppas eller styras till särskild granskning, inte gissas av AI.

## Verifierat arbete i denna etapp

1. PR 62: åtta nya regressionstester för atomisk journal, återförsök och beloppsprecision. PR-CI 35311117053 godkänd. Sammanslagen som `a03e895`.
2. PR 63: sex nya tester för företagsrelationer och HTTP-skydd. PR-CI 35311699321 godkänd, inklusive befintliga webbläsarflöden. Sammanslagen som `3143a33`.
3. PR 64: sju nya verkliga CLI-prov för backup/restore. 36 relaterade tester passerade på Node 24.11.1 med PR 63-källkod och restore-ändringen. Slutlig CI-status ska läsas i PR:n; detta dokument gör inte anspråk på tester i en extern produktionsmiljö.

Befintligt fakturaflöde hämtar köparen på servern från rätt företags kundregister och separerar fakturadatum/förfallodatum/bokföringsdatum. Intäktskonto kopplas till vald momssats. Leverantörsfakturan kan bokföras med moms och skuld före betalningen via `supplier-accounting.js`. Detta är användbara redan byggda skydd, men de tar inte bort punkterna ovan.

## Återstående arbetsordning och bevis för pilotbeslut

Nästa ändringar ska stänga P03/P04 och P07/P08 samt sessionsriskerna, därefter full moms-/reskontraavstämning och originalarkiv. Gör separat commit och negativa tester för varje spärr. Parallellt kan hostingägare och redovisningsansvarig fylla i drift- respektive företagsbesluten utan att vi gissar dem.

Efter korrigeringar körs UAT mot samma API-build, HTTPS, roller och databasmodell som ska användas i pilot. Följ alla nio scenarier i uppdraget: kundfaktura, attest, förslag, rättelse, dubbelklick, betalningsperioder, export, restore och otillåten åtkomst. Varje rad behöver version, testare, datum, förväntat/utfall och bevis. Därefter beslutas om begränsat pilotomfång, ansvarig support, stoppkriterier och återgång. Ingen automatisk e-post, bankbetalning eller deklarationsinlämning aktiveras genom denna granskning.

Se [pilotchecklistan](ROLANDS-PILOT-READINESS-CHECKLIST.md) och [återställningsinstruktionen](BACKUP-RESTORE-PILOT.md). När kod eller bevis ändras ska samma dokument uppdateras i GitHub.

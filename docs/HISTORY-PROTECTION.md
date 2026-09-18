# Skydd av bokföringshistorik och säkra rättelsevägar

Datum: 2026-09-18. Uppföljning av P03/P04 i [Production Readiness Audit](PRODUCTION-READINESS-AUDIT-2026-09-18.md). **Pilot med verklig ekonomisk information är fortfarande inte godkänd.**

## Vad som har ändrats

Den privata SQLite-backenden får skydd på databasnivå för verifikationshuvud och konteringsrader. Vanliga UPDATE, DELETE och ersättning genom INSERT OR REPLACE nekas. När alla rader har sparats förseglas verifikationen med radantal och ett SHA-256-fingeravtryck i samma transaktion. Därefter nekas även ytterligare rader. Om förseglingen misslyckas återställs hela postningen inklusive nummerserien.

Vid uppstart och läsning av en enskild verifikation jämförs de sparade uppgifterna med förseglingen. Även en ändrad kontering som fortfarande balanserar upptäcks. Återställningsverktyget verifierar förseglingen när den finns i säkerhetskopian; det migrerar inte säkerhetskopian.

Revisionshändelser, rättelsekopplingar, sparade kundfakturaunderlag och fakturornas idempotensreferenser är append-only: nya poster får tillkomma men gamla får inte skrivas över eller tas bort via vanliga databasoperationer. När kundfakturans underlag är arkiverat låses dess kund, datum, belopp, moms och ursprungliga betalningsuppgifter. Restbelopp och betalningsstatus kan fortfarande uppdateras av betalningsflödet. Läsning av fakturaunderlaget kontrollerar dess sparade hash.

## Rättelser som inte förstör reskontran

En fristående motverifikation av en faktura eller betalning kan ge en annan skuld i huvudboken än i reskontran. Den generella rättelsevägen tillåter därför endast uttryckliga manuella verifikationer (`manual`, `manual-journal`) och spårbara rättelser av dessa. Poster på 151x/244x samt automatiska eller okända källor nekas. En ersättningspost får inte heller föra in reskontrakonton genom denna väg.

Detta är en säker spärr, **inte ett färdigbyggt rättelseflöde för kundfakturor, leverantörsfakturor, bank, lager eller lön**. Sådana rättelser måste senare hantera ursprungsobjekt och bokföring tillsammans. P04 är därför endast delvis hanterad.

En tillåten rättelse sparar originalkoppling, motpost, eventuell ersättningspost, fullständig orsak, användare, tid och en revisionshändelse i samma transaktion. Samma original kan inte rättas två gånger genom dubbla anrop. Momsrader vänds tillsammans med övriga rader; de faller inte bort i motposten. Vid fel i rättelsekoppling eller auditlogg rullas hela åtgärden tillbaka.

## Inför uppdatering av en befintlig databas

1. Ta en säkerhetskopia och verifiera den. Prova först på en separat kopia.
2. Vid första uppdateringen kontrolleras befintliga journaler och får en baslinjeförsegling. Detta visar inte att tidigare historik aldrig har ändrats; det behövs fortfarande avstämning mot originalunderlagen.
3. Om en historikpost är ofullständig eller ogiltig stoppas uppdateringen utan automatisk reparation eller radering. Utred på en kopia tillsammans med redovisningsansvarig.
4. Vid senare uppstarter accepteras inte nytillkomna oförseglade poster genom en tyst ny baslinje.

Radering av användare eller företag kan nu nekas när databasens följdrader annars skulle ändra eller radera revisionshistorik. Stäng av användarkonton i stället. Eventuell gallring måste ha en separat, dokumenterad och rättsligt granskad rutin.

## Testbevis

- `test/history-protection.test.js`: 12 tester av skrivspärrar, ersättning via nycklar/rowid, andra SQLite-anslutningar, uppgradering, kontrollvärden, fakturafält och återställningskontroll.
- `test/correction-safety.test.js`: 7 tester av förbjudna källor, reskontrakonton, moms i rättelser, kedjade rättelser, återställning vid skrivfel och parallella HTTP-anrop.
- 80 berörda tester passerade i isolerade databaser med påhittade uppgifter och Node 22.16.0. Obligatorisk full GitHub CI kör Node 24 före sammanslagning. Inga produktionsdata användes.
- Äldre felprov som avsiktligt skapar en skadad databas tar uttryckligen bort en trigger i sin isolerade testfil. Produktionskoden tar aldrig bort skyddet.

Denna etapp ändrar främst backend. Befintliga webbläsartester i CI ska fortfarande passera, men de bevisar inte att hela privata pilotens gränssnitt eller varje UAT-flöde är färdigtestat.

## Begränsningar och återstående blockerare

En person med full kontroll över databasfilen/servern kan även ta bort triggers och räkna om kontrollvärden. Skydden ersätter inte serverbehörigheter, krypterad extern backup eller ett externt skyddat revisionsankare. Detta är inte ett intyg om full juridisk efterlevnad.

Exakt utfärdad PDF, leverantörsunderlag, kompletta reskontrakontroller, momsrapportering, räntehistorik, demo/pilot-separation, privata PDF/CMS-flöden och verklig katastrofåterställning är fortfarande separata öppna granskningspunkter. P03 och P04 ska inte markeras helt klara i pilotchecklistan enbart på grund av denna etapp.

## Primära källor

Bokföringslagen 5 kap. 4–7, 9 och 11 §§ reglerar bland annat sidoordnad bokföring, rättelser, verifikationer och behandlingshistorik. Kontrollerad 2026-09-18:
https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/

SQLite beskriver att REPLACE kan radera en tidigare rad och att dess delete-triggers beror på recursive_triggers. Därför omfattar testerna även särskilda BEFORE INSERT-spärrar:
https://www.sqlite.org/lang_conflict.html
https://www.sqlite.org/lang_createtrigger.html

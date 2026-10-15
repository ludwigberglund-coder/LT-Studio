# Underlagsläsning: fakturor och kvitton i PDF (lokal första etapp)

Datum: 2026-10-15. Kopplat till AI-planen #774 och #797. GitHub är källan till koden.

## Vad som nu går att göra

- I `AI-bokföring` kan en inloggad användare välja en **passiv PDF** (leverantörsfaktura eller kvitto) och klicka **Läs PDF lokalt**.
- I befintliga `Dokument` finns **Läs PDF lokalt** på lagrade leverantörsfakturor och kvitton. Arkivet hämtar endast filen som aktuell inloggad användare redan får läsa, kontrollerar företagsmapp, MIME, storlek och originalets SHA-256, och analyserar den i webbläsaren.
- En begränsad PDF-textläsare känner igen okomprimerade och enkla FlateDecode-komprimerade textströmmar i vanliga digitala PDF-filer. Den letar efter explicit märkta uppgifter: leverantör/butik, nummer, datum, förfallodatum, netto, moms och totalbelopp. Beloppssummor jämförs matematiskt.
- Motstridiga, saknade eller obalanserade uppgifter markeras för granskning. Inga uppgifter antas vara verifierade.
- Originalet lämnar inte webbläsaren via denna läsare. Den gör **inga AI-, OCR-, API-, skriv-, uppladdnings- eller bokföringsanrop**. Den lagrar inte text, dokument, utdata eller token i localStorage, sessionStorage, Supabase eller GitHub.
- PDF-only (10 MB), header/slutmarkör, nekad aktiv/inbäddad PDF-syntax, begränsade strömmar och textmängder. Arkivets befintliga serververifiering och RLS gäller fortfarande vid **uppladdning**. Den lokala läsaren ersätter inte den kontrollen.

## Avgränsning och korrekt status

**Detta är inte AI.** Det är en lokal, regelbaserad, försiktig första läsning av digitala PDF-underlag. Ingen Cloudflare-modell är aktiverad; `AI_PILOT_RELEASED=false`, `RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` består.

Skannade PDF-kvitton och fakturabilder saknar ofta markerbar text och kräver OCR/vision. Fontmappningar, ovanliga PDF-strömmar, flera sidlayouter, tabeller och felplacerade fält kan inte tolkas säkert av denna begränsade läsare. Den visar då ett fel eller ett osäkert resultat i stället för att hitta på belopp. Vanliga bildfiler stöds **inte** enligt `AGENTS.md`.

Inget avläst belopp får direkt bokföras, betalas eller skickas som en godkänd automation. Användaren måste granska originalet.

## Kvar till AI som kan tolka verkliga underlag

1. Serverägd, tenant-/MFA-säkrad dokumenthämtning och robust, fullständig PDF/OCR-extraktion; skannade kvitton kräver särskild säkerhetsgranskning.
2. Dataskydds-/DPA-/leverantörsbedömning och dokumenterat samtycke eller annan giltig behandlingsgrund innan riktiga kunddokument skickas till extern AI.
3. Låst Cloudflare-adapter som endast får nödvändiga verifierade fakta, med verifierad klient-IP, session, företagsisolering, atomär kvot och idempotens. Separat godkännande innan aktivering.
4. Oberoende momskontroll och kontoval, sedan ett **granskningsförslag i befintlig automationskö**, aldrig direkt automatbokföring från modellen.
5. Tvåföretags-UAT med syntetiska fakturor och kvitton, inklusive skannat underlag, krediter, 0/6/12/25 % moms, prompt injection, dubbletter och negativa tester.

## Tester

`node --test test/ai-document-reader.test.js` och hela `npm test` i GitHub CI. Alla ändringar levereras via branch/PR/CI/merge enligt `AGENTS.md`.

## Nästa etapp 2026-10-15: lokal granskningskontering (PR efter #811)

Efter avläsning i **AI-bokföring** kan användaren nu välja inköpstyp på vanlig svenska (kontorsmateriel, förbrukningsmaterial eller IT-tjänster). För kvitton måste användaren dessutom uttryckligen välja företagskonto eller kassa som betalningssätt. Den rena klientmodulen `apps/portal/ai-document-review.js` skapar då ett **tillfälligt granskningsutkast** från PDF-fakta.

- Leverantörsfaktura: valt kostnadskonto + eventuell ingående moms 2641 i debet och leverantörsskuld 2440 i kredit.
- Kvitto: valt kostnadskonto + eventuell ingående moms 2641 i debet och manuellt valt företagskonto 1930 eller kassa 1910 i kredit.
- Endast 0/6/12/25 % moms när satsen entydigt kan beräknas i heltalsören och nettobelopp + moms = total. Annars stoppas utkastet. Vid kvitto kan netto beräknas som total minus explicit moms, med tydlig varning.
- Källfält saknas, felaktig summa, oklar momssats, utländsk valuta, motstridiga värden, negativa/kreditbelopp och okänt konto ger stopp. Dubblettkontroll och faktisk betalningsmetod **kan inte** verifieras av denna lokala modul och måste granskas.
- Inga knappar för attest, spara, betala eller bokföra. `posted:false`, `saved:false`, `aiGenerated:false`, `requiresHumanApproval:true`. **Inga** Cloudflare-/Supabase-anrop eller kunduppgifter till modellen. Utkastet försvinner vid omladdning.
- Detta är inte en rekommendation att använda samma kostnadskonto för alla inköp eller ett juridiskt momsgodkännande. Konto väljs uttryckligen av användaren och ska kontrolleras mot inköpet.

Detta är en användbar, kontrollerad övergång från underlag till möjlig kontering, men **inte** det slutliga AI-automationsflödet. AI-gateway och riktiga dokument i automationskön är fortsatt spärrade tills tenant-, GDPR-, IP-, budget-, redovisnings- och releasekrav är uppfyllda. Varken `AI_PILOT_RELEASED` eller Edge Function-releaseflaggorna ändras.

## 2026-10-15: Granskningsutkast även i dokumentarkivet

Den befintliga knappen **Läs PDF lokalt** i `Dokument` ger nu samma möjlighet till tillfälligt bokföringsutkast som i `AI-bokföring`. Användaren behöver inte ladda ned och ladda upp PDF:en på nytt:

1. Välj ett redan lagrat kvitto eller en leverantörsfaktura och klicka **Läs PDF lokalt**.
2. Arkivet kontrollerar aktiv företagskontext, privat Storage-sökväg, MIME, filstorlek och SHA-256 för originalet, och läser PDF-texten i webbläsaren.
3. Välj **vad som köpts** (kontorsmateriel, förbrukningsmaterial eller IT-tjänster). För kvitto måste användaren även aktivt välja **hur det betalades**.
4. Klicka **Visa granskningsutkast**. Den gemensamma regelmotorn `LTStudioDocumentReview.buildReview` visar antingen balanserade debet-/kreditrader med tydliga varningar, eller ett **blockerat** utkast med orsaker.
5. Stäng granskningen: PDF-fakta och konteringsutkast finns bara i webbläsarens arbetsminne under den öppna dialogen. Ingen ny dokumentpost, verifikation, automation eller betalning skapas.

Vid varje begäran om konteringsutkast kontrolleras aktuell session, användare, företag, dokument-id, lagringsväg, kategori och SHA-256 igen. Ändrad företagskontext eller dokumentmetadata stänger dialogen. Alla textfält från PDF och varningar HTML-escapas. Det finns inga attest-, bokförings- eller spara-knappar och inga Cloudflare-/modell-/Edge Function-anrop i detta steg.

**Begränsningar:** Textbaserade, passiva PDF:er; ingen OCR för skannade bilder. En användarvald kostnadskategori är inte ett AI-beslut och garanterar inte korrekt konto eller avdragsgill moms. Faktisk betalning, dubbletter, kreditnotor, komplexa fakturor och momsundantag måste fortfarande kontrolleras i de ordinarie ekonomiflödena. AI-releasegrindarna är oförändrade.

Regressionstest: `test/document-accounting-preview.test.js`, tillsammans med befintliga `test/ai-document-reader.test.js` och `test/ai-document-review.test.js`.

## 2026-10-15: Säkrare hantering av krediter och momssatser

Efter att lokal PDF-avläsning och bokföringsutkast kopplats till både `AI-bokföring` och `Dokument` har regelmotorn förstärkts. Tidigare kunde en **kreditfaktura med positiva belopp** se ut som en vanlig leverantörsfaktura: netto + moms = total stämde matematiskt, men bokföringsriktningen var fel. Det är nu ett uttryckligt stoppvillkor.

- **Kreditfaktura, kreditnota, credit note och returkvitto:** identifieras från PDF-text även när beloppen är positiva. Det vanliga kostnad-/leverantörsskuldsutkastet blockeras i stället för att vända tecken eller gissa konton.
- **Negativa summor:** negativt netto, moms eller totalbelopp i sammanfattningsrader ger stopp, även om ett annat positivt totalbelopp hittats. En separat negativ rabattrad stoppar inte automatiskt en i övrigt entydig vanlig faktura.
- **Flera angivna momssatser:** blockerar det enkla utkastet, eftersom inköpet kan kräva flera kostnads-/momskonton.
- **Angiven momssats måste stämma med beloppen:** exempelvis `Momssats: 25 %` tillsammans med belopp som motsvarar 12 % blockeras även om netto + moms = total.
- **Fler utländska valutor:** NOK, DKK, CHF, PLN, CAD, AUD, JPY och CNY markeras nu liksom EUR, USD och GBP.
- **Saknade eller förfalskade riskfält:** den gemensamma granskningsmotorn avvisar resultaten; det räcker inte att ändra en klientflagga för att få ett utkast godkänt.

Resultatet visas med svenska förklaringar i båda gränssnitten. **Inga kreditnotor bokförs automatiskt.** Kreditflöde, momsfördelning och riktiga kundunderlag kräver fortfarande serververifiering och separat redovisnings-/driftsgodkännande. Skyddet är en fail-closed granskningsregel, inte en fullständig klassificerare eller ett bokföringsbeslut.

Automatiska tester finns i `test/ai-document-risk-gates.test.js`, samt de tidigare reader-/review-/dokumentarkivstesterna.

## 2026-10-15: Striktare belopp och explicit Unicode i digitala PDF:er

Den lokala PDF-läsaren har förstärkts för vanliga digitala leverantörsfakturor och kvitton:

- **Belopp med svensk eller internationell tusentalsgruppering** stöds när grupperna är konsekventa, t.ex. `1 234,56`, `1.234,56`, `1,234.56` och `1 234 567,89`. Endast heltalsören används.
- **Felaktiga belopp avvisas** i stället för att ta bort skiljetecken och skapa ett falskt belopp. Exempel: `1,2`, `12,34,56`, `1.234.56` och felaktig tusentalsgruppering. Ett sådant saknat totalbelopp stoppar även granskningsutkastet.
- **UTF-16 med uttrycklig BOM i PDF-hexsträngar** kan avkodas, inklusive svenska tecken. PDF-text som består av tvåbytes-glyfkoder utan BOM avvisas när en fontspecifik ToUnicode-tabell behövs. Läsaren får inte gissa att glyfkoder är fakturatext.
- Detta är **fortfarande lokal PDF-textläsning, inte OCR eller AI**. Den tolkar inte generella ToUnicode-fontmappningar eller skannade dokument. Den gör inga nätverks-, databas-, AI- eller bokföringsanrop.

Regressionstester: `test/ai-document-reader-numeric-unicode.test.js` samt tidigare PDF- och konteringstester. Releaseflaggorna för extern AI är fortsatt avstängda.

## 2026-10-15: Binärsäkrare läsning av PDF-strömmar

PDF-läsaren läser nu längden för varje dataström från dokumentets `/Length`-fält och accepterar även ett **entydigt** indirekt längdreferensobjekt. På så sätt kan ordinära bytes som råkar innehålla texten `endstream` eller `endobj` inte felaktigt kapa komprimerad eller okomprimerad fakturatext. En komprimerad ström avslutas inte längre genom att godtyckligt klippa bort ett radslut som kan tillhöra dess zlib-data.

Felaktig, saknad, motstridig eller oåtkomlig längdinformation stoppar läsningen. Maxgränserna för PDF, komprimerade strömmar, uppblåst text och antal strömmar är kvar. Detta ger **bättre textläsning**, inte bildtolkning eller en fullständig PDF-standardtolk. Första steget är fortsatt lokalt, helt utan AI-anrop, bokföring eller lagring. Skannade kvitton och vanliga bilder stöds fortfarande inte.

Regressionstester i `test/ai-document-reader.test.js` täcker interna markörer i båda strömtyperna, en zlib-ström vars sista byte är radslut, indirekt längd, fel längd, dubbla referensobjekt och saknad längd.

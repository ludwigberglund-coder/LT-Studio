# Bokslut #745 – P1E: fullständig saldobalans med explicit period

Denna etapp ger en **läsbaserad, serverberäknad saldobalans** för ett valbart intervall med startdatum inkluderat och slutdatum exkluderat. Därmed kan även brutna räkenskapsår analyseras.

## Levererat
- `public.book_close_trial_balance(company, start, end)` beräknar periodens debet, kredit och nettorrörelse för **alla** konton, utan PostgREST:s radbegränsning.
- Summerar tidigare tillgängliga bokförda rörelser och ackumulerat värde till periodens slut per konto.
- `SECURITY INVOKER`, AAL2/personlig sessionskontroll, företagstillhörighet, RLS och bara `authenticated`-åtkomst.
- Belopp summeras i PostgreSQL `numeric` och skickas som textsträngar i ören. Browserkontraktet kontrollerar beloppen med `BigInt`.
- Browserkontraktet avvisar felaktiga datum, fel företag, felaktig status, upprepade konton, ogiltiga belopp och motsägande totalsummor.

## Viktiga begränsningar

Detta är **inte** en slutligt verifierad saldobalans. Konton med bokföring före systemstart, ingående balans, kontoplan, externa kontoutdrag, reskontra per balansdagen, momsunderlag och historisk täckning är **inte verifierade**. Även lika debet/kredit får **aldrig** innebära bokslut godkänt.

Resultatet är alltid `not_reconciled`. Ingen verifikation, period, betalning eller faktura skrivs eller ändras.

## Samordning
Arbetet berör endast ny migration, eget klientkontrakt och egna tester, inte `bokslut.html` eller `bokslut.css` som hanteras i parallell PR #769.

## Fortsättning
När #769 är färdig kan saldobalansen integreras i den visuella arbetslistan med tydlig periodväljare och sökbara kontorader. Följ därefter verifierbar ingående balans samt 1510/2440/1930-avstämning mot externa underlag.

## Releasekrav
Quality, CodeQL och Supabase clean rebuild måste vara gröna på PR-headen. Supabase-UAT ska därefter få den versionerade migrationen och den aktiva RPC:n verifieras. Två företags negativa tenanttest och mänsklig bokslutsgranskning återstår innan skarpt bruk.

# Gemensam portal-layout

Den privata företagsportalen använder en gemensam ytterlayout. Syftet är att navigation, användarinformation och grundläggande responsivitet inte ska bero på vilken affärsmodul som är öppen.

## Ägarskap

`apps/portal/portal-nav.js` äger den gemensamma portalramen:

- huvudnavigationen i vänsterspalten
- företagsnamn i navigationen
- gemensam användarmeny i toppbaren
- avatar/initialer
- säker utloggning mot `POST /api/v1/auth/logout`
- normalisering av portalens workspace-klasser

`apps/portal/styles.css` äger portalramens gemensamma visuella regler.

Affärsmoduler som Bokföring, Rapporter, Lager, Leverantörer och Kundfakturor äger sitt eget innehåll, men ska inte skapa en egen säkerhets- eller användarmeny.

## Gemensamma layoutklasser

När en portalsida renderas märks den automatiskt upp med:

- `.shared-workspace-shell` på den yttre tvåkolumnslayouten
- `.shared-sidebar` på huvudnavigationen
- `.shared-workspace-main` på huvudkolumnen
- `.shared-user-menu` i toppbaren

Det gör att samma grundlayout kan tillämpas även om äldre moduler fortfarande har modulunika klassnamn som `.accounting-shell`, `.reports-shell` eller `.payables-shell`.

## Responsiva brytpunkter

Den gemensamma portalramen använder:

- över 1000 px: ordinarie sidomeny med `--sidebar-width` (248 px)
- 721–1000 px: smalare men fortfarande textläsbar sidomeny på 220 px
- 720 px och mindre: enkolumnslayout där sidomenyn döljs

Modulspecifik CSS får styra innehållet inne i respektive modul, men ska inte ändra dessa grundläggande portalbrytpunkter.

## Utloggning

Utloggning ska alltid ske genom den gemensamma användarmenyn. Klientkoden skickar en CSRF-skyddad POST-begäran till backend. Backend tar bort serversessionen, skriver revisionshändelsen `SESSION_LOGOUT` och skickar en cookie som upphör.

En modul ska därför inte implementera en egen logout-knapp eller egen sessionsradering.

## Tester

Följande tester skyddar kontraktet:

- `test/portal-sidebar.test.js` verifierar att privata portalsidor laddar den gemensamma navigationen och att layoutreglerna finns.
- `test/api-v1.test.js` verifierar att logout kräver CSRF, raderar serversessionen och lämnar revisionsspår.
- `test/menu-invoice-browser.cjs` verifierar den gemensamma användarmenyn och portalens layout i flera skärmstorlekar.

Vid framtida portaländringar ska den gemensamma ramen ändras först. Undvik att kopiera navigation, användarmeny eller grundlayout till enskilda moduler.

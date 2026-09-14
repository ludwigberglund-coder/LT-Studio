# Komplett källkodsexport

Den här katalogen innehåller en komplett export av den aktuella Rollands-arbetsversionen från 2026-09-14. Exporten omfattar `public/`, `dist/`, backend (`server.js`), PDF-generator, tester, dokumentation, konfiguration och build-script. Lokala data, `node_modules`, loggar och hemligheter är medvetet exkluderade.

Källarkivet lagras som base64-delar för att kunna delas säkert genom GitHub-anslutningen. Bygg ihop delarna med `rebuild-source.ps1` på Windows eller `rebuild-source.sh` på macOS/Linux. Kontrollera sedan SHA-256 mot `SHA256SUMS.txt` innan uppackning.

Efter uppackning: kör `npm install`, därefter `npm test` och `npm start`.

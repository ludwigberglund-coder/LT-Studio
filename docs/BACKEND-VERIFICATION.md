# Verifieringsgrind för den säkra backendgrunden

Följande kontroller ska passera i GitHub Actions innan den här backendgrunden får slås ihop till `main`:

- innehålls- och behörighetskonfiguration valideras,
- all JavaScript-kod syntaxkontrolleras,
- hela den befintliga testsamlingen körs,
- kundreskontrans exakta kolumnkontrakt testas,
- öresberäkning och restbelopp testas,
- företagsisolering testas med två separata företag,
- läs- och skrivbehörighet för fakturakommentarer testas,
- lösenordshashning, MFA och krypterade hemligheter testas,
- sessionstak, CSRF och skyddad adminväg testas,
- produktionsberoenden granskas med `npm audit`,
- den statiska demon byggs och kontrolleras så att privata driftfiler inte följer med.

Godkända tester visar att de implementerade kontrollerna fungerar enligt testfallen. De ersätter inte penetrationstest, driftgranskning, återställningstest eller redovisningsmässig slutverifiering före skarp användning.

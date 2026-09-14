# Dela och vidareutveckla

## Klona projektet

```bash
git clone https://github.com/ludwigberglund-coder/Rollands.git
cd Rollands
npm install
npm start
```

## Vad som medvetet inte ligger i Git
- `node_modules/`
- `.env` och andra hemlighetsfiler
- lokala loggar
- lokal produktions-/testdata
- webbläsarens localStorage
- autentiseringsuppgifter till bank, e-post eller AI-tjänster

## Statisk publicering
Mappen `dist/` kan användas för statisk demo/publicering. Den representerar frontendversionen som kan köras utan lokal Node-server, men gemensam datalagring och serverfunktioner kräver backend.

## Källkodsexport
Repot innehåller både arbetskällan i `public/` och motsvarande statiska `dist/`, samt server, PDF-generator och tester. Därmed kan en annan utvecklare både köra den lokala fullare versionen och publicera statisk demo.

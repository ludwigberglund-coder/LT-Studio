# Ändra Rollands utan att röra programkoden

Den nya grunden skiljer på **innehåll**, **design** och **systemlogik**. Vanliga textändringar ska därför normalt inte göras inne i JavaScript- eller CSS-filer.

## Vilken fil ska ändras?

| Det ni vill ändra | Fil |
|---|---|
| Företagsnamn, adress, telefon, e-post | `content/company.json` |
| Rubriker, texter, erbjudanden och kontakttext | `content/site.json` |
| Adminmeny, modulnamn och utvecklingsplan | `content/admin.json` |
| Räkenskapsår, K2, moms, lön och lagerbeslut | `config/rolands-business-decisions.json` |

## Enklaste sättet

1. Öppna filen i GitHub.
2. Klicka på pennan **Edit this file**.
3. Ändra bara texten mellan citationstecknen.
4. Välj att skapa en ny branch och en pull request.
5. GitHub kör automatiska kontroller.
6. När pull requesten slås ihop till `main` publiceras demon automatiskt.

Projektadmin på GitHub Pages innehåller också ett formulär för webbplatsens vanligaste texter. Där kan ni göra en lokal förhandsvisning, kopiera JSON eller ladda ned en färdig `site.json`.

## Direktlänkar

- Webbplatstexter: <https://github.com/ludwigberglund-coder/Rollands/edit/main/content/site.json>
- Företagsuppgifter: <https://github.com/ludwigberglund-coder/Rollands/edit/main/content/company.json>
- Admininnehåll: <https://github.com/ludwigberglund-coder/Rollands/edit/main/content/admin.json>

## När ni inte vill redigera filer

Skapa ett ärende med mallen **Begär innehållsändring**. Beskriv nuvarande text och önskad text. Då kan ändringen genomföras utan att ni behöver förstå kod eller JSON.

## Viktig gräns

Lägg aldrig följande i GitHub:

- kund- eller leverantörsuppgifter från skarp drift,
- fakturor eller kvitton,
- bankhändelser,
- personuppgifter om anställda,
- lösenord, API-nycklar eller andra hemligheter,
- skarpa bokföringsregister eller säkerhetskopior.

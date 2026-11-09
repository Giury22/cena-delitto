# Cena con delitto

Sito in italiano per raccogliere adesioni, creare squadre e consultare le preferenze sui ruoli. Nessun tema o trama già assegnati. Interfaccia responsive, senza librerie esterne né servizi di tracciamento.

## Avvio sul computer

Richiede Node.js 22 o successivo. Non ci sono dipendenze da installare. Su una nuova copia del progetto, copia prima `.env.example` in `.env` e configura nome e cognome dell'organizzatore; se lasci vuota la password ne viene generata una al primo avvio.

```sh
npm start
```

Apri http://localhost:3000. Al primo avvio viene creata una password casuale nel file `.env`: usa **nome**, **cognome** e **password** configurati nelle variabili `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` e `ADMIN_PASSWORD` nel link **Accesso organizzatore** in fondo al sito. Puoi modificarli e riavviare il server. Sono ammesse anche password semplici. `.env` è escluso da Git. Il server ascolta anche sulla rete locale; `HOST=127.0.0.1` lo limita al computer.

In locale, i dati vengono aggiornati in `data/registrations.json`, incluso nella repository. Ogni salvataggio crea un backup `.bak` della versione precedente ed è serializzato per evitare aggiornamenti persi. Avvia una sola istanza del server sullo stesso file. Le prove automatiche usano file temporanei e non modificano le adesioni reali.

```sh
npm test
```

## Pubblicazione su Netlify

Netlify serve la cartella `public` e le API sono Netlify Functions. Il filesystem delle funzioni non è un archivio persistente: in produzione la funzione legge e aggiorna **lo stesso JSON nella repository GitHub**, tramite API. Nessun database. Ogni modifica è un commit; in caso di aggiornamenti simultanei lo SHA viene controllato e l'operazione viene ritentata sul contenuto aggiornato.

1. Crea una **repository GitHub privata** e carica il progetto, incluso `data/registrations.json`. Il branch predefinito previsto è `main`. Non caricare `.env` o i backup.
2. Crea un token GitHub **fine-grained** limitato a questa repository, con permesso **Contents: Read and write**. Il branch deve permettere al token di scrivere direttamente il file (non deve richiedere pull request per questi aggiornamenti). Scegli una scadenza successiva alla cena.
3. In Netlify importa la repository. `netlify.toml` configura già **Publish directory: `public`** e **Functions directory: `netlify/functions`**; non serve un comando di build. Il caricamento della sola cartella `public` tramite drag-and-drop non pubblica il backend.
4. Nelle variabili d'ambiente Netlify, disponibili alle **Functions** (oppure a tutti gli ambiti), imposta:

   | Variabile | Valore |
   | --- | --- |
   | `ADMIN_FIRST_NAME` | Il nome dell'organizzatore |
   | `ADMIN_LAST_NAME` | Il cognome dell'organizzatore |
   | `ADMIN_PASSWORD` | La password scelta per l'account organizzatore |
   | `GITHUB_TOKEN` | Il token limitato alla repository |
   | `GITHUB_REPOSITORY` | `tuo-utente/nome-repository` |
   | `GITHUB_DATA_BRANCH` | `main`, oppure il branch dove conservi il JSON |
   | `SESSION_SECRET` | Facoltativo: un segreto casuale lungo. Se assente viene usata la password admin |

5. Esegui il deploy. Verifica un'iscrizione dal sito e il relativo commit in `data/registrations.json` su GitHub. Le API restituiscono un messaggio di configurazione incompleta finché token, password e repository non sono pronti. Usa le stesse variabili anche nei deploy di anteprima solo se vuoi che modifichino i dati reali; è preferibile un branch dati separato per le prove.

I commit dei dati contengono `[skip netlify]`, così non viene ricostruito il sito a ogni adesione. Le modifiche al codice si pubblicano normalmente. Prima di aggiornare il codice dalla tua copia locale, esegui `git pull` per includere i commit delle adesioni e conservare il JSON più recente.

`netlify.toml` esclude dalla scansione dei segreti soltanto `ADMIN_FIRST_NAME` e `ADMIN_LAST_NAME`: nome e cognome possono comparire legittimamente nelle adesioni. La scansione resta attiva per password, token e gli altri segreti, anche nel JSON dei partecipanti. Questa configurazione evita che un cognome coincidente blocchi il deploy; non modifica le credenziali o i dati salvati.

Il token resta nel backend e non viene inviato al browser. Il JSON non è nella cartella pubblicata. Chi può leggere la repository può leggere i dati e gli hash delle password, come richiesto: mantieni privata la repository. La cronologia GitHub conserva anche le versioni precedenti.

Questa soluzione è pensata per una cena tra amici: le API GitHub hanno limiti di utilizzo e frequenza. Un evento con molti accessi richiederebbe uno storage diverso. I dati locali e quelli GitHub restano separati; il server `npm start` usa sempre il file locale.

## Utilizzo

- **Prima volta:** nome, cognome, soprannome facoltativo e password libera, senza requisiti di lunghezza o composizione. L'iscrizione conferma la presenza.
- **Ritorno:** nome, cognome e password. Maiuscole e spazi in più nei nomi non impediscono l'accesso. Due omonimi possono avere profili distinti usando password diverse. Gli stessi nome, cognome e password identificano lo stesso profilo: non possiamo distinguere due persone con tutte e tre le credenziali identiche.
- **Profilo:** modifica soprannome, immagine personale e partecipazione. Carica una foto JPG, PNG o WebP di massimo 10 MB: viene ritagliata al centro e ridotta nel browser a 320 × 320 pixel (JPEG, massimo 128 KB), con anteprima prima del salvataggio. Puoi sostituirla o rimuoverla; senza foto appaiono le iniziali del soprannome. Premi **Salva il profilo** per confermare le modifiche. L'immagine viene conservata nello stesso JSON delle adesioni, anche su GitHub.
- **Scelta del ruolo:** nel profilo, sotto **Scegli se fare l'assassino**, seleziona **Voglio fare l'assassino**, **Non voglio fare l'assassino** oppure **Per me è indifferente** e premi **Salva il profilo**. Un messaggio distingue la scelta ancora da salvare dalla preferenza già memorizzata. È una disponibilità: il ruolo finale viene assegnato dall'organizzatore.
- **Squadre:** crea un gruppo, unisciti a uno esistente, cambia gruppo o lascialo. Ogni nuova squadra deve scegliere un colore diverso da quello delle altre: quelli gi? assegnati non sono selezionabili. Il vincolo vale anche quando si cambia colore ed ? verificato sul server, anche in caso di richieste simultanee. Cambiare il colore o eliminare una squadra rende nuovamente disponibile quello precedente; una squadra vuota lo mantiene riservato. Tutti i membri possono impostarlo o cambiarlo dalla propria squadra, anche per i gruppi creati in precedenza: il colore ? condiviso e visibile ai partecipanti, all?organizzatore e nel CSV. Le squadre senza membri restano disponibili.
- **Organizzatore:** accesso con nome, cognome e password configurati in ambiente; panoramica, filtri, gruppi completi e CSV compatibile con Excel. I cestini accanto ai profili e alle squadre permettono di eliminarli dopo una conferma. Eliminare una squadra conserva i partecipanti, che tornano senza squadra; eliminare un profilo lo rimuove dalla lista e ne impedisce il successivo accesso con le vecchie credenziali. Le squadre create dal profilo eliminato restano disponibili. Le presenze rinunciate sono conservate e distinte da quelle confermate. I ruoli non vengono assegnati automaticamente.

I partecipanti vedono i soprannomi e le immagini nelle squadre; i nomi completi e le preferenze altrui sono riservati all'organizzatore. Le foto sono visibili anche nel registro e nelle squadre del pannello organizzatore. Password protette con scrypt e sale individuale; cookie di sessione firmati, HttpOnly, SameSite=Lax e Secure su Netlify. Le sessioni durano sette giorni e funzionano fra istanze serverless; cambiare il segreto di firma le invalida tutte. Il logout elimina il cookie dal browser. Dopo un riavvio in locale occorre reinserire la password solo se la sessione è scaduta o il segreto di firma è cambiato.

Non sono previsti email, recupero password automatico o verifica dell'identità reale. Per una password dimenticata, l'organizzatore accede al proprio pannello e preme **Nuova password** sulla riga del partecipante: sceglie la nuova password, può mostrarla prima di salvare e la comunica direttamente alla persona. Il salvataggio conserva profilo, preferenze e squadra, sostituisce la vecchia password e invalida tutte le sessioni precedenti di quel partecipante. Funziona anche con i profili che usavano il vecchio PIN. In caso di omonimi, non si può scegliere una password già usata da un altro profilo con lo stesso nome e cognome. Le password esistenti non sono visualizzabili perché sono salvate solo come hash, e anche quelle nuove restano protette allo stesso modo. Non occorrono nuove variabili d'ambiente. Registrarsi di nuovo con una password diversa può invece creare un duplicato.

La configurazione locale include un segreto di sessione casuale distinto dalla password di accesso. Per mantenerlo distinto anche su Netlify, imposta la variabile `SESSION_SECRET`.

Il limite dei tentativi di accesso è per IP e per istanza del backend; su Netlify non è un limite globale tra tutte le istanze.

## Riferimenti ufficiali

- [Netlify Functions: Request e Response](https://docs.netlify.com/build/functions/get-started/)
- [Variabili delle funzioni](https://docs.netlify.com/build/functions/environment-variables/)
- [GitHub: leggere e aggiornare un file nella repository](https://docs.github.com/en/rest/repos/contents)

I profili creati prima della modifica alle password restano validi: il precedente PIN di sei cifre si usa come password. Le password vengono confrontate esattamente come inserite, inclusi maiuscole e spazi. Rimane solo il requisito di non lasciare il campo vuoto. Il limite tecnico delle richieste API è di 16 KB complessivi, tranne `PATCH /api/me`, che ammette 192 KB per includere l'immagine in base64. Il backend accetta soltanto dati immagine JPG, PNG o WebP entro 128 KB e ne verifica formato, intestazione e base64; URL esterni e SVG non sono ammessi. Non occorrono nuove variabili d'ambiente.

Quando il JSON su GitHub supera 1 MB, il backend ne legge i metadati e recupera il contenuto tramite il blob dello stesso SHA, conservando il controllo delle modifiche simultanee. Vedi la documentazione di [Contents](https://docs.github.com/en/rest/repos/contents#get-repository-content) e [Git blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob).

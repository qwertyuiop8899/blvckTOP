# blvckTOP v7.6.3 (SQLite & ARM Edition)

Addon ad alte prestazioni per Nuvio e Stremio con Top 10 numerate, rendering grafico HD e persistenza su SQLite.

---

## 🚀 Novità v7.3

* **Database SQLite e Storage persistente:** Mappature IMDb $\rightarrow$ TMDB, asset grafici (loghi e backdrop) e cover PNG generate vengono salvati su disco (`/app/data`). Le richieste successive vengono servite all'istante in **0ms** come file statici.
* **Pre-caching e Aggiornamento Programmato (Cron):** Il server sincronizza automaticamente tutti i cataloghi ed esegue il pre-rendering in background **ogni giorno alle 09:00 e alle 18:00**. Quando apri Stremio, le cover sono già pronte.
* **Chiave TMDB Globale:** La TMDB API key è gestita a livello di server (configurabile in `.env`), eliminando la richiesta di inserimento per i singoli utenti nel configuratore web.
* **Supporto Nativo Docker & ARM (carloarm):** Pronto per l'installazione su server ARM64 / Raspberry / VPS tramite `docker compose`.

---

## 🎨 Formati e Personalizzazioni

Ogni utente può scegliere per ciascun catalogo:
* **Landscape:** Cover $1280 \times 720$, backdrop TMDB `w1280`, logo ufficiale e numero a sinistra con glow.
* **Portrait:** Cover $1000 \times 1500$, poster verticale TMDB `w780`, logo ufficiale e numero a sinistra.
* **Sfondo Canvas:** Fresh (predefinito), Brand Glass, Trasparente, Nuvio e Stremio.
* **Fresh (predefinito):** immagine nitida a tutto schermo, numero in vetro scuro e logo del titolo in basso a destra. Genere, voto e logo provider restano opzionali. Disponibile in orizzontale e verticale, in JPEG.
* **Cache:** alle 09:00 e alle 18:00, ora italiana, le cover invariate vengono riutilizzate; le nuove posizioni vengono renderizzate. La pulizia dei titoli usciti dalla Top 10 avviene solo dopo una sincronizzazione completa. Le sei immagini di esempio del configuratore sono statiche.
* **Ordine cataloghi:** dopo la selezione, le frecce su/giu permettono di ordinare le classifiche anche tra provider diversi.
* **Nomi cataloghi:** ogni classifica puo avere un nome personalizzato di massimo 80 caratteri. Il campo vuoto mantiene il nome originale; ID, loghi provider e cover non cambiano.

Ordine e nomi vengono salvati nei nuovi link personalizzati. Per cambiarli dopo l'installazione occorre generare e installare un nuovo link; quello precedente resta invariato. Le configurazioni gia esistenti conservano ordine e nomi precedenti. Il manifest restituisce l'ordine scelto, ma l'app client puo applicare un proprio ordinamento.

---

## 🛠️ Installazione su Server / Docker (carloarm)

### 1. Clona il repository
```bash
git clone https://github.com/qwertyuiop8899/blvckTOP.git
cd blvckTOP
```

### 2. Configura le variabili d'ambiente
Copia il file di esempio:
```bash
cp .env.example .env
```
Modifica il file `.env`:
```env
PORT=3000
SOURCE_MANIFEST_URL=https://IL-TUO-MANIFEST-SORGENTE/manifest.json
APP_SECRET=stringa_lunga_e_casuale_di_almeno_32_caratteri_stabile
TMDB_API_KEY=ad0f7351455041d8c9c0d4370a4b5fa5
DATA_DIR=/app/data
```

> [!IMPORTANT]
> Non cambiare `APP_SECRET` dopo aver generato i manifest agli utenti, altrimenti i loro token cifrati smetteranno di essere validi.

### 3. Avvia con Docker Compose
```bash
docker compose up -d --build
```

Il database SQLite e tutte le locandine generate verranno salvati nella cartella locale `./data`, persistendo a tutti i riavvii del server.

---

## 📊 Monitoraggio Statistiche Cache

Puoi verificare in qualunque momento quante copertine e dati sono stati salvati nella cache visitando:
```
http://tuo-server:3000/api/stats
```
Risposta di esempio:
```json
{
  "covers": 240,
  "assets": 110,
  "mappings": 85,
  "dataDir": "/app/data"
}
```

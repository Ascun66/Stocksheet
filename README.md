# Alt-Soundcircus

Nightclub / pub stock sheets, dashboard, postmix ordering, and email alerts.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

Passcode for Settings and Postmix: **999906**

## Deploy on Render (recommended)

1. Create a free account at https://render.com
2. Click **New +** → **Web Service**
3. Connect your GitHub repo (upload this folder to a GitHub repo first), **or** use "Deploy an existing image" / manual deploy
4. Settings:
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`
5. Add Environment Variables:
   - `SMTP_USER` = `a.skan.campbell.06@gmail.com`
   - `SMTP_PASSWORD` = your Gmail App Password (hous ioqc ljgd gtzd without spaces, or as Google gave it)
   - `ALERT_EMAIL` = `askan-campbell@outlook.com`
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
6. Click **Create Web Service**

You will get a public URL like:
`https://alt-soundcircus.onrender.com`

Open that on your phone from anywhere.

### Important notes about free Render

- The free tier spins down after ~15 minutes of no traffic. First load after that can take 30–60 seconds.
- Free disk is **ephemeral**: stock data can reset if the service is fully redeployed. For permanent storage later, add a Render **Persistent Disk** or switch the database to Postgres.
- For day-to-day use between redeploys, SQLite data usually stays while the same instance is running.

## Features

- **Stock Dates:** Dashboard, Pub, Front Left, Front Right, Back Bar, All Stock
- Search-friendly lists, date colours (soon / past)
- **Postmix + Gas** ordering (PIN protected)
- **Settings** for email, targets, supplier template (PIN: 999906)
- Automatic 14-day and monthly stock emails

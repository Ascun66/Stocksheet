from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import datetime, timedelta, date
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import threading
import time
import json

app = Flask(__name__)
DB_PATH = os.environ.get("DATABASE_PATH") or os.path.join(os.path.dirname(__file__), "stock.db")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "email_config.json")

LOCATIONS = {
    "pub": "Pub",
    "front_left": "Front Bar Left",
    "front_right": "Front Bar Right",
    "back_bar": "Back Bar"
}

# ---------- Database ----------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location TEXT NOT NULL,
            item TEXT NOT NULL,
            earliest_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_alerted TEXT
        )
    """)
    try:
        conn.execute("ALTER TABLE stock ADD COLUMN last_alerted TEXT")
    except sqlite3.OperationalError:
        pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS postmix (
            key TEXT PRIMARY KEY,
            current REAL DEFAULT 0,
            needed REAL DEFAULT 0
        )
    """)
    for k in ["cola","diet_cola","energy_drink","lemonade","lime_cordial","blackcurrant_cordial","nitro_70_30","co2"]:
        conn.execute("INSERT OR IGNORE INTO postmix (key, current, needed) VALUES (?, 0, 0)", (k,))

    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    defaults = {
        "supplier_email": "",
        "order_email_subject": "Postmix & Gas Order",
        "order_email_body": "Hi,\n\nPlease could we place the following order:\n\n{{order_list}}\n\nThanks"
    }
    for k, v in defaults.items():
        conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", (k, v))

    conn.commit()
    conn.close()

# ---------- Email config ----------

def load_email_config():
    cfg = {
        "to_email": "askan-campbell@outlook.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "a.skan.campbell.06@gmail.com",
        "smtp_password": "",
        "from_name": "Alt-Soundcircus"
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                cfg.update(json.load(f))
        except Exception:
            pass
    # Environment variables override file (best for Render)
    if os.environ.get("SMTP_USER"):
        cfg["smtp_user"] = os.environ["SMTP_USER"]
    if os.environ.get("SMTP_PASSWORD"):
        cfg["smtp_password"] = os.environ["SMTP_PASSWORD"]
    if os.environ.get("SMTP_HOST"):
        cfg["smtp_host"] = os.environ["SMTP_HOST"]
    if os.environ.get("SMTP_PORT"):
        cfg["smtp_port"] = int(os.environ["SMTP_PORT"])
    if os.environ.get("ALERT_EMAIL"):
        cfg["to_email"] = os.environ["ALERT_EMAIL"]
    return cfg

def save_email_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)

# ---------- Email sending ----------

def send_email(subject, body_html):
    cfg = load_email_config()
    if not cfg.get("smtp_password"):
        print("[email] No password set – skipping send")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg.get('from_name', 'Alt-Soundcircus')} <{cfg['smtp_user']}>"
    msg["To"] = cfg["to_email"]

    msg.attach(MIMEText(body_html, "html"))

    try:
        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"]) as server:
            server.starttls()
            server.login(cfg["smtp_user"], cfg["smtp_password"])
            server.sendmail(cfg["smtp_user"], cfg["to_email"], msg.as_string())
        print(f"[email] Sent: {subject}")
        return True
    except Exception as e:
        print(f"[email] Failed: {e}")
        return False

def build_items_html(items, title):
    if not items:
        return f"<p>No items found.</p>"

    rows = ""
    for it in items:
        loc = LOCATIONS.get(it["location"], it["location"])
        rows += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">{loc}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">{it['item']}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">{it['earliest_date']}</td>
        </tr>
        """
    return f"""
    <h2 style="font-family:sans-serif;">{title}</h2>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
        <thead>
            <tr style="background:#f5f5f5;">
                <th style="padding:8px 12px;text-align:left;">Location</th>
                <th style="padding:8px 12px;text-align:left;">Item</th>
                <th style="padding:8px 12px;text-align:left;">Earliest Date</th>
            </tr>
        </thead>
        <tbody>
            {rows}
        </tbody>
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px;">Sent automatically by your Alt-Soundcircus app.</p>
    """

# ---------- Alert logic ----------

def check_and_send_alerts():
    """Run periodically. Sends 14-day warnings and (on 1st of month) the monthly top-10."""
    today = date.today()
    today_str = today.isoformat()
    two_weeks = (today + timedelta(days=14)).isoformat()

    conn = get_db()

    # --- 14-day warnings ---
    # Items due in the next 14 days that we haven't alerted today
    rows = conn.execute("""
        SELECT * FROM stock
        WHERE earliest_date >= ? AND earliest_date <= ?
          AND (last_alerted IS NULL OR last_alerted < ?)
        ORDER BY earliest_date ASC
    """, (today_str, two_weeks, today_str)).fetchall()

    if rows:
        items = [dict(r) for r in rows]
        html = build_items_html(items, "Items going out of date in the next 2 weeks")
        if send_email("Stock alert – items expiring within 2 weeks", html):
            ids = [str(r["id"]) for r in rows]
            conn.execute(
                f"UPDATE stock SET last_alerted = ? WHERE id IN ({','.join('?' * len(ids))})",
                [today_str] + ids
            )
            conn.commit()

    # --- Monthly summary (1st of the month) ---
    if today.day == 1:
        # Only send once per month – use a simple marker file
        marker = os.path.join(os.path.dirname(__file__), f"monthly_sent_{today.year}_{today.month}.flag")
        if not os.path.exists(marker):
            top10 = conn.execute("""
                SELECT * FROM stock
                WHERE earliest_date >= ?
                ORDER BY earliest_date ASC
                LIMIT 10
            """, (today_str,)).fetchall()

            items = [dict(r) for r in top10]
            html = build_items_html(items, f"Next 10 items going out of date – {today.strftime('%B %Y')}")
            if send_email(f"Monthly stock summary – {today.strftime('%B %Y')}", html):
                with open(marker, "w") as f:
                    f.write(today_str)

    conn.close()

def background_checker():
    """Check every 60 minutes while the app is running."""
    # Small delay on startup so the server is fully up
    time.sleep(15)
    while True:
        try:
            check_and_send_alerts()
        except Exception as e:
            print(f"[checker] Error: {e}")
        time.sleep(60 * 60)  # 1 hour

# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html", locations=LOCATIONS)

@app.route("/settings")
def settings_page():
    cfg = load_email_config()
    # Never send the password back to the browser
    safe = {k: v for k, v in cfg.items() if k != "smtp_password"}
    safe["has_password"] = bool(cfg.get("smtp_password"))
    return render_template("settings.html", config=safe)

@app.route("/api/settings", methods=["POST"])
def save_settings():
    data = request.json
    cfg = load_email_config()
    cfg["to_email"] = data.get("to_email", cfg["to_email"]).strip()
    cfg["smtp_user"] = data.get("smtp_user", cfg["smtp_user"]).strip()
    cfg["smtp_host"] = data.get("smtp_host", cfg["smtp_host"]).strip()
    cfg["smtp_port"] = int(data.get("smtp_port", cfg["smtp_port"]))
    # Only update password if they typed a new one
    new_pass = data.get("smtp_password", "").strip()
    if new_pass:
        cfg["smtp_password"] = new_pass
    save_email_config(cfg)
    return jsonify({"ok": True})

@app.route("/api/test-email", methods=["POST"])
def test_email():
    ok = send_email(
        "Alt-Soundcircus – test email",
        "<p>This is a test from your Alt-Soundcircus app. If you received this, email is working.</p>"
    )
    if ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Failed to send. Check password and settings."}), 400

@app.route("/api/items")
def get_items():
    location = request.args.get("location")
    conn = get_db()
    if location and location in LOCATIONS:
        rows = conn.execute(
            "SELECT * FROM stock WHERE location = ? ORDER BY earliest_date ASC, item ASC",
            (location,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM stock ORDER BY earliest_date ASC, item ASC"
        ).fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])

@app.route("/api/items", methods=["POST"])
def add_item():
    data = request.json
    location = data.get("location")
    item = data.get("item", "").strip()
    earliest_date = data.get("earliest_date")

    if not location or location not in LOCATIONS:
        return jsonify({"error": "Invalid location"}), 400
    if not item:
        return jsonify({"error": "Item name required"}), 400
    if not earliest_date:
        return jsonify({"error": "Date required"}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO stock (location, item, earliest_date, created_at) VALUES (?, ?, ?, ?)",
        (location, item, earliest_date, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route("/api/items/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    data = request.json
    item = data.get("item", "").strip()
    earliest_date = data.get("earliest_date")

    if not item or not earliest_date:
        return jsonify({"error": "Item and date required"}), 400

    conn = get_db()
    conn.execute(
        "UPDATE stock SET item = ?, earliest_date = ? WHERE id = ?",
        (item, earliest_date, item_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    conn = get_db()
    conn.execute("DELETE FROM stock WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})



# ---------- Postmix + Gas ----------

POSTMIX_LABELS = {
    "cola": "Cola",
    "diet_cola": "Diet Cola",
    "energy_drink": "Energy Drink",
    "lemonade": "Lemonade",
    "lime_cordial": "Lime Cordial",
    "blackcurrant_cordial": "Blackcurrant Cordial",
    "nitro_70_30": "70/30 (Nitro)",
    "co2": "CO2 (Carbon)"
}

def get_setting(key, default=""):
    conn = get_db()
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default

def set_setting(key, value):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()

@app.route("/api/postmix")
def get_postmix():
    conn = get_db()
    rows = conn.execute("SELECT * FROM postmix").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["label"] = POSTMIX_LABELS.get(d["key"], d["key"])
        needed = float(d["needed"] or 0)
        current = float(d["current"] or 0)
        d["to_order"] = max(0, needed - current)
        result.append(d)
    # keep consistent order
    order = list(POSTMIX_LABELS.keys())
    result.sort(key=lambda x: order.index(x["key"]) if x["key"] in order else 99)
    return jsonify(result)

@app.route("/api/postmix", methods=["POST"])
def save_postmix():
    data = request.json or {}
    conn = get_db()
    for key, vals in data.items():
        if key not in POSTMIX_LABELS:
            continue
        current = float(vals.get("current", 0) or 0)
        needed = float(vals.get("needed", 0) or 0)
        conn.execute(
            "INSERT OR REPLACE INTO postmix (key, current, needed) VALUES (?, ?, ?)",
            (key, current, needed)
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route("/api/order-settings")
def get_order_settings():
    return jsonify({
        "supplier_email": get_setting("supplier_email"),
        "order_email_subject": get_setting("order_email_subject", "Postmix & Gas Order"),
        "order_email_body": get_setting("order_email_body", "Hi,\n\nPlease could we place the following order:\n\n{{order_list}}\n\nThanks")
    })

@app.route("/api/order-settings", methods=["POST"])
def save_order_settings():
    data = request.json or {}
    if "supplier_email" in data:
        set_setting("supplier_email", data["supplier_email"].strip())
    if "order_email_subject" in data:
        set_setting("order_email_subject", data["order_email_subject"])
    if "order_email_body" in data:
        set_setting("order_email_body", data["order_email_body"])
    return jsonify({"ok": True})

@app.route("/api/send-order", methods=["POST"])
def send_order():
    """Build order from current vs needed and email the supplier."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM postmix").fetchall()
    conn.close()

    lines = []
    for r in rows:
        needed = float(r["needed"] or 0)
        current = float(r["current"] or 0)
        to_order = max(0, needed - current)
        if to_order > 0:
            label = POSTMIX_LABELS.get(r["key"], r["key"])
            qty = int(to_order) if to_order == int(to_order) else to_order
            lines.append(f"- {label}: {qty}")

    if not lines:
        return jsonify({"error": "Nothing to order – current stock meets or exceeds targets."}), 400

    order_list = "\n".join(lines)
    subject = get_setting("order_email_subject", "Postmix & Gas Order")
    body_template = get_setting(
        "order_email_body",
        "Hi,\n\nPlease could we place the following order:\n\n{{order_list}}\n\nThanks"
    )
    body = body_template.replace("{{order_list}}", order_list)

    supplier = get_setting("supplier_email", "").strip()
    if not supplier:
        return jsonify({"error": "No supplier email set. Add it in Settings."}), 400

    cfg = load_email_config()
    if not cfg.get("smtp_password"):
        return jsonify({"error": "Outlook password not set. Add it in Settings → Email alerts."}), 400

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg.get('from_name', 'Alt-Soundcircus')} <{cfg['smtp_user']}>"
    msg["To"] = supplier
    # plain text is fine for orders
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(cfg["smtp_host"], int(cfg["smtp_port"])) as server:
            server.starttls()
            server.login(cfg["smtp_user"], cfg["smtp_password"])
            server.sendmail(cfg["smtp_user"], supplier, msg.as_string())
        print(f"[email] Order sent to {supplier}")
        return jsonify({"ok": True, "sent_to": supplier, "items": len(lines)})
    except Exception as e:
        print(f"[email] Order failed: {e}")
        return jsonify({"error": f"Failed to send: {e}"}), 500



# Start DB + background checker when the app loads (works with gunicorn too)
init_db()
_checker_started = False

def start_background_checker():
    global _checker_started
    if _checker_started:
        return
    _checker_started = True
    t = threading.Thread(target=background_checker, daemon=True)
    t.start()
    print("Background email checker started (runs every hour)")

start_background_checker()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)


# إقفال — Eqfal

تطبيق ويب لإدارة تقفيل يوميات المطاعم والكافيهات.

- **Frontend** — HTML/CSS/JS عربي RTL (نسخة dark + light).
- **Backend** — Node.js 20 + Postgres (دون فريمورك خارجي).
- **Storage** — Postgres + filesystem للصور.
- **Auth** — admin (email + password) و employees (username + password)، PBKDF2 + JWT في HttpOnly cookie + CSRF.

## الإعداد المحلي

```bash
npm install
cat > .env.local <<EOF
DATABASE_URL=postgresql://postgres@localhost:5432/eqfal
JWT_SECRET=$(openssl rand -base64 48)
PORT=3001
HOST=0.0.0.0
EOF
npm run db:migrate
npm run dev
```

## النشر على VPS (Hostinger / DigitalOcean / غيرها)

سكربت واحد يثبّت Node + Postgres + nginx + Let's Encrypt:

```bash
ssh root@your-vps-ip
git clone https://github.com/ywnsdany/flowdesk-console.git /opt/eqfal
cd /opt/eqfal
sudo bash scripts/deploy-vps.sh eqfal.brave.com.sa admin@brave.com.sa
```

السكربت يعمل:
1. تثبيت Node 20 و Postgres 16 و nginx و certbot
2. إنشاء قاعدة بيانات + مستخدم بكلمة سر عشوائية
3. كتابة `.env.production` مع DATABASE_URL و JWT_SECRET
4. تشغيل migrations
5. إعداد systemd service (يبدأ تلقائياً)
6. nginx reverse proxy + شهادة SSL
7. cron للنسخ الاحتياطية اليومية لـ Postgres (٧ أيام)

بعد ما يخلص افتح `https://your-domain/console/signup` وأنشئ حساب الادمن الأول.

## الاستخدام

١. الادمن يسجّل عبر `/console/signup` (إيميل + كلمة سر).
٢. ينشئ Brand → Branch → Safe (برصيد افتتاحي) → Employee (بـ username + password + الفروع المسموحة).
٣. الموظف يدخل بـ username + password، ينحوّل لـ`/staff/`، يختار التاريخ + الفرع + الخزنة، ويرفع التقفيل.
٤. الادمن يراجع التقفيلات في `/console/closings` ويأكّد أو يرفض.

## بنية المشروع

```
api/                Node.js HTTP route handlers (file-based)
  _lib/             db, auth, money, blob, multipart, ids, ...
  auth/             signup, login, logout, me, change-password
  brands/, branches/, safes/, employees/   admin CRUD
  closings/, deposits/, reports/           admin business
  staff/            employee endpoints (branches, closing, upload, history)
  files.js          signed-token streamer for stored files
  dashboard/stats.js  today's totals
public/
  console/          accountant pages (HTML + styles.css + app.js)
  staff/            mobile-first employee UI
migrations/         Postgres schema (.postgres.sql, ordered)
scripts/
  server.js         production HTTP server (file-based routing)
  migrate.js        apply pending migrations
  deploy-vps.sh     one-shot installer for Debian/Ubuntu VPS
```

## أوامر مفيدة بعد النشر

```bash
# لوقات حية
journalctl -u eqfal -f

# إعادة تشغيل
systemctl restart eqfal

# نسخ احتياطي يدوي
sudo -u postgres pg_dump eqfal | gzip > backup.sql.gz

# تحديث الكود
cd /opt/eqfal && git pull && npm install --omit=dev && \
  npm run db:migrate:prod && systemctl restart eqfal
```

## الأمان

- **PBKDF2-SHA256** ٣١٠٬٠٠٠ تكرار + JWT HS256 في HttpOnly cookie + CSRF double-submit.
- كل query يفلتر بـ `accountant_id` + `requireOwn()` للتحقق من الملكية.
- الموظف يرى تقفيلاته فقط، ولا يصل لـ admin endpoints.
- الموظف يقدر يقفل ضمن آخر ٧ أيام فقط.
- الملفات تُعرض عبر `/api/files?t=<jwt>` بصلاحية ٥ دقائق.
- المبالغ كلها INTEGER halalas (ر.س × ١٠٠) — صفر أخطاء floating point.
- نسخ احتياطية يومية لـ Postgres تلقائياً.

# Daily Closing Console — كاشير اقفال

تطبيق ويب لإدارة تقفيل يوميات المطاعم والكافيهات. مبني على Vercel + Neon Postgres + Vercel Blob.

## المعمارية
- **Frontend** — صفحات HTML/CSS/JS عربية RTL في [public/](public/).
- **Backend** — Vercel Serverless Functions في [api/](api/).
- **Database** — [Neon Postgres](https://neon.tech) (serverless).
- **File storage** — [Vercel Blob](https://vercel.com/storage/blob).
- **Auth** — PBKDF2 + JWT HS256 في HttpOnly cookie + CSRF double-submit.

## النشر على Vercel

### 1) قاعدة البيانات في Neon
1. سجّل في [neon.tech](https://neon.tech) وأنشئ مشروع.
2. من **Connection Details**، انسخ الـ connection string (يبدأ بـ `postgresql://`).

### 2) Vercel Blob
1. في Vercel dashboard → **Storage** → **Blob** → Create.
2. اربطه بالمشروع — Vercel يحقن `BLOB_READ_WRITE_TOKEN` تلقائياً.

### 3) Environment variables
في إعدادات مشروع Vercel، أضف:
- `DATABASE_URL` — من Neon.
- `JWT_SECRET` — ولّد قيمة عشوائية: `openssl rand -base64 48`.

### 4) Deploy
```bash
npm install
npx vercel link        # ربط المجلد بمشروع Vercel
npx vercel env pull    # تنزيل المتغيرات للتطوير المحلي
npm run db:migrate     # تطبيق الـ schema على Neon
npx vercel --prod      # نشر للـ production
```

## التطوير المحلي
```bash
npm install
cp .env.example .env.local       # ثم عبّيه بقيمك
npm run db:migrate
npm run dev                       # vercel dev على localhost:3000
```

## استيراد بيانات قديمة من SQLite (اختياري)
لو عندك `data/db.sqlite` من النسخة القديمة:
```bash
npm run db:migrate                # أنشئ الـ schema أولاً
npm run db:import                 # ينسخ الصفوف ويرفع الملفات
```
الـ script يقرأ من `data/db.sqlite` ويرفع الملفات من `data/uploads/` إلى Vercel Blob (لو الـ token موجود).

## الاستخدام
1. افتح `https://your-app.vercel.app/console/signup` وسجّل أول محاسب.
2. أنشئ Brand → Branch → Safe (برصيد افتتاحي) → Employee.
3. أنشئ Cashier Link، انسخ الرابط والـ PIN، وأرسلهم للكاشير.
4. الكاشير يفتح الرابط على الموبايل، يدخل PIN، يصور المطلوب، ويرسل التقفيل.
5. ارجع للكونسول وأكّد/ارفض التقفيل.

## بنية المشروع
```
api/
  _lib/                shared modules (db, auth, money, blob, multipart, etc.)
  auth/                signup/login/logout/me/change-password
  brands/, branches/, safes/, employees/   CRUD
  links/, closings/, deposits/, reports/   business
  cashier/             link metadata, PIN, upload, closing submission
  files.js             signed-token redirect to Blob URL
  dashboard/stats.js   today's totals
public/
  console/             accountant pages (HTML + styles.css + app.js)
  cashier/             mobile cashier UI
migrations/            Postgres schema (.postgres.sql)
scripts/
  migrate.js           apply migrations
  import-from-sqlite.js  one-shot import from old db.sqlite
```

## الأمان
- **محاسب**: PBKDF2-SHA256 (310k iters) + JWT HS256 في `HttpOnly` cookie + CSRF token.
- **كاشير**: token في URL + PIN ٦ أرقام → JWT scoped لمدة ٣٠ دقيقة.
- **Brute-force**: ٥/١٥د، ١٠/٢٤س لكل link، ٢٠/ساعة لكل IP.
- **الملفات**: تُعرض عبر `/api/files?t=<jwt>` بصلاحية ٥ دقائق.
- **`regenerate-pin`**: يبطل الجلسات السابقة عبر `pin_version`.
- **Multi-tenant**: كل query يفلتر بـ `accountant_id` + `requireOwn()` على الموارد.
- **Money**: integer halalas — لا أخطاء floating point.

## ملاحظة الكاميرا (iOS Safari)
بعض المتصفحات تتطلب HTTPS لتفعيل `capture="environment"` (الكاميرا الخلفية). على Vercel HTTPS متوفر افتراضياً، فما تحتاج تونّل.

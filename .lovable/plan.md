## خطة: تصدير قاعدة البيانات إلى ملف SQL واحد

### الناتج
ملفان جاهزان في `/mnt/documents/`:
1. **`01_schema.sql`** — كل السكيما: جداول `public` + functions + triggers + RLS policies + sequences + grants
2. **`02_data.sql`** — INSERT statements لكل البيانات في جداول `public` + `auth.users` + `auth.identities`

### طريقة الاستيراد عندك
في مشروع Supabase الجديد (الفاضي):
1. افتح **SQL Editor** → الصق محتوى `01_schema.sql` → Run
2. الصق محتوى `02_data.sql` → Run
3. شغّل ضبط الـ sequences:
   ```sql
   SELECT setval('public.order_code_seq',
     COALESCE((SELECT MAX(last_value) FROM public.store_order_counters), 1));
   ```

### خطوات التنفيذ (من جهتي)
1. **استخراج السكيما** عبر `pg_dump --schema-only --schema=public` على قاعدة Lovable Cloud الحالية (باستخدام `SUPABASE_DB_URL` الموجود في الـ secrets).
2. **استخراج البيانات** عبر `pg_dump --data-only --schema=public` + `--data-only --schema=auth --table=auth.users --table=auth.identities`.
3. **تنظيف الـ dump**: حذف مراجع `supabase_admin`, `pgsodium`, `vault`, `realtime`, `CREATE EXTENSION` للإضافات غير المتوفرة، و `ALTER ... OWNER TO`.
4. **حفظ الملفات** في `/mnt/documents/` وإصدار `<presentation-artifact>` تنزّلها منها.

### ملاحظات مهمة
- **Edge Functions**: ما تنتقلش مع SQL — لازم تنشرها يدوياً في Supabase الجديد بـ `supabase functions deploy` (كل الفولدرات تحت `supabase/functions/`)، وتضيف الـ secrets يدوياً (LOVABLE_API_KEY، VAPID_*، TURNSTILE_SECRET_KEY، إلخ).
- **Storage buckets**: ما عندكش buckets حالياً، فما فيش ملفات تنقل.
- **auth.users**: الباسوردات تنتقل مشفّرة (bcrypt)، المستخدمون يدخلون بنفس بياناتهم.
- **بعد الاستيراد**: في Supabase Dashboard → Authentication → URL Configuration → ضيف `https://was-la.com` كـ Site URL.

### المطلوب منك
- لا شيء قبل التنفيذ — عندي connection string للقاعدة الحالية في الـ secrets.
- بعد التنفيذ: connection / SQL Editor access لمشروع Supabase الجديد عندك.

وافق على الخطة وأنا أبدأ التصدير فوراً.

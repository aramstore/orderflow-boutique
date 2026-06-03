## خطة نقل المشروع من Lovable Cloud إلى Supabase خاص بك

### المرحلة 1: تجهيز بيانات الاتصال
من لوحة Supabase الجديدة (Settings → Database / API)، احصل على:
- **Project URL** (مثل: `https://xxx.supabase.co`)
- **anon public key**
- **service_role key** (سري — للنقل فقط)
- **Database password** + **Connection string** (Direct connection على المنفذ 5432)

### المرحلة 2: تصدير قاعدة البيانات الحالية
سأعطيك أمر `pg_dump` كامل لتشغيله من جهازك (يحتاج `postgresql-client` مثبت):

```bash
# Dump كامل: سكيما + بيانات + auth.users
pg_dump "postgresql://postgres.iyqooryhmshlajuhabmc:[OLD_PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres" \
  --schema=public --schema=auth --schema=storage \
  --no-owner --no-privileges --no-publications --no-subscriptions \
  -f libya_store_dump.sql
```

ملاحظة: ستحتاج كلمة سر قاعدة بيانات Lovable Cloud الحالية — أحضرها لك من Cloud → Database → Connection.

### المرحلة 3: تنظيف الـ dump قبل الاستيراد
قبل الاستيراد، نحذف من الملف:
- مراجع `supabase_admin`, `pgsodium`, `vault`, `realtime` الخاصة بـ Lovable
- أوامر `CREATE EXTENSION` للإضافات غير المتوفرة افتراضياً (سأحدد القائمة بعد الاطلاع على الـ dump)
- إعدادات publications/subscriptions الخاصة بـ realtime القديم

سأولّد لك سكربت `sed` أو Python جاهز للتنظيف.

### المرحلة 4: الاستيراد إلى Supabase الجديد
```bash
psql "postgresql://postgres.[NEW_REF]:[NEW_PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres" \
  -f libya_store_dump_clean.sql
```

ثم تشغيل أوامر إعادة ضبط الـ sequences:
```sql
SELECT setval('public.order_code_seq', (SELECT COALESCE(MAX(last_value),1) FROM public.store_order_counters));
```

### المرحلة 5: نشر Edge Functions
كل الـ Edge Functions (موجودة في `supabase/functions/`) لازم تنشر يدوياً في Supabase الجديد:
```bash
supabase link --project-ref [NEW_REF]
supabase functions deploy --no-verify-jwt
```
ثم إضافة كل الـ Secrets يدوياً في Supabase Dashboard → Edge Functions → Secrets:
- `LOVABLE_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `TURNSTILE_SECRET_KEY` + أي مفاتيح خاصة بـ WhatsApp/Facebook إن وجدت.

### المرحلة 6: تحديث المشروع للاتصال بـ Supabase الجديد
**هنا نواجه مشكلة جوهرية:** ملف `src/integrations/supabase/client.ts` و `.env` و `supabase/config.toml` **مولّدة تلقائياً من Lovable Cloud** وتُكتب فوق أي تعديل يدوي.

الحلول الممكنة:
- **(أ) الأنسب**: إنشاء **مشروع Lovable جديد** (Remix بدون Cloud) وربطه بـ Supabase الجديد عبر **Supabase Integration** الرسمية (زر Connect Supabase في Lovable).
- **(ب) البديل**: الإبقاء على هذا المشروع وإضافة طبقة client مخصصة (`src/lib/supabase-custom.ts`) تشير لـ Supabase الجديد، واستبدال كل `import` تدريجياً — لكن Lovable Cloud يبقى مفعّل وما تقدرش تطفيه.

### المرحلة 7: تحديث URLs والإعدادات
- في Supabase الجديد: Authentication → URL Configuration → أضف `https://was-la.com` كـ Site URL و Redirect URLs.
- تحديث Cloudflare Worker (`cloudflare-worker/worker.js`) لاستخدام الـ URL الجديد إن كان يستدعي Supabase.
- إعادة ربط Custom Domains.

### تحذيرات
- **لا يمكن تعطيل Lovable Cloud** بعد تفعيله في هذا المشروع — لذلك الخيار (أ) في المرحلة 6 هو الأنظف.
- **التوقف**: خلال النقل، أوقف كتابة طلبات جديدة من المستخدمين لتفادي فقدان بيانات.
- **ستفقد**: تكامل types التلقائي، نشر edge functions التلقائي، إدارة secrets من Lovable.

### المطلوب منك قبل البدء
1. كلمة سر قاعدة البيانات الحالية (Lovable Cloud) — أين تجدها: Cloud → Database → Connection String → Reveal password.
2. بيانات اتصال مشروع Supabase الجديد (URL + anon key + service_role + DB password).
3. تأكيد: هل تريد المسار (أ) Remix جديد، أم (ب) تعديل هذا المشروع كما هو؟

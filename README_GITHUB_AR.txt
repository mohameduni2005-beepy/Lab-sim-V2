بناء APK عن طريق GitHub (من غير ما تثبّت Android Studio)
==========================================================

1) اعمل حساب على github.com (لو مفيش)، واضغط New repository، سمّيه (مثلاً circuit-jumper) وخليه Public أو Private.

2) ارفع محتويات الفولدر ده للـ repository:
   - من صفحة الـ repository اضغط  Add file > Upload files
   - اسحب كل الملفات والفولدرات (www و package.json و capacitor.config.json و .gitignore و فولدر .github).
   - مهم: فولدر .github لازم يتحمّل كمان (فيه ملف البناء). لو الموبايل/المتصفح مش بيرفع الفولدرات المخفية، ارفع من الكمبيوتر أو استخدم GitHub Desktop.
   - اضغط Commit changes (على الفرع main).

3) بعد الرفع GitHub هيبدأ البناء لوحده. تابعه من تبويب Actions:
   - لو ماشتغلش: Actions > Build Android APK > Run workflow.
   - البناء بياخد من 5 لـ 10 دقايق تقريباً.

4) لما يخلّص (علامة صح خضرا):
   - افتح الـ run، وانزل لقسم Artifacts، ونزّل  circuit-jumper-apk (ملف zip).
   - فك الضغط هتلاقي  app-debug.apk.

5) انقل الملف للموبايل وثبّته (فعّل "التثبيت من مصادر غير معروفة" لو طلب).

ملاحظات
- ده APK تجريبي (debug) كفاية للتثبيت المباشر. للنشر على Google Play محتاج نسخة release وتوقيع (keystore)، وده خطوة تانية.
- عشان تثبّت الشاشة أفقي: افتح .github/workflows/build-apk.yml وشيل علامة # من سطري "Lock landscape".
- الـ workflow بينزّل أحدث Capacitor. لو البناء فشل بخطأ إصدارات، افتح الـ log وابعتلي النص، أو غيّر node-version و java-version في الملف.
- أي تعديل في فولدر www وترفعه، البناء بيتعاد لوحده وبيطلع APK جديد.

جهاز جديد: CT707 (3 محولات). موجود في النسخة دي وفي المحاكاة (sim.js، ثوابت TX_* أول الملف).

Circuit Jumper - نسخة الأندرويد (Capacitor)
===========================================

المطلوب تثبيته مرة واحدة
- Node.js (نسخة LTS) من nodejs.org
- Android Studio من developer.android.com/studio (بيجيب معاه Android SDK و JDK)

الخطوات (من داخل فولدر المشروع بعد فك الضغط)
1) تجربة في المتصفح قبل أي حاجة:
       npx serve www
   وافتح الرابط اللي بيظهر (أو: python -m http.server -d www 8080)

2) تثبيت Capacitor (بينزّل أحدث إصدار):
       npm install @capacitor/core
       npm install -D @capacitor/cli
       npm install @capacitor/android

3) إضافة مشروع الأندرويد (مرة واحدة):
       npx cap add android

4) أي مرة تعدّل في فولدر www:
       npx cap sync android

5) فتح المشروع في Android Studio:
       npx cap open android
   استنى Gradle يخلّص أول مرة (ممكن ياخد وقت)، وبعدين:
       Build > Build Bundle(s) / APK(s) > Build APK(s)
   الملف بيطلع في:
       android/app/build/outputs/apk/debug/app-debug.apk
   انقله للموبايل وثبّته (فعّل "التثبيت من مصادر غير معروفة"). أو وصّل الموبايل (USB debugging) واضغط Run.

   بديل من سطر الأوامر:
       cd android
       gradlew assembleDebug        (على ويندوز)     /    ./gradlew assembleDebug  (لينكس/ماك)

تثبيت الشاشة أفقي (اختياري - أنسب للأجهزة العريضة)
   افتح android/app/src/main/AndroidManifest.xml وضيف داخل <activity ...> السطر:
       android:screenOrientation="sensorLandscape"
   ثم npx cap sync android وابني من جديد.

لو ظهر خطأ في الإصدارات
   Capacitor الجديد ممكن يطلب Node أحدث أو Android Studio أحدث، فحدّثهم، أو ابعتلي رسالة الخطأ.

طريقة الاستخدام على الموبايل
- لمسة على طرف ثم لمسة على طرف تاني = سلك (jumper).
- لمسة على المفتاح (دايرة ON/OFF) = تشغيل/إيقاف.
- لمسة على سلك = تحديده، وبعدها اللون/السمك/الانحناء من تبويب "الأسلاك" بتتطبق عليه.
- ضغطة مطولة على طرف = إظهار كل الأطراف الموصولة بنفس النقطة (مع نقط تيار متحركة).
- ضغطة مطولة على سلك = حذفه.
- إصبع واحد = تحريك الشاشة، إصبعين = تكبير/تصغير.
- تبويب "المحاكاة": المفتاح الرئيسي، المتغير، الفاريك 0-100%، التردد 50/60، وقراءات الأجهزة.
- تبويب "ملف": حفظ الدوائر بأسماء، استيراد/تصدير، قائمة الوصلات.
- الدايرة بتتحفظ تلقائي وترجع لما تفتح التطبيق.

الملفات
- www/index.html, style.css           الواجهة
- www/js/app.js                       الرسم واللمس والمؤشرات
- www/js/sim.js                       محرك المحاكاة (نفس نسخة بايثون)
- www/js/data.js                      إحداثيات الأطراف والمؤشرات (معايرة على الصور)
- www/images/                         صور الأجهزة
الافتراضات القابلة للتعديل (مقاومة المصدر، مقاومة الملفات...) أول sim.js.
وضع "تعديل الأطراف" الموجود في نسخة الويندوز مش موجود هنا (الإحداثيات متعايرة).

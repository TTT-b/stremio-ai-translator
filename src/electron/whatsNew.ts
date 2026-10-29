/** Release notes shown once on the first launch after an update. Pure helpers: no Electron imports. */

export type NotesLang = 'he' | 'en';

/** A plain line, or a short title with an explanation that opens on click. */
export type ReleaseNote = string | { title: string; text: string };

export interface WhatsNew {
  version: string;
  notes: ReleaseNote[];
}

/** Bundled with the app so the popup works offline. Add an entry (both languages) for every release. */
export const RELEASE_NOTES: Record<string, Record<NotesLang, ReleaseNote[]>> = {
  '1.9.1': {
    en: [
      {
        title: 'New name: TTT Sub',
        text: 'The app and the add-on in Stremio are now called TTT Sub. In Stremio the add-on shows as TTT Sub · כתוביות AI. If the old name still shows there, remove the add-on and install it again.',
      },
      {
        title: 'Cleaner subtitles',
        text: 'After translating, the app quietly checks each line. A line that came back with a stray English word is translated once more on its own. Nothing to do on your side.',
      },
      {
        title: 'Tidier library',
        text: 'Each subtitle in My subtitles now has two buttons: Subtitles (SRT file) and Video, with a small menu for MKV or MP4.',
      },
      {
        title: 'Saving a video, and clearer labels',
        text: 'Saving a video shows a progress bar with the time left, a cancel button, and a done row with Show in folder. Timing labels now have different colors and icons, and a set key can be removed with a small x.',
      },
    ],
    he: [
      {
        title: 'שם חדש: TTT Sub',
        text: 'האפליקציה והתוסף ב-Stremio נקראים עכשיו TTT Sub. ב-Stremio התוסף מופיע כ-TTT Sub · כתוביות AI. אם עדיין מופיע השם הישן, הסר את התוסף והתקן אותו מחדש.',
      },
      {
        title: 'כתוביות נקיות יותר',
        text: 'אחרי התרגום התוכנה בודקת בשקט כל שורה. שורה שחזרה עם מילה באנגלית שלא שייכת אליה מתורגמת שוב פעם אחת בנפרד. אין מה לעשות מצדך.',
      },
      {
        title: 'ספרייה מסודרת יותר',
        text: 'לכל כתובית ב"הכתוביות שלי" יש עכשיו שני כפתורים: כתוביות (קובץ SRT) וסרטון, עם תפריט קטן ל-MKV או ל-MP4.',
      },
      {
        title: 'שמירת סרטון ותגיות ברורות',
        text: 'שמירת סרטון מציגה פס התקדמות עם הזמן שנשאר, כפתור ביטול, ובסיום שורה עם הצג בתיקייה. לתגיות התזמון יש צבעים ואייקונים שונים, ואפשר להסיר מפתח שהוגדר עם איקס קטן.',
      },
    ],
  },
  '1.9.0': {
    en: [
      {
        title: 'Start with Windows',
        text: 'Settings, General (and the last step of the setup) can start the app with Windows, optionally minimized to the icon near the clock. The tray menu has the same switch.',
      },
      {
        title: 'Pause translation, and time left',
        text: 'The tray menu can pause and resume translating and shows the time until the subtitle is complete, sound check included. The main screen shows the time left too.',
      },
      {
        title: 'Calmer progress bar, cleaner checks',
        text: 'The progress bar no longer wobbles. SubDL and Jimaku checks appear only when you saved a key for them. Subtitles closest to the playing release are preferred, and signs/songs tracks are skipped.',
      },
    ],
    he: [
      {
        title: 'הפעלה עם Windows',
        text: 'בהגדרות (כללי) ובשלב האחרון של האשף אפשר להפעיל את התוכנה עם Windows, אם רוצים גם ממוזערת לסמל ליד השעון. אותו מתג יש גם בתפריט הסמל.',
      },
      {
        title: 'השהיית תרגום וזמן משוער',
        text: 'בתפריט הסמל אפשר להשהות ולהמשיך תרגום, ורואים את הזמן עד כתובית מלאה, כולל סנכרון הקול. גם במסך הראשי מופיע הזמן שנשאר.',
      },
      {
        title: 'פס התקדמות רגוע ובדיקות נקיות',
        text: 'הפס כבר לא רועד. בדיקות SubDL ו-Jimaku מופיעות רק אם שמרת להן מפתח. נבחרת הכתובית הקרובה ביותר לגרסה שמתנגנת, ומסלולי שלטים ושירים מדולגים.',
      },
    ],
  },
  '1.8.0': {
    en: [
      {
        title: 'More sources, in the order you choose',
        text: 'SubDL (with season packs) and Jimaku (Japanese, for anime) join OpenSubtitles. Every subtitle in My subtitles shows where it came from, and Developer settings (Settings, About) lets you order the sources and ask again from one source.',
      },
      {
        title: 'Translation starts at once; the sound check goes on in the background',
        text: 'The main screen shows how far the sound check is and whether it moved the subtitle. Videos too big to read for their own subtitle are skipped quickly.',
      },
      {
        title: 'Cleaner screens',
        text: 'One line per episode in My subtitles, a Jimaku connection test, the queue only when 2 or more wait, OK buttons on the sync notices, and a question before Stremio is opened.',
      },
    ],
    he: [
      {
        title: 'עוד מקורות, בסדר שאתה בוחר',
        text: 'SubDL (כולל חבילות עונה) ו-Jimaku (יפנית, לאנימה) מצטרפים ל-OpenSubtitles. כל כתובית ב"הכתוביות שלי" מראה מאיפה הגיעה, וב"הגדרות מפתח" (הגדרות, אודות) אפשר לסדר את המקורות ולבקש שוב ממקור אחד.',
      },
      {
        title: 'התרגום מתחיל מיד, בדיקת הקול ממשיכה ברקע',
        text: 'המסך הראשי מראה כמה בדיקת הקול התקדמה והאם הכתובית הוזזה. סרטונים גדולים מדי לקריאת הכתובית שבתוכם מדולגים מהר.',
      },
      {
        title: 'מסכים נקיים יותר',
        text: 'שורה אחת לכל פרק ב"הכתוביות שלי", בדיקת חיבור ל-Jimaku, תור התרגומים מופיע רק כשממתינים 2 ומעלה, כפתורי אישור בהודעות הסנכרון, ושאלה לפני פתיחת Stremio.',
      },
    ],
  },
  '1.7.0': {
    en: [
      {
        title: 'Save a video with the subtitle inside',
        text: 'In My subtitles, the new button saves a copy of the video (MKV) with the translated subtitle as an extra track, plus an SRT file next to it. If the video is on Stremio, it is taken from there; otherwise you pick the file. Picture and sound are copied with no loss of quality.',
      },
      {
        title: 'No more waiting on a stuck sound check',
        text: 'If the video does not send its sound for 45 seconds, the app goes on with the subtitle as it is. The Continue button also skips that step.',
      },
      {
        title: 'Cleaner subtitles and clearer window buttons',
        text: 'Translator credits and site adverts are removed from subtitles, and the window buttons are bigger.',
      },
    ],
    he: [
      {
        title: 'שמירת סרטון עם הכתובית בתוכו',
        text: 'ב"הכתוביות שלי" הכפתור החדש שומר עותק של הסרטון (MKV) עם הכתובית המתורגמת כרצועה נוספת, וגם קובץ SRT לידו. אם הסרטון ב-Stremio הוא נלקח משם, ואחרת בוחרים את הקובץ. התמונה והקול מועתקים בלי פגיעה באיכות.',
      },
      {
        title: 'לא מחכים יותר על בדיקת קול תקועה',
        text: 'אם הסרטון לא שולח שמע במשך 45 שניות, האפליקציה ממשיכה עם הכתובית כמו שהיא. גם כפתור "המשך תרגום" מדלג על השלב הזה.',
      },
      {
        title: 'כתוביות נקיות יותר וכפתורי חלון ברורים',
        text: 'קרדיט של מתרגמים ופרסומות אתרים מוסרים מהכתוביות, וכפתורי החלון גדולים יותר.',
      },
    ],
  },
  '1.6.0': {
    en: [
      {
        title: 'Timing that follows the sound',
        text: 'When the video has no subtitle of its own, the app listens to a few short parts of the audio and shifts or stretches the subtitle to match. If it is not sure, it leaves the subtitle as it is.',
      },
      {
        title: 'Exact subtitle from the video, even if it arrives late',
        text: 'The app waits up to 15 seconds for the subtitle inside the video. If it arrives later, it is translated in the background and replaces the shown one. You get a notice, then select the subtitle again in Stremio.',
      },
      {
        title: 'Continue translation button',
        text: 'If the AI gets stuck, the button nudges it or starts the job again.',
      },
      {
        title: 'Cleaner subtitles',
        text: 'Speaker names, sound notes and translator credits are removed before translation. You can turn this off in Settings.',
      },
      {
        title: 'New look and more',
        text: 'Wider two-column screen that fits any monitor, F11 for full screen, language picker with flags, target language on the main screen, a button that opens Stremio, and a Download SRT link for each subtitle in My subtitles.',
      },
    ],
    he: [
      {
        title: 'תזמון לפי הקול',
        text: 'כשאין לסרטון כתובית משלו, האפליקציה מאזינה לכמה קטעים קצרים מהשמע ומזיזה או מותחת את הכתובית שתתאים. אם היא לא בטוחה, היא משאירה את הכתובית כמו שהיא.',
      },
      {
        title: 'כתובית מדויקת מהסרטון, גם אם היא מגיעה באיחור',
        text: 'האפליקציה ממתינה עד 15 שניות לכתובית שבתוך הסרטון. אם היא מגיעה אחר כך, היא מתורגמת ברקע ומחליפה את המוצגת. תקבל הודעה, ואז תבחר שוב את הכתובית ב-Stremio.',
      },
      {
        title: 'כפתור "המשך תרגום"',
        text: 'אם ה-AI נתקע, הכפתור דוחף אותו או מתחיל את העבודה מחדש.',
      },
      {
        title: 'כתוביות נקיות יותר',
        text: 'שמות דוברים, הערות קול וקרדיט של מתרגמים מוסרים לפני התרגום. אפשר לכבות את זה בהגדרות.',
      },
      {
        title: 'מראה חדש ועוד',
        text: 'מסך רחב בשתי עמודות שמתאים לכל מסך, F11 למסך מלא, בחירת שפה עם דגלים, שפת יעד במסך הראשי, כפתור שפותח את Stremio וקישור "הורד SRT" לכל כתובית ב"הכתוביות שלי".',
      },
    ],
  },
  '1.5.1': {
    en: [
      {
        title: 'Skip button for slow steps',
        text: 'When a step takes too long (looking for a subtitle, listening to the video), a Skip button lets you move on to the next one instead of waiting.',
      },
      {
        title: 'Install link on the main screen',
        text: 'The Stremio install button and the add-on address with a Copy button now sit at the bottom of the main screen, so you no longer need to reopen the setup wizard.',
      },
      {
        title: 'Cancel and start again',
        text: 'A cancelled request can be started again after 20 seconds.',
      },
      {
        title: 'Better subtitle reading from the video',
        text: 'While a video is still loading, the app keeps trying to read its built-in subtitle for up to 2 minutes before it falls back to another source.',
      },
      {
        title: 'Test mode for developers',
        text: 'Under Advanced settings. Made-up subtitles and a pretend AI run through the real queue, without using your keys or download limits.',
      },
    ],
    he: [
      {
        title: 'כפתור "דלג" לשלבים איטיים',
        text: 'כששלב לוקח יותר מדי זמן (חיפוש כתובית, האזנה לסרטון), כפתור "דלג" מאפשר לעבור לשלב הבא במקום לחכות.',
      },
      {
        title: 'קישור ההתקנה במסך הראשי',
        text: 'כפתור ההתקנה ב-Stremio וכתובת התוסף עם כפתור "העתק" נמצאים עכשיו בתחתית המסך הראשי, ואין צורך לפתוח שוב את אשף ההגדרה.',
      },
      {
        title: 'ביטול והתחלה מחדש',
        text: 'בקשה שבוטלה אפשר להתחיל שוב אחרי 20 שניות.',
      },
      {
        title: 'קריאה טובה יותר של כתובית מתוך הסרטון',
        text: 'כל עוד הסרטון עדיין נטען, האפליקציה ממשיכה לנסות לקרוא את הכתובית המוטמעת בו עד 2 דקות לפני שהיא עוברת למקור אחר.',
      },
      {
        title: 'מצב בדיקות למפתחים',
        text: 'בהגדרות מתקדמות. כתוביות מומצאות ו-AI מדומה עוברים דרך התור האמיתי, בלי להשתמש במפתחות או במכסות ההורדה שלך.',
      },
    ],
  },
  '1.5.0': {
    en: [
      {
        title: 'Ask before translating (optional)',
        text: 'Settings > Translation > "Ask me before translating". When you pick an episode the app says Received and waits for you to press Translate. A queue on the main screen shows what is waiting or running, each with a Cancel button. Picking another episode replaces the waiting one.',
      },
      {
        title: 'Tidier settings',
        text: 'Settings are grouped into cards: Accounts and keys, Translation. Maintenance and Advanced settings are folded away until you open them.',
      },
      {
        title: 'Precise sync by speech (optional)',
        text: 'Under Advanced settings. The app listens to the video and puts every subtitle line exactly when it is said. Free, runs on your computer, one-time 87 MB download that you confirm. For videos played through Stremio that have no subtitle of their own.',
      },
      {
        title: 'Daily download meters',
        text: 'The main screen shows how many OpenSubtitles downloads you used today and how many are left.',
      },
      {
        title: 'Saves your quota',
        text: 'Subtitles are compared only when 30 or more downloads are left, and two identical requests from Stremio now share one translation instead of paying twice.',
      },
      {
        title: 'SubDL as a second source',
        text: 'Optional. Add a free SubDL key in the setup wizard or in Settings. It is used when OpenSubtitles has no subtitle or its daily downloads are used up.',
      },
      {
        title: 'Exact or estimated timing',
        text: 'In My subtitles, each subtitle says whether its timing came from the video itself (exact) or is an estimate.',
      },
      {
        title: 'New look and fixes',
        text: 'A new app icon and colours that match the app, a clearer update row, and a fix for the main screen showing 0% after a subtitle was already translated.',
      },
    ],
    he: [
      {
        title: 'לשאול לפני שמתרגמים (אופציונלי)',
        text: 'הגדרות > תרגום > "שאל אותי לפני שמתרגמים". כשבוחרים פרק, האפליקציה אומרת "התקבל" ומחכה ללחיצה על "תרגם". תור במסך הראשי מראה מה ממתין או רץ, ולכל אחד כפתור "בטל". בחירת פרק אחר מחליפה את זה שממתין.',
      },
      {
        title: 'הגדרות מסודרות',
        text: 'ההגדרות מקובצות בכרטיסים: חשבונות ומפתחות, תרגום. תחזוקה והגדרות מתקדמות סגורות עד שתפתח אותן.',
      },
      {
        title: 'סנכרון מדויק לפי הקול (אופציונלי)',
        text: 'בהגדרות מתקדמות. האפליקציה מקשיבה לסרטון ומציבה כל שורה בדיוק ברגע שהיא נאמרת. חינמי, רץ על המחשב שלך, הורדה חד-פעמית של 87 MB שאתה מאשר. לסרטונים שמנוגנים דרך Stremio ואין להם כתובית משלהם.',
      },
      {
        title: 'מדי הורדות יומיים',
        text: 'המסך הראשי מציג כמה הורדות מ-OpenSubtitles ניצלת היום וכמה נשארו.',
      },
      {
        title: 'חוסך מכסה',
        text: 'משווים כתוביות רק כשנשארו 30 הורדות ומעלה, ושתי בקשות זהות מ-Stremio חולקות עכשיו תרגום אחד במקום לשלם פעמיים.',
      },
      {
        title: 'SubDL כמקור שני',
        text: 'אופציונלי. הוסף מפתח SubDL חינמי באשף ההגדרה או בהגדרות. משתמשים בו כשב-OpenSubtitles אין כתובית או שההורדות להיום נגמרו.',
      },
      {
        title: 'תזמון מדויק או משוער',
        text: 'ב"הכתוביות שלי" כל כתובית אומרת אם התזמון שלה נלקח מהסרטון עצמו (מדויק) או שהוא הערכה.',
      },
      {
        title: 'מראה חדש ותיקונים',
        text: 'אייקון חדש וצבעים שמתאימים לאפליקציה, שורת עדכונים ברורה יותר, ותיקון: המסך הראשי הציג 0% אחרי שהכתובית כבר תורגמה.',
      },
    ],
  },
  '1.4.9': {
    en: [
      'Fixes "quota exceeded" errors that were really OpenSubtitles saying "too many requests at once": requests are now spaced out and retried, so jobs no longer fail for that.',
      'Saves your OpenSubtitles download quota: comparing several subtitles is skipped when few downloads are left today.',
      'The main screen now says where a subtitle is (waiting, checking the video, searching, translating) and why the last one failed.',
      'A stuck step can no longer block everything: every step has a time limit.',
      'New "Copy diagnostics" button in Settings: copy and send it to the author if something does not work (no keys, no subtitle text).',
      'The bell lists only the newest three versions; earlier ones are behind a "Show earlier versions" button.',
    ],
    he: [
      'תוקנו שגיאות "חרגת מהמכסה" שהיו בעצם OpenSubtitles שאומר "יותר מדי בקשות בבת אחת": הבקשות מרווחות עכשיו ונשלחות שוב, ולכן משימות כבר לא נכשלות בגלל זה.',
      'חיסכון במכסת ההורדות שלך מ-OpenSubtitles: השוואת כמה כתוביות מדולגת כשנשארו מעט הורדות להיום.',
      'המסך הראשי אומר עכשיו איפה הכתובית נמצאת (ממתינה, בודק את הסרטון, מחפש, מתרגם) ולמה האחרונה נכשלה.',
      'שלב תקוע כבר לא יכול לחסום הכול: לכל שלב יש הגבלת זמן.',
      'כפתור חדש בהגדרות: "העתק פרטי אבחון". אם משהו לא עובד, העתק ושלח ליוצר (בלי מפתחות ובלי טקסט כתוביות).',
      'הפעמון מציג רק את שלוש הגרסאות האחרונות; הקודמות מאחורי כפתור "הצג גרסאות קודמות".',
    ],
  },
  '1.4.8': {
    en: [
      'Fixes translations that stayed on "Translating..." with no line count. Looking for a subtitle inside the video or its torrent now has a 30-second limit, and the normal search takes over after that.',
      'The quick subtitle file in the torrent is tried before reading the video itself.',
      "A subtitle taken from OpenSubtitles is replaced by the video's own subtitle as soon as that is available, instead of being kept.",
      'New bell: messages and updates from the author, and the notes of every version, always in one place that does not disappear.',
      'Removed the - and + timing buttons from My subtitles: they did not take effect.',
    ],
    he: [
      'תוקנו תרגומים שנתקעו על "מתרגם..." בלי מספר שורות. לחיפוש כתובית בתוך הסרטון או בטורנט שלו יש עכשיו הגבלה של 30 שניות, ואחריה החיפוש הרגיל ממשיך.',
      'קובץ הכתוביות המהיר שבטורנט נבדק לפני קריאת הסרטון עצמו.',
      'כתובית שנלקחה מ-OpenSubtitles מוחלפת בכתובית של הסרטון עצמו ברגע שהיא זמינה, במקום להישמר.',
      'פעמון חדש: הודעות ועדכונים מהיוצר, ומה חדש בכל גרסה, תמיד במקום אחד ולא נעלם.',
      'הוסרו כפתורי ההזזה − ו-+ מ"הכתוביות שלי": הם לא עבדו.',
    ],
  },
  '1.4.7': {
    en: [
      'Exact subtitle timing for torrents: when the video file has a text subtitle track inside it, or the torrent ships a subtitle file for it, that one is used (no drift, no OpenSubtitles download).',
      'Videos without one still use OpenSubtitles, where the timing can be off. Use the new - and + buttons to fix a single episode.',
      'New "Use subtitles embedded in the video file" switch in Settings (on by default).',
      'Fine-tune timing per episode in My subtitles with − and + buttons (half a second each).',
    ],
    he: [
      'תזמון מדויק לטורנטים: כשבקובץ הווידאו יש מסלול כתוביות טקסט מובנה, או שהטורנט כולל קובץ כתוביות עבורו, משתמשים בו (בלי סטיות ובלי הורדה מ-OpenSubtitles).',
      'סרטונים בלי אחד כזה עדיין משתמשים ב-OpenSubtitles, ושם התזמון עלול להיות לא מדויק. אפשר לתקן פרק בודד עם כפתורי − ו-+.',
      'מתג חדש בהגדרות: "השתמש בכתוביות שמוטמעות בקובץ הווידאו" (פעיל כברירת מחדל).',
      'כוונון תזמון לכל פרק ב"הכתוביות שלי" עם כפתורי − ו-+ (חצי שנייה בכל לחיצה).',
    ],
  },
  '1.4.6': {
    en: [
      'Hebrew or English: choose the interface language in Settings. Everything follows it, including these notes and the tray menu.',
      'New "My subtitles" screen: see every translated subtitle by series, season and episode, and delete the ones you pick or all of them.',
      'The connection checks are now on the main screen.',
      'You can leave the setup wizard with Cancel when you opened it by mistake.',
      'Smarter source choice: when there is no exact file match, the subtitle whose timing most other candidates share is used, so fewer subtitles drift out of sync.',
    ],
    he: [
      'עברית או אנגלית: בחר את שפת הממשק בהגדרות. הכול עוקב אחריה, כולל ההערות האלה ותפריט המגש.',
      'מסך חדש "הכתוביות שלי": כל הכתוביות שתורגמו לפי סדרה, עונה ופרק, עם מחיקה של מה שתבחר או של הכול.',
      'בדיקות החיבור עברו למסך הראשי.',
      'אפשר לצאת מאשף ההגדרה עם "ביטול" אם נכנסת אליו בטעות.',
      'בחירת מקור חכמה יותר: כשאין התאמה מדויקת לקובץ, נבחרת הכתובית שהתזמון שלה משותף לרוב המועמדות, כך שפחות כתוביות יוצאות מסנכרון.',
    ],
  },
  '1.4.5': {
    en: [
      'New update button in the top bar: appears when an update is ready, one click installs it.',
      'Check for updates from Preferences at any time.',
      'Clear Translation Cache moved into Live status.',
      'Status messages now sit on their own line below the buttons.',
      'Cleaner, calmer look and a new app icon.',
    ],
    he: [
      'כפתור עדכון חדש בסרגל העליון: מופיע כשעדכון מוכן, ולחיצה אחת מתקינה אותו.',
      'אפשר לבדוק עדכונים בכל רגע מההגדרות.',
      'ניקוי מטמון התרגומים עבר אל מצב הפעילות.',
      'הודעות המצב מופיעות עכשיו בשורה נפרדת מתחת לכפתורים.',
      'מראה נקי ורגוע יותר ואייקון חדש לאפליקציה.',
    ],
  },
};

/**
 * What to show after startup, in the given language. `lastSeen` is the version stored the last
 * time the app ran (undefined on a fresh install, where there is nothing "new" to announce).
 */
export function pickWhatsNew(
  lastSeen: string | undefined,
  current: string,
  lang: NotesLang = 'en',
  notes: Record<string, Record<NotesLang, ReleaseNote[]>> = RELEASE_NOTES,
): WhatsNew | undefined {
  if (!lastSeen || lastSeen === current) return undefined;
  const entry = notes[current];
  const list = entry?.[lang] ?? entry?.en;
  return list && list.length > 0 ? { version: current, notes: list } : undefined;
}

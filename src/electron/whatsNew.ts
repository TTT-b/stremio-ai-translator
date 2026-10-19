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

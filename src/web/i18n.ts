import type { ErrorCode } from '../errors';

/** Language of the app's own screens. Server messages, logs and Stremio placeholders stay English. */
export type UiLang = 'he' | 'en';

export const UI_LANGS: readonly UiLang[] = ['he', 'en'];

export const isUiLang = (v: unknown): v is UiLang => v === 'he' || v === 'en';

interface Pair {
  he: string;
  en: string;
}

/** `{name}` placeholders are filled by fmt(). Text is plain (no HTML); the page escapes it. */
const S = {
  appTitle: { he: 'מתרגם כתוביות AI', en: 'AI Subtitle Translator' },
  update: { he: 'עדכן', en: 'Update' },
  updateTitle: {
    he: 'הפעל מחדש והתקן את העדכון שהורד',
    en: 'Restart and install the downloaded update',
  },
  updateInstallV: { he: 'הפעל מחדש והתקן את גרסה {v}', en: 'Restart and install version {v}' },
  minimize: { he: 'מזער', en: 'Minimize' },
  maximize: { he: 'הגדל', en: 'Maximize' },
  close: { he: 'סגור', en: 'Close' },
  exitTitle: { he: 'לסגור את החלון?', en: 'Close the window?' },
  exitBody: {
    he: 'התרגום ממשיך לעבוד ברקע (אייקון ליד השעון). אם תכבה את האפליקציה, כתוביות לא יתורגמו עד שתפתח אותה שוב.',
    en: 'Translation keeps working in the background (icon near the clock). If you turn the app off, no subtitles are translated until you open it again.',
  },
  exitTray: {
    he: 'סגור את החלון והמשך לעבוד ברקע',
    en: 'Close the window, keep working in the background',
  },
  exitQuit: { he: 'כבה את האפליקציה', en: 'Turn off the app' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  newsUpdated: { he: 'עודכן לגרסה', en: 'Updated to version' },
  newsTitle: { he: 'מה חדש', en: "What's new" },
  newsOk: { he: 'הבנתי', en: 'Got it' },
  version: { he: 'גרסה', en: 'Version' },
  checkUpdates: { he: 'בדוק עדכונים', en: 'Check for updates' },

  step1Label: { he: 'מפתח AI', en: 'AI key' },
  step1Title: { he: 'חבר ספק AI', en: 'Connect an AI provider' },
  step1Sub: {
    he: 'הדבק מפתח של Gemini, Claude או OpenAI.',
    en: 'Paste a Gemini, Claude or OpenAI key.',
  },
  step2Label: { he: 'OpenSubtitles', en: 'OpenSubtitles' },
  step2Title: { he: 'חשבון OpenSubtitles', en: 'OpenSubtitles account' },
  step2Sub: {
    he: 'נדרשים מפתח API והתחברות כדי להוריד כתוביות מקור. אפשר להוסיף גם מקור שני, SubDL (אופציונלי).',
    en: 'An API key and a login are needed to download source subtitles. You can also add a second source, SubDL (optional).',
  },
  step3Label: { he: 'שפה', en: 'Language' },
  step3Title: { he: 'שפה ותרגום כפול', en: 'Language and dual subtitles' },
  step3Sub: {
    he: 'בחר את שפת היעד ואם להציג גם את השורה המקורית.',
    en: 'Choose the target language and whether to also show the original line.',
  },
  step4Label: { he: 'בדיקה', en: 'Check' },
  step4Title: { he: 'בדוק שהכול עובד', en: 'Check that everything works' },
  step4Sub: {
    he: 'בדיקה קצרה של שני החיבורים ותרגום דוגמה.',
    en: 'A quick test of both connections and a sample translation.',
  },
  step5Label: { he: 'התקנה', en: 'Install' },
  step5Title: { he: 'התקן ב-Stremio', en: 'Install in Stremio' },
  step5Sub: {
    he: 'לחיצה אחת מוסיפה את התוסף. האפליקציה ממשיכה לעבוד ברקע גם כשהחלון סגור.',
    en: 'One click adds the add-on. The app keeps working in the background even when the window is closed.',
  },
  setupProgress: { he: 'התקדמות ההגדרה', en: 'Setup progress' },
  stepOf: { he: 'שלב {n} מתוך 5', en: 'Step {n} of 5' },

  dualLabel: {
    he: 'כתוביות כפולות (אנגלית + שפת היעד)',
    en: 'Dual subtitles (English + target language)',
  },
  dualHint: {
    he: 'השורה המקורית מוצגת מעל התרגום. חל על כתוביות שיתורגמו אחרי השמירה.',
    en: 'The original line appears above the translation. Applies to subtitles translated after saving.',
  },
  installBtn: { he: 'התקן ב-Stremio', en: 'Install in Stremio' },
  installTitle: { he: 'התקנה ב-Stremio', en: 'Install in Stremio' },
  installNote1: {
    he: 'נפתח Stremio Web בדפדפן (התחבר שם לחשבון Stremio שלך; ייתכן ש-Chrome יבקש לאשר גישה למחשב הזה – בחר Allow). אחר כך התוסף יופיע באפליקציית Stremio.',
    en: 'Stremio Web opens in your browser (sign in to your Stremio account there; Chrome may ask to allow access to this computer - choose Allow). The add-on then appears in the Stremio app.',
  },
  installOr: {
    he: 'או הדבק את הכתובת הזו ב-Stremio ← Add-ons:',
    en: 'Or paste this address in Stremio → Add-ons:',
  },
  manifestAria: { he: 'כתובת ה-manifest', en: 'Manifest address' },
  copy: { he: 'העתק', en: 'Copy' },
  copied: { he: 'כתובת ה-manifest הועתקה', en: 'Manifest address copied' },
  installNote2: {
    he: 'הכתובת עובדת במחשב הזה בלבד. האפליקציה צריכה להיות פועלת (גם ברקע, ליד השעון) בזמן הצפייה.',
    en: 'The address works on this computer only. The app must be running (in the background, near the clock is fine) while you watch.',
  },
  installNotReady: {
    he: 'נקודת הקצה של התוסף ל-Stremio עדיין לא פעילה. קישור ההתקנה יהיה:',
    en: 'The Stremio add-on endpoint is not active yet. The install link will be:',
  },

  configured: { he: 'מוגדר', en: 'Set' },
  missing: { he: 'חסר', en: 'Missing' },
  savedPh: { he: 'שמור – השאר ריק כדי לשמור', en: 'Saved - leave empty to keep' },
  pasteKeyPh: { he: 'הדבק מפתח', en: 'Paste key' },
  keptPh: { he: 'שמור', en: 'Saved' },
  free: { he: 'חינם', en: 'Free' },
  keyAiLabel: { he: 'מפתח API של ספק ה-AI', en: 'API key of the AI provider' },
  keyAiPh: { he: 'הדבק מפתח Gemini, Claude או OpenAI', en: 'Paste a Gemini, Claude or OpenAI key' },
  keyAiHelp: {
    he: 'המפתח נשמר במחשב בלבד ולא מוצג שוב. כשתמשיך, האפליקציה בודקת איזה ספק מקבל אותו.',
    en: 'The key is stored on this computer only and is never shown again. When you continue, the app checks which provider accepts it.',
  },
  savedProvider: { he: 'שמור: {p}.', en: 'Saved: {p}.' },
  getGemini: { he: 'קבל מפתח Gemini', en: 'Get a Gemini key' },
  getClaude: { he: 'קבל מפתח Claude', en: 'Get a Claude key' },
  getOpenAI: { he: 'קבל מפתח OpenAI', en: 'Get an OpenAI key' },
  osKeyLabel: { he: 'מפתח API של OpenSubtitles', en: 'OpenSubtitles API key' },
  subdlKeyLabel: {
    he: 'מפתח API של SubDL (אופציונלי)',
    en: 'SubDL API key (optional)',
  },
  subdlHint: {
    he: 'מקור שני לכתוביות כשב-OpenSubtitles אין כתובית או שההורדות להיום נגמרו. מפתח חינמי מ-subdl.com.',
    en: "A second subtitle source for when OpenSubtitles has none or today's downloads are used up. Free key from subdl.com.",
  },
  username: { he: 'שם משתמש', en: 'Username' },
  password: { he: 'סיסמה', en: 'Password' },
  osUserPh: { he: 'שם המשתמש ב-opensubtitles.com', en: 'Your opensubtitles.com username' },
  osPassPh: { he: 'הסיסמה ב-opensubtitles.com', en: 'Your opensubtitles.com password' },
  createOsAccount: { he: 'צור חשבון OpenSubtitles', en: 'Create an OpenSubtitles account' },
  getSubdlKey: { he: 'קבל מפתח API של SubDL', en: 'Get a SubDL API key' },
  getOsKey: { he: 'קבל מפתח API של OpenSubtitles', en: 'Get an OpenSubtitles API key' },
  langLabel: { he: 'שפת יעד', en: 'Target language' },

  testAi: { he: 'בדוק ספק AI', en: 'Test AI provider' },
  testOs: { he: 'בדוק OpenSubtitles', en: 'Test OpenSubtitles' },
  testSubdl: { he: 'בדוק SubDL', en: 'Test SubDL' },
  testOkSubdl: { he: 'SubDL קיבל את המפתח.', en: 'SubDL accepted the key.' },
  testSample: { he: 'תרגם דוגמה מובנית', en: 'Translate a built-in sample' },
  testBtn: { he: 'בדיקה', en: 'Test' },
  testOkAi: { he: 'מחובר. המודל הגיב.', en: 'Connected. The model replied.' },
  testOkOs: { he: 'התחברת ל-OpenSubtitles בהצלחה.', en: 'Connected to OpenSubtitles.' },
  testing: { he: 'בודק...', en: 'Testing...' },
  translating: { he: 'מתרגם...', en: 'Translating...' },
  translatedN: { he: 'תורגמו {n} שורות', en: 'Translated {n} lines' },
  translatedOk: { he: 'התרגום הצליח', en: 'Translation succeeded' },

  back: { he: 'חזרה', en: 'Back' },
  next: { he: 'המשך', en: 'Continue' },
  finish: { he: 'סיום', en: 'Finish' },
  leaveWizard: { he: 'ביטול – חזרה למסך הראשי', en: 'Cancel - back to the main screen' },
  switchLang: { he: 'English', en: 'עברית' },

  dashTitle: { he: 'הכול מוכן', en: 'All set' },
  providerLine: { he: 'ספק:', en: 'Provider:' },
  noKeyYet: { he: 'עדיין לא נשמר מפתח AI.', en: 'No AI key saved yet.' },
  settings: { he: 'הגדרות', en: 'Settings' },
  mySubs: { he: 'הכתוביות שלי', en: 'My subtitles' },
  stLines: {
    he: 'שורות כתוביות שתורגמו בסשן הזה',
    en: 'Subtitle lines translated this session',
  },
  progressDone: { he: 'הושלם: {t} שורות תורגמו', en: 'Done: {t} lines translated' },
  qTitle: { he: 'תור תרגומים', en: 'Translation queue' },
  qSeasonEp: { he: 'עונה {s} פרק {e}', en: 'S{s} E{e}' },
  qPending: {
    he: 'התקבל. לתרגם? אחרי הלחיצה בחר שוב את הכתובית ב-Stremio.',
    en: 'Received. Translate it? After you press, reselect the subtitle in Stremio.',
  },
  qQueued: { he: 'ממתין בתור', en: 'Waiting in the queue' },
  qRunning: { he: 'מתרגם...', en: 'Translating...' },
  qRunningPct: { he: 'מתרגם... {p}%', en: 'Translating... {p}%' },
  qLocal: {
    he: 'בודק אם יש כתובית בתוך הסרטון...',
    en: 'Looking for a subtitle inside the video...',
  },
  qSync: { he: 'מקשיב לקול בסרטון...', en: 'Listening to the video...' },
  qSkip: { he: 'דלג', en: 'Skip' },
  qTranslate: { he: 'תרגם', en: 'Translate' },
  qCancel: { he: 'בטל', en: 'Cancel' },
  askLabel: { he: 'שאל אותי לפני שמתרגמים', en: 'Ask me before translating' },
  askHint: {
    he: 'כשבוחרים פרק, האפליקציה אומרת "התקבל" ומחכה ללחיצה על "תרגם". בחירת פרק אחר מחליפה אותו. כבוי = מתרגם אוטומטית.',
    en: 'When you pick an episode the app says "Received" and waits for you to press Translate. Picking another episode replaces it. Off = translates automatically.',
  },
  stSize: { he: 'גודל הקבצים', en: 'File size' },
  stQuota: {
    he: 'הורדות כתוביות מ-OpenSubtitles היום',
    en: 'OpenSubtitles downloads used today',
  },
  stQuotaLow: {
    he: 'נשארו רק {n} הורדות להיום. כתוביות שכבר הורדו לא נספרות שוב.',
    en: 'Only {n} downloads left today. Subtitles already downloaded are not counted again.',
  },
  stQuotaOut: {
    he: 'המכסה היומית נגמרה. כתוביות חדשות יחכו למחר.',
    en: 'Daily limit reached. New subtitles will wait until tomorrow.',
  },
  stTarget: { he: 'שפת יעד', en: 'Target language' },
  stDual: { he: 'כתוביות כפולות', en: 'Dual subtitles' },
  on: { he: 'פעיל', en: 'On' },
  off: { he: 'כבוי', en: 'Off' },
  keepRunning: {
    he: 'אפשר לסגור את החלון: האפליקציה ממשיכה לעבוד ברקע (ליד השעון). רק "כבה את האפליקציה" עוצר אותה.',
    en: 'You can close the window: the app keeps working in the background (near the clock). Only "Turn off the app" stops it.',
  },
  privacy: {
    he: 'טקסט הכתוביות נשלח לתרגום לספק ה-AI שמתאים למפתח שלך: Google Gemini, Anthropic או OpenAI. מכסות API, חיוב ותנאי השימוש בנתונים נקבעים על ידי הספקים, לא על ידי התוסף.',
    en: 'Subtitle text is sent for translation to the AI provider that matches your key: Google Gemini, Anthropic or OpenAI. API quotas, billing and data-use terms are set by the providers, not by this add-on.',
  },
  stWaiting: { he: 'ממתין ל-Stremio...', en: 'Waiting for Stremio...' },
  stTranslating: { he: 'מתרגם...', en: 'Translating...' },
  stRate: {
    he: 'הגבלת קצב, ממתין לניסיון חוזר...',
    en: 'Rate limited, waiting to retry...',
  },
  stIdle: { he: 'מוכן – הכתובית האחרונה הסתיימה', en: 'Ready - the last subtitle finished' },
  stError: {
    he: 'התרגום האחרון נכשל – הרץ את האשף מחדש ובדוק את החיבורים',
    en: 'The last translation failed - run the wizard again and check the connections',
  },
  noSub: { he: 'אין כתובית בתרגום כרגע', en: 'No subtitle is being translated' },
  progressText: {
    he: 'תורגמו {d} מתוך {t} שורות ({p}%)',
    en: 'Translated {d} of {t} lines ({p}%)',
  },
  progressAria: { he: 'קובץ הכתוביות הנוכחי', en: 'Current subtitle file' },
  checksTitle: { he: 'בדיקות חיבור', en: 'Connection checks' },
  checksSub: {
    he: 'בדוק שהספקים מגיבים ושהתרגום עובד.',
    en: 'Check that the providers respond and translation works.',
  },

  settingsTitle: { he: 'הגדרות', en: 'Settings' },
  closeSettings: { he: 'סגור הגדרות', en: 'Close settings' },
  rowAi: { he: 'ספק AI', en: 'AI provider' },
  rowOsKey: { he: 'מפתח API של OpenSubtitles', en: 'OpenSubtitles API key' },
  rowSubdl: { he: 'מפתח API של SubDL', en: 'SubDL API key' },
  rowOsLogin: { he: 'התחברות ל-OpenSubtitles', en: 'OpenSubtitles login' },
  aiKeyLabel: { he: 'מפתח ספק AI', en: 'AI provider key' },
  rtlNote: {
    he: 'תיקון פיסוק לימין-לשמאל: {state} (אפשרות מתקדמת, ראה Troubleshooting).',
    en: 'Right-to-left punctuation fix: {state} (advanced option, see Troubleshooting).',
  },
  clearNote: {
    he: 'מחק תרגומים שמורים כדי שהכתוביות יתורגמו מחדש בפעם הבאה.',
    en: 'Delete saved translations so subtitles are translated again next time.',
  },
  clearCache: { he: 'נקה מטמון תרגומים', en: 'Clear translation cache' },
  clearOk: { he: 'מטמון התרגומים נוקה', en: 'Translation cache cleared' },
  clearFail: { he: 'לא ניתן לנקות את המטמון.', en: 'Could not clear the cache.' },
  rerun: { he: 'הרץ את האשף מחדש', en: 'Run the wizard again' },
  save: { he: 'שמור', en: 'Save' },
  uiLangLabel: { he: 'שפת הממשק', en: 'Interface language' },
  langHe: { he: 'עברית', en: 'עברית (Hebrew)' },
  langEn: { he: 'English (אנגלית)', en: 'English' },

  failed: { he: 'הבקשה נכשלה', en: 'The request failed' },
  keyErr400: { he: 'אין מה לשמור.', en: 'Nothing to save.' },
  keyErr401: {
    he: 'המפתח נדחה על ידי Google Gemini, OpenAI ו-Anthropic. לא נשמר דבר – ודא שהעתקת את כל המפתח.',
    en: 'The key was rejected by Google Gemini, OpenAI and Anthropic. Nothing was saved - make sure you copied the whole key.',
  },
  keyErr503: {
    he: 'לא ניתן לאמת את המפתח כרגע (אין תשובה ברורה מהספקים). בדוק את החיבור לאינטרנט ונסה שוב. לא נשמר דבר.',
    en: 'The key cannot be verified right now (no clear answer from the providers). Check your internet connection and try again. Nothing was saved.',
  },
  keyErrOther: {
    he: 'לא ניתן לשמור את המפתחות. ודא שתיקיית הנתונים של האפליקציה ניתנת לכתיבה.',
    en: 'The keys could not be saved. Make sure the app data folder is writable.',
  },
  verifying: { he: 'מאמת את המפתח...', en: 'Verifying the key...' },
  saving: { he: 'שומר...', en: 'Saving...' },
  verified: { he: 'המפתח אומת: {p}', en: 'Key verified: {p}' },
  saved: { he: 'נשמר', en: 'Saved' },
  settingsSaved: { he: 'ההגדרות נשמרו', en: 'Settings saved' },
  settingsInvalid: { he: 'ההגדרות לא תקינות.', en: 'The settings are not valid.' },
  pasteToContinue: { he: 'הדבק מפתח כדי להמשיך', en: 'Paste a key to continue' },
  fillOs: {
    he: 'מלא את מפתח ה-API, שם המשתמש והסיסמה',
    en: 'Fill in the API key, username and password',
  },

  updChecking: { he: 'בודק עדכונים...', en: 'Checking for updates...' },
  updNone: { he: 'הגרסה שלך עדכנית.', en: 'You are up to date.' },
  updUnavailable: {
    he: 'עדכונים עובדים רק באפליקציה המותקנת.',
    en: 'Updates only work in the installed app.',
  },
  updError: {
    he: 'לא ניתן לבדוק עדכונים. נסה שוב מאוחר יותר.',
    en: 'Could not check for updates. Try again later.',
  },
  updDownloading: { he: 'מוריד את גרסה {v}...', en: 'Downloading version {v}...' },
  updReady: {
    he: 'גרסה {v} מוכנה – לחץ על "עדכן" למעלה.',
    en: 'Version {v} is ready - click "Update" at the top.',
  },

  libTitle: { he: 'הכתוביות שלי', en: 'My subtitles' },
  libSub: {
    he: 'כל הכתוביות שתורגמו. בחר מה למחוק; נמחקות רק כתוביות התרגום, והורדות המקור נשמרות.',
    en: 'Every subtitle translated so far. Choose what to delete; only the translated subtitles are removed, the source downloads are kept.',
  },
  libBack: { he: 'חזרה למסך הראשי', en: 'Back to the main screen' },
  libEmpty: { he: 'עדיין אין כתוביות שמורות.', en: 'No saved subtitles yet.' },
  libLoadFail: { he: 'לא ניתן לטעון את הרשימה.', en: 'Could not load the list.' },
  libMovies: { he: 'סרטים', en: 'Movies' },
  libMovieCount: { he: '{n} סרטים', en: '{n} movies' },
  libSeason: { he: 'עונה {n}', en: 'Season {n}' },
  libEpisode: { he: 'פרק {n}', en: 'Episode {n}' },
  libEpisodes: { he: '{n} פרקים', en: '{n} episodes' },
  libLines: { he: '{n} שורות', en: '{n} lines' },
  libExact: { he: 'תזמון מדויק', en: 'Exact timing' },
  libEstimated: { he: 'תזמון מוערך', en: 'Estimated timing' },
  libExactTip: {
    he: 'התזמון נלקח מהסרטון עצמו, ולכן הוא תואם לו.',
    en: 'The timing comes from the video itself, so it matches it.',
  },
  libSpeech: { he: 'תזמון לפי הקול', en: 'Timing by speech' },
  libSpeechTip: {
    he: 'הכתובית הוצבה לפי הדיבור בסרטון. בדרך כלל בתוך חצי שנייה, אבל לא בהכרח בכל שורה.',
    en: 'The subtitle was placed on the speech in the video: usually within half a second, but not guaranteed for every line.',
  },
  libEstimatedTip: {
    he: 'הכתובית הורדה מ-OpenSubtitles וייתכן שהיא לגרסה אחרת של הסרטון. אם היא מוזזת, נסה סטרים אחר או הזז אותה בנגן של Stremio.',
    en: "The subtitle came from OpenSubtitles and may be for another version of the video. If it is off, try another stream or shift it in Stremio's player.",
  },
  libTotal: { he: '{n} כתוביות · {size}', en: '{n} subtitles · {size}' },
  libSelectAll: { he: 'בחר הכול', en: 'Select all' },
  libSelectNone: { he: 'נקה בחירה', en: 'Clear selection' },
  libDeleteSel: { he: 'מחק נבחרות ({n})', en: 'Delete selected ({n})' },
  libDeleteAll: { he: 'מחק הכול', en: 'Delete all' },
  libConfirmSel: { he: 'למחוק {n} כתוביות נבחרות?', en: 'Delete {n} selected subtitles?' },
  libConfirmAll: { he: 'למחוק את כל הכתוביות?', en: 'Delete all subtitles?' },
  libConfirmNote: {
    he: 'הן יתורגמו מחדש בפעם הבאה שתנגן אותן. אי אפשר לבטל.',
    en: 'They will be translated again the next time you play them. This cannot be undone.',
  },
  libDelete: { he: 'מחק', en: 'Delete' },
  libDeleted: { he: 'נמחקו {n} כתוביות', en: 'Deleted {n} subtitles' },
  embLabel: {
    he: 'השתמש בכתוביות שמוטמעות בקובץ הווידאו',
    en: 'Use subtitles embedded in the video file',
  },
  cleanLabel: {
    he: 'הסר שמות דוברים והערות קול מהכתוביות',
    en: 'Remove speaker names and sound notes from subtitles',
  },
  cleanHint: {
    he: 'למשל "קטארה:" או "(גונח)" בכתוביות שנכתבו גם לכבדי שמיעה. שורה שהיא רק הערת קול נמחקת.',
    en: 'For example "KATARA:" or "(groans)" in subtitles made for the hard of hearing. A line that is only a sound note is removed.',
  },
  embHint: {
    he: 'מתאים בדיוק לקובץ שמנגן (בלי הפרשי תזמון ובלי הורדה). עובד עם טורנטים דרך Stremio.',
    en: 'Matches the playing file exactly (no timing drift, no download). Works with torrents through Stremio.',
  },
  newsBell: { he: 'הודעות ועדכונים', en: 'News and updates' },
  newsFromCreator: { he: 'הודעות מהיוצר', en: 'Messages from the creator' },
  newsWhatsNew: { he: 'מה חדש', en: "What's new" },
  newsVersion: { he: 'גרסה {v}', en: 'Version {v}' },
  newsNew: { he: 'חדש', en: 'New' },
  newsLink: { he: 'פתח', en: 'Open' },
  newsEmptyMsgs: { he: 'אין הודעות כרגע.', en: 'No messages right now.' },
  newsOffline: {
    he: 'אין חיבור לשרת ההודעות. מוצגות הודעות שנשמרו.',
    en: 'Could not reach the message server. Showing saved messages.',
  },
  newsOlder: { he: 'הצג גרסאות קודמות ({n})', en: 'Show earlier versions ({n})' },
  newsHideOlder: { he: 'הסתר גרסאות קודמות', en: 'Hide earlier versions' },
  newsClose: { he: 'סגור', en: 'Close' },
  stageQueued: { he: 'ממתין בתור...', en: 'Waiting in line...' },
  stageLocal: {
    he: 'בודק אם יש כתובית בתוך הסרטון...',
    en: 'Checking for a subtitle inside the video...',
  },
  stageSearch: { he: 'מחפש כתובית ב-OpenSubtitles...', en: 'Searching OpenSubtitles...' },
  stageTranslate: { he: 'מתרגם...', en: 'Translating...' },
  diagBtn: { he: 'העתק פרטי אבחון', en: 'Copy diagnostics' },
  advanced: { he: 'הגדרות מתקדמות', en: 'Advanced settings' },
  secKeys: { he: 'חשבונות ומפתחות', en: 'Accounts and keys' },
  secTranslate: { he: 'תרגום', en: 'Translation' },
  secMaintenance: { he: 'תחזוקה', en: 'Maintenance' },
  diagNote: {
    he: 'אם משהו לא עובד, העתק ושלח ליוצר. אין בזה מפתחות או טקסט כתוביות.',
    en: 'If something does not work, copy this and send it to the author. It has no keys and no subtitle text.',
  },
  diagCopied: { he: 'פרטי האבחון הועתקו', en: 'Diagnostics copied' },
  srcLabel: { he: 'מקור כתוביות ראשון', en: 'First subtitle source' },
  srcOs: { he: 'OpenSubtitles (ברירת מחדל)', en: 'OpenSubtitles (default)' },
  srcSubdl: { he: 'SubDL', en: 'SubDL' },
  srcInUse: { he: 'בשימוש', en: 'In use' },
  srcBackup: { he: 'גיבוי', en: 'Backup' },
  stSubdl: { he: 'הורדות כתוביות מ-SubDL', en: 'SubDL downloads' },
  stSubdlCount: { he: '{n} בסשן הנוכחי', en: '{n} this session' },
  resumeBtn: { he: 'המשך תרגום', en: 'Continue translation' },
  resumeHint: {
    he: 'מופעל כשתרגום נתקע או בוטל: ממשיך מהמקום שנשמר, בלי לתרגם שוב מה שכבר תורגם.',
    en: 'Available when a translation is stuck or was cancelled: continues from what was saved, without translating it again.',
  },
  resumeStarted: { he: 'ממשיך את התרגום', en: 'Continuing the translation' },
  resumeNone: { he: 'אין כרגע מה להמשיך', en: 'Nothing to continue right now' },
  stSubdlPanel: { he: 'בדוק את המכסה בלוח SubDL', en: 'Check your quota in the SubDL panel' },
  stSubdlHint: {
    he: 'התוכנה לא מקבלת מ-SubDL נתון על מכסה, ולכן מוצג רק מספר ההורדות בסשן הנוכחי.',
    en: 'The app does not get a quota figure from SubDL, so only the downloads in this session are shown.',
  },
  srcHint: {
    he: 'המקור השני משמש רק כשאין כתובית במקור הראשון. SubDL דורש מפתח SubDL (בחשבונות ומפתחות), בלי מפתח משתמשים ב-OpenSubtitles. ב-SubDL התזמון פחות מדויק, ואין הורדות יומיות שנספרות מול OpenSubtitles.',
    en: 'The other source is used only when the first has no subtitle. SubDL needs a SubDL key (under Accounts and keys); without one OpenSubtitles is used. SubDL timing is less exact, and it does not use up the OpenSubtitles daily downloads.',
  },
  menuAbout: { he: 'אודות התוכנה', en: 'About' },
  aboutDesc: {
    he: 'מתרגם כתוביות ל-Stremio בעזרת AI. כאן אפשר לראות את הגרסה ולבדוק אם יש עדכון.',
    en: 'Translates subtitles for Stremio with AI. See the version here and check for updates.',
  },
  testTitle: { he: 'מצב בדיקה (למפתחים)', en: 'Test mode (for developers)' },
  testDesc: {
    he: 'מדמה תרגום בלי OpenSubtitles ובלי AI: כתובית אקראית מהדוגמאות, ובכל שורה מתווספת התחילית "HE:". עובד דרך התור האמיתי, כך שאפשר לנסות את הכפתורים והאבחון בלי לנגן סרטון. כתוביות משלך (קבצי srt) אפשר לשים בתיקייה test-subtitles שבתיקיית הנתונים של האפליקציה, ובכל בדיקה תיבחר אחת מהן באקראי.',
    en: 'Simulates a translation without OpenSubtitles or the AI: a random subtitle from the samples, with "HE:" put in front of every line. It runs through the real queue, so you can try the buttons and diagnostics without playing a video. Your own subtitle files (srt) can go in the test-subtitles folder inside the app data folder; one is picked at random each time.',
  },
  testBanner: { he: 'מצב בדיקה פעיל: אין תרגום אמיתי', en: 'Test mode is on: no real translation' },
  testOn: { he: 'הפעל מצב בדיקה', en: 'Turn on test mode' },
  testRun: { he: 'הרץ בקשת בדיקה', en: 'Run a test request' },
  testEnabled: {
    he: 'מצב בדיקה פעיל. תרגומים אמיתיים מושהים עד שתכבה אותו.',
    en: 'Test mode is on. Real translations are paused until you turn it off.',
  },
  testDisabled: { he: 'מצב בדיקה כבוי', en: 'Test mode is off' },
  testStarted: { he: 'בקשת בדיקה נוספה לתור', en: 'Test request added to the queue' },
  syncTitle: {
    he: 'דיוק מרבי: סנכרון לפי הקול (אופציונלי)',
    en: 'Maximum accuracy: sync by speech (optional)',
  },
  syncDesc: {
    he: 'מקשיב לדיבור בסרטון ומציב כל שורה בדיוק ברגע שהיא נאמרת. עובד לסרטונים באנגלית שמנוגנים דרך Stremio. בפעם הראשונה לכל פרק זה לוקח כמה דקות, ואחר כך נשמר. בלי זה התרגום מהיר יותר (בערך חצי דקה), אבל התזמון משוער.',
    en: 'Listens to the speech in the video and puts every line exactly when it is said. Works for English-language videos played through Stremio. The first time per episode takes a few minutes, then it is remembered. Without it translation is faster (about half a minute), but the timing is estimated.',
  },
  syncPrivacy: {
    he: 'הכלי חינמי, בקוד פתוח (MIT) ורץ על המחשב שלך. האודיו לא יוצא מהמחשב.',
    en: 'The tool is free, open source (MIT) and runs on your computer. The audio never leaves it.',
  },
  syncDownload: { he: 'הורד והפעל (\u2066{mb} MB\u2069)', en: 'Download and turn on ({mb} MB)' },
  syncDownloading: { he: 'מוריד... {p}%', en: 'Downloading... {p}%' },
  syncOn: { he: 'השתמש בסנכרון לפי הקול', en: 'Use precise sync by speech' },
  syncRemove: { he: 'הסר את הכלי', en: 'Remove the tool' },
  syncUnsupported: { he: 'זמין רק ב-Windows 64 ביט.', en: 'Only available on 64-bit Windows.' },
  syncFailed: { he: 'ההורדה נכשלה: {e}', en: 'The download failed: {e}' },
  syncConfirmTitle: { he: 'להוריד כלי זיהוי דיבור?', en: 'Download a speech tool?' },
  syncConfirmBody: {
    he: 'כלי חינמי (כ-\u2066{mb} MB\u2069) יורד פעם אחת מ-GitHub ומ-Hugging Face, נבדק מול סכום ביקורת, ורץ על המחשב שלך.',
    en: 'A free tool (about {mb} MB) is downloaded once from GitHub and Hugging Face, checked against a checksum, and runs on your computer.',
  },
  stageSync: { he: 'מסנכרן לפי הקול... {p}%', en: 'Syncing to the speech... {p}%' },
  libDeleteFail: { he: 'המחיקה נכשלה.', en: 'The delete failed.' },
} as const satisfies Record<string, Pair>;

export type StrKey = keyof typeof S;

/** Fill `{name}` placeholders. */
export function fmt(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function t(lang: UiLang, key: StrKey, vars?: Record<string, string | number>): string {
  return fmt(S[key][lang], vars);
}

/** The whole dictionary for one language, for the page's script. */
export function dictFor(lang: UiLang): Record<StrKey, string> {
  const out = {} as Record<StrKey, string>;
  for (const key of Object.keys(S) as StrKey[]) out[key] = S[key][lang];
  return out;
}

/** Text for the error codes the API returns. Logs and Stremio placeholders stay English. */
export const ERROR_MESSAGES: Record<UiLang, Record<ErrorCode, string>> = {
  he: {
    CONFIGURATION_INVALID: 'חסר מפתח או שההגדרה לא תקינה. הזן את המפתחות מחדש בהגדרות.',
    INVALID_API_KEY: 'הספק דחה את מפתח ה-API. הזן אותו מחדש בהגדרות.',
    PROVIDER_RATE_LIMITED: 'ספק התרגום מגביל את קצב הבקשות. נסה שוב בעוד רגע.',
    PROVIDER_QUOTA_EXCEEDED: 'הגעת למכסה או למגבלת החיוב של ספק התרגום.',
    PROVIDER_MODEL_UNAVAILABLE: 'מודל התרגום אינו זמין כרגע.',
    PROVIDER_TIMEOUT: 'ספק התרגום לא ענה בזמן או שאינו זמין כרגע.',
    PROVIDER_RESPONSE_INVALID: 'ספק התרגום החזיר תשובה לא שמישה.',
    SOURCE_AUTH_FAILED: 'ההתחברות ל-OpenSubtitles נכשלה. בדוק את המפתח, שם המשתמש והסיסמה.',
    SOURCE_QUOTA_EXCEEDED: 'הגעת למכסת ההורדות של OpenSubtitles. נסה שוב אחרי שהיא מתאפסת.',
    SOURCE_SUBTITLE_NOT_FOUND: 'לא נמצאה כתובית מקור מתאימה.',
    SOURCE_DOWNLOAD_FAILED: 'הורדת כתובית המקור נכשלה.',
    SOURCE_FILE_TOO_LARGE: 'קובץ הכתוביות גדול מהמותר.',
    UNSUPPORTED_SUBTITLE_FORMAT: 'פורמט הכתוביות אינו נתמך (רק SRT ו-WebVTT).',
    SUBTITLE_PARSE_FAILED: 'לא ניתן היה לקרוא את קובץ הכתוביות.',
    TRANSLATION_VALIDATION_FAILED: 'התרגום לא עבר בדיקת תקינות ונמחק.',
    CACHE_READ_FAILED: 'קריאת מטמון התרגומים נכשלה.',
    CACHE_WRITE_FAILED: 'כתיבה למטמון התרגומים נכשלה.',
    FINAL_SUBTITLE_INVALID: 'הכתובית הסופית לא תאמה למקור (תזמון או מספר שורות).',
    STREMIO_REQUEST_INVALID: 'הבקשה לא הייתה תקינה.',
  },
  en: {
    CONFIGURATION_INVALID:
      'A key is missing or a setting is not valid. Enter the keys again in Settings.',
    INVALID_API_KEY: 'The provider rejected the API key. Enter it again in Settings.',
    PROVIDER_RATE_LIMITED: 'The translation provider is limiting requests. Try again in a moment.',
    PROVIDER_QUOTA_EXCEEDED: 'You reached the quota or billing limit of the translation provider.',
    PROVIDER_MODEL_UNAVAILABLE: 'The translation model is not available right now.',
    PROVIDER_TIMEOUT: 'The translation provider did not answer in time or is unavailable.',
    PROVIDER_RESPONSE_INVALID: 'The translation provider returned an unusable answer.',
    SOURCE_AUTH_FAILED: 'Signing in to OpenSubtitles failed. Check the key, username and password.',
    SOURCE_QUOTA_EXCEEDED:
      'You reached the OpenSubtitles download quota. Try again after it resets.',
    SOURCE_SUBTITLE_NOT_FOUND: 'No suitable source subtitle was found.',
    SOURCE_DOWNLOAD_FAILED: 'Downloading the source subtitle failed.',
    SOURCE_FILE_TOO_LARGE: 'The subtitle file is larger than allowed.',
    UNSUPPORTED_SUBTITLE_FORMAT: 'The subtitle format is not supported (only SRT and WebVTT).',
    SUBTITLE_PARSE_FAILED: 'The subtitle file could not be read.',
    TRANSLATION_VALIDATION_FAILED: 'The translation failed validation and was discarded.',
    CACHE_READ_FAILED: 'Reading the translation cache failed.',
    CACHE_WRITE_FAILED: 'Writing to the translation cache failed.',
    FINAL_SUBTITLE_INVALID: 'The final subtitle did not match the source (timing or line count).',
    STREMIO_REQUEST_INVALID: 'The request was not valid.',
  },
};

/**
 * TEMPORARY experiment: an ASS subtitle with overlapping cues (main speaker at the bottom with
 * {\an2}, background speech at the top with {\an8}) to see how Stremio draws it. Remove after the test.
 */
export const ASS_TEST_PATH = '/sub/overlap-test.ass';

const HEADER = `[Script Info]
Title: TTT Sub overlap test
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const EVENTS: readonly (readonly [string, string, string])[] = [
  ['0:00:02.00', '0:00:12.00', '{\\an2}בדיקה 1 - הדובר הראשי: אמור להיות למטה'],
  ['0:00:04.00', '0:00:12.00', '{\\an8}בדיקה 1 - דיבור רקע: אמור להיות למעלה'],
  ['0:00:14.00', '0:00:24.00', "בדיקה 2 - שורה א' בלי הוראת מיקום"],
  ['0:00:16.00', '0:00:24.00', "בדיקה 2 - שורה ב' בלי הוראת מיקום"],
  ['0:00:26.00', '0:00:36.00', '{\\an2}בדיקה 3 - נשארו לי 50 HP, ו-MP נגמר.'],
  ['0:00:28.00', '0:00:36.00', '{\\an8}בדיקה 3 - הוא אמר Hello World.'],
];

export function assTestContent(): string {
  const lines = EVENTS.map(([s, e, t]) => `Dialogue: 0,${s},${e},Default,,0,0,0,,${t}`);
  return `${HEADER}${lines.join('\n')}\n`;
}

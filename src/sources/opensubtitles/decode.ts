import chardet from 'chardet';
import iconv from 'iconv-lite';
import { stripBom } from '../../subtitles/parse';

/** Decode subtitle bytes to a UTF-8 string: BOMs, strict UTF-8, then charset detection. */
export function decodeSubtitleBytes(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return stripBom(iconv.decode(buf, 'utf16-le'));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return stripBom(iconv.decode(buf, 'utf16-be'));
  }
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(buf));
  } catch {
    /* not valid UTF-8 - detect below */
  }
  const detected = chardet.detect(buf);
  const encoding = detected && iconv.encodingExists(detected) ? detected : 'windows-1252';
  return stripBom(iconv.decode(buf, encoding));
}

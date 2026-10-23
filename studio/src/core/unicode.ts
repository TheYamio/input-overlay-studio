// Preserve authored text exactly; never normalize away combining marks or ZWJ.
const segmenter = new Intl.Segmenter(undefined, {granularity:'grapheme'});
export const graphemes = (text:string) => Array.from(segmenter.segment(text), part=>part.segment);
export function truncateText(text:string, units:number) {
  if(text.length<=units)return text;
  let result='';
  for(const part of segmenter.segment(text)) {if(result.length+part.segment.length>units)break;result+=part.segment;}
  return result;
}
// Constant native regex: validation is called for every string in a document.
const invalidUnicode=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const validUnicode=(text:string)=>!invalidUnicode.test(text);
export const needsShaping=(text:string)=>/[\u0590-\u08ff\u0900-\u109f\u1780-\u17ff\ua980-\ua9df\uaa60-\uaa7f\ue000-\ue10f]/u.test(text);
export const textSpacing=(text:string,spacing:number)=>needsShaping(text)?0:spacing;
export const unicodeFallback='"IOS Tengwar", "IOS Noto", "IOS Arabic", "IOS Hebrew", "IOS Devanagari", "IOS Thai", "IOS Bengali", "IOS Tamil", "IOS Telugu", "IOS Gujarati", "IOS Gurmukhi", "IOS Kannada", "IOS Malayalam", "IOS Sinhala", "IOS Khmer", "IOS Lao", "IOS Myanmar", "IOS Armenian", "IOS Georgian", "IOS CJK", "IOS Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export function fontStack(family:string) {return `${['Segoe UI','Arial','Verdana','Consolas','Georgia'].includes(family)?JSON.stringify(family)+', ':''}${unicodeFallback}`;}
export function numberLocale(locale:string) {try{return Intl.NumberFormat.supportedLocalesOf([locale])[0]||'en';}catch{return 'en';}}

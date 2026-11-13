// A UTF-8 prefix misread as Latin-1/Windows-1252 must be followed by a
// continuation byte (or its Windows-1252 glyph). Genuine Ã/Â letters in
// Portuguese/French, such as VISUALIZAÇÃO and Âge, are valid text.
const corruptEncoding = /(?:[ÃÂ][\u0080-\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|ï¿½|�)/;

export function hasCorruptTextEncoding(value) {
  return corruptEncoding.test(value);
}

export function isUnchangedUtmExample(source, translation) {
  return source === translation && /^(?:utm_[a-z_]+=[a-z0-9._~-]+)(?:&utm_[a-z_]+=[a-z0-9._~-]+)*$/iu.test(source);
}

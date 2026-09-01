/**
 * Expose un Uint8Array sous forme de Buffer sans recopier son contenu.
 *
 * Les vidéos Gateway peuvent peser plusieurs dizaines de Mio. `Buffer.from(bytes)`
 * dupliquerait toute cette mémoire, tandis que cette surcharge conserve le même
 * ArrayBuffer et respecte la fenêtre byteOffset/byteLength d'origine.
 */
export function bufferFromUint8ArrayView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

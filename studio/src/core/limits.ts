// The compact document leaves room for the WebSocket envelope below 2 MB.
export const MAX_DOCUMENT_BYTES = 1_800_000;
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_MESSAGE_BYTES = 2_000_000;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

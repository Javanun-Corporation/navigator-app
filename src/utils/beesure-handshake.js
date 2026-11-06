// The rules of step 0, the BeeSure QR handshake of the LVA app. They mirror HandshakeHandler's (Fleetbase/HandshakeHandler/handshake.js) and are plain JavaScript so Jest can check them without a device.
// decodeBase64Url uses neither atob nor Buffer: Hermes and Jest's node environment provide them differently, and a decoder that leans on either passes the tests and fails on the device.

export const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
const UUID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const QR_PREFIX = 'BSQ1.';
const MAX_INPUT_LENGTH = 64;
const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// A binary string, one character per byte, or null when the text is not base64url.
export const decodeBase64Url = (text) => {
    if (typeof text !== 'string') {
        return null;
    }
    let body = text;
    for (let stripped = 0; stripped < 2 && body.endsWith('='); stripped++) {
        body = body.slice(0, -1);
    }
    if (body.length % 4 === 1) {
        return null;
    }
    let result = '';
    let buffer = 0;
    let bits = 0;
    for (let index = 0; index < body.length; index++) {
        const value = BASE64_URL_ALPHABET.indexOf(body[index]);
        if (value < 0) {
            return null;
        }
        buffer = ((buffer << 6) | value) & 0xffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return result;
};

// The validation id inside the order token (base64url(<id without dashes>:<exp>) + '.' + signature), as a dashed lower-case UUID. The signature is not checked here: the server does that.
export const validationIdFromOrderToken = (token) => {
    if (typeof token !== 'string') {
        return null;
    }
    const dot = token.indexOf('.');
    if (dot <= 0) {
        return null;
    }
    const payload = decodeBase64Url(token.slice(0, dot));
    const match = payload === null ? null : /^([0-9a-fA-F]{32}):([0-9]+)$/.exec(payload);
    if (!match) {
        return null;
    }
    const hex = match[1].toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// meta.beesure_token, where meta is order.meta or else order.attributes.meta, like the wizard.
export const readOrderToken = (order) => {
    const meta = order ? order.meta || (order.attributes ? order.attributes.meta : null) : null;
    const token = meta ? meta.beesure_token : null;
    return typeof token === 'string' && token.length > 0 ? token : null;
};

export const formatCode = (code) => `${code.slice(0, 4)} ${code.slice(4)}`;

export const isBeeSureQr = (text) => typeof text === 'string' && text.trim().toUpperCase().startsWith(QR_PREFIX);

// { ok: true, code } or { ok: false, reason: 'invalid' | 'other_order' }, with HS2's rules. The server parses the raw text again.
export const normaliseHandshakeInput = (text, validationId) => {
    if (typeof text !== 'string' || text.length > MAX_INPUT_LENGTH) {
        return { ok: false, reason: 'invalid' };
    }
    const upper = text.trim().toUpperCase();
    if (upper.startsWith(QR_PREFIX)) {
        const parts = upper.split('.');
        if (parts.length !== 3 || !UUID_PATTERN.test(parts[1]) || !CODE_PATTERN.test(parts[2])) {
            return { ok: false, reason: 'invalid' };
        }
        if (parts[1] !== validationId.toUpperCase()) {
            return { ok: false, reason: 'other_order' };
        }
        return { ok: true, code: parts[2] };
    }
    const typed = upper.replace(/[\s-]/g, '');
    return CODE_PATTERN.test(typed) ? { ok: true, code: typed } : { ok: false, reason: 'invalid' };
};

// One slash between the base (the HandshakeUrl stack output) and the path, whether or not the base ends with one.
export const handshakeUrl = (base, validationId, action) => `${base.replace(/\/+$/, '')}/handshake/${validationId}/${action}`;

// The body's error text when the body is JSON whose error and code are both strings, else null.
export const serverErrorMessage = (bodyText) => {
    try {
        const body = JSON.parse(bodyText);
        return body && typeof body.error === 'string' && typeof body.code === 'string' ? body.error : null;
    } catch (error) {
        return null;
    }
};

// What step 0 does with one HandshakeHandler answer.
export const handshakeOutcome = (status, body) => {
    const code = body && typeof body.code === 'string' ? body.code : null;
    if (status === 200 && body) {
        if (body.selfValidation === false) {
            return { kind: 'skip' };
        }
        return body.met === true ? { kind: 'met' } : { kind: 'state', state: body };
    }
    if (status === 409 && code === 'already_submitted') {
        return { kind: 'advance' };
    }
    const message = body && typeof body.error === 'string' ? body.error : `The BeeSure handshake failed (HTTP ${status}). Try again.`;
    if (status === 409 && (code === 'report_expired' || code === 'handshake_driver_mismatch')) {
        return { kind: 'stop', message };
    }
    return { kind: 'error', message };
};

// Applies one answer to the panel without ever moving it back: the code and QR content stay when the answer lacks them (the lva-scan answer has neither), and a scanned flag or Met that was true stays true, so a poll answered after a scan does nothing.
export const mergeHandshakeState = (previous, next) => {
    if (!previous) {
        return next;
    }
    return {
        ...next,
        lvaCode: next.lvaCode || previous.lvaCode,
        qrContent: next.qrContent || previous.qrContent,
        userScanned: Boolean(previous.userScanned || next.userScanned),
        lvaScanned: Boolean(previous.lvaScanned || next.lvaScanned),
        met: Boolean(previous.met || next.met),
    };
};

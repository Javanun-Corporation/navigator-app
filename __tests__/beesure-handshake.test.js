import { Buffer } from 'buffer';
import crypto from 'crypto';
import { CODE_PATTERN, decodeBase64Url, formatCode, handshakeOutcome, handshakeUrl, isBeeSureQr, mergeHandshakeState, normaliseHandshakeInput, readOrderToken, serverErrorMessage, validationIdFromOrderToken } from '../src/utils/beesure-handshake';

const ID = '8f14e45f-ceea-467a-9af6-1c0c3d0a1b11';

// Builds a token the way issueOrderToken (Fleetbase/HandshakeHandler/orderToken.js) does: base64url(payload) + '.' + base64url(HMAC-SHA256(secret, payload)).
const base64Url = (buffer) => Buffer.from(buffer).toString('base64url');
const makeToken = (validationId, exp = 1893456000, secret = 'test-secret') => {
    const payload = `${validationId.replace(/-/g, '').toLowerCase()}:${exp}`;
    const signature = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(payload, 'utf8').digest();
    return `${base64Url(Buffer.from(payload, 'utf8'))}.${base64Url(signature)}`;
};
const tokenFor = (payload) => `${base64Url(Buffer.from(payload, 'utf8'))}.sig`;

describe('CODE_PATTERN', () => {
    test('matches eight characters of the handshake alphabet only', () => {
        expect(CODE_PATTERN.test('K7M2QX9D')).toBe(true);
        expect(CODE_PATTERN.test('K7M2QX9')).toBe(false);
        expect(CODE_PATTERN.test('K7M2QX9O')).toBe(false);
    });
});

describe('decodeBase64Url', () => {
    test('decodes padded and unpadded text', () => {
        expect(decodeBase64Url('aGk')).toBe('hi');
        expect(decodeBase64Url('aGk=')).toBe('hi');
    });

    test('maps - and _', () => {
        const decoded = decodeBase64Url('-_8');
        expect(Array.from(decoded).map((character) => character.charCodeAt(0))).toEqual([251, 255]);
    });

    test('returns null for bad input', () => {
        ['a+b', 'a/b', 'a b', 'a', 'a=Gk', 'aGk==='].forEach((text) => {
            expect(decodeBase64Url(text)).toBeNull();
        });
    });

    test('does not use atob or Buffer', () => {
        const savedAtob = global.atob;
        const savedBuffer = global.Buffer;
        global.atob = undefined;
        global.Buffer = undefined;
        try {
            expect(decodeBase64Url('aGk')).toBe('hi');
        } finally {
            global.atob = savedAtob;
            global.Buffer = savedBuffer;
        }
    });
});

describe('validationIdFromOrderToken', () => {
    test('gives the dashed lower-case id of a token made like issueOrderToken', () => {
        expect(validationIdFromOrderToken(makeToken(ID))).toBe(ID);
    });

    test('lower-cases an id written in upper-case hex', () => {
        expect(validationIdFromOrderToken(tokenFor(`${ID.replace(/-/g, '').toUpperCase()}:1893456000`))).toBe(ID);
    });

    test('gives null for anything that is not a token', () => {
        const hex31 = ID.replace(/-/g, '').slice(1);
        [
            'abc',
            '.sig',
            tokenFor(`${ID.replace(/-/g, '')}-1893456000`),
            tokenFor(`${hex31}:1893456000`),
            '***.sig',
            null,
            undefined,
            42,
        ].forEach((token) => {
            expect(validationIdFromOrderToken(token)).toBeNull();
        });
    });
});

describe('readOrderToken', () => {
    test('reads meta.beesure_token', () => {
        expect(readOrderToken({ meta: { beesure_token: 't' } })).toBe('t');
    });

    test('reads attributes.meta.beesure_token when the order has no meta', () => {
        expect(readOrderToken({ attributes: { meta: { beesure_token: 't2' } } })).toBe('t2');
    });

    test('gives null for no token and an empty token', () => {
        expect(readOrderToken({})).toBeNull();
        expect(readOrderToken({ meta: { beesure_token: '' } })).toBeNull();
    });

    test('does not fall back to attributes.meta when meta exists, like the wizard', () => {
        expect(readOrderToken({ meta: {}, attributes: { meta: { beesure_token: 't3' } } })).toBeNull();
    });
});

describe('formatCode', () => {
    test('splits the code into two groups of four', () => {
        expect(formatCode('K7M2QX9D')).toBe('K7M2 QX9D');
    });
});

describe('isBeeSureQr', () => {
    test('accepts text that starts with BSQ1. in any case after trimming', () => {
        expect(isBeeSureQr(' bsq1.x ')).toBe(true);
        expect(isBeeSureQr('BSQ1.')).toBe(true);
    });

    test('rejects other text', () => {
        expect(isBeeSureQr('https://fleetbase.io/x')).toBe(false);
        expect(isBeeSureQr(null)).toBe(false);
    });
});

describe('normaliseHandshakeInput', () => {
    test.each([
        ['K7M2QX9D'],
        [' k7m2-qx9d '],
        ['K7M2 QX9D'],
        [`BSQ1.${ID.toUpperCase()}.K7M2QX9D`],
        [`bsq1.${ID}.k7m2qx9d`],
    ])('accepts %s', (text) => {
        expect(normaliseHandshakeInput(text, ID)).toEqual({ ok: true, code: 'K7M2QX9D' });
    });

    test.each([
        ['K7M2QX9'],
        ['K7M2QX9O'],
        ['K7M2QX91'],
        ['A'.repeat(65)],
        ['BSQ1.not-a-uuid.K7M2QX9D'],
        [`BSQ2.${ID}.K7M2QX9D`],
        [null],
    ])('refuses %s as invalid', (text) => {
        expect(normaliseHandshakeInput(text, ID)).toEqual({ ok: false, reason: 'invalid' });
    });

    test('refuses the QR of another order', () => {
        expect(normaliseHandshakeInput('BSQ1.0B2A1C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D.K7M2QX9D', ID)).toEqual({ ok: false, reason: 'other_order' });
    });
});

describe('handshakeUrl', () => {
    const expected = `https://x.lambda-url.us-east-1.on.aws/handshake/${ID}/lva-code`;

    test('gives one slash whether or not the base ends with one', () => {
        expect(handshakeUrl('https://x.lambda-url.us-east-1.on.aws/', ID, 'lva-code')).toBe(expected);
        expect(handshakeUrl('https://x.lambda-url.us-east-1.on.aws', ID, 'lva-code')).toBe(expected);
        expect(handshakeUrl('https://x.lambda-url.us-east-1.on.aws//', ID, 'lva-code')).toBe(expected);
    });

    test('names the action', () => {
        expect(handshakeUrl('https://x/', ID, 'lva-scan')).toBe(`https://x/handshake/${ID}/lva-scan`);
    });
});

describe('serverErrorMessage', () => {
    test('gives the error of a coded body', () => {
        expect(serverErrorMessage('{"error":"E","code":"c"}')).toBe('E');
    });

    test('gives null for a body without a string error and a string code, and for text that is not JSON', () => {
        expect(serverErrorMessage('{"error":"E"}')).toBeNull();
        expect(serverErrorMessage('{"error":1,"code":"c"}')).toBeNull();
        expect(serverErrorMessage('not json')).toBeNull();
        expect(serverErrorMessage('')).toBeNull();
    });
});

describe('handshakeOutcome', () => {
    test('200 not Met gives the state', () => {
        const body = { met: false, selfValidation: true, lvaScanned: false };
        expect(handshakeOutcome(200, body)).toEqual({ kind: 'state', state: body });
    });

    test('200 Met gives met', () => {
        expect(handshakeOutcome(200, { met: true, selfValidation: true })).toEqual({ kind: 'met' });
    });

    test('200 with selfValidation false gives skip, Met or not', () => {
        expect(handshakeOutcome(200, { met: false, selfValidation: false })).toEqual({ kind: 'skip' });
        expect(handshakeOutcome(200, { met: true, selfValidation: false })).toEqual({ kind: 'skip' });
    });

    test('409 already_submitted advances', () => {
        expect(handshakeOutcome(409, { code: 'already_submitted', error: 'A' })).toEqual({ kind: 'advance' });
    });

    test('409 report_expired stops', () => {
        expect(handshakeOutcome(409, { code: 'report_expired', error: 'E' })).toEqual({ kind: 'stop', message: 'E' });
    });

    test('409 handshake_driver_mismatch stops', () => {
        expect(handshakeOutcome(409, { code: 'handshake_driver_mismatch', error: 'D' })).toEqual({ kind: 'stop', message: 'D' });
    });

    test('400 invalid_code gives the server message', () => {
        expect(handshakeOutcome(400, { code: 'invalid_code', error: 'I' })).toEqual({ kind: 'error', message: 'I' });
    });

    test('401 without a code gives the server message', () => {
        expect(handshakeOutcome(401, { error: 'Invalid or missing order token' })).toEqual({ kind: 'error', message: 'Invalid or missing order token' });
    });

    test('500 without a body gives the generic message', () => {
        expect(handshakeOutcome(500, null)).toEqual({ kind: 'error', message: 'The BeeSure handshake failed (HTTP 500). Try again.' });
    });
});

describe('mergeHandshakeState', () => {
    test('merge keeps scanned flags and Met once set', () => {
        const previous = { lvaCode: 'K7M2QX9D', qrContent: 'BSQ1.X.K7M2QX9D', lvaScanned: true, userScanned: false, met: false };
        const merged = mergeHandshakeState(previous, { lvaScanned: false, userScanned: true, met: false });
        expect(merged.lvaScanned).toBe(true);
        expect(merged.userScanned).toBe(true);
        expect(merged.met).toBe(false);
        expect(merged.lvaCode).toBe('K7M2QX9D');
        expect(merged.qrContent).toBe('BSQ1.X.K7M2QX9D');
        expect(mergeHandshakeState({ ...previous, met: true }, { met: false }).met).toBe(true);
    });

    test('takes the code and QR content of the newer answer when it has them', () => {
        const merged = mergeHandshakeState({ lvaCode: 'AAAAAAAA', qrContent: 'old' }, { lvaCode: 'BBBBBBBB', qrContent: 'new' });
        expect(merged.lvaCode).toBe('BBBBBBBB');
        expect(merged.qrContent).toBe('new');
    });

    test('a null previous gives next', () => {
        const next = { lvaScanned: false, userScanned: false, met: false };
        expect(mergeHandshakeState(null, next)).toBe(next);
    });
});

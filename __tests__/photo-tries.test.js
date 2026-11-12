import { createTryUploader, photoTryUrl, MAX_TRY_SENDS } from '../src/utils/photo-tries';

const PRESIGN_URL = 'https://presign.test/';
const TRY_URL = 'https://complete.test/photo-tries';
const TRY = { role: 'lva_id', uri: 'file:///front-1.jpg', tryNo: 1, kept: false, check: { attempt: 1, result: 'fail_shape', faceCount: 0, width: 1920, height: 1080, ratio: 1.778 } };
// plan: presign / put / record are lists of outcomes taken in order ('ok' when the list runs out); a presign outcome may be { status, body }.
const makeFetch = (plan = {}) => {
    const calls = [];
    const take = (name) => (plan[name] && plan[name].length ? plan[name].shift() : 'ok');
    let minted = 0;
    const fetchFn = jest.fn(async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });
        if (url.startsWith('file://')) return { ok: true, blob: async () => ({ type: 'image/jpeg' }) };
        if (url === PRESIGN_URL) {
            const outcome = take('presign');
            if (outcome !== 'ok') return { ok: false, status: outcome.status, text: async () => outcome.body || '' };
            minted += 1;
            const role = JSON.parse(init.body).roles[0];
            return { ok: true, json: async () => ({ presignedData: [{ role, uploadUrl: `https://s3.test/put/${minted}`, key: `reports/r/v/tries/${minted}/${role}.jpg` }] }) };
        }
        if (url.startsWith('https://s3.test/put/')) return { ok: take('put') === 'ok' };
        if (url === TRY_URL) return { ok: take('record') === 'ok', status: 500, text: async () => '' };
        throw new Error(`unexpected url ${url}`);
    });
    return { fetchFn, calls };
};
const uploader = (fetchFn) => createTryUploader({ presignUrl: PRESIGN_URL, tryUrl: TRY_URL, orderToken: 'token-1', fetchFn, wait: async () => {} });
const to = (calls, url) => calls.filter((c) => c.url === url || c.url.startsWith(url));

describe('photo tries uploader', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        console.warn.mockRestore();
    });

    it('photoTryUrl appends photo-tries with or without a trailing slash', () => {
        expect(photoTryUrl('https://x.test')).toBe('https://x.test/photo-tries');
        expect(photoTryUrl('https://x.test/')).toBe('https://x.test/photo-tries');
        expect(photoTryUrl('https://x.test//')).toBe('https://x.test/photo-tries');
    });

    it('add presigns one try key, uploads the photo, and records the try', async () => {
        const { fetchFn, calls } = makeFetch();
        await uploader(fetchFn).add(TRY);
        const presign = to(calls, PRESIGN_URL);
        expect(presign).toHaveLength(1);
        expect(presign[0].method).toBe('POST');
        expect(presign[0].headers['X-BeeSure-Order-Token']).toBe('token-1');
        expect(presign[0].body).toBe(JSON.stringify({ roles: ['lva_id'], tries: true }));
        const puts = to(calls, 'https://s3.test/put/');
        expect(puts).toHaveLength(1);
        expect(puts[0].url).toBe('https://s3.test/put/1');
        expect(puts[0].method).toBe('PUT');
        const record = to(calls, TRY_URL);
        expect(record).toHaveLength(1);
        expect(record[0].body).toBe(JSON.stringify({ role: 'lva_id', key: 'reports/r/v/tries/1/lva_id.jpg', tryNo: 1, kept: false, phoneCheck: TRY.check }));
    });

    it('add retries a failed send and never rejects', async () => {
        const { fetchFn, calls } = makeFetch({ presign: [{ status: 500 }, { status: 500 }, { status: 500 }] });
        await expect(uploader(fetchFn).add(TRY)).resolves.toBeUndefined();
        expect(to(calls, PRESIGN_URL)).toHaveLength(MAX_TRY_SENDS);
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('a retry after a failed record does not upload the photo again', async () => {
        const { fetchFn, calls } = makeFetch({ record: ['fail', 'ok'] });
        await uploader(fetchFn).add(TRY);
        expect(to(calls, PRESIGN_URL)).toHaveLength(1);
        expect(to(calls, 'https://s3.test/put/')).toHaveLength(1);
        expect(to(calls, TRY_URL)).toHaveLength(2);
    });

    it('keyFor answers the uploaded key and makes no request', async () => {
        const { fetchFn } = makeFetch();
        const up = uploader(fetchFn);
        await up.add(TRY);
        const before = fetchFn.mock.calls.length;
        await expect(up.keyFor('lva_id', TRY.uri)).resolves.toBe('reports/r/v/tries/1/lva_id.jpg');
        expect(fetchFn.mock.calls.length).toBe(before);
    });

    it('keyFor uploads now when the background sends failed', async () => {
        const { fetchFn } = makeFetch({ presign: [{ status: 500 }, { status: 500 }, { status: 500 }] });
        const up = uploader(fetchFn);
        await up.add(TRY);
        await expect(up.keyFor('lva_id', TRY.uri)).resolves.toBe('reports/r/v/tries/1/lva_id.jpg');
    });

    it("keyFor rejects with the server's message, or today's fallback", async () => {
        const body = JSON.stringify({ error: 'This validation passed its deadline.', code: 'report_expired' });
        const refused = makeFetch({ presign: [{ status: 409, body }] });
        await expect(uploader(refused.fetchFn).keyFor('lva_id', TRY.uri)).rejects.toThrow('This validation passed its deadline.');
        const failed = makeFetch({ presign: [{ status: 500 }] });
        await expect(uploader(failed.fetchFn).keyFor('lva_id', TRY.uri)).rejects.toThrow('Failed to fetch pre-signed URLs (HTTP 500).');
        const putRefused = makeFetch({ put: ['fail'] });
        await expect(uploader(putRefused.fetchFn).keyFor('lva_id', TRY.uri)).rejects.toThrow('S3 Upload failed for lva_id');
    });

    it('keyFor uploads a photo it never saw and records no try', async () => {
        const { fetchFn, calls } = makeFetch();
        const key = await uploader(fetchFn).keyFor('lva_face', 'file:///face-9.jpg');
        expect(key).toBe('reports/r/v/tries/1/lva_face.jpg');
        expect(to(calls, TRY_URL)).toHaveLength(0);
    });

    it('keyFor waits for an upload in flight instead of uploading twice', async () => {
        const { fetchFn, calls } = makeFetch();
        const up = uploader(fetchFn);
        const adding = up.add(TRY);
        const keying = up.keyFor('lva_id', TRY.uri);
        const [, key] = await Promise.all([adding, keying]);
        expect(key).toBe('reports/r/v/tries/1/lva_id.jpg');
        expect(to(calls, PRESIGN_URL)).toHaveLength(1);
        expect(to(calls, 'https://s3.test/put/')).toHaveLength(1);
    });

    it('keyFor does not wait for the record call or a retry wait', async () => {
        const { fetchFn } = makeFetch({ record: ['fail', 'fail', 'fail'] });
        const up = createTryUploader({ presignUrl: PRESIGN_URL, tryUrl: TRY_URL, orderToken: 'token-1', fetchFn, wait: () => new Promise(() => {}) });
        up.add(TRY);
        await expect(up.keyFor('lva_id', TRY.uri)).resolves.toBe('reports/r/v/tries/1/lva_id.jpg');
    });

    it('a request that never answers is given up after the timeout', async () => {
        const fetchFn = jest.fn((url, init = {}) => {
            if (url === PRESIGN_URL) {
                return new Promise((resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
                });
            }
            throw new Error(`unexpected url ${url}`);
        });
        const up = createTryUploader({ presignUrl: PRESIGN_URL, tryUrl: TRY_URL, orderToken: 'token-1', fetchFn, wait: async () => {}, requestTimeoutMs: 10 });
        await expect(up.add(TRY)).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });
});

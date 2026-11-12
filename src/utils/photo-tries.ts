import { serverErrorMessage } from './beesure-handshake';
import type { PhoneCheck } from './photo-capture';

// A photo try is one photo the LVA took for a role, kept or not, with the phone's check of it. The uploader sends every try to the backend in the background and answers the uploaded key of a photo at submit.
// Nothing here may throw into the capture flow (PT4): add never rejects, and only keyFor, which the submit awaits, rejects.
// MAX_TRY_SENDS, TRY_RETRY_DELAY_MS and TRY_REQUEST_TIMEOUT_MS are first picks, each one named constant, to be tuned after testing.

export type TryRole = 'lva_face' | 'lva_id' | 'lva_id_back';
export type PhotoTry = { role: TryRole; uri: string; tryNo: number; kept: boolean; check: PhoneCheck };
export type TryUploader = { add: (photoTry: PhotoTry) => Promise<void>; keyFor: (role: TryRole, uri: string) => Promise<string> };

export const MAX_TRY_SENDS = 3;
export const TRY_RETRY_DELAY_MS = 3000;
export const TRY_REQUEST_TIMEOUT_MS = 30000;

export const photoTryUrl = (validationCompleteUrl: string): string => `${validationCompleteUrl.replace(/\/+$/, '')}/photo-tries`;

// own is true while the upload in flight is one keyFor started, which has no time limit.
type UploadState = { key: string | null; uploading: Promise<string> | null; own: boolean };

export const createTryUploader = (config: {
    presignUrl: string;
    tryUrl: string;
    orderToken: string;
    fetchFn?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
    requestTimeoutMs?: number;
}): TryUploader => {
    const { presignUrl, tryUrl, orderToken } = config;
    const fetchFn = config.fetchFn || fetch;
    const wait = config.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const requestTimeoutMs = config.requestTimeoutMs ?? TRY_REQUEST_TIMEOUT_MS;
    const states = new Map<string, UploadState>();
    const jsonHeaders = { 'Content-Type': 'application/json', 'X-BeeSure-Order-Token': orderToken };

    // A background request carries a signal that aborts after the timeout, and the timer runs until read has consumed the response body, so a request that never answers or a body that stalls counts as a failed one. The submit's own requests (bounded false) have no limit, so a slow connection never fails the submit.
    const request = async <T>(url: string, init: RequestInit, read: (res: Response) => Promise<T>, bounded: boolean): Promise<T> => {
        if (!bounded) {
            return read(await fetchFn(url, init));
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            return await read(await fetchFn(url, { ...init, signal: controller.signal }));
        } finally {
            clearTimeout(timer);
        }
    };

    const uploadPhoto = async (role: TryRole, uri: string, bounded: boolean): Promise<string> => {
        const presigned = await request(
            presignUrl,
            { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ roles: [role], tries: true }) },
            async (res) => {
                if (!res.ok) {
                    const bodyText = await res.text().catch(() => '');
                    console.warn('Presign request failed:', res.status, bodyText);
                    throw new Error(serverErrorMessage(bodyText) || `Failed to fetch pre-signed URLs (HTTP ${res.status}).`);
                }
                const { presignedData } = await res.json();
                return presignedData.find((p: { role: string }) => p.role === role);
            },
            bounded
        );
        if (!presigned) {
            throw new Error(`Missing photo or presigned URL for ${role}.`);
        }
        const blob = await request(uri, {}, (res) => res.blob(), bounded);
        const putOk = await request(presigned.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } }, async (res) => res.ok, bounded);
        if (!putOk) {
            throw new Error(`S3 Upload failed for ${role}`);
        }
        return presigned.key;
    };

    const stateFor = (uri: string): UploadState => {
        let state = states.get(uri);
        if (!state) {
            state = { key: null, uploading: null, own: false };
            states.set(uri, state);
        }
        return state;
    };

    // Starts the one upload of a photo that has none in flight. The caller has checked that state.key and state.uploading are empty.
    const startUpload = (state: UploadState, role: TryRole, uri: string, own: boolean): Promise<string> => {
        state.own = own;
        const uploading = uploadPhoto(role, uri, !own).then(
            (key) => {
                state.key = key;
                state.uploading = null;
                state.own = false;
                return key;
            },
            (error) => {
                state.uploading = null;
                state.own = false;
                throw error;
            }
        );
        state.uploading = uploading;
        return uploading;
    };

    // The background send: answers the key of an uploaded photo, joins an upload in flight, or starts one with the time limit.
    const ensureUploaded = (role: TryRole, uri: string): Promise<string> => {
        const state = stateFor(uri);
        if (state.key) {
            return Promise.resolve(state.key);
        }
        return state.uploading || startUpload(state, role, uri, false);
    };

    // The submit's answer: an uploaded photo's key with no request, otherwise an upload with no time limit. A background upload it joins that then fails does not fail the submit: it takes over with an upload of its own, unless another one has been started meanwhile, which it joins in turn.
    const keyFor = async (role: TryRole, uri: string): Promise<string> => {
        for (;;) {
            const state = stateFor(uri);
            if (state.key) {
                return state.key;
            }
            if (!state.uploading) {
                return startUpload(state, role, uri, true);
            }
            if (state.own) {
                return state.uploading;
            }
            try {
                return await state.uploading;
            } catch {
                // The joined background upload failed; look again.
            }
        }
    };

    const send = async (photoTry: PhotoTry): Promise<void> => {
        const key = await ensureUploaded(photoTry.role, photoTry.uri);
        const status = await request(
            tryUrl,
            { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ role: photoTry.role, key, tryNo: photoTry.tryNo, kept: photoTry.kept, phoneCheck: photoTry.check }) },
            async (res) => (res.ok ? null : res.status),
            true
        );
        if (status !== null) {
            throw new Error(`Recording the photo try failed (HTTP ${status}).`);
        }
    };

    const add = async (photoTry: PhotoTry): Promise<void> => {
        let lastError: unknown = null;
        for (let sendNo = 1; sendNo <= MAX_TRY_SENDS; sendNo++) {
            try {
                await send(photoTry);
                return;
            } catch (error) {
                lastError = error;
                if (sendNo < MAX_TRY_SENDS) {
                    await wait(TRY_RETRY_DELAY_MS);
                }
            }
        }
        console.warn('Photo try could not be sent:', photoTry.role, photoTry.tryNo, lastError);
    };

    return { add, keyFor };
};

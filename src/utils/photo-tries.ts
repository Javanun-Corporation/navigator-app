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

type UploadState = { key: string | null; uploading: Promise<string> | null };

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

    // Every request carries a signal that aborts after the timeout, so a request that never answers counts as a failed one.
    const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            return await fetchFn(url, { ...init, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    };

    const uploadPhoto = async (role: TryRole, uri: string): Promise<string> => {
        const presignRes = await request(presignUrl, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ roles: [role], tries: true }) });
        if (!presignRes.ok) {
            const bodyText = await presignRes.text().catch(() => '');
            throw new Error(serverErrorMessage(bodyText) || `Failed to fetch pre-signed URLs (HTTP ${presignRes.status}).`);
        }
        const { presignedData } = await presignRes.json();
        const presigned = presignedData.find((p: { role: string }) => p.role === role);
        if (!presigned) throw new Error(`Missing presigned URL for ${role}.`);
        const blob = await (await request(uri)).blob();
        const putRes = await request(presigned.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } });
        if (!putRes.ok) throw new Error(`S3 Upload failed for ${role}`);
        return presigned.key;
    };

    // Answers the key of an uploaded photo, joins an upload in flight, or starts one.
    const ensureUploaded = (role: TryRole, uri: string): Promise<string> => {
        let state = states.get(uri);
        if (!state) {
            state = { key: null, uploading: null };
            states.set(uri, state);
        }
        if (state.key) return Promise.resolve(state.key);
        if (state.uploading) return state.uploading;
        const current = state;
        current.uploading = uploadPhoto(role, uri).then(
            (key) => {
                current.key = key;
                current.uploading = null;
                return key;
            },
            (error) => {
                current.uploading = null;
                throw error;
            }
        );
        return current.uploading;
    };

    const send = async (photoTry: PhotoTry): Promise<void> => {
        const key = await ensureUploaded(photoTry.role, photoTry.uri);
        const res = await request(tryUrl, {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ role: photoTry.role, key, tryNo: photoTry.tryNo, kept: photoTry.kept, phoneCheck: photoTry.check }),
        });
        if (!res.ok) throw new Error(`Recording the photo try failed (HTTP ${res.status}).`);
    };

    const add = async (photoTry: PhotoTry): Promise<void> => {
        let lastError: unknown = null;
        for (let sendNo = 1; sendNo <= MAX_TRY_SENDS; sendNo++) {
            try {
                await send(photoTry);
                return;
            } catch (error) {
                lastError = error;
                if (sendNo < MAX_TRY_SENDS) await wait(TRY_RETRY_DELAY_MS);
            }
        }
        console.warn('Photo try could not be sent:', photoTry.role, photoTry.tryNo, lastError);
    };

    return { add, keyFor: ensureUploaded };
};

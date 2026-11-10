import { Image } from 'react-native';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import { detectFaces } from 'react-native-vision-camera-face-detector';

// The phone's basic photo checks and the downscale. Nothing here says whether an ID is genuine: a check only asks whether a scan has the shape of an ID card and, for the front, shows at least one face.
// The face photo's check is the live camera's (FaceAutoCaptureCamera captures only when exactly one face is in view, IC18), so this module has no face-photo check.
// The tolerance, ID_FRONT_MIN_FACE_SIZE and the attempt default are first picks, each one named constant, to be tuned after testing with real data (IC5).

export const MAX_EDGE = 1920;
export const JPEG_QUALITY = 90;
export const ID1_RATIO = 85.6 / 53.98;
export const ID1_RATIO_TOLERANCE = 0.12;
export const ID_FRONT_MIN_FACE_SIZE = 0.05;
export const DEFAULT_PHOTO_MAX_ATTEMPTS = 3;

export type PhoneCheckResult = 'pass' | 'fail_no_face' | 'fail_shape' | 'error';

export type PhoneCheck = {
    attempt: number;
    result: PhoneCheckResult;
    faceCount: number | null;
    width: number | null;
    height: number | null;
    ratio: number | null;
};

export type ShrunkPhoto = {
    uri: string;
    width: number | null;
    height: number | null;
};

const FACE_MESSAGE = 'We could not find a face on the ID front. Scan the whole front of the ID, flat and in good light, with its photo clearly visible and nothing else in the frame.';
const SHAPE_MESSAGE = 'This does not look like a whole ID card. Scan the card flat and edge to edge, with nothing else in the frame.';

// The size the platform reports for a photo, or null sizes when it cannot read it.
const readSize = (uri: string): Promise<{ width: number | null; height: number | null }> =>
    new Promise((resolve) => {
        try {
            Image.getSize(
                uri,
                (width: number, height: number) => resolve({ width, height }),
                () => resolve({ width: null, height: null })
            );
        } catch (error) {
            resolve({ width: null, height: null });
        }
    });

// Shrinks a photo to at most MAX_EDGE px on the long edge as a JPEG. onlyScaleDown keeps a small photo at its size, and dropping the metadata (keepMeta false) is safe because the Android resizer applies the EXIF rotation before it scales.
// If the resizer throws, the original photo is kept with the size from Image.getSize, or null sizes when that fails too.
export const shrinkPhoto = async (uri: string): Promise<ShrunkPhoto> => {
    try {
        const resized = await ImageResizer.createResizedImage(uri, MAX_EDGE, MAX_EDGE, 'JPEG', JPEG_QUALITY, 0, undefined, false, { mode: 'contain', onlyScaleDown: true });
        return { uri: resized.uri, width: resized.width, height: resized.height };
    } catch (error) {
        const size = await readSize(uri);
        return { uri, width: size.width, height: size.height };
    }
};

export const cardRatio = (width: number, height: number): number => Math.max(width, height) / Math.min(width, height);

export const isId1Shape = (width: number, height: number): boolean => Math.abs(cardRatio(width, height) - ID1_RATIO) / ID1_RATIO <= ID1_RATIO_TOLERANCE;

// The number of faces the still-image detector finds, or null when it throws or answers with something other than a list (the native module missing).
export const countFaces = async (uri: string): Promise<number | null> => {
    try {
        const faces = await detectFaces({
            image: { uri },
            options: { performanceMode: 'accurate', landmarkMode: 'none', contourMode: 'none', classificationMode: 'none', minFaceSize: ID_FRONT_MIN_FACE_SIZE, trackingEnabled: false },
        });
        return Array.isArray(faces) ? faces.length : null;
    } catch (error) {
        return null;
    }
};

// The shape test runs first. The front's face count is always taken so it is recorded, and one face or more passes (a second, ghost portrait never fails the front, IC18). The back has no face check.
export const checkIdPhoto = async (side: 'front' | 'back', photo: ShrunkPhoto, attempt: number): Promise<PhoneCheck> => {
    const { width, height } = photo;
    if (width === null || height === null) {
        return { attempt, result: 'error', faceCount: null, width, height, ratio: null };
    }
    const ratio = Math.round(cardRatio(width, height) * 1000) / 1000;
    const faceCount = side === 'front' ? await countFaces(photo.uri) : null;
    if (!isId1Shape(width, height)) {
        return { attempt, result: 'fail_shape', faceCount, width, height, ratio };
    }
    if (side === 'front') {
        if (faceCount === null) {
            return { attempt, result: 'error', faceCount, width, height, ratio };
        }
        if (faceCount === 0) {
            return { attempt, result: 'fail_no_face', faceCount, width, height, ratio };
        }
    }
    return { attempt, result: 'pass', faceCount, width, height, ratio };
};

// A failed photo is accepted once the attempt reaches the limit; -1 means no limit.
export const acceptFailedPhoto = (attempt: number, limit: number): boolean => limit !== -1 && attempt >= limit;

export const retakeAlert = (side: 'front' | 'back', result: PhoneCheckResult, attempt: number, limit: number): { title: string; message: string } => {
    const base = result === 'fail_no_face' ? FACE_MESSAGE : SHAPE_MESSAGE;
    return {
        title: side === 'front' ? 'Retake the ID front' : 'Retake the ID back',
        message: limit !== -1 ? `${base} Attempt ${attempt} of ${limit}.` : base,
    };
};

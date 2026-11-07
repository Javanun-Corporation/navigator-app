import { Image } from 'react-native';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import { detectFaces } from 'react-native-vision-camera-face-detector';
import {
    DEFAULT_PHOTO_MAX_ATTEMPTS,
    ID1_RATIO,
    ID1_RATIO_TOLERANCE,
    ID_FRONT_MIN_FACE_SIZE,
    JPEG_QUALITY,
    MAX_EDGE,
    acceptFailedPhoto,
    cardRatio,
    checkIdPhoto,
    countFaces,
    isId1Shape,
    retakeAlert,
    shrinkPhoto,
} from '../src/utils/photo-capture';
import { DEFAULT_PHOTO_MAX_ATTEMPTS as HANDSHAKE_DEFAULT_PHOTO_MAX_ATTEMPTS } from '../src/utils/beesure-handshake';

jest.mock('react-native', () => ({ Image: { getSize: jest.fn() } }));
jest.mock('@bam.tech/react-native-image-resizer', () => ({ __esModule: true, default: { createResizedImage: jest.fn() } }));
jest.mock('react-native-vision-camera-face-detector', () => ({ detectFaces: jest.fn() }));

const FACE_MESSAGE = 'We could not find a face on the ID front. Scan the whole front of the ID, flat and in good light, with its photo clearly visible and nothing else in the frame.';
const SHAPE_MESSAGE = 'This does not look like a whole ID card. Scan the card flat and edge to edge, with nothing else in the frame.';

beforeEach(() => {
    jest.resetAllMocks();
});

describe('constants', () => {
    test("the constants are the spec's first picks", () => {
        expect(MAX_EDGE).toBe(1920);
        expect(JPEG_QUALITY).toBe(90);
        expect(ID1_RATIO).toBe(85.6 / 53.98);
        expect(ID1_RATIO_TOLERANCE).toBe(0.12);
        expect(ID_FRONT_MIN_FACE_SIZE).toBe(0.05);
        expect(DEFAULT_PHOTO_MAX_ATTEMPTS).toBe(3);
    });

    test('the default limit matches the one of the handshake rules', () => {
        expect(HANDSHAKE_DEFAULT_PHOTO_MAX_ATTEMPTS).toBe(DEFAULT_PHOTO_MAX_ATTEMPTS);
    });
});

describe('cardRatio', () => {
    test('is the long edge over the short edge in either orientation', () => {
        expect(cardRatio(1012, 638)).toBeCloseTo(1.586, 3);
        expect(cardRatio(638, 1012)).toBeCloseTo(1.586, 3);
    });
});

describe('isId1Shape', () => {
    test.each([
        [1012, 638],
        [1400, 1000],
        [1770, 1000],
        [933, 1400],
    ])('accepts %i x %i', (width, height) => {
        expect(isId1Shape(width, height)).toBe(true);
    });

    test.each([
        [1390, 1000],
        [1780, 1000],
        [1000, 1000],
        [1350.45, 1000],
    ])('rejects %f x %f', (width, height) => {
        expect(isId1Shape(width, height)).toBe(false);
    });
});

describe('acceptFailedPhoto', () => {
    test('accepts from the limit on, and never with no limit', () => {
        expect(acceptFailedPhoto(3, 3)).toBe(true);
        expect(acceptFailedPhoto(2, 3)).toBe(false);
        expect(acceptFailedPhoto(50, -1)).toBe(false);
        expect(acceptFailedPhoto(1, 1)).toBe(true);
    });
});

describe('retakeAlert', () => {
    test('front with no face', () => {
        expect(retakeAlert('front', 'fail_no_face', 1, 3)).toEqual({ title: 'Retake the ID front', message: `${FACE_MESSAGE} Attempt 1 of 3.` });
    });

    test('back with the wrong shape', () => {
        expect(retakeAlert('back', 'fail_shape', 2, 3)).toEqual({ title: 'Retake the ID back', message: `${SHAPE_MESSAGE} Attempt 2 of 3.` });
    });

    test('no limit means no suffix', () => {
        expect(retakeAlert('front', 'fail_no_face', 4, -1).message).toBe(FACE_MESSAGE);
        expect(retakeAlert('front', 'fail_shape', 4, -1).message).toBe(SHAPE_MESSAGE);
    });

    test('only fail_no_face selects the face message', () => {
        expect(retakeAlert('front', 'fail_shape', 1, 3).message).toBe(`${SHAPE_MESSAGE} Attempt 1 of 3.`);
        expect(retakeAlert('front', 'error', 1, 3).message).toBe(`${SHAPE_MESSAGE} Attempt 1 of 3.`);
        expect(retakeAlert('front', 'pass', 1, 3).message).toBe(`${SHAPE_MESSAGE} Attempt 1 of 3.`);
    });
});

describe('shrinkPhoto', () => {
    test("shrinkPhoto calls the resizer with the spec's arguments", async () => {
        ImageResizer.createResizedImage.mockResolvedValue({ uri: 'file:///small.jpg', width: 1920, height: 1080 });
        const result = await shrinkPhoto('file:///big.jpg');
        expect(ImageResizer.createResizedImage).toHaveBeenCalledWith('file:///big.jpg', 1920, 1920, 'JPEG', 90, 0, undefined, false, { mode: 'contain', onlyScaleDown: true });
        expect(result).toEqual({ uri: 'file:///small.jpg', width: 1920, height: 1080 });
    });

    test('shrinkPhoto falls back to the original and Image.getSize', async () => {
        ImageResizer.createResizedImage.mockRejectedValue(new Error('resizer failed'));
        Image.getSize.mockImplementation((uri, success) => success(800, 600));
        const result = await shrinkPhoto('file:///big.jpg');
        expect(Image.getSize).toHaveBeenCalledWith('file:///big.jpg', expect.any(Function), expect.any(Function));
        expect(result).toEqual({ uri: 'file:///big.jpg', width: 800, height: 600 });
    });

    test('shrinkPhoto returns null sizes when both fail', async () => {
        ImageResizer.createResizedImage.mockRejectedValue(new Error('resizer failed'));
        Image.getSize.mockImplementation((uri, success, failure) => failure(new Error('size failed')));
        const result = await shrinkPhoto('file:///big.jpg');
        expect(result).toEqual({ uri: 'file:///big.jpg', width: null, height: null });
    });

    test('shrinkPhoto returns null sizes when Image.getSize throws', async () => {
        ImageResizer.createResizedImage.mockRejectedValue(new Error('resizer failed'));
        Image.getSize.mockImplementation(() => {
            throw new Error('size threw');
        });
        const result = await shrinkPhoto('file:///big.jpg');
        expect(result).toEqual({ uri: 'file:///big.jpg', width: null, height: null });
    });
});

describe('countFaces', () => {
    test("countFaces passes the spec's options", async () => {
        detectFaces.mockResolvedValue([{}, {}]);
        const count = await countFaces('file:///a.jpg');
        expect(detectFaces).toHaveBeenCalledWith({
            image: { uri: 'file:///a.jpg' },
            options: { performanceMode: 'accurate', landmarkMode: 'none', contourMode: 'none', classificationMode: 'none', minFaceSize: 0.05, trackingEnabled: false },
        });
        expect(count).toBe(2);
    });

    test('returns null for a throw', async () => {
        detectFaces.mockRejectedValue(new Error('detector failed'));
        expect(await countFaces('file:///a.jpg')).toBeNull();
    });

    test('returns null for a non-array answer', async () => {
        detectFaces.mockResolvedValue(undefined);
        expect(await countFaces('file:///a.jpg')).toBeNull();
    });
});

describe('checkIdPhoto', () => {
    test('a front with one face passes', async () => {
        detectFaces.mockResolvedValue([{}]);
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: 1600, height: 1009 }, 1);
        expect(result).toEqual({ attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: 1.586 });
    });

    test('a front with two faces passes (the ghost portrait)', async () => {
        detectFaces.mockResolvedValue([{}, {}]);
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: 1600, height: 1009 }, 2);
        expect(result.result).toBe('pass');
        expect(result.faceCount).toBe(2);
        expect(result.attempt).toBe(2);
    });

    test('a front with no face fails', async () => {
        detectFaces.mockResolvedValue([]);
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: 1600, height: 1009 }, 1);
        expect(result.result).toBe('fail_no_face');
        expect(result.faceCount).toBe(0);
    });

    test('a 1000 x 1000 front fails the shape and still records faceCount', async () => {
        detectFaces.mockResolvedValue([{}]);
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: 1000, height: 1000 }, 1);
        expect(result).toEqual({ attempt: 1, result: 'fail_shape', faceCount: 1, width: 1000, height: 1000, ratio: 1 });
        expect(detectFaces).toHaveBeenCalledTimes(1);
    });

    test('a null size is an error with no detector call', async () => {
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: null, height: null }, 1);
        expect(result).toEqual({ attempt: 1, result: 'error', faceCount: null, width: null, height: null, ratio: null });
        expect(detectFaces).not.toHaveBeenCalled();
    });

    test('a detector throw is an error', async () => {
        detectFaces.mockRejectedValue(new Error('detector failed'));
        const result = await checkIdPhoto('front', { uri: 'file:///a.jpg', width: 1600, height: 1009 }, 1);
        expect(result.result).toBe('error');
        expect(result.faceCount).toBeNull();
    });

    test('a back never calls detectFaces', async () => {
        const result = await checkIdPhoto('back', { uri: 'file:///a.jpg', width: 1600, height: 1009 }, 1);
        expect(result).toEqual({ attempt: 1, result: 'pass', faceCount: null, width: 1600, height: 1009, ratio: 1.586 });
        expect(detectFaces).not.toHaveBeenCalled();
    });

    test('a back with the wrong shape fails', async () => {
        const result = await checkIdPhoto('back', { uri: 'file:///a.jpg', width: 1000, height: 1000 }, 2);
        expect(result.result).toBe('fail_shape');
        expect(result.faceCount).toBeNull();
        expect(detectFaces).not.toHaveBeenCalled();
    });
});

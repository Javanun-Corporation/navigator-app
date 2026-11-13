import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { toast } from '../src/utils/toast';
import { checkIdPhoto, shrinkPhoto } from '../src/utils/photo-capture';
import AutomatedCaptureFlow from '../src/components/AutomatedCaptureFlow';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));

jest.mock('tamagui', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    const Button = host('Button');
    Button.Text = host('ButtonText');
    Button.Icon = host('ButtonIcon');
    return { Button, Image: host('Image'), Spinner: host('Spinner'), Text: host('Text'), XStack: host('XStack'), YStack: host('YStack') };
});

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@fortawesome/react-native-fontawesome', () => ({ FontAwesomeIcon: () => null }));
jest.mock('@fortawesome/free-solid-svg-icons', () => ({ faCheck: {}, faRotateLeft: {} }));
jest.mock('../src/utils/toast', () => ({ toast: { info: jest.fn() } }));

const mockLog = { faceProps: null, scannerProps: { front: null, back: null }, mounts: { front: 0, back: 0 } };

jest.mock('../src/components/FaceAutoCaptureCamera', () => {
    const mockReact = require('react');
    const FaceAutoCaptureCamera = (props) => {
        mockLog.faceProps = props;
        return mockReact.createElement('FaceAutoCaptureCamera');
    };
    return { __esModule: true, default: FaceAutoCaptureCamera };
});

jest.mock('../src/components/IdDocumentScanner', () => {
    const mockReact = require('react');
    const IdDocumentScanner = (props) => {
        mockReact.useEffect(() => {
            mockLog.mounts[props.side] += 1;
        }, []);
        mockLog.scannerProps[props.side] = props;
        return mockReact.createElement('IdDocumentScanner', { side: props.side });
    };
    return { __esModule: true, default: IdDocumentScanner };
});

jest.mock('../src/utils/photo-capture', () => ({
    shrinkPhoto: jest.fn(),
    checkIdPhoto: jest.fn(),
    acceptFailedPhoto: (attempt, limit) => limit !== -1 && attempt >= limit,
    retakeAlert: () => ({ title: 'T', message: 'M' }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const CHECKING_TEXT = 'Checking the ID photo…';
const FACE_URI = 'file:///face.jpg';
const FRONT_URI = 'file:///front.jpg';
const BACK_URI = 'file:///back.jpg';

const passCheck = (side, photo, attempt) => ({ attempt, result: 'pass', faceCount: side === 'front' ? 1 : null, width: photo.width, height: photo.height, ratio: 1.586 });

let renderer;
let onComplete;
let onTry;
let attempts;

const settle = () => new Promise((resolve) => setImmediate(resolve));

const render = async (photoMaxAttempts = 3, initialAttempts = { face: 0, frontFailures: 0, backFailures: 0, tries: { lva_face: 0, lva_id: 0, lva_id_back: 0 } }) => {
    onComplete = jest.fn();
    onTry = jest.fn();
    attempts = { current: { ...initialAttempts } };
    await act(async () => {
        renderer = TestRenderer.create(<AutomatedCaptureFlow onComplete={onComplete} onTry={onTry} photoMaxAttempts={photoMaxAttempts} attempts={attempts} />);
    });
    return { photoMaxAttempts };
};

const captureFace = async () => {
    await act(async () => {
        mockLog.faceProps.onCapture({ uri: FACE_URI, path: '/face.jpg' });
        await settle();
    });
};

const scan = async (side, uri) => {
    await act(async () => {
        mockLog.scannerProps[side].onComplete(uri);
        await settle();
    });
};

const treeText = () => JSON.stringify(renderer.toJSON());

const nodeText = (node) => (typeof node === 'string' ? node : node.children.map(nodeText).join(''));

const pressButton = async (label) => {
    const [button] = renderer.root.findAll((node) => node.type === 'Button' && nodeText(node).includes(label));
    await act(async () => {
        button.props.onPress();
        await settle();
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    mockLog.faceProps = null;
    mockLog.scannerProps = { front: null, back: null };
    mockLog.mounts = { front: 0, back: 0 };
    shrinkPhoto.mockImplementation(async (uri) => ({ uri: 'shrunk:' + uri, width: 1600, height: 1009 }));
    checkIdPhoto.mockImplementation(async (side, photo, attempt) => passCheck(side, photo, attempt));
});

afterEach(() => {
    if (renderer) {
        act(() => {
            renderer.unmount();
        });
        renderer = null;
    }
});

describe('AutomatedCaptureFlow', () => {
    test('a failing front check shows the retake alert and mounts the scanner again only on Retake', async () => {
        checkIdPhoto.mockImplementation(async (side, photo, attempt) => ({ attempt, result: 'fail_shape', faceCount: 1, width: photo.width, height: photo.height, ratio: 1 }));
        await render();
        await captureFace();
        expect(mockLog.mounts.front).toBe(1);

        await scan('front', FRONT_URI);

        expect(checkIdPhoto).toHaveBeenCalledWith('front', { uri: 'shrunk:' + FRONT_URI, width: 1600, height: 1009 }, 1);
        expect(Alert.alert).toHaveBeenCalledTimes(1);
        const [title, message, buttons, options] = Alert.alert.mock.calls[0];
        expect(title).toBe('T');
        expect(message).toBe('M');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].text).toBe('Retake');
        expect(options).toEqual({ cancelable: false });
        expect(mockLog.mounts.front).toBe(1);
        expect(treeText()).toContain(CHECKING_TEXT);
        expect(treeText()).not.toContain('IdDocumentScanner');
        expect(attempts.current.frontFailures).toBe(1);

        await act(async () => {
            buttons[0].onPress();
            await settle();
        });

        expect(mockLog.mounts.front).toBe(2);
        expect(treeText()).not.toContain(CHECKING_TEXT);
        expect(treeText()).toContain('IdDocumentScanner');
    });

    test("a re-render keeps the scanner's onComplete identity", async () => {
        await render();
        await captureFace();
        const before = mockLog.scannerProps.front.onComplete;

        await act(async () => {
            renderer.update(<AutomatedCaptureFlow onComplete={onComplete} onTry={onTry} photoMaxAttempts={3} attempts={attempts} />);
        });
        expect(mockLog.scannerProps.front.onComplete).toBe(before);

        await act(async () => {
            renderer.update(<AutomatedCaptureFlow onComplete={jest.fn()} onTry={onTry} photoMaxAttempts={5} attempts={attempts} />);
        });
        expect(mockLog.scannerProps.front.onComplete).toBe(before);
        expect(mockLog.mounts.front).toBe(1);
    });

    test("a pass goes on to the back and the back's pass to the review", async () => {
        await render();
        await captureFace();
        await scan('front', FRONT_URI);

        expect(Alert.alert).not.toHaveBeenCalled();
        expect(mockLog.mounts.back).toBe(1);

        await scan('back', BACK_URI);

        expect(treeText()).toContain('Review your photos');
        await pressButton('Continue');

        expect(shrinkPhoto.mock.calls.map((call) => call[0])).toEqual([FACE_URI, FRONT_URI, BACK_URI]);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith({
            facePhoto: 'shrunk:' + FACE_URI,
            documentFront: 'shrunk:' + FRONT_URI,
            documentBack: 'shrunk:' + BACK_URI,
            checks: {
                lva_face: { attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: null },
                lva_id: { attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: 1.586 },
                lva_id_back: { attempt: 1, result: 'pass', faceCount: null, width: 1600, height: 1009, ratio: 1.586 },
            },
            tryNos: { lva_face: 1, lva_id: 1, lva_id_back: 1 },
        });
        expect(attempts.current).toEqual({ face: 1, frontFailures: 0, backFailures: 0, tries: { lva_face: 1, lva_id: 1, lva_id_back: 1 } });
    });

    test('an accepted Nth failure goes on with a toast', async () => {
        checkIdPhoto.mockImplementation(async (side, photo, attempt) => (side === 'front' ? { attempt, result: 'fail_no_face', faceCount: 0, width: photo.width, height: photo.height, ratio: 1.586 } : passCheck(side, photo, attempt)));
        await render(2, { face: 0, frontFailures: 1, backFailures: 0, tries: { lva_face: 0, lva_id: 0, lva_id_back: 0 } });
        await captureFace();

        await scan('front', FRONT_URI);

        expect(Alert.alert).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(toast.info).toHaveBeenCalledWith('ID front accepted after 2 attempts.');
        expect(mockLog.mounts.back).toBe(1);
        expect(attempts.current.frontFailures).toBe(1);

        await scan('back', BACK_URI);
        await pressButton('Continue');

        expect(onComplete.mock.calls[0][0].checks.lva_id).toEqual({ attempt: 2, result: 'fail_no_face', faceCount: 0, width: 1600, height: 1009, ratio: 1.586 });
        expect(onComplete.mock.calls[0][0].documentFront).toBe('shrunk:' + FRONT_URI);
    });

    test('an error result goes on without counting a failure', async () => {
        checkIdPhoto.mockImplementation(async (side, photo, attempt) => ({ attempt, result: 'error', faceCount: null, width: null, height: null, ratio: null }));
        await render();
        await captureFace();

        await scan('front', FRONT_URI);

        expect(Alert.alert).not.toHaveBeenCalled();
        expect(toast.info).not.toHaveBeenCalled();
        expect(attempts.current.frontFailures).toBe(0);
        expect(mockLog.mounts.back).toBe(1);
        expect(treeText()).not.toContain(CHECKING_TEXT);
    });

    test('a second Use Photo tap while the face is being shrunk is dropped', async () => {
        let finishShrink;
        shrinkPhoto.mockImplementationOnce((uri) => new Promise((resolve) => (finishShrink = () => resolve({ uri: 'shrunk:' + uri, width: 1600, height: 1009 }))));
        await render();
        const { onCapture } = mockLog.faceProps;

        await act(async () => {
            onCapture({ uri: FACE_URI, path: '/face.jpg' });
            onCapture({ uri: FACE_URI, path: '/face.jpg' });
            await settle();
        });
        expect(shrinkPhoto).toHaveBeenCalledTimes(1);

        await act(async () => {
            finishShrink();
            await settle();
        });

        expect(shrinkPhoto).toHaveBeenCalledTimes(1);
        expect(attempts.current.face).toBe(1);
        expect(mockLog.mounts.front).toBe(1);
    });

    describe('photo tries', () => {
        const failNoFace = async (side, photo, attempt) => ({ attempt, result: 'fail_no_face', faceCount: 0, width: photo.width, height: photo.height, ratio: 1.586 });

        const pressRetakeInAlert = async () => {
            const [, , buttons] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
            await act(async () => {
                buttons[0].onPress();
                await settle();
            });
        };

        const idTries = () => onTry.mock.calls.map((call) => call[0]).filter((photoTry) => photoTry.role === 'lva_id');

        test('reports a used face photo as a kept try', async () => {
            await render();

            await captureFace();

            expect(onTry).toHaveBeenCalledTimes(1);
            expect(onTry).toHaveBeenCalledWith({
                role: 'lva_face',
                uri: 'shrunk:' + FACE_URI,
                tryNo: 1,
                kept: true,
                check: { attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: null },
            });
        });

        test('reports a discarded face photo as a try that was not kept, and the next used one as try 2', async () => {
            await render();

            await act(async () => {
                mockLog.faceProps.onDiscard({ uri: FACE_URI, path: '/face.jpg' });
                await settle();
            });

            expect(treeText()).not.toContain('IdDocumentScanner');
            expect(mockLog.mounts.front).toBe(0);
            expect(attempts.current.face).toBe(0);

            await captureFace();

            expect(onTry).toHaveBeenCalledTimes(2);
            expect(onTry.mock.calls[0][0]).toEqual({
                role: 'lva_face',
                uri: 'shrunk:' + FACE_URI,
                tryNo: 1,
                kept: false,
                check: { attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: null },
            });
            expect(onTry.mock.calls[1][0]).toEqual({
                role: 'lva_face',
                uri: 'shrunk:' + FACE_URI,
                tryNo: 2,
                kept: true,
                check: { attempt: 1, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: null },
            });
        });

        test('reports a refused ID scan as a try that was not kept, and the retake as the next try', async () => {
            checkIdPhoto.mockImplementationOnce(failNoFace);
            await render();
            await captureFace();

            await scan('front', FRONT_URI);
            await pressRetakeInAlert();
            await scan('front', FRONT_URI);

            expect(idTries()).toEqual([
                { role: 'lva_id', uri: 'shrunk:' + FRONT_URI, tryNo: 1, kept: false, check: { attempt: 1, result: 'fail_no_face', faceCount: 0, width: 1600, height: 1009, ratio: 1.586 } },
                { role: 'lva_id', uri: 'shrunk:' + FRONT_URI, tryNo: 2, kept: true, check: { attempt: 2, result: 'pass', faceCount: 1, width: 1600, height: 1009, ratio: 1.586 } },
            ]);
        });

        test('reports a failed scan that is accepted at the limit as kept', async () => {
            checkIdPhoto.mockImplementation(failNoFace);
            await render(1);
            await captureFace();

            await scan('front', FRONT_URI);

            expect(Alert.alert).not.toHaveBeenCalled();
            expect(idTries()).toEqual([{ role: 'lva_id', uri: 'shrunk:' + FRONT_URI, tryNo: 1, kept: true, check: { attempt: 1, result: 'fail_no_face', faceCount: 0, width: 1600, height: 1009, ratio: 1.586 } }]);
        });

        test('Continue hands over the try number of each final photo', async () => {
            checkIdPhoto.mockImplementationOnce(failNoFace);
            await render();
            await captureFace();
            await scan('front', FRONT_URI);
            await pressRetakeInAlert();
            await scan('front', FRONT_URI);
            await scan('back', BACK_URI);

            await pressButton('Continue');

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete.mock.calls[0][0].tryNos).toEqual({ lva_face: 1, lva_id: 2, lva_id_back: 1 });
        });

        test('a retake from the review screen hands over the new try number', async () => {
            await render();
            await captureFace();
            await scan('front', FRONT_URI);
            await scan('back', BACK_URI);
            expect(treeText()).toContain('Review your photos');

            // The review screen lists Face, ID Front and ID Back in that order, each with its own Retake button.
            const retakeButtons = renderer.root.findAll((node) => node.type === 'Button' && nodeText(node).includes('Retake'));
            expect(retakeButtons).toHaveLength(3);
            await act(async () => {
                retakeButtons[1].props.onPress();
                await settle();
            });
            await scan('front', FRONT_URI);
            expect(treeText()).toContain('Review your photos');
            await pressButton('Continue');

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete.mock.calls[0][0].tryNos).toEqual({ lva_face: 1, lva_id: 2, lva_id_back: 1 });
            expect(idTries().map((photoTry) => [photoTry.tryNo, photoTry.kept])).toEqual([
                [1, true],
                [2, true],
            ]);
        });

        test('a discarded face photo keeps the attempt it was taken at', async () => {
            const finishers = {};
            shrinkPhoto.mockImplementation((uri) => new Promise((resolve) => (finishers[uri] = () => resolve({ uri: 'shrunk:' + uri, width: 1600, height: 1009 }))));
            await render();

            await act(async () => {
                mockLog.faceProps.onDiscard({ uri: 'file:///face-a.jpg', path: '/face-a.jpg' });
                mockLog.faceProps.onCapture({ uri: 'file:///face-b.jpg', path: '/face-b.jpg' });
                await settle();
            });
            await act(async () => {
                finishers['file:///face-b.jpg']();
                await settle();
            });
            expect(attempts.current.face).toBe(1);
            await act(async () => {
                finishers['file:///face-a.jpg']();
                await settle();
            });

            const faceTries = onTry.mock.calls.map((call) => call[0]).filter((photoTry) => photoTry.role === 'lva_face');
            expect(faceTries.map((photoTry) => [photoTry.tryNo, photoTry.kept, photoTry.check.attempt])).toEqual([
                [2, true, 1],
                [1, false, 1],
            ]);
        });

        test('a new onTry does not restart a mounted scanner', async () => {
            await render();
            await captureFace();
            expect(mockLog.mounts.front).toBe(1);
            const before = mockLog.scannerProps.front.onComplete;

            await act(async () => {
                renderer.update(<AutomatedCaptureFlow onComplete={onComplete} onTry={jest.fn()} photoMaxAttempts={3} attempts={attempts} />);
            });

            expect(mockLog.scannerProps.front.onComplete).toBe(before);
            expect(mockLog.mounts.front).toBe(1);
        });
    });

    // The app runs the old architecture, where an update made from a native callback or after an await is not batched. act() batches, so these cases run outside it.
    describe('without batched updates', () => {
        const outsideAct = async (action) => {
            global.IS_REACT_ACT_ENVIRONMENT = false;
            try {
                action();
                await settle();
                await settle();
            } finally {
                global.IS_REACT_ACT_ENVIRONMENT = true;
            }
        };

        test('Retake mounts the scanner once more, not twice', async () => {
            checkIdPhoto.mockImplementation(async (side, photo, attempt) => ({ attempt, result: 'fail_shape', faceCount: 1, width: photo.width, height: photo.height, ratio: 1 }));
            await render();
            await captureFace();
            await scan('front', FRONT_URI);
            expect(mockLog.mounts.front).toBe(1);
            const [, , buttons] = Alert.alert.mock.calls[0];

            await outsideAct(() => buttons[0].onPress());

            expect(mockLog.mounts.front).toBe(2);
        });

        test('a front pass mounts the back scanner once and the front scanner no more', async () => {
            await render();
            await captureFace();
            expect(mockLog.mounts.front).toBe(1);

            await outsideAct(() => mockLog.scannerProps.front.onComplete(FRONT_URI));

            expect(mockLog.mounts.front).toBe(1);
            expect(mockLog.mounts.back).toBe(1);
        });

        test('a back pass opens the review without mounting the back scanner again', async () => {
            await render();
            await captureFace();
            await scan('front', FRONT_URI);
            expect(mockLog.mounts.back).toBe(1);

            await outsideAct(() => mockLog.scannerProps.back.onComplete(BACK_URI));

            expect(mockLog.mounts.back).toBe(1);
            expect(treeText()).toContain('Review your photos');
        });
    });
});

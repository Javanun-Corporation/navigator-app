import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { runAsync, runAtTargetFps } from 'react-native-vision-camera';
import FaceAutoCaptureCamera from '../src/components/FaceAutoCaptureCamera';

const mockLog = { cameraProps: null, detectFaces: jest.fn() };

jest.mock('react-native', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    const animation = { start: jest.fn(), stop: jest.fn() };
    return {
        Animated: { Value: function Value() {}, View: host('AnimatedView'), loop: () => animation, sequence: () => animation, timing: () => animation },
        Image: host('Image'),
        Platform: { OS: 'android' },
        StyleSheet: { absoluteFill: {}, absoluteFillObject: {}, create: (styles) => styles },
    };
});

jest.mock('tamagui', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    const Button = host('Button');
    Button.Text = host('ButtonText');
    Button.Icon = host('ButtonIcon');
    return { Button, Spinner: host('Spinner'), Text: host('Text'), View: host('View'), XStack: host('XStack'), YStack: host('YStack') };
});

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-linear-gradient', () => ({ __esModule: true, default: () => null }));
jest.mock('@fortawesome/react-native-fontawesome', () => ({ FontAwesomeIcon: () => null }));
jest.mock('@fortawesome/free-solid-svg-icons', () => ({ faCheck: {}, faRotateLeft: {}, faUserLarge: {} }));
jest.mock('react-native-worklets-core', () => ({ Worklets: { createRunOnJS: (fn) => fn } }));
jest.mock('react-native-vision-camera-face-detector', () => ({ useFaceDetector: () => ({ detectFaces: mockLog.detectFaces, stopListeners: jest.fn() }) }));

// runAsync is the call that kills a standalone Android build on the first camera frame, so the stand-in does nothing: a frame handler that still goes through it never reaches face detection here either.
jest.mock('react-native-vision-camera', () => {
    const mockReact = require('react');
    const Camera = mockReact.forwardRef((props, ref) => {
        mockLog.cameraProps = props;
        mockReact.useImperativeHandle(ref, () => ({ takePhoto: async () => ({ path: '/cache/face-1.jpg' }) }));
        return mockReact.createElement('Camera');
    });
    Camera.getCameraPermissionStatus = async () => 'granted';
    Camera.requestCameraPermission = async () => 'granted';
    return {
        Camera,
        runAsync: jest.fn(),
        runAtTargetFps: jest.fn((fps, func) => func()),
        useCameraDevice: () => ({ id: 'back' }),
        useFrameProcessor: (frameProcessor) => frameProcessor,
    };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const FRAME = { width: 1280, height: 720 };

const textOf = (renderer) => JSON.stringify(renderer.toJSON());

const mount = async (props = { onCapture: jest.fn() }) => {
    let renderer;
    await act(async () => {
        renderer = TestRenderer.create(React.createElement(FaceAutoCaptureCamera, props));
    });
    return renderer;
};

const buttonWithText = (renderer, text) =>
    renderer.root.findAll((node) => node.type === 'Button' && node.findAll((child) => child.type === 'ButtonText' && child.props.children === text).length > 0)[0];

const captureAPhoto = async () => {
    await act(async () => {
        mockLog.cameraProps.frameProcessor(FRAME);
    });
};

describe('FaceAutoCaptureCamera', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLog.cameraProps = null;
        mockLog.detectFaces.mockReturnValue([{ bounds: {} }]);
    });

    // vision-camera's runAsync crashes standalone Android builds on the camera's frame thread (the app died 40 ms after the face camera started on a Pixel 3 XL, 2026-11-12), so faces are looked for directly in the frame handler.
    it('looks for faces in the frame handler itself, without runAsync', async () => {
        const renderer = await mount();

        await act(async () => {
            mockLog.cameraProps.frameProcessor(FRAME);
        });

        expect(runAsync).not.toHaveBeenCalled();
        expect(mockLog.detectFaces).toHaveBeenCalledWith(FRAME);
        expect(textOf(renderer)).toContain('Face detected - hold still...');
    });

    // The frame handler holds up the camera's frame thread while it runs, so it looks for faces a few times a second instead of on every frame.
    it('looks for faces 5 times a second', async () => {
        await mount();

        await act(async () => {
            mockLog.cameraProps.frameProcessor(FRAME);
        });

        expect(runAtTargetFps).toHaveBeenCalledWith(5, expect.any(Function));
    });

    it('hands a discarded photo to onDiscard when Retake is tapped', async () => {
        const onCapture = jest.fn();
        const onDiscard = jest.fn();
        const renderer = await mount({ onCapture, onDiscard, holdDurationMs: 0 });
        await captureAPhoto();

        await act(async () => {
            buttonWithText(renderer, 'Retake').props.onPress();
        });

        expect(onDiscard).toHaveBeenCalledTimes(1);
        expect(onDiscard).toHaveBeenCalledWith({ uri: 'file:///cache/face-1.jpg', path: '/cache/face-1.jpg' });
        expect(onCapture).not.toHaveBeenCalled();
    });

    it('Use Photo does not call onDiscard', async () => {
        const onCapture = jest.fn();
        const onDiscard = jest.fn();
        const renderer = await mount({ onCapture, onDiscard, holdDurationMs: 0 });
        await captureAPhoto();

        await act(async () => {
            buttonWithText(renderer, 'Use Photo').props.onPress();
        });

        expect(onCapture).toHaveBeenCalledTimes(1);
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('a second Use Photo tap still calls onCapture', async () => {
        const onCapture = jest.fn();
        const onDiscard = jest.fn();
        const renderer = await mount({ onCapture, onDiscard, holdDurationMs: 0 });
        await captureAPhoto();
        const { onPress } = buttonWithText(renderer, 'Use Photo').props;

        await act(async () => {
            onPress();
        });
        await act(async () => {
            onPress();
        });

        expect(onCapture).toHaveBeenCalledTimes(2);
        expect(onCapture).toHaveBeenNthCalledWith(1, { uri: 'file:///cache/face-1.jpg', path: '/cache/face-1.jpg' });
        expect(onCapture).toHaveBeenNthCalledWith(2, { uri: 'file:///cache/face-1.jpg', path: '/cache/face-1.jpg' });
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('Use Photo then Retake does not hand the photo to onDiscard', async () => {
        const onCapture = jest.fn();
        const onDiscard = jest.fn();
        const renderer = await mount({ onCapture, onDiscard, holdDurationMs: 0 });
        await captureAPhoto();

        await act(async () => {
            buttonWithText(renderer, 'Use Photo').props.onPress();
        });
        await act(async () => {
            buttonWithText(renderer, 'Retake').props.onPress();
        });

        expect(onCapture).toHaveBeenCalledTimes(1);
        expect(onDiscard).not.toHaveBeenCalled();
        expect(textOf(renderer)).not.toContain('Face captured');
    });

    it('a double tap on Retake hands the photo over once', async () => {
        const onDiscard = jest.fn();
        const renderer = await mount({ onCapture: jest.fn(), onDiscard, holdDurationMs: 0 });
        await captureAPhoto();
        const { onPress } = buttonWithText(renderer, 'Retake').props;

        await act(async () => {
            onPress();
            onPress();
        });

        expect(onDiscard).toHaveBeenCalledTimes(1);
    });
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image as RNImage, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { Camera, runAsync, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import type { Camera as CameraRef } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import type { Face, FaceDetectionOptions } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { Button, Spinner, Text, View, XStack, YStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faRotateLeft, faUserLarge } from '@fortawesome/free-solid-svg-icons';

export type CapturedPhoto = { uri: string; path: string };

type FaceAutoCaptureCameraProps = {
    instructionText?: string;
    holdDurationMs?: number; // how long a single, centered face must be held before auto-capture fires
    onCapture: (photo: CapturedPhoto) => void;
};

type Phase = 'checking-permission' | 'detecting' | 'holding' | 'capturing' | 'captured';

// Safety net: if a capture somehow never resolves, bail back to detecting instead of hanging forever.
const CAPTURE_TIMEOUT_MS = 8000;

/**
 * In-place back-camera step that uses real ML Kit face detection (via
 * react-native-vision-camera-face-detector) to auto-capture once exactly one face has been
 * held steadily inside the guide for `holdDurationMs`. After capture the photo stays on
 * screen (not a fleeting flash) and auto-confirms after a short preview window unless the
 * user taps Retake.
 *
 * Uses the back (outward-facing) camera, not the front/selfie camera - the driver is
 * photographing the subject of the delivery, not themselves.
 */
const FaceAutoCaptureCamera: React.FC<FaceAutoCaptureCameraProps> = ({
    instructionText = "Center their face in the frame and hold still",
    holdDurationMs = 1200,
    onCapture,
}) => {
    const insets = useSafeAreaInsets();
    const cameraRef = useRef<CameraRef>(null);
    const device = useCameraDevice('back');
    const [hasPermission, setHasPermission] = useState(false);
    const [phase, setPhase] = useState<Phase>('checking-permission');
    const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
    const pulse = useRef(new Animated.Value(1)).current;
    const holdStartedAtRef = useRef<number | null>(null);
    const capturingRef = useRef(false);
    const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const faceDetectionOptions = useRef<FaceDetectionOptions>({
        performanceMode: 'fast',
        cameraFacing: 'back',
        minFaceSize: 0.25,
    }).current;

    useEffect(() => {
        (async () => {
            const current = await Camera.getCameraPermissionStatus();
            if (current === 'granted') {
                setHasPermission(true);
                return;
            }
            const requested = await Camera.requestCameraPermission();
            setHasPermission(requested === 'granted');
        })();
    }, []);

    useEffect(() => {
        if (hasPermission && device && phase === 'checking-permission') {
            setPhase('detecting');
        }
    }, [hasPermission, device, phase]);

    // Pulsing guide animation to signal "live detection"
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1.06, duration: 700, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    const resetToDetecting = useCallback(() => {
        if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
        holdStartedAtRef.current = null;
        capturingRef.current = false;
        setPhase('detecting');
    }, []);

    const handleCapture = useCallback(async () => {
        if (!cameraRef.current || capturingRef.current) return;
        capturingRef.current = true;
        setPhase('capturing');

        // Defensive: never get stuck on "capturing" forever if takePhoto hangs for some reason.
        captureTimeoutRef.current = setTimeout(() => {
            console.warn('FaceAutoCaptureCamera: capture timed out, resetting');
            resetToDetecting();
        }, CAPTURE_TIMEOUT_MS);

        try {
            const photo = await cameraRef.current.takePhoto({ flash: 'off', qualityPrioritization: 'balanced' });
            if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
            const uri = (Platform.OS === 'ios' ? '' : 'file://') + photo.path;
            setCapturedPhoto({ uri, path: photo.path });
            setPhase('captured');
        } catch (error) {
            console.warn('FaceAutoCaptureCamera: failed to capture photo', error);
            resetToDetecting();
        }
    }, [resetToDetecting]);

    // Called on every processed frame with the faces ML Kit found in it (already on the JS thread,
    // via Worklets.createRunOnJS below - the frame processor itself runs on a worklet thread).
    const handleFacesDetected = useCallback(
        (faces: Face[]) => {
            if (phase !== 'detecting' && phase !== 'holding') return;

            const singleFace = faces.length === 1 ? faces[0] : null;
            if (!singleFace) {
                holdStartedAtRef.current = null;
                if (phase !== 'detecting') setPhase('detecting');
                return;
            }

            if (holdStartedAtRef.current === null) {
                holdStartedAtRef.current = Date.now();
            }
            if (phase !== 'holding') setPhase('holding');

            const heldFor = Date.now() - holdStartedAtRef.current;
            if (heldFor >= holdDurationMs) {
                holdStartedAtRef.current = null;
                handleCapture();
            }
        },
        [phase, holdDurationMs, handleCapture]
    );

    // NOTE: deliberately NOT using react-native-vision-camera-face-detector's <Camera> wrapper -
    // it unconditionally calls vision-camera's useSkiaFrameProcessor internally, which throws if
    // @shopify/react-native-skia isn't installed (it isn't, and we don't need Skia drawing here).
    // Driving the frame processor manually avoids that dependency entirely.
    const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions);

    useEffect(() => {
        return () => stopListeners();
    }, [stopListeners]);

    const runFacesDetectedOnJS = useMemo(() => Worklets.createRunOnJS(handleFacesDetected), [handleFacesDetected]);

    const frameProcessor = useFrameProcessor(
        (frame) => {
            'worklet';
            runAsync(frame, () => {
                'worklet';
                const faces = detectFaces(frame);
                runFacesDetectedOnJS(faces);
            });
        },
        [detectFaces, runFacesDetectedOnJS]
    );

    // NOTE: no auto-confirm timer here on purpose - this preview is the explicit checkpoint
    // where the driver can retake the photo, so it waits for a deliberate "Use Photo" tap
    // instead of racing a timer (which previously made Retake look broken if it fired first).
    const handleRetake = useCallback(() => {
        setCapturedPhoto(null);
        resetToDetecting();
    }, [resetToDetecting]);

    const handleUsePhoto = useCallback(() => {
        if (!capturedPhoto) return;
        onCapture(capturedPhoto);
    }, [capturedPhoto, onCapture]);

    if (!hasPermission) {
        return (
            <YStack flex={1} ai='center' jc='center' bg='#000'>
                <Text color='#fff'>Waiting for camera permission...</Text>
            </YStack>
        );
    }

    if (!device) {
        return (
            <YStack flex={1} ai='center' jc='center' bg='#000'>
                <Text color='#fff'>No camera available</Text>
            </YStack>
        );
    }

    const isCameraActive = phase === 'detecting' || phase === 'holding' || phase === 'capturing';
    const isHolding = phase === 'holding';

    return (
        <View flex={1} bg='#000'>
            {phase === 'captured' && capturedPhoto ? (
                <RNImage source={{ uri: capturedPhoto.uri }} style={StyleSheet.absoluteFill} resizeMode='cover' />
            ) : (
                <Camera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isCameraActive}
                    photo={true}
                    frameProcessor={frameProcessor}
                    pixelFormat='yuv'
                />
            )}

            {phase !== 'captured' && (
                <LinearGradient colors={['rgba(0,0,0,0.65)', 'transparent']} style={[styles.topScrim, { height: insets.top + 96 }]} pointerEvents='none' />
            )}

            {phase !== 'captured' && (
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={[styles.bottomScrim, { paddingBottom: insets.bottom }]} pointerEvents='none' />
            )}

            <View pointerEvents='none' style={styles.overlay}>
                {phase !== 'captured' && (
                    <Animated.View
                        style={[
                            styles.faceGuide,
                            {
                                borderColor: isHolding ? '#22c55e' : 'rgba(255,255,255,0.85)',
                                transform: [{ scale: pulse }],
                            },
                        ]}
                    />
                )}

                <YStack mt='$6' ai='center' space='$3' px='$6' maxWidth={340}>
                    {phase === 'detecting' && (
                        <XStack ai='center' space='$2' bg='rgba(0,0,0,0.35)' px='$4' py='$2' borderRadius={999}>
                            <FontAwesomeIcon icon={faUserLarge} size={14} color='#fff' />
                            <Text color='#fff' fontSize={15} fontWeight='600' textAlign='center'>
                                {instructionText}
                            </Text>
                        </XStack>
                    )}
                    {phase === 'holding' && (
                        <XStack ai='center' space='$2' bg='rgba(34,197,94,0.25)' px='$4' py='$2' borderRadius={999} borderWidth={1} borderColor='#22c55e'>
                            <FontAwesomeIcon icon={faCheck} size={14} color='#22c55e' />
                            <Text color='#22c55e' fontSize={15} fontWeight='700' textAlign='center'>
                                Face detected - hold still...
                            </Text>
                        </XStack>
                    )}
                    {phase === 'capturing' && (
                        <XStack ai='center' space='$2' bg='rgba(0,0,0,0.45)' px='$4' py='$2' borderRadius={999}>
                            <Spinner size='small' color='#fff' />
                            <Text color='#fff' fontSize={15} fontWeight='600'>
                                Capturing...
                            </Text>
                        </XStack>
                    )}
                </YStack>
            </View>

            {phase === 'captured' && capturedPhoto && (
                <YStack
                    pos='absolute'
                    bottom={0}
                    left={0}
                    right={0}
                    pt='$4'
                    px='$4'
                    space='$3'
                    bg='rgba(12,12,14,0.85)'
                    borderTopLeftRadius='$7'
                    borderTopRightRadius='$7'
                    style={{ paddingBottom: insets.bottom + 16 }}
                >
                    <XStack ai='center' jc='center' space='$2'>
                        <FontAwesomeIcon icon={faCheck} size={18} color='#22c55e' />
                        <Text color='#fff' fontSize={16} fontWeight='700'>
                            Face captured
                        </Text>
                    </XStack>
                    <XStack space='$3'>
                        <Button flex={1} size='$5' bg='rgba(255,255,255,0.12)' borderWidth={1} borderColor='rgba(255,255,255,0.2)' onPress={handleRetake}>
                            <Button.Icon>
                                <FontAwesomeIcon icon={faRotateLeft} size={14} color='#fff' />
                            </Button.Icon>
                            <Button.Text color='#fff' fontWeight='600'>
                                Retake
                            </Button.Text>
                        </Button>
                        <Button flex={1} size='$5' bg='$success' onPress={handleUsePhoto}>
                            <Button.Text color='white' fontWeight='700'>
                                Use Photo
                            </Button.Text>
                        </Button>
                    </XStack>
                </YStack>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    topScrim: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    bottomScrim: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 160,
    },
    faceGuide: {
        width: 220,
        height: 290,
        borderRadius: 140,
        borderWidth: 4,
        borderStyle: 'dashed',
    },
});

export default FaceAutoCaptureCamera;

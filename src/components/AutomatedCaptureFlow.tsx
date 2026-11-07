import React, { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Image, Spinner, Text, XStack, YStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import FaceAutoCaptureCamera, { CapturedPhoto } from './FaceAutoCaptureCamera';
import IdDocumentScanner from './IdDocumentScanner';
import { toast } from '../utils/toast';
import { PhoneCheck, acceptFailedPhoto, checkIdPhoto, retakeAlert, shrinkPhoto } from '../utils/photo-capture';

export type PhotoChecks = {
    lva_face: PhoneCheck;
    lva_id: PhoneCheck;
    lva_id_back: PhoneCheck;
};

export type CapturedPhotoSet = {
    facePhoto: string;
    documentFront: string;
    documentBack: string;
    checks: PhotoChecks;
};

// How many tries the visit has used: face captures, and the failed checks of each ID side. The wizard owns this object so a remount of the flow does not reset it.
export type CaptureAttempts = { face: number; frontFailures: number; backFailures: number };

type AutomatedCaptureFlowProps = {
    onComplete: (photos: CapturedPhotoSet) => void;
    photoMaxAttempts: number;
    attempts: React.MutableRefObject<CaptureAttempts>;
};

type IdSide = 'front' | 'back';

type SubStep = 'face' | 'document-front' | 'document-back' | 'review';

// Maps the fine-grained sub-steps to the 3 steps shown in the overlay indicator.
const STEP_GROUPS: { key: 'face' | 'document' | 'review'; label: string; subSteps: SubStep[] }[] = [
    { key: 'face', label: 'Face', subSteps: ['face'] },
    { key: 'document', label: 'ID', subSteps: ['document-front', 'document-back'] },
    { key: 'review', label: 'Review', subSteps: ['review'] },
];

/**
 * Fully automated capture sequence:
 *   1. Face/selfie auto-capture (ML Kit face detection, see FaceAutoCaptureCamera)
 *   2. ID front, then ID back, auto-capture (native document scanner, see IdDocumentScanner) -
 *      scanned as two independent sessions so either side can be retaken on its own.
 *      Each scan is shrunk and checked on the phone (see photo-capture); a failed check shows a retake alert and opens the scanner again, and the Nth failed check of a side is accepted anyway.
 *   3. Review - all three photos stay on screen so the driver can retake any of them;
 *      advancing past this checkpoint requires an explicit "Continue" tap (no auto-advance
 *      timer here - a timer previously raced against the Retake tap and made it look broken).
 */
const AutomatedCaptureFlow: React.FC<AutomatedCaptureFlowProps> = ({ onComplete, photoMaxAttempts, attempts }) => {
    const insets = useSafeAreaInsets();
    const [subStep, setSubStep] = useState<SubStep>('face');
    const [facePhoto, setFacePhoto] = useState<string | null>(null);
    const [documentFront, setDocumentFront] = useState<string | null>(null);
    const [documentBack, setDocumentBack] = useState<string | null>(null);
    // The side whose photo is being shrunk and checked, and the side whose retake alert is up. While either is set the scanner stays unmounted, because IdDocumentScanner opens a scan whenever it mounts.
    const [checking, setChecking] = useState<IdSide | null>(null);
    const [retakePending, setRetakePending] = useState<IdSide | null>(null);
    // Bumped by the alert's Retake, so the scanner's key changes and it mounts once more.
    const [scanCount, setScanCount] = useState(0);
    // handleScan reads these through refs so its identity, and the scanner callbacks built on it, do not change while a scanner is mounted (a new onComplete would restart the scan).
    const photoMaxAttemptsRef = useRef(photoMaxAttempts);
    photoMaxAttemptsRef.current = photoMaxAttempts;
    const attemptsRef = useRef(attempts);
    attemptsRef.current = attempts;
    const checksRef = useRef<Partial<PhotoChecks>>({});

    const handleFaceCaptured = useCallback(
        async (photo: CapturedPhoto) => {
            const shrunk = await shrinkPhoto(photo.uri);
            attemptsRef.current.current.face += 1;
            // The live detector captures only when exactly one face is held steady, so that is the face photo's check.
            checksRef.current.lva_face = { attempt: attemptsRef.current.current.face, result: 'pass', faceCount: 1, width: shrunk.width, height: shrunk.height, ratio: null };
            setFacePhoto(shrunk.uri);
            // If the ID photos are already captured (i.e. this was a retake of just the face
            // from the review screen), go straight back to review instead of forcing the ID
            // step to be redone too.
            setSubStep(documentFront && documentBack ? 'review' : 'document-front');
        },
        [documentFront, documentBack]
    );

    const handleDocumentFrontCaptured = useCallback(
        (uri: string) => {
            setDocumentFront(uri);
            // Same idea: if the back is already captured (retaking just the front from review),
            // skip straight back to review instead of forcing the back to be redone too.
            setSubStep(documentBack ? 'review' : 'document-back');
        },
        [documentBack]
    );

    const handleDocumentBackCaptured = useCallback((uri: string) => {
        setDocumentBack(uri);
        setSubStep('review');
    }, []);

    const handleScan = useCallback(
        async (side: IdSide, uri: string) => {
            setChecking(side);
            const failuresKey = side === 'front' ? 'frontFailures' : 'backFailures';
            const limit = photoMaxAttemptsRef.current;
            const shrunk = await shrinkPhoto(uri);
            const attempt = attemptsRef.current.current[failuresKey] + 1;
            const check = await checkIdPhoto(side, shrunk, attempt);
            const failed = check.result === 'fail_no_face' || check.result === 'fail_shape';
            if (failed && !acceptFailedPhoto(attempt, limit)) {
                attemptsRef.current.current[failuresKey] += 1;
                // Set retakePending before clearing checking, so the spinner stays up between the check and the alert even when each call renders on its own.
                setRetakePending(side);
                setChecking(null);
                const { title, message } = retakeAlert(side, check.result, attempt, limit);
                Alert.alert(
                    title,
                    message,
                    [
                        {
                            text: 'Retake',
                            onPress: () => {
                                // The alert's callback is not batched on the old architecture, so each call renders on its own. Bump the key first: the render that clears retakePending then already has the new key, and the scanner mounts once.
                                setScanCount((count) => count + 1);
                                setRetakePending(null);
                            },
                        },
                    ],
                    { cancelable: false }
                );
                return;
            }
            if (failed) {
                toast.info(`ID ${side} accepted after ${attempt} attempts.`);
            }
            if (side === 'front') {
                checksRef.current.lva_id = check;
                handleDocumentFrontCaptured(shrunk.uri);
            } else {
                checksRef.current.lva_id_back = check;
                handleDocumentBackCaptured(shrunk.uri);
            }
            // Clear checking last. Updates after an await are not batched on the old architecture, so clearing it first would render this side's scanner again before subStep moves on, and that mount starts a second scan.
            setChecking(null);
        },
        [handleDocumentFrontCaptured, handleDocumentBackCaptured]
    );

    const handleScanFront = useCallback((uri: string) => handleScan('front', uri), [handleScan]);

    const handleScanBack = useCallback((uri: string) => handleScan('back', uri), [handleScan]);

    const handleRetakeFace = useCallback(() => {
        setFacePhoto(null);
        setSubStep('face');
    }, []);

    const handleRetakeDocumentFront = useCallback(() => {
        setDocumentFront(null);
        setSubStep('document-front');
    }, []);

    const handleRetakeDocumentBack = useCallback(() => {
        setDocumentBack(null);
        setSubStep('document-back');
    }, []);

    const handleContinue = useCallback(() => {
        const { lva_face, lva_id, lva_id_back } = checksRef.current;
        if (!facePhoto || !documentFront || !documentBack || !lva_face || !lva_id || !lva_id_back) return;
        onComplete({ facePhoto, documentFront, documentBack, checks: { lva_face, lva_id, lva_id_back } });
    }, [facePhoto, documentFront, documentBack, onComplete]);

    const activeGroupIndex = STEP_GROUPS.findIndex((group) => group.subSteps.includes(subStep));

    return (
        <YStack flex={1} bg='#000'>
            {/* Step indicator overlays the camera instead of pushing it down - keeps the preview full-height */}
            <XStack
                pos='absolute'
                top={0}
                left={0}
                right={0}
                zIndex={10}
                jc='center'
                pt={insets.top + 10}
                pb='$2'
                space='$2'
                pointerEvents='none'
            >
                {STEP_GROUPS.map((group, index) => {
                    const isActive = index === activeGroupIndex;
                    const isDone = index < activeGroupIndex;
                    return (
                        <XStack
                            key={group.key}
                            ai='center'
                            space='$1.5'
                            bg={isActive ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.4)'}
                            borderWidth={isActive ? 0 : 1}
                            borderColor='rgba(255,255,255,0.4)'
                            px='$3'
                            py='$1.5'
                            borderRadius={999}
                        >
                            {isDone ? (
                                <FontAwesomeIcon icon={faCheck} size={11} color='#22c55e' />
                            ) : (
                                <Text fontSize={11} fontWeight='700' color={isActive ? '#000' : '#fff'}>
                                    {index + 1}
                                </Text>
                            )}
                            <Text fontSize={12} fontWeight='600' color={isActive ? '#000' : '#fff'}>
                                {group.label}
                            </Text>
                        </XStack>
                    );
                })}
            </XStack>

            <YStack flex={1}>
                {subStep === 'face' && <FaceAutoCaptureCamera onCapture={handleFaceCaptured} />}
                {(subStep === 'document-front' || subStep === 'document-back') &&
                    (checking || retakePending ? (
                        <YStack flex={1} ai='center' jc='center' bg='#000' space='$4'>
                            <Spinner size='small' color='#fff' />
                            <Text color='#fff' fontSize={15} textAlign='center'>
                                Checking the ID photo…
                            </Text>
                        </YStack>
                    ) : subStep === 'document-front' ? (
                        <IdDocumentScanner key={`front-${scanCount}`} side='front' onComplete={handleScanFront} />
                    ) : (
                        <IdDocumentScanner key={`back-${scanCount}`} side='back' onComplete={handleScanBack} />
                    ))}
                {subStep === 'review' && facePhoto && documentFront && documentBack && (
                    <YStack flex={1} bg='$background' px='$5' pt={insets.top + 64} space='$5' style={{ paddingBottom: insets.bottom + 20 }}>
                        <YStack ai='center' space='$1.5'>
                            <Text fontSize={20} fontWeight='700' color='$textPrimary' textAlign='center'>
                                Review your photos
                            </Text>
                            <Text fontSize={13} color='$textSecondary' textAlign='center'>
                                Tap Retake to redo a photo, or Continue when ready
                            </Text>
                        </YStack>

                        <XStack jc='space-around' flex={1} ai='center'>
                            <ReviewThumbnail label='Face' uri={facePhoto} onRetake={handleRetakeFace} />
                            <ReviewThumbnail label='ID Front' uri={documentFront} onRetake={handleRetakeDocumentFront} />
                            <ReviewThumbnail label='ID Back' uri={documentBack} onRetake={handleRetakeDocumentBack} />
                        </XStack>

                        <Button size='$5' bg='$success' onPress={handleContinue}>
                            <Button.Text color='white' fontWeight='700' fontSize={16}>
                                Continue
                            </Button.Text>
                        </Button>
                    </YStack>
                )}
            </YStack>
        </YStack>
    );
};

const ReviewThumbnail = ({ label, uri, onRetake }: { label: string; uri: string; onRetake: () => void }) => (
    <YStack ai='center' space='$2'>
        <YStack width={96} height={96} bg='$gray3' borderRadius='$5' overflow='hidden' borderWidth={1} borderColor='$borderColorWithShadow'>
            <Image source={{ uri }} width={96} height={96} />
        </YStack>
        <Text fontSize={12} fontWeight='600' color='$textPrimary'>
            {label}
        </Text>
        <Button size='$2' chromeless onPress={onRetake}>
            <Button.Icon>
                <FontAwesomeIcon icon={faRotateLeft} size={11} />
            </Button.Icon>
            <Button.Text fontSize={11} color='$info'>
                Retake
            </Button.Text>
        </Button>
    </YStack>
);

export default AutomatedCaptureFlow;

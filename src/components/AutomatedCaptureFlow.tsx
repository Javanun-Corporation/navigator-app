import React, { useCallback, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Image, Text, XStack, YStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import FaceAutoCaptureCamera, { CapturedPhoto } from './FaceAutoCaptureCamera';
import IdDocumentScanner from './IdDocumentScanner';

export type CapturedPhotoSet = {
    facePhoto: string;
    documentFront: string;
    documentBack: string;
};

type AutomatedCaptureFlowProps = {
    onComplete: (photos: CapturedPhotoSet) => void;
};

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
 *   3. Review - all three photos stay on screen so the driver can retake any of them;
 *      advancing past this checkpoint requires an explicit "Continue" tap (no auto-advance
 *      timer here - a timer previously raced against the Retake tap and made it look broken).
 */
const AutomatedCaptureFlow: React.FC<AutomatedCaptureFlowProps> = ({ onComplete }) => {
    const insets = useSafeAreaInsets();
    const [subStep, setSubStep] = useState<SubStep>('face');
    const [facePhoto, setFacePhoto] = useState<string | null>(null);
    const [documentFront, setDocumentFront] = useState<string | null>(null);
    const [documentBack, setDocumentBack] = useState<string | null>(null);

    const handleFaceCaptured = useCallback(
        (photo: CapturedPhoto) => {
            setFacePhoto(photo.uri);
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
        if (!facePhoto || !documentFront || !documentBack) return;
        onComplete({ facePhoto, documentFront, documentBack });
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
                {subStep === 'document-front' && <IdDocumentScanner side='front' onComplete={handleDocumentFrontCaptured} />}
                {subStep === 'document-back' && <IdDocumentScanner side='back' onComplete={handleDocumentBackCaptured} />}
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

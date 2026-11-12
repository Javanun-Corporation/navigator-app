//validationwizardscreen.tsx
import { Order } from '@fleetbase/sdk';
import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faChevronLeft, faChevronRight, faClipboardCheck, faNoteSticky, faXmark } from '@fortawesome/free-solid-svg-icons';
import AutomatedCaptureFlow, { CaptureAttempts, CapturedPhotoSet } from '../components/AutomatedCaptureFlow';
import LvaHandshakeStep from '../components/LvaHandshakeStep';
import ScoreInfoButton from '../components/ScoreInfoButton';
import ScoreWidgetDevToggle from '../components/ScoreWidgetDevToggle';
import { ScoreInputWidget } from '../components/score-inputs';
import { DEFAULT_SCORE_WIDGET_TYPE, SCORE_WIDGET_TYPE_STORAGE_KEY } from '../components/score-inputs/scoreNormalization';
import { useAuth } from '../contexts/AuthContext';
import { useTempStore } from '../contexts/TempStoreContext';
import useFleetbase from '../hooks/use-fleetbase';
import useStorage from '../hooks/use-storage';
import { readOrderToken, serverErrorMessage } from '../utils/beesure-handshake';
import { DEFAULT_PHOTO_MAX_ATTEMPTS } from '../utils/photo-capture';
import { createTryUploader, photoTryUrl, PhotoTry, TryRole, TryUploader } from '../utils/photo-tries';
import { toast } from '../utils/toast';

import Config from 'react-native-config';

const PRESIGN_API_URL = Config.PRESIGN_API_URL;
const VALIDATION_COMPLETE_API_URL = Config.VALIDATION_COMPLETE_API_URL;

const SCORE_LABELS = {
    resultScore: 'Result Score',
    confidenceScore: 'Confidence Score',
    likenessScore: 'Likeness Score',
    vibeCheckScore: 'Vibe Check Score',
};

const SCORE_DESCRIPTIONS = {
    resultScore: 'Overall outcome of this validation - how closely what you observed matches what was expected for this order.',
    confidenceScore: 'How confident you are in your assessment, based on photo clarity, lighting, and how clearly you could verify the subject.',
    likenessScore: 'How closely the subject in your photos matches the reference photo or description on file for this order.',
    vibeCheckScore: "A general gut-check of the situation - does anything about this delivery or validation feel off or inconsistent?",
};

const ValidationWizardScreen = ({ route }) => {
    const { activity, order: orderData } = route.params;
    const { adapter } = useFleetbase();
    const navigation = useNavigation();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const [scoreWidgetType] = useStorage(SCORE_WIDGET_TYPE_STORAGE_KEY, DEFAULT_SCORE_WIDGET_TYPE);

    const order = new Order(orderData, adapter);
    const { store, setValue } = useTempStore();

    // Safely default to empty values if they don't exist in the store yet
    const photos = store.validationPhotos || [];
    const notes = store.validationNotes || '';
    const resultScore = store.resultScore ?? null;
    const confidenceScore = store.confidenceScore ?? null;
    const likenessScore = store.likenessScore ?? null;
    const vibeCheckScore = store.vibeCheckScore ?? null;
    const subjectExists = store.subjectExists ?? true;

    // Wizard States
    const [step, setStep] = useState(0); // 0 = BeeSure handshake, 1 = Photos, 2 = Scores, 3 = Notes
    const [isSubmitting, setIsSubmitting] = useState(false); // Used for final submission

    // The limit from step 0 and the tries this visit has used. The counters live here, not in the capture flow, so the remount from step 2's Back does not reset them.
    const [photoMaxAttempts, setPhotoMaxAttempts] = useState(DEFAULT_PHOTO_MAX_ATTEMPTS);
    const captureAttempts = useRef<CaptureAttempts>({ face: 0, frontFailures: 0, backFailures: 0, tries: { lva_face: 0, lva_id: 0, lva_id_back: 0 } });

    // The uploader for this visit, made on first use because it needs the order token, and dropped with the visit's other state.
    const tryUploader = useRef<TryUploader | null>(null);
    const uploaderFor = (orderToken: string) => (tryUploader.current ??= createTryUploader({ presignUrl: PRESIGN_API_URL as string, tryUrl: photoTryUrl(VALIDATION_COMPLETE_API_URL as string), orderToken }));

    // Sends each photo try to the server in the background as it is taken. A missing token is not reported here, because the submit stops with its own message.
    const handleTry = (photoTry: PhotoTry) => {
        const orderToken = readOrderToken(order);
        if (orderToken) {
            uploaderFor(orderToken).add(photoTry);
        }
    };

    // Clear tempstore if the user navigates to a different order
    useEffect(() => {
        if (store.validationOrderId !== orderData.id) {
            captureAttempts.current = { face: 0, frontFailures: 0, backFailures: 0, tries: { lva_face: 0, lva_id: 0, lva_id_back: 0 } };
            tryUploader.current = null;
            setValue('validationPhotos', []);
            setValue('validationPhotoChecks', null);
            setValue('validationPhotoTryNos', null);
            setValue('validationNotes', '');
            setValue('resultScore', null);
            setValue('confidenceScore', null);
            setValue('likenessScore', null);
            setValue('vibeCheckScore', null);
            setValue('subjectExists', true);
            setValue('validationOrderId', orderData.id);
        }
    }, [orderData.id]);

    // Called once the automated face + ID document capture sequence completes (after the
    // user has had a chance to review/retake each photo). Advances straight to the scores step.
    const handleCaptureFlowComplete = ({ facePhoto, documentFront, documentBack, checks, tryNos }: CapturedPhotoSet) => {
        setValue('validationPhotos', [facePhoto, documentFront, documentBack]);
        setValue('validationPhotoChecks', checks);
        setValue('validationPhotoTryNos', tryNos);
        toast.success('Face and ID photos captured.');
        setStep(2);
    };

    const handleScoreChange = (key, value) => {
        setValue(key, value);
    };

    // Atomic Submission: S3 Uploads -> Fleetbase Activity Completion
    const runValidationSubmission = async () => {
        setIsSubmitting(true);

        try {
            // The token is the order's credential for the presign, the submit, and HandshakeHandler, minted at dispatch and kept in meta.beesure_token.
            const orderToken = readOrderToken(order);

            if (!orderToken) {
                console.warn('Missing beesure_token. order.id:', order.id, 'meta keys:', Object.keys(order.meta || (order.attributes && order.attributes.meta) || {}));
                throw new Error('Critical Error: This order is missing its BeeSure order token.');
            }

            // Photos are always captured and stored in this fixed order: face, ID front, ID back.
            const roles = ['lva_face', 'lva_id', 'lva_id_back'];
            const authHeaders = {
                'Content-Type': 'application/json',
                'X-BeeSure-Order-Token': orderToken,
            };

            // 1. The photos are normally on the server already, uploaded in the background as each try was taken.
            // 2. Ask the uploader for each final photo's key, which uploads it here only when its earlier upload did not go through.
            const attachments = {};
            for (let i = 0; i < roles.length; i++) {
                const role = roles[i] as TryRole;

                if (!photos[i]) {
                    throw new Error(`Missing photo or presigned URL for ${role}.`);
                }

                attachments[role] = await uploaderFor(orderToken).keyFor(role, photos[i]);
            }

            // 3. Beesure Backend Call - save the validation report
            if (!driver || !driver.id) {
                throw new Error('Critical Error: Driver session lost. Please log out and log back in.');
            }

            const payload = {
                fleetbaseDriverId: driver.id,
                reportType: 'LVA Field Report',
                reportDetails: notes,
                resultScore: store.resultScore,
                confidenceScore: store.confidenceScore,
                likenessScore: store.likenessScore,
                vibeCheckScore: store.vibeCheckScore,
                subjectExists: store.subjectExists,
                attachments,
                phoneChecks: store.validationPhotoChecks ? Object.fromEntries(Object.entries(store.validationPhotoChecks).map(([role, check]) => [role, { ...(check as object), tryNo: store.validationPhotoTryNos?.[role] }])) : undefined,
            };

            const reportRes = await fetch(VALIDATION_COMPLETE_API_URL, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(payload),
            });

            if (!reportRes.ok) {
                const bodyText = await reportRes.text().catch(() => '');
                console.warn('Validation report request failed:', reportRes.status, bodyText);
                const serverMessage = serverErrorMessage(bodyText);
                if (serverMessage) throw new Error(serverMessage);
                throw new Error(`Failed to save the validation report to BeeSure (HTTP ${reportRes.status}).`);
            }

            // 4. Close the Fleetbase activity with no report data and no proof, because BeeSure's handshake is the meeting's proof (HS11).
            await order.updateActivity({ activity: { ...activity, status: 'completed', code: 'completed' } });

            toast.success('Validation Submitted Successfully!');

            // Clear the temp store
            setValue('validationPhotos', []);
            tryUploader.current = null;
            setValue('validationPhotoChecks', null);
            setValue('validationPhotoTryNos', null);
            setValue('validationNotes', '');
            setValue('resultScore', null);
            setValue('confidenceScore', null);
            setValue('likenessScore', null);
            setValue('vibeCheckScore', null);
            setValue('subjectExists', true);
            setValue('validationOrderId', null);

            navigation.goBack();
        } catch (error) {
            console.error('Submission Flow Error:', error);
            Alert.alert('Submission Failed', error.message || 'An unexpected error occurred.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <YStack flex={1} bg='$background' safeArea>
            {/* --- STEP 0: BEESURE HANDSHAKE --- */}
            {step === 0 && <LvaHandshakeStep orderToken={readOrderToken(order)} driverId={driver?.id ?? null} onDone={(limit) => { setPhotoMaxAttempts(limit); setStep(1); }} onLeave={() => navigation.goBack()} />}

            {/* --- STEP 1: AUTOMATED FACE + ID CAPTURE --- */}
            {/* Full-bleed (no padding/heading) so the camera gets the entire screen - the step
                indicator and instructions are overlaid on top of the camera itself instead. */}
            {step === 1 && (
                <YStack flex={1} bg='#000'>
                    <AutomatedCaptureFlow onComplete={handleCaptureFlowComplete} photoMaxAttempts={photoMaxAttempts} attempts={captureAttempts} onTry={handleTry} />

                    {/* DEV BYPASS: Remove before pushing to production */}
                    {__DEV__ && (
                        <Button
                            pos='absolute'
                            top={insets.top + 10}
                            right='$3'
                            zIndex={20}
                            size='$2'
                            bg='$warning'
                            onPress={() => setStep(2)}
                        >
                            <Button.Text fontSize={11} fontWeight='700'>
                                [DEV] Skip
                            </Button.Text>
                        </Button>
                    )}
                </YStack>
            )}

            {/* --- STEPS 2-3: SCORES & NOTES --- */}
            {step > 1 && (
                <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                    {/* Progress pills shared by both steps */}
                    <XStack px='$4' pt='$4' pb='$1' space='$2'>
                        {[
                            { key: 2, label: 'Scores' },
                            { key: 3, label: 'Notes' },
                        ].map(({ key, label }) => {
                            const isActive = step === key;
                            const isDone = step > key;
                            return (
                                <XStack
                                    key={key}
                                    flex={1}
                                    ai='center'
                                    jc='center'
                                    space='$1.5'
                                    py='$2'
                                    borderRadius={999}
                                    bg={isActive ? '$info' : isDone ? '$success' : '$gray5'}
                                >
                                    {isDone ? (
                                        <FontAwesomeIcon icon={faCheck} size={11} color='#fff' />
                                    ) : (
                                        <Text fontSize={11} fontWeight='700' color={isActive ? 'white' : '$textSecondary'}>
                                            {key - 1}
                                        </Text>
                                    )}
                                    <Text fontSize={12} fontWeight='700' color={isActive || isDone ? 'white' : '$textSecondary'}>
                                        {label}
                                    </Text>
                                </XStack>
                            );
                        })}
                    </XStack>

                    {step === 2 && (
                        <YStack px='$4' pt='$4' space='$4' flex={1}>
                            <XStack ai='center' jc='space-between' flexWrap='wrap' gap='$2'>
                                <XStack ai='center' space='$2'>
                                    <FontAwesomeIcon icon={faClipboardCheck} size={16} color={theme.textPrimary?.val} />
                                    <Text fontSize={20} fontWeight='700' color='$textPrimary'>
                                        Validation Scores
                                    </Text>
                                </XStack>
                                <ScoreWidgetDevToggle />
                            </XStack>
                            <Text fontSize={13} color='$textSecondary' mt={-8}>
                                Rate each category based on what you observed
                            </Text>

                            {['resultScore', 'confidenceScore', 'likenessScore', 'vibeCheckScore'].map((scoreKey) => {
                                const values = {
                                    resultScore,
                                    confidenceScore,
                                    likenessScore,
                                    vibeCheckScore,
                                };

                                return (
                                    <YStack key={scoreKey} bg='$surface' borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$6' p='$4' space='$3'>
                                        <XStack ai='center' space='$2'>
                                            <Text fontSize={15} fontWeight='600' color='$textPrimary'>
                                                {SCORE_LABELS[scoreKey]}
                                            </Text>
                                            <ScoreInfoButton title={SCORE_LABELS[scoreKey]} description={SCORE_DESCRIPTIONS[scoreKey]} />
                                        </XStack>
                                        <ScoreInputWidget widgetType={scoreWidgetType} value={values[scoreKey]} onChange={(value) => handleScoreChange(scoreKey, value)} />
                                    </YStack>
                                );
                            })}

                            <YStack bg='$surface' borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$6' p='$4' space='$3'>
                                <Text fontSize={15} fontWeight='600' color='$textPrimary'>
                                    Subject Exists?
                                </Text>
                                <XStack bg='$gray3' borderRadius={999} p='$1' space='$1'>
                                    <Button flex={1} size='$3' borderRadius={999} bg={subjectExists ? '$success' : 'transparent'} onPress={() => setValue('subjectExists', true)}>
                                        <Button.Icon>
                                            <FontAwesomeIcon icon={faCheck} size={12} color={subjectExists ? 'white' : theme.textSecondary?.val} />
                                        </Button.Icon>
                                        <Button.Text color={subjectExists ? 'white' : '$textSecondary'} fontWeight='700'>
                                            Yes
                                        </Button.Text>
                                    </Button>
                                    <Button flex={1} size='$3' borderRadius={999} bg={!subjectExists ? '$error' : 'transparent'} onPress={() => setValue('subjectExists', false)}>
                                        <Button.Icon>
                                            <FontAwesomeIcon icon={faXmark} size={12} color={!subjectExists ? 'white' : theme.textSecondary?.val} />
                                        </Button.Icon>
                                        <Button.Text color={!subjectExists ? 'white' : '$textSecondary'} fontWeight='700'>
                                            No
                                        </Button.Text>
                                    </Button>
                                </XStack>
                            </YStack>

                            <YStack flex={1} justifyContent='flex-end' pt='$4'>
                                <XStack space='$3'>
                                    <Button flex={1} size='$5' bg='$gray5' onPress={() => setStep(1)}>
                                        <Button.Icon>
                                            <FontAwesomeIcon icon={faChevronLeft} size={13} color={theme.textPrimary?.val} />
                                        </Button.Icon>
                                        <Button.Text color='$textPrimary' fontWeight='600'>
                                            Back
                                        </Button.Text>
                                    </Button>
                                    <Button flex={2} size='$5' bg='$success' onPress={() => setStep(3)}>
                                        <Button.Text color='white' fontWeight='700'>
                                            Continue to Notes
                                        </Button.Text>
                                        <Button.Icon>
                                            <FontAwesomeIcon icon={faChevronRight} size={13} color='white' />
                                        </Button.Icon>
                                    </Button>
                                </XStack>
                            </YStack>
                        </YStack>
                    )}

                    {step === 3 && (
                        <YStack px='$4' pt='$4' space='$4' flex={1}>
                            <XStack ai='center' space='$2'>
                                <FontAwesomeIcon icon={faNoteSticky} size={16} color={theme.textPrimary?.val} />
                                <Text fontSize={20} fontWeight='700' color='$textPrimary'>
                                    Final Notes
                                </Text>
                            </XStack>
                            <Text fontSize={13} color='$textSecondary' mt={-8}>
                                Optional - add any additional context for this validation
                            </Text>

                            <YStack bg='$surface' borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$6' p='$1' space='$1'>
                                <TextInput
                                    style={{
                                        height: 160,
                                        padding: 12,
                                        textAlignVertical: 'top',
                                        color: theme.textPrimary?.val || 'black',
                                        fontSize: 15,
                                    }}
                                    multiline
                                    placeholder='Enter notes here...'
                                    placeholderTextColor={theme.textSecondary?.val || '#999'}
                                    value={notes}
                                    onChangeText={(text) => setValue('validationNotes', text)}
                                />
                            </YStack>

                            <YStack flex={1} justifyContent='flex-end' space='$3' pt='$4'>
                                <Button size='$5' bg='$success' onPress={runValidationSubmission} disabled={isSubmitting}>
                                    {isSubmitting ? (
                                        <Spinner color='white' />
                                    ) : (
                                        <XStack ai='center' space='$2'>
                                            <FontAwesomeIcon icon={faCheck} size={14} color='white' />
                                            <Text color='white' fontWeight='700' fontSize={16}>
                                                Complete & Finish Order
                                            </Text>
                                        </XStack>
                                    )}
                                </Button>
                                <Button size='$5' bg='$gray5' onPress={() => setStep(2)} disabled={isSubmitting}>
                                    <Button.Icon>
                                        <FontAwesomeIcon icon={faChevronLeft} size={13} color={theme.textPrimary?.val} />
                                    </Button.Icon>
                                    <Button.Text color='$textPrimary' fontWeight='600'>
                                        Back to Scores
                                    </Button.Text>
                                </Button>
                            </YStack>
                        </YStack>
                    )}
                </ScrollView>
            )}
        </YStack>
    );
};

export default ValidationWizardScreen;

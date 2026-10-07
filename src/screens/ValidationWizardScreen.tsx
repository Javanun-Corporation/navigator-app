//validationwizardscreen.tsx
import { Order, Place } from '@fleetbase/sdk';
import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faChevronLeft, faChevronRight, faClipboardCheck, faNoteSticky, faXmark } from '@fortawesome/free-solid-svg-icons';
import AutomatedCaptureFlow from '../components/AutomatedCaptureFlow';
import LoadingOverlay from '../components/LoadingOverlay';
import QrCodeScanner from '../components/QrCodeScanner';
import ScoreInfoButton from '../components/ScoreInfoButton';
import ScoreWidgetDevToggle from '../components/ScoreWidgetDevToggle';
import { ScoreInputWidget } from '../components/score-inputs';
import { DEFAULT_SCORE_WIDGET_TYPE, SCORE_WIDGET_TYPE_STORAGE_KEY } from '../components/score-inputs/scoreNormalization';
import { useAuth } from '../contexts/AuthContext';
import { useTempStore } from '../contexts/TempStoreContext';
import useFleetbase from '../hooks/use-fleetbase';
import useStorage from '../hooks/use-storage';
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
    const [step, setStep] = useState(0); // 0 = QR Handshake, 1 = Photos, 2 = Scores, 3 = Notes
    const [isLoading, setIsLoading] = useState(false); // Used for UI loading overlays
    const [isScanning, setIsScanning] = useState(true); // Prevents rapid-fire scans
    const [isSubmitting, setIsSubmitting] = useState(false); // Used for final submission

    // Clear tempstore if the user navigates to a different order
    useEffect(() => {
        if (store.validationOrderId !== orderData.id) {
            setValue('validationPhotos', []);
            setValue('validationNotes', '');
            setValue('resultScore', null);
            setValue('confidenceScore', null);
            setValue('likenessScore', null);
            setValue('vibeCheckScore', null);
            setValue('subjectExists', true);
            setValue('validationOrderId', orderData.id);
        }
    }, [orderData.id]);

    // Handle QR Code Scan - SERVER SIDE VALIDATION
    // Fires automatically the instant the scanner reads a valid code - there is no
    // manual "confirm" step, the handshake kicks off immediately.
    const handleQrCodeScan = async (data) => {
        if (!isScanning) return;
        setIsScanning(false);

        const scannedValue = data?.value || data?.data || data;
        console.log('📸 SCANNER FIRED! Scanned:', scannedValue);

        let subject;

        try {
            // Ultra-Safe Subject Resolution
            const waypointData = route.params?.waypoint || activity?.waypoint;
            const entity = route.params?.entity;

            const isWaypointActivity = waypointData && typeof waypointData.tracking === 'string' && waypointData.tracking.trim() !== '';

            if (isWaypointActivity) {
                subject = new Place(waypointData, adapter);
            } else if (entity) {
                subject = entity;
            } else {
                subject = order;
            }
        } catch (err) {
            console.log('❌ FATAL EXTRACTION CRASH:', err);
            setIsScanning(true);
            return;
        }

        // Hit Fleetbase API to validate the QR code immediately
        setIsLoading(true); // Turn on the verifying overlay
        try {
            console.log(`Sending Handshake to Fleetbase API...`);
            const proof = await order.captureQrCode(subject, {
                code: scannedValue,
                waypoint: activity?.waypoint_uuid || route.params?.waypoint?.id,
            });

            if (proof && proof.id) {
                console.log('✅ SUCCESS: Handshake accepted, Proof ID:', proof.id);
                toast.success('Handshake verified!');

                // Save the Proof ID to your temp store so we can attach it at the end
                setValue('fleetbaseProofId', proof.id);
                setStep(1); // Move to photos - automatically, no manual confirmation
            } else {
                throw new Error('No proof returned.');
            }
        } catch (error) {
            console.log('❌ HANDSHAKE REJECTED:', error);
            Alert.alert('Invalid Handshake', 'Fleetbase rejected this QR code. Are you sure this is the right item?', [{ text: 'Try Again', onPress: () => setIsScanning(true) }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Called once the automated face + ID document capture sequence completes (after the
    // user has had a chance to review/retake each photo). Advances straight to the scores step.
    const handleCaptureFlowComplete = ({ facePhoto, documentFront, documentBack }) => {
        setValue('validationPhotos', [facePhoto, documentFront, documentBack]);
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
            // The BeeSure order token is minted once at order-dispatch time and stored in the
            // Fleetbase order's own meta (FleetbaseOrderDispatcher sets meta.beesure_token when
            // the order is created). It's the credential the presign/validation-complete
            // endpoints require via the X-BeeSure-Order-Token header - it has nothing to do with
            // the QR code scanned in step 0, which is a separate Fleetbase proof-of-delivery check.
            const meta = order.meta || (order.attributes && order.attributes.meta) || {};
            const orderToken = meta.beesure_token;

            if (!orderToken) {
                throw new Error('Critical Error: This order is missing its BeeSure order token.');
            }

            // Photos are always captured and stored in this fixed order: face, ID front, ID back.
            const roles = ['lva_face', 'lva_id', 'lva_id_back'];
            const authHeaders = {
                'Content-Type': 'application/json',
                'X-BeeSure-Order-Token': orderToken,
            };

            // 1. Request Pre-signed URLs from Beesure Backend
            const presignRes = await fetch(PRESIGN_API_URL, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ roles }),
            });

            if (!presignRes.ok) {
                const bodyText = await presignRes.text().catch(() => '');
                console.warn('Presign request failed:', presignRes.status, bodyText);
                throw new Error(`Failed to fetch pre-signed URLs (HTTP ${presignRes.status}).`);
            }
            const { presignedData } = await presignRes.json();

            // 2. Upload each photo to its matching presigned URL - matched by role, not array
            // index, since the backend returns presignedData tagged with the role it's for.
            const attachments = {};
            for (let i = 0; i < roles.length; i++) {
                const role = roles[i];
                const localUri = photos[i];
                const presigned = presignedData.find((p) => p.role === role);

                if (!localUri || !presigned) {
                    throw new Error(`Missing photo or presigned URL for ${role}.`);
                }

                const imgBlob = await (await fetch(localUri)).blob();
                const s3Res = await fetch(presigned.uploadUrl, {
                    method: 'PUT',
                    body: imgBlob,
                    headers: { 'Content-Type': imgBlob.type || 'image/jpeg' },
                });

                if (!s3Res.ok) throw new Error(`S3 Upload failed for ${role}`);
                attachments[role] = presigned.key;
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
            };

            const reportRes = await fetch(VALIDATION_COMPLETE_API_URL, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(payload),
            });

            if (!reportRes.ok) {
                const bodyText = await reportRes.text().catch(() => '');
                console.warn('Validation report request failed:', reportRes.status, bodyText);
                throw new Error(`Failed to save the validation report to BeeSure (HTTP ${reportRes.status}).`);
            }

            // 4. Call Fleetbase to complete the order activity status using the Proof ID from Step 0
            const fleetbasePayload = {
                activity: {
                    ...activity,
                    status: 'completed',
                    code: 'completed',
                },
                proof: store.fleetbaseProofId, // Retrieve from temp store
                attributes: {
                    validation_notes: notes,
                    validation_attachments: attachments,
                },
            };

            await order.updateActivity(fleetbasePayload);

            toast.success('Validation Submitted Successfully!');

            // Clear the temp store
            setValue('validationPhotos', []);
            setValue('validationNotes', '');
            setValue('resultScore', null);
            setValue('confidenceScore', null);
            setValue('likenessScore', null);
            setValue('vibeCheckScore', null);
            setValue('subjectExists', true);
            setValue('fleetbaseProofId', null);
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
            <LoadingOverlay visible={isLoading} text='Verifying Handshake...' />

            {/* --- STEP 0: QR HANDSHAKE --- */}
            {step === 0 && (
                <YStack flex={1} padding='$4'>
                    <YStack mb='$4'>
                        <Text fontSize={24} fontWeight='bold'>
                            QR Handshake
                        </Text>
                        <Text fontSize={16} color='$textPrimary' mt='$2'>
                            Scan the customer's QR code to verify the order and begin validation.
                        </Text>
                    </YStack>

                    <YStack flex={1} overflow='hidden' borderRadius='$4'>
                        {isScanning && <QrCodeScanner onScan={handleQrCodeScan} />}
                    </YStack>

                    {/* DEV BYPASS: Remove before pushing to production */}
                    {__DEV__ && (
                        <Button mt='$4' bg='$warning' onPress={() => setStep(1)}>
                            [DEV] Skip Handshake
                        </Button>
                    )}
                </YStack>
            )}

            {/* --- STEP 1: AUTOMATED FACE + ID CAPTURE --- */}
            {/* Full-bleed (no padding/heading) so the camera gets the entire screen - the step
                indicator and instructions are overlaid on top of the camera itself instead. */}
            {step === 1 && (
                <YStack flex={1} bg='#000'>
                    <AutomatedCaptureFlow onComplete={handleCaptureFlowComplete} />

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

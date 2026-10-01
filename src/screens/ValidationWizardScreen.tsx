//validationwizardscreen.tsx
import { Order, Place } from '@fleetbase/sdk';
import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, TextInput } from 'react-native';
import ImagePicker from 'react-native-image-crop-picker';
import { Button, Image, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import LoadingOverlay from '../components/LoadingOverlay';
import QrCodeScanner from '../components/QrCodeScanner';
import { useAuth } from '../contexts/AuthContext';
import { useOrderManager } from '../contexts/OrderManagerContext';
import { useTempStore } from '../contexts/TempStoreContext';
import useFleetbase from '../hooks/use-fleetbase';
import { toast } from '../utils/toast';

import Config from 'react-native-config';

const PRESIGN_API_URL = Config.PRESIGN_API_URL;
const VALIDATION_COMPLETE_API_URL = Config.VALIDATION_COMPLETE_API_URL;

const ValidationWizardScreen = ({ route }) => {
    const { activity, order: orderData } = route.params;
    const { adapter } = useFleetbase();
    const navigation = useNavigation();
    const theme = useTheme();
    const { driver } = useAuth();
    const { updateStorageOrder, reloadCurrentOrders, reloadNearbyOrders } = useOrderManager();

    const order = new Order(orderData, adapter);
    const { store, setValue } = useTempStore();

    // Safely default to empty values if they don't exist in the store yet
    const facePhoto = store.validationFacePhoto || null;
    const idPhoto = store.validationIdPhoto || null;
    const notes = store.validationNotes || '';
    const resultScore = store.resultScore || '';
    const confidenceScore = store.confidenceScore || '';
    const likenessScore = store.likenessScore || '';
    const vibeCheckScore = store.vibeCheckScore || '';
    const subjectExists = store.subjectExists ?? true;

    // Wizard States
    const [step, setStep] = useState(0); // 0 = QR Handshake, 1 = Face, 2 = ID, 3 = Scores, 4 = Notes
    const [isLoading, setIsLoading] = useState(false); // Used for UI loading overlays
    const [isScanning, setIsScanning] = useState(true); // Prevents rapid-fire scans
    const [isSubmitting, setIsSubmitting] = useState(false); // Used for final submission

    // New State for Decoupled Handshake
    const [scannedQrValue, setScannedQrValue] = useState(null);
    const [qrSubject, setQrSubject] = useState(null);

    // Clear tempstore if the user navigates to a different order
    useEffect(() => {
        if (store.validationOrderId !== orderData.id) {
            setValue('validationFacePhoto', null);
            setValue('validationIdPhoto', null);
            setValue('validationNotes', '');
            setValue('resultScore', '');
            setValue('confidenceScore', '');
            setValue('likenessScore', '');
            setValue('vibeCheckScore', '');
            setValue('subjectExists', true);
            setValue('validationOrderId', orderData.id);
        }
    }, [orderData.id]);

    // Handle QR Code Scan - SERVER SIDE VALIDATION
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
                setStep(1); // Move to photos
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

    // Helper to ensure scores stay between 0 and 100
    const handleScoreChange = (key, text) => {
        const numericValue = text.replace(/[^0-9]/g, '');
        if (numericValue === '') {
            setValue(key, '');
            return;
        }
        const val = parseInt(numericValue, 10);
        if (val >= 0 && val <= 100) {
            setValue(key, val.toString());
        }
    };

    // Opens the native camera, crops the image, and stores the local path under the given temp-store key.
    const handleTakePhoto = async (storeKey) => {
        try {
            const image = await ImagePicker.openCamera({
                width: 1024,
                height: 1024,
                cropping: true,
                mediaType: 'photo',
                compressImageQuality: 0.8,
            });
            setValue(storeKey, image.path);
        } catch (error) {
            if (error.message !== 'User cancelled image selection') {
                console.warn('Camera Error:', error);
                Alert.alert('Error', 'Failed to open camera.');
            }
        }
    };

    // Atomic submission: presign (order token) → PUT both captures → POST scores + keys to BeeSure → close the Fleetbase activity with only the proof.
    const runValidationSubmission = async () => {
        setIsSubmitting(true);
        try {
            const meta = order.meta || (order.attributes && order.attributes.meta) || {};
            const orderToken = meta.beesure_token;
            if (!orderToken) {
                throw new Error('Critical Error: This order is missing the BeeSure order token.');
            }
            if (!driver || !driver.id) {
                throw new Error('Critical Error: Driver session lost. Please log out and log back in.');
            }
            const authHeaders = { 'Content-Type': 'application/json', 'X-BeeSure-Order-Token': orderToken };

            // 1. Presigned PUT URLs, one per role, keys derived by BeeSure.
            const presignRes = await fetch(PRESIGN_API_URL, { method: 'POST', headers: authHeaders, body: JSON.stringify({ roles: ['lva_face', 'lva_id'] }) });
            if (!presignRes.ok) throw new Error(`Failed to fetch pre-signed URLs (${presignRes.status}).`);
            const { presignedData } = await presignRes.json();
            const byRole = Object.fromEntries(presignedData.map((p) => [p.role, p]));
            if (!byRole.lva_face || !byRole.lva_id) throw new Error('Pre-sign response was incomplete.');

            // 2. Upload both captures straight to S3.
            for (const [role, localUri] of [['lva_face', facePhoto], ['lva_id', idPhoto]]) {
                const blob = await (await fetch(localUri)).blob();
                const s3Res = await fetch(byRole[role].uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
                if (!s3Res.ok) throw new Error(`S3 upload failed for ${role} (${s3Res.status}).`);
            }

            // 3. Report to BeeSure. reportId/validationId come from the token server-side.
            const payload = {
                fleetbaseDriverId: driver.id,
                reportType: 'LVA Field Report',
                reportDetails: notes,
                resultScore: store.resultScore === '' ? null : parseInt(store.resultScore, 10),
                confidenceScore: store.confidenceScore === '' ? null : parseInt(store.confidenceScore, 10),
                likenessScore: store.likenessScore === '' ? null : parseInt(store.likenessScore, 10),
                vibeCheckScore: store.vibeCheckScore === '' ? null : parseInt(store.vibeCheckScore, 10),
                subjectExists: !!store.subjectExists,
                attachments: { lva_face: byRole.lva_face.key, lva_id: byRole.lva_id.key },
            };
            const reportRes = await fetch(VALIDATION_COMPLETE_API_URL, { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
            if (!reportRes.ok) {
                const text = await reportRes.text();
                throw new Error(`Failed to save the validation report to BeeSure (${reportRes.status}): ${text}`);
            }

            // 4. Close the Fleetbase activity with the proof only — no report data or keys go to Fleetbase.
            const updatedOrder = await order.updateActivity({
                activity: { ...activity, status: 'completed', code: 'completed' },
                proof: store.fleetbaseProofId,
            });

            // 5. Push the closed order into the cached lists and refetch, so the orders screen shows it
            // completed as soon as the driver lands there instead of after a manual pull-to-refresh.
            if (updatedOrder && typeof updatedOrder.serialize === 'function') {
                updateStorageOrder(updatedOrder.serialize(), ['current', 'active', 'recent']);
            }
            reloadCurrentOrders({}, { setLoadingFlag: false });
            reloadNearbyOrders({}, { setLoadingFlag: false });

            toast.success('Validation Submitted Successfully!');

            setValue('validationFacePhoto', null);
            setValue('validationIdPhoto', null);
            setValue('validationNotes', '');
            setValue('resultScore', '');
            setValue('confidenceScore', '');
            setValue('likenessScore', '');
            setValue('vibeCheckScore', '');
            setValue('subjectExists', true);
            setValue('fleetbaseProofId', null);
            setValue('validationOrderId', null);

            // The order is finished for this driver, so return to the orders list (which also reloads on
            // focus) rather than the order screen underneath, which still holds the pre-submit order.
            navigation.navigate('DriverOrderManagement');
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
                        {isScanning && <QrCodeScanner onScan={handleQrCodeScan} manualCapture />}
                    </YStack>

                    {/* DEV BYPASS: Remove before pushing to production */}
                    {__DEV__ && (
                        <Button mt='$4' bg='$warning' onPress={() => setStep(1)}>
                            [DEV] Skip Handshake
                        </Button>
                    )}
                </YStack>
            )}

            {/* --- STEPS 1-3: VALIDATION WIZARD --- */}
            {step > 0 && (
                <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40, padding: 16 }}>
                    <Text fontSize={24} fontWeight='bold' mb='$4'>
                        Validation Step {step} of 4
                    </Text>

                    {step === 1 && (
                        <YStack space='$4' flex={1}>
                            <Text fontSize={16} color='$textPrimary'>
                                Take a clear photo of the subject's face.
                            </Text>
                            <Button onPress={() => handleTakePhoto('validationFacePhoto')} bg='$info' color='white' pressStyle={{ opacity: 0.8 }}>
                                {facePhoto ? 'Retake face photo' : 'Take face photo'}
                            </Button>
                            {facePhoto && (
                                <YStack width={160} height={160} bg='$gray3' borderRadius='$2' overflow='hidden'>
                                    <Image source={{ uri: facePhoto }} width={160} height={160} />
                                </YStack>
                            )}
                            <YStack flex={1} justifyContent='flex-end'>
                                <Button bg='$success' color='white' disabled={!facePhoto} opacity={facePhoto ? 1 : 0.5} onPress={() => setStep(2)}>
                                    Continue to ID
                                </Button>
                            </YStack>
                        </YStack>
                    )}

                    {step === 2 && (
                        <YStack space='$4' flex={1}>
                            <Text fontSize={16} color='$textPrimary'>
                                Take a photo of the subject's government ID, face side.
                            </Text>
                            <Button onPress={() => handleTakePhoto('validationIdPhoto')} bg='$info' color='white' pressStyle={{ opacity: 0.8 }}>
                                {idPhoto ? 'Retake ID photo' : 'Take ID photo'}
                            </Button>
                            {idPhoto && (
                                <YStack width={160} height={160} bg='$gray3' borderRadius='$2' overflow='hidden'>
                                    <Image source={{ uri: idPhoto }} width={160} height={160} />
                                </YStack>
                            )}
                            <YStack flex={1} justifyContent='flex-end' space='$3'>
                                <Button onPress={() => setStep(1)} bg='$gray5' color='$textPrimary'>
                                    Back to face
                                </Button>
                                <Button bg='$success' color='white' disabled={!idPhoto} opacity={idPhoto ? 1 : 0.5} onPress={() => setStep(3)}>
                                    Continue to Scores
                                </Button>
                            </YStack>
                        </YStack>
                    )}

                    {step === 3 && (
                        <YStack space='$4' flex={1}>
                            <Text fontSize={16} color='$textPrimary'>
                                Enter Validation Scores (0-100)
                            </Text>

                            {['resultScore', 'confidenceScore', 'likenessScore', 'vibeCheckScore'].map((scoreKey) => {
                                const labels = {
                                    resultScore: 'Result Score',
                                    confidenceScore: 'Confidence Score',
                                    likenessScore: 'Likeness Score',
                                    vibeCheckScore: 'Vibe Check Score',
                                };
                                const values = {
                                    resultScore,
                                    confidenceScore,
                                    likenessScore,
                                    vibeCheckScore,
                                };

                                return (
                                    <YStack key={scoreKey} space='$2'>
                                        <Text color='$textPrimary'>{labels[scoreKey]}</Text>
                                        <TextInput
                                            style={{
                                                height: 50,
                                                borderColor: theme.gray8?.val || '#ccc',
                                                borderWidth: 1,
                                                borderRadius: 8,
                                                padding: 12,
                                                color: theme.textPrimary?.val || 'black',
                                                backgroundColor: theme.background?.val,
                                            }}
                                            keyboardType='numeric'
                                            placeholder='0 - 100'
                                            placeholderTextColor='#999'
                                            value={values[scoreKey]}
                                            onChangeText={(text) => handleScoreChange(scoreKey, text)}
                                        />
                                    </YStack>
                                );
                            })}

                            <YStack space='$2' mt='$2'>
                                <Text color='$textPrimary'>Subject Exists?</Text>
                                <XStack space='$4'>
                                    <Button flex={1} bg={subjectExists ? '$info' : '$gray5'} color={subjectExists ? 'white' : '$textPrimary'} onPress={() => setValue('subjectExists', true)}>
                                        Yes
                                    </Button>
                                    <Button
                                        flex={1}
                                        bg={!subjectExists ? '$info' : '$gray5'}
                                        color={!subjectExists ? 'white' : '$textPrimary'}
                                        onPress={() => setValue('subjectExists', false)}
                                    >
                                        No
                                    </Button>
                                </XStack>
                            </YStack>

                            <YStack flex={1} justifyContent='flex-end' space='$3' mt='$4'>
                                <Button onPress={() => setStep(2)} bg='$gray5' color='$textPrimary'>
                                    Back to ID
                                </Button>
                                <Button bg='$success' color='white' onPress={() => setStep(4)}>
                                    Continue to Notes
                                </Button>
                            </YStack>
                        </YStack>
                    )}

                    {step === 4 && (
                        <YStack space='$4' flex={1}>
                            <Text fontSize={16} color='$textPrimary'>
                                Additional Validation Notes
                            </Text>

                            <TextInput
                                style={{
                                    height: 150,
                                    borderColor: theme.gray8?.val || '#ccc',
                                    borderWidth: 1,
                                    borderRadius: 8,
                                    padding: 12,
                                    textAlignVertical: 'top',
                                    color: theme.textPrimary?.val || 'black',
                                    backgroundColor: theme.background?.val,
                                }}
                                multiline
                                placeholder='Enter notes here...'
                                placeholderTextColor='#999'
                                value={notes}
                                onChangeText={(text) => setValue('validationNotes', text)}
                            />

                            <YStack flex={1} justifyContent='flex-end' space='$3'>
                                <Button onPress={() => setStep(3)} bg='$gray5' color='$textPrimary'>
                                    Back to Scores
                                </Button>

                                <Button bg='$success' onPress={runValidationSubmission} disabled={isSubmitting}>
                                    {isSubmitting ? (
                                        <Spinner color='white' />
                                    ) : (
                                        <Text color='white' fontWeight='600'>
                                            Complete & Finish Order
                                        </Text>
                                    )}
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput } from 'react-native';
import { Button, Spinner, Text, YStack, useTheme } from 'tamagui';
import QRCode from 'react-native-qrcode-svg';
import Config from 'react-native-config';
import LoadingOverlay from './LoadingOverlay';
import QrCodeScanner from './QrCodeScanner';
import { toast } from '../utils/toast';
import { DEFAULT_PHOTO_MAX_ATTEMPTS, formatCode, handshakeOutcome, handshakeUrl, isBeeSureQr, mergeHandshakeState, normaliseHandshakeInput, photoMaxAttemptsFrom, validationIdFromOrderToken } from '../utils/beesure-handshake';

// Step 0 of the validation wizard: BeeSure's half of the mutual QR handshake. The LVA shows their code and QR, takes the customer's code by scan or typing through HandshakeHandler (GET lva-code, POST lva-scan), and goes on to the photos once both sides have scanned (Met). There is no skip.

type HandshakeState = {
    lvaCode?: string;
    qrContent?: string;
    userScanned?: boolean;
    lvaScanned?: boolean;
    met?: boolean;
};

type HandshakeOutcome =
    | { kind: 'skip' }
    | { kind: 'met' }
    | { kind: 'advance' }
    | { kind: 'state'; state: HandshakeState }
    | { kind: 'stop'; message: string }
    | { kind: 'error'; message: string };

type Source = 'entry' | 'poll' | 'scan';

type Phase = 'loading' | 'blocked' | 'panel' | 'failed';

type LvaHandshakeStepProps = {
    orderToken: string | null;
    driverId: string | null;
    onDone: (photoMaxAttempts: number) => void;
    onLeave: () => void;
};

const POLL_INTERVAL_MS = 3000;
const NETWORK_ERROR = 'Network error during the handshake. Try again.';
const MISSING_TOKEN = 'This order is missing its BeeSure order token. Ask BeeSure support to replace the order.';
const MISSING_URL = 'This app has no BeeSure handshake address (HANDSHAKE_API_URL).';

export default function LvaHandshakeStep({ orderToken, driverId, onDone, onLeave }: LvaHandshakeStepProps) {
    const theme = useTheme();
    const baseUrl = Config.HANDSHAKE_API_URL || '';
    const validationId: string | null = useMemo(() => validationIdFromOrderToken(orderToken), [orderToken]);
    const blockedMessage = !validationId ? MISSING_TOKEN : !baseUrl ? MISSING_URL : null;

    const [phase, setPhase] = useState<Phase>(blockedMessage ? 'blocked' : 'loading');
    const [state, setState] = useState<HandshakeState | null>(null);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [posting, setPosting] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [retry, setRetry] = useState(0);

    // The wizard re-renders often (the temp-store reset, the driver's location updates), so the callbacks live in refs and the effects below never restart because of them.
    const onDoneRef = useRef(onDone);
    const onLeaveRef = useRef(onLeave);
    onDoneRef.current = onDone;
    onLeaveRef.current = onLeave;
    const photoMaxAttemptsRef = useRef(DEFAULT_PHOTO_MAX_ATTEMPTS);
    const doneRef = useRef(false);
    const stoppedRef = useRef(false);
    const mountedRef = useRef(false);
    const inFlightRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    // One HandshakeHandler request, mapped through handshakeOutcome. A non-2xx body is read once as text and parsed when it is JSON; a transport failure throws.
    const request = async (action: 'lva-code' | 'lva-scan', body?: object): Promise<HandshakeOutcome> => {
        const response = await fetch(handshakeUrl(baseUrl, validationId as string, action), {
            method: action === 'lva-scan' ? 'POST' : 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-BeeSure-Order-Token': orderToken as string,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        let parsed: any = null;
        if (response.ok) {
            parsed = await response.json().catch(() => null);
        } else {
            const text = await response.text();
            try {
                parsed = JSON.parse(text);
            } catch (parseError) {
                parsed = null;
            }
        }
        if (response.status === 200) {
            photoMaxAttemptsRef.current = photoMaxAttemptsFrom(parsed);
        }
        return handshakeOutcome(response.status, parsed);
    };

    const finish = (toastMessage: string | null) => {
        if (doneRef.current || stoppedRef.current || !mountedRef.current) {
            return;
        }
        doneRef.current = true;
        clearTimer();
        if (toastMessage) {
            toast.success(toastMessage);
        }
        onDoneRef.current(photoMaxAttemptsRef.current);
    };

    // The first report_expired or handshake_driver_mismatch ends the step: one alert, and its OK leaves the wizard. Every later answer is dropped.
    const stop = (message: string) => {
        if (stoppedRef.current || doneRef.current) {
            return;
        }
        stoppedRef.current = true;
        clearTimer();
        Alert.alert('Handshake stopped', message, [{ text: 'OK', onPress: () => onLeaveRef.current() }], { cancelable: false });
    };

    const apply = (outcome: HandshakeOutcome, source: Source) => {
        if (stoppedRef.current || doneRef.current || !mountedRef.current) {
            return;
        }
        switch (outcome.kind) {
            case 'skip':
                toast.info('This order has no customer handshake.');
                finish(null);
                return;
            case 'met':
                finish(source === 'entry' ? null : 'Handshake complete.');
                return;
            case 'advance':
                finish(null);
                return;
            case 'stop':
                stop(outcome.message);
                return;
            case 'state':
                // Every answer goes through mergeHandshakeState, so a poll answered after a scan never moves the panel back.
                setState((previous) => mergeHandshakeState(previous, outcome.state));
                if (source === 'entry') {
                    setPhase('panel');
                }
                return;
            case 'error':
                if (source === 'entry') {
                    setError(outcome.message);
                    setPhase('failed');
                } else if (source === 'scan') {
                    setError(outcome.message);
                }
                // A poll error is ignored: the panel keeps its last state and the next poll runs.
                return;
        }
    };

    // The entry GET runs again only for a new validation id or a Try again tap.
    useEffect(() => {
        if (blockedMessage) {
            setPhase('blocked');
            return;
        }
        setPhase('loading');
        setError(null);
        request('lva-code')
            .then((outcome) => apply(outcome, 'entry'))
            .catch(() => {
                if (mountedRef.current && !stoppedRef.current && !doneRef.current) {
                    setError(NETWORK_ERROR);
                    setPhase('failed');
                }
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validationId, retry]);

    // The poll: one setTimeout chain while the panel shows and the order is not Met, so never two polls at once. It stops on Met, on a stop and on unmount.
    useEffect(() => {
        if (phase !== 'panel' || state?.met || stoppedRef.current || doneRef.current) {
            return;
        }
        let active = true;
        const schedule = () => {
            timerRef.current = setTimeout(async () => {
                timerRef.current = null;
                try {
                    const outcome = await request('lva-code');
                    if (active) {
                        apply(outcome, 'poll');
                    }
                } catch (pollError) {
                    // A network failure is ignored like an error answer.
                }
                if (active && mountedRef.current && !stoppedRef.current && !doneRef.current) {
                    schedule();
                }
            }, POLL_INTERVAL_MS);
        };
        schedule();
        return () => {
            active = false;
            clearTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, state?.met]);

    // POST lva-scan with the customer's code (typed or scanned). The ref guard drops a second attempt while one is in flight, because the scanner fires again every 3 s.
    const postCode = async (code: string) => {
        if (inFlightRef.current || stoppedRef.current || doneRef.current) {
            return;
        }
        if (!driverId) {
            setError('Driver session lost. Please log out and log back in.');
            return;
        }
        inFlightRef.current = true;
        setPosting(true);
        setError(null);
        try {
            const outcome = await request('lva-scan', { code, driverId });
            apply(outcome, 'scan');
        } catch (postError) {
            if (mountedRef.current && !stoppedRef.current && !doneRef.current) {
                setError(NETWORK_ERROR);
            }
        } finally {
            inFlightRef.current = false;
            if (mountedRef.current) {
                setPosting(false);
            }
        }
    };

    const submitTyped = () => {
        if (typed.length === 0 || inFlightRef.current || !validationId) {
            return;
        }
        const parsed = normaliseHandshakeInput(typed, validationId);
        if (!parsed.ok) {
            setError(parsed.reason === 'other_order' ? 'That QR code belongs to a different order.' : 'That is not a BeeSure code. Check the 8 characters and try again.');
            return;
        }
        postCode(typed.trim());
    };

    // The scanner hands over the vision-camera code object. Only a BeeSure QR (BSQ1.) is taken; anything else is ignored and the camera stays open.
    const handleScan = (data: any) => {
        if (inFlightRef.current) {
            return;
        }
        const text = data?.value || data?.data || data;
        if (!isBeeSureQr(text)) {
            return;
        }
        setCameraOpen(false);
        postCode(String(text).trim());
    };

    const header = (
        <YStack marginBottom='$4'>
            <Text fontSize={24} fontWeight='bold'>
                QR Handshake
            </Text>
            <Text fontSize={16} color='$textPrimary' marginTop='$2'>
                Show the customer your code, then scan or type theirs.
            </Text>
        </YStack>
    );

    if (phase === 'blocked' || phase === 'loading' || phase === 'failed') {
        return (
            <YStack flex={1} padding='$4'>
                {header}
                {phase === 'blocked' && (
                    <Text fontSize={16} color='$errorBorder'>
                        {blockedMessage}
                    </Text>
                )}
                {phase === 'loading' && (
                    <YStack alignItems='center' marginTop='$6' gap='$3'>
                        <Spinner color='$textPrimary' />
                        <Text fontSize={16} color='$textPrimary'>
                            Loading the handshake...
                        </Text>
                    </YStack>
                )}
                {phase === 'failed' && (
                    <YStack gap='$3'>
                        <Text fontSize={16} color='$errorBorder'>
                            {error}
                        </Text>
                        <Button size='$5' backgroundColor='$gray5' onPress={() => setRetry((count) => count + 1)}>
                            <Button.Text color='$textPrimary' fontWeight='600'>
                                Try again
                            </Button.Text>
                        </Button>
                    </YStack>
                )}
            </YStack>
        );
    }

    const lvaCode = state?.lvaCode;
    const qrContent = state?.qrContent;
    const lvaScanned = state?.lvaScanned === true;
    const userScanned = state?.userScanned === true;
    const submitDisabled = typed.length === 0 || posting;

    return (
        <YStack flex={1}>
            <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {header}

                {lvaCode && (
                    <Text fontSize={20} fontWeight='700' color='$textPrimary' textAlign='center'>
                        {`Your code: ${formatCode(lvaCode)}`}
                    </Text>
                )}

                {qrContent && (
                    <YStack alignSelf='center' backgroundColor='white' borderRadius='$4' marginTop='$3'>
                        <QRCode value={qrContent} size={240} quietZone={16} ecl='M' backgroundColor='white' color='black' />
                    </YStack>
                )}

                <YStack marginTop='$5' gap='$3'>
                    <Text fontSize={15} fontWeight='600' color='$textPrimary'>
                        Type the customer's code
                    </Text>
                    <YStack backgroundColor='$surface' borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$6' padding='$1'>
                        <TextInput
                            style={[styles.input, { color: theme.textPrimary?.val || 'black' }]}
                            placeholder='XXXX XXXX'
                            placeholderTextColor={theme.textSecondary?.val || '#999'}
                            autoCapitalize='characters'
                            autoCorrect={false}
                            maxLength={20}
                            returnKeyType='send'
                            onSubmitEditing={submitTyped}
                            value={typed}
                            onChangeText={setTyped}
                        />
                    </YStack>
                    <Button size='$5' backgroundColor='$success' onPress={submitTyped} disabled={submitDisabled} opacity={submitDisabled ? 0.6 : 1}>
                        <Button.Text color='white' fontWeight='700'>
                            Submit code
                        </Button.Text>
                    </Button>
                    <Button size='$5' backgroundColor='$gray5' onPress={() => setCameraOpen((open) => !open)}>
                        <Button.Text color='$textPrimary' fontWeight='600'>
                            {cameraOpen ? 'Close camera' : "Scan the customer's code"}
                        </Button.Text>
                    </Button>
                    {cameraOpen && (
                        <YStack width={280} height={280} alignSelf='center' overflow='hidden' borderRadius='$4'>
                            <QrCodeScanner onScan={handleScan} />
                        </YStack>
                    )}
                </YStack>

                <YStack marginTop='$4' gap='$2'>
                    {lvaScanned && (
                        <Text fontSize={15} color='$textPrimary'>
                            You scanned the customer's code ✓
                        </Text>
                    )}
                    {userScanned && (
                        <Text fontSize={15} color='$textPrimary'>
                            The customer scanned your code ✓
                        </Text>
                    )}
                    {lvaScanned && !userScanned && (
                        <Text fontSize={15} color='$textSecondary'>
                            Waiting for the customer to scan your code
                        </Text>
                    )}
                    {error && (
                        <Text fontSize={15} color='$errorBorder'>
                            {error}
                        </Text>
                    )}
                </YStack>
            </ScrollView>

            <LoadingOverlay visible={posting} text='Checking the code...' />
        </YStack>
    );
}

const styles = StyleSheet.create({
    content: { flexGrow: 1, padding: 16, paddingBottom: 32 },
    input: { padding: 12, fontSize: 18, letterSpacing: 2 },
});

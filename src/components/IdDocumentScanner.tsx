import React, { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';
import { Button, Spinner, Text, XStack, YStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faIdCard, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';

export type IdDocumentSide = 'front' | 'back';

type IdDocumentScannerProps = {
    side: IdDocumentSide;
    onComplete: (uri: string) => void;
};

/**
 * Drives the platform's native document scanner (VisionKit on iOS, ML Kit Document Scanner
 * on Android) to capture a single side of an ID. The native scanner does its own live
 * rectangle detection and auto-capture - this component just launches it automatically on
 * mount. Scanning one side at a time (rather than bundling front+back into one session) lets
 * the driver retake just the front or just the back without redoing the other one.
 */
const IdDocumentScanner: React.FC<IdDocumentScannerProps> = ({ side, onComplete }) => {
    const insets = useSafeAreaInsets();
    const [status, setStatus] = useState<'scanning' | 'error'>('scanning');

    const runScan = useCallback(async () => {
        setStatus('scanning');
        try {
            // Give the camera hardware a beat to fully release before the native scanner tries
            // to acquire it again - launching back-to-back scans (e.g. front then back) with no
            // gap can leave the native camera preview blank until some unrelated UI interaction
            // forces a redraw. This is a workaround for that resource-contention race, not
            // something fixable from the JS side since the scan itself runs in a native Activity.
            await new Promise((resolve) => setTimeout(resolve, 500));

            const result = await DocumentScanner.scanDocument({ maxNumDocuments: 1, responseType: ResponseType.ImageFilePath });

            if (result.status !== ScanDocumentResponseStatus.Success || !result.scannedImages || result.scannedImages.length === 0) {
                setStatus('error');
                return;
            }

            onComplete(result.scannedImages[0]);
        } catch (error) {
            console.warn('IdDocumentScanner: scan failed', error);
            setStatus('error');
        }
    }, [onComplete]);

    useEffect(() => {
        runScan();
    }, [runScan]);

    return (
        <YStack flex={1} ai='center' jc='center' bg='#000' space='$5' px='$6' style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
            {status === 'scanning' ? (
                <YStack ai='center' space='$4'>
                    <XStack ai='center' jc='center' width={72} height={72} borderRadius={36} bg='rgba(255,255,255,0.1)'>
                        <FontAwesomeIcon icon={faIdCard} size={30} color='#fff' />
                    </XStack>
                    <YStack ai='center' space='$2'>
                        <Text color='#fff' fontSize={17} fontWeight='700' textAlign='center'>
                            Opening ID scanner
                        </Text>
                        <Text color='rgba(255,255,255,0.65)' fontSize={14} textAlign='center'>
                            Align the {side} of their ID within the frame - it captures automatically.
                        </Text>
                    </YStack>
                    <Spinner size='small' color='#fff' />
                </YStack>
            ) : (
                <YStack ai='center' space='$4'>
                    <XStack ai='center' jc='center' width={72} height={72} borderRadius={36} bg='rgba(239,68,68,0.15)'>
                        <FontAwesomeIcon icon={faTriangleExclamation} size={28} color='#ef4444' />
                    </XStack>
                    <Text color='#fff' fontSize={16} fontWeight='600' textAlign='center'>
                        ID scan was cancelled or didn't complete
                    </Text>
                    <Button size='$5' bg='$info' onPress={runScan}>
                        <Button.Text color='white' fontWeight='700'>
                            Scan ID {side === 'front' ? 'Front' : 'Back'}
                        </Button.Text>
                    </Button>
                </YStack>
            )}
        </YStack>
    );
};

export default IdDocumentScanner;

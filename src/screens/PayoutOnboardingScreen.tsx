import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { SafeAreaView, Linking } from 'react-native';
import { Spinner, Button, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCircleCheck, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';
import { useAuth } from '../contexts/AuthContext';
import { getConnectStatus, createOnboardingLink } from '../utils/payoutsApi';
import { toast } from '../utils/toast';

const STATUS_LABELS = {
    not_started: 'Not started',
    onboarding: 'Onboarding in progress',
    restricted: 'Action needed',
    enabled: 'Ready for payouts',
};

const PayoutOnboardingScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const { driver, authToken } = useAuth();
    const [status, setStatus] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLaunching, setIsLaunching] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const result = await getConnectStatus({ driver, authToken });
            setStatus(result);
        } catch (err) {
            console.warn('[PayoutOnboardingScreen] Failed to load Connect status:', err);
            toast.error('Unable to load payout setup status.');
        }
    }, [driver, authToken]);

    useEffect(() => {
        if (!isFocused) return;
        (async () => {
            setIsLoading(true);
            await loadStatus();
            setIsLoading(false);
        })();
    }, [isFocused, loadStatus]);

    const handleSetUpPayouts = async () => {
        setIsLaunching(true);
        try {
            const { url } = await createOnboardingLink({ driver, authToken });
            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
            } else {
                toast.error('Unable to open the payout setup link.');
            }
        } catch (err) {
            console.warn('[PayoutOnboardingScreen] Failed to create onboarding link:', err);
            toast.error('Unable to start payout setup. Please try again.');
        } finally {
            setIsLaunching(false);
        }
    };

    const isEnabled = status?.payoutsEnabled;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <YStack flex={1} px='$4' pt='$3'>
                <XStack alignItems='center' gap='$3' mb='$5'>
                    <BackButton onPress={() => navigation.goBack()} />
                    <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                        Payout Setup
                    </Text>
                </XStack>
                {isLoading ? (
                    <YStack flex={1} alignItems='center' justifyContent='center'>
                        <Spinner size='large' color='$textPrimary' />
                    </YStack>
                ) : (
                    <YStack space='$4'>
                        <XStack alignItems='center' space='$3' bg='$secondary' p='$4' rounded>
                            {isEnabled ? <FontAwesomeIcon icon={faCircleCheck} color={theme.success.val} size={20} /> : null}
                            <YStack flex={1}>
                                <Text color='$textPrimary' fontWeight='bold'>
                                    {STATUS_LABELS[status?.stripeAccountStatus] ?? STATUS_LABELS.not_started}
                                </Text>
                                <Text color='$textSecondary' fontSize='$3'>
                                    Connect a bank account to receive your validation bonuses.
                                </Text>
                            </YStack>
                        </XStack>
                        <Button size='$5' onPress={handleSetUpPayouts} bg='$primary' width='100%' opacity={isLaunching ? 0.75 : 1} disabled={isLaunching} rounded>
                            <Button.Icon>{isLaunching ? <Spinner color='$white' /> : <FontAwesomeIcon icon={faArrowUpRightFromSquare} color={theme.white.val} />}</Button.Icon>
                            <Button.Text color='$white' fontWeight='bold'>
                                {isEnabled ? 'Update payout details' : 'Set up payouts'}
                            </Button.Text>
                        </Button>
                    </YStack>
                )}
            </YStack>
        </SafeAreaView>
    );
};

export default PayoutOnboardingScreen;

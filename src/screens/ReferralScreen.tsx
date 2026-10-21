import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, Share } from 'react-native';
import { Spinner, Button, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faShareNodes } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';
import { useAuth } from '../contexts/AuthContext';
import { getReferralInfo, formatCents } from '../utils/payoutsApi';
import { toast } from '../utils/toast';

const ReferralScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const { driver, authToken } = useAuth();
    const [referral, setReferral] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const result = await getReferralInfo({ driver, authToken });
                setReferral(result);
            } catch (err) {
                console.warn('[ReferralScreen] Failed to load referral info:', err);
                toast.error('Unable to load your referral code.');
            } finally {
                setIsLoading(false);
            }
        })();
    }, [driver, authToken]);

    const handleShare = async () => {
        if (!referral?.code) return;

        try {
            await Share.share({
                message: `Join me as a driver on beeSure LVA — use my referral code ${referral.code} when you sign up.`,
            });
        } catch (err) {
            console.warn('[ReferralScreen] Failed to share referral code:', err);
        }
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <YStack flex={1} px='$4' pt='$3'>
                <XStack alignItems='center' gap='$3' mb='$5'>
                    <BackButton onPress={() => navigation.goBack()} />
                    <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                        Refer a Friend
                    </Text>
                </XStack>
                {isLoading ? (
                    <YStack flex={1} alignItems='center' justifyContent='center'>
                        <Spinner size='large' color='$textPrimary' />
                    </YStack>
                ) : (
                    <YStack space='$5'>
                        <Text color='$textSecondary'>Share your code. When a driver you refer completes their 10th validation, you earn a bonus.</Text>
                        <YStack bg='$secondary' p='$5' rounded alignItems='center'>
                            <Text color='$textSecondary' fontSize='$3'>
                                Your referral code
                            </Text>
                            <Text color='$textPrimary' fontSize='$10' fontWeight='bold' letterSpacing={2}>
                                {referral?.code}
                            </Text>
                        </YStack>
                        <XStack justifyContent='space-between'>
                            <YStack alignItems='center' flex={1}>
                                <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                                    {referral?.referralsCount ?? 0}
                                </Text>
                                <Text color='$textSecondary' fontSize='$3'>
                                    Referrals
                                </Text>
                            </YStack>
                            <YStack alignItems='center' flex={1}>
                                <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                                    {formatCents(referral?.totalEarningsCents)}
                                </Text>
                                <Text color='$textSecondary' fontSize='$3'>
                                    Earned
                                </Text>
                            </YStack>
                        </XStack>
                        <Button size='$5' onPress={handleShare} bg='$primary' width='100%' rounded>
                            <Button.Icon>
                                <FontAwesomeIcon icon={faShareNodes} color={theme.white.val} />
                            </Button.Icon>
                            <Button.Text color='$white' fontWeight='bold'>
                                Share my code
                            </Button.Text>
                        </Button>
                    </YStack>
                )}
            </YStack>
        </SafeAreaView>
    );
};

export default ReferralScreen;

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, FlatList, RefreshControl } from 'react-native';
import { Spinner, Text, XStack, YStack, Separator, useTheme } from 'tamagui';
import BackButton from '../components/BackButton';
import { useAuth } from '../contexts/AuthContext';
import { getPayoutHistory, formatCents } from '../utils/payoutsApi';
import { toast } from '../utils/toast';

const STATUS_LABELS = {
    pending: 'Pending',
    sandbox_recorded: 'Recorded (sandbox)',
    stripe_transfer_created: 'Processing',
    paid: 'Paid',
    failed: 'Failed',
};

const EarningsScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const { driver, authToken } = useAuth();
    const [history, setHistory] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const result = await getPayoutHistory({ driver, authToken });
            setHistory(result);
        } catch (err) {
            console.warn('[EarningsScreen] Failed to load payout history:', err);
            toast.error('Unable to load earnings. Please try again.');
        }
    }, [driver, authToken]);

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            await load();
            setIsLoading(false);
        })();
    }, [load]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await load();
        setIsRefreshing(false);
    }, [load]);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <YStack flex={1} px='$4' pt='$3'>
                <XStack alignItems='center' gap='$3' mb='$4'>
                    <BackButton onPress={() => navigation.goBack()} />
                    <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                        Earnings & Payouts
                    </Text>
                </XStack>
                {isLoading ? (
                    <YStack flex={1} alignItems='center' justifyContent='center'>
                        <Spinner size='large' color='$textPrimary' />
                    </YStack>
                ) : (
                    <FlatList
                        data={history?.ledger ?? []}
                        keyExtractor={(row) => row.id}
                        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.textPrimary.val} />}
                        showsVerticalScrollIndicator={false}
                        ListHeaderComponent={
                            <YStack mb='$5' space='$3'>
                                <YStack bg='$secondary' p='$4' rounded>
                                    <Text color='$textSecondary'>Validations completed</Text>
                                    <Text color='$textPrimary' fontSize='$9' fontWeight='bold'>
                                        {history?.validationCount ?? 0}
                                    </Text>
                                    {history?.nextMilestone ? (
                                        <Text color='$textSecondary' mt='$2'>
                                            {history.nextMilestone.threshold - history.validationCount} more to earn {formatCents(history.nextMilestone.amountCents)}
                                        </Text>
                                    ) : null}
                                </YStack>
                                <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                                    Payout history
                                </Text>
                            </YStack>
                        }
                        renderItem={({ item }) => (
                            <XStack justifyContent='space-between' alignItems='center' py='$3'>
                                <YStack flex={1}>
                                    <Text color='$textPrimary' fontWeight='bold'>
                                        {item.description}
                                    </Text>
                                    <Text color='$textSecondary' fontSize='$3'>
                                        {STATUS_LABELS[item.status] ?? item.status}
                                    </Text>
                                </YStack>
                                <Text color='$textPrimary' fontWeight='bold'>
                                    {formatCents(item.amountCents)}
                                </Text>
                            </XStack>
                        )}
                        ItemSeparatorComponent={() => <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' />}
                        ListEmptyComponent={
                            <YStack flex={1} alignItems='center' justifyContent='center' py='$8'>
                                <Text color='$textSecondary'>No payouts yet. Complete a validation to earn your first bonus.</Text>
                            </YStack>
                        }
                    />
                )}
            </YStack>
        </SafeAreaView>
    );
};

export default EarningsScreen;

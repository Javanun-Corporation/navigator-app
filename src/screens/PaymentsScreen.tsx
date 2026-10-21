import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { SafeAreaView, FlatList, RefreshControl, Linking } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Spinner, Button, Text, XStack, YStack, Separator, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
    faCircleCheck,
    faArrowUpRightFromSquare,
    faLock,
    faClock,
    faCircleXmark,
    faTrophy,
    faUserGroup,
    faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';
import { useAuth } from '../contexts/AuthContext';
import { getConnectStatus, createOnboardingLink, getPayoutHistory, getPayoutRules, formatCents } from '../utils/payoutsApi';
import { toast } from '../utils/toast';

const CONNECT_STATUS_META = {
    not_started: { label: 'Not started', tone: 'default', icon: null },
    onboarding: { label: 'Onboarding in progress', tone: 'info', icon: faClock },
    restricted: { label: 'Action needed', tone: 'warning', icon: faTriangleExclamation },
    enabled: { label: 'Ready for payouts', tone: 'success', icon: faCircleCheck },
};

const LEDGER_STATUS_META = {
    pending: { label: 'Pending', tone: 'warning', icon: faClock },
    sandbox_recorded: { label: 'Recorded (sandbox)', tone: 'warning', icon: faClock },
    stripe_transfer_created: { label: 'Processing', tone: 'info', icon: faClock },
    paid: { label: 'Paid', tone: 'success', icon: faCircleCheck },
    failed: { label: 'Failed', tone: 'error', icon: faCircleXmark },
};

function describeRule(rule) {
    if (rule.ruleType === 'referral') {
        return `Refer a driver who completes ${rule.threshold} validations`;
    }
    return `Complete your ${ordinal(rule.threshold)} validation`;
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function getMilestoneProgress(rules, validationCount, nextMilestone) {
    if (!nextMilestone) return null;

    const previousThreshold = rules
        .filter((rule) => rule.ruleType === 'milestone' && rule.threshold <= validationCount)
        .reduce((max, rule) => Math.max(max, rule.threshold), 0);

    const span = nextMilestone.threshold - previousThreshold;
    const progressed = validationCount - previousThreshold;
    const percent = span > 0 ? Math.min(100, Math.max(0, (progressed / span) * 100)) : 0;

    return { previousThreshold, percent };
}

const MilestoneRoadmap = ({ rules, validationCount, theme }) => {
    const milestoneRules = rules.filter((rule) => rule.ruleType === 'milestone').slice().sort((a, b) => a.threshold - b.threshold);
    if (milestoneRules.length === 0) return null;

    const maxThreshold = milestoneRules[milestoneRules.length - 1].threshold;
    const fillPercent = Math.min(100, (validationCount / maxThreshold) * 100);

    return (
        <YStack height={54} position='relative' mt='$3' mb='$2' mx='$1'>
            <YStack height={8} bg='$secondary' rounded overflow='hidden'>
                <LinearGradient
                    colors={[theme.primaryBorder.val, theme.primary.val]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ height: '100%', width: `${fillPercent}%`, borderRadius: 999 }}
                />
            </YStack>
            {milestoneRules.map((rule) => {
                const earned = validationCount >= rule.threshold;
                const leftPercent = Math.min(100, (rule.threshold / maxThreshold) * 100);
                return (
                    <YStack key={rule.threshold} position='absolute' top={-4} left={`${leftPercent}%`} style={{ transform: [{ translateX: -11 }] }} alignItems='center'>
                        <YStack
                            width={22}
                            height={22}
                            borderRadius={11}
                            alignItems='center'
                            justifyContent='center'
                            bg={earned ? '$success' : '$background'}
                            borderWidth={2}
                            borderColor={earned ? '$successBorder' : '$secondaryBorder'}
                        >
                            {earned ? <FontAwesomeIcon icon={faCircleCheck} size={11} color='#fff' /> : null}
                        </YStack>
                        <Text color={earned ? '$success' : '$textSecondary'} fontSize='$1' fontWeight={earned ? 'bold' : '400'} mt='$1'>
                            {rule.threshold}
                        </Text>
                    </YStack>
                );
            })}
        </YStack>
    );
};

const PaymentsScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const { driver, authToken } = useAuth();
    const [connectStatus, setConnectStatus] = useState(null);
    const [history, setHistory] = useState(null);
    const [rules, setRules] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);

    const load = useCallback(async () => {
        try {
            const [statusResult, historyResult, rulesResult] = await Promise.all([
                getConnectStatus({ driver, authToken }),
                getPayoutHistory({ driver, authToken }),
                getPayoutRules({ driver, authToken }),
            ]);
            setConnectStatus(statusResult);
            setHistory(historyResult);
            setRules(rulesResult?.rules ?? []);
        } catch (err) {
            console.warn('[PaymentsScreen] Failed to load payments data:', err);
            toast.error('Unable to load payment information. Please try again.');
        }
    }, [driver, authToken]);

    useEffect(() => {
        if (!isFocused) return;
        (async () => {
            setIsLoading(true);
            await load();
            setIsLoading(false);
        })();
    }, [isFocused, load]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await load();
        setIsRefreshing(false);
    }, [load]);

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
            console.warn('[PaymentsScreen] Failed to create onboarding link:', err);
            toast.error('Unable to start payout setup. Please try again.');
        } finally {
            setIsLaunching(false);
        }
    };

    const isEnabled = connectStatus?.payoutsEnabled;
    const validationCount = history?.validationCount ?? 0;
    const nextMilestone = history?.nextMilestone ?? null;
    const milestoneProgress = getMilestoneProgress(rules, validationCount, nextMilestone);
    const setupMeta = CONNECT_STATUS_META[connectStatus?.stripeAccountStatus] ?? CONNECT_STATUS_META.not_started;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <YStack flex={1} px='$4' pt='$3'>
                <XStack alignItems='center' gap='$3' mb='$4'>
                    <BackButton onPress={() => navigation.goBack()} />
                    <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                        Payments
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
                            <YStack mb='$5' space='$5'>
                                <YStack space='$2'>
                                    <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                                        Payment setup
                                    </Text>
                                    <XStack
                                        alignItems='center'
                                        space='$3'
                                        bg='$secondary'
                                        p='$4'
                                        rounded
                                        borderLeftWidth={4}
                                        borderLeftColor={`$${setupMeta.tone}Border`}
                                    >
                                        {setupMeta.icon ? <FontAwesomeIcon icon={setupMeta.icon} color={theme[setupMeta.tone].val} size={20} /> : null}
                                        <YStack flex={1}>
                                            <Text color={`$${setupMeta.tone}`} fontWeight='bold'>
                                                {setupMeta.label}
                                            </Text>
                                            <Text color='$textSecondary' fontSize='$3'>
                                                Connect a bank account to receive your validation bonuses.
                                            </Text>
                                        </YStack>
                                    </XStack>
                                    <Button size='$4' onPress={handleSetUpPayouts} bg='$primary' width='100%' opacity={isLaunching ? 0.75 : 1} disabled={isLaunching} rounded>
                                        <Button.Icon>{isLaunching ? <Spinner color='$white' /> : <FontAwesomeIcon icon={faArrowUpRightFromSquare} color={theme.white.val} />}</Button.Icon>
                                        <Button.Text color='$white' fontWeight='bold'>
                                            {isEnabled ? 'Update payout details' : 'Set up payouts'}
                                        </Button.Text>
                                    </Button>
                                </YStack>

                                <YStack bg='$secondary' p='$4' rounded>
                                    <Text color='$textSecondary'>Validations completed</Text>
                                    <Text color='$textPrimary' fontSize='$9' fontWeight='bold'>
                                        {validationCount}
                                    </Text>
                                    {nextMilestone ? (
                                        <Text color='$textSecondary' mt='$2'>
                                            {nextMilestone.threshold - validationCount} more to earn {formatCents(nextMilestone.amountCents)}
                                        </Text>
                                    ) : (
                                        <XStack alignItems='center' space='$2' mt='$2'>
                                            <FontAwesomeIcon icon={faTrophy} color={theme.success.val} size={14} />
                                            <Text color='$success' fontWeight='bold'>
                                                All milestones earned!
                                            </Text>
                                        </XStack>
                                    )}
                                </YStack>

                                <YStack space='$2'>
                                    <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                                        Payout structure
                                    </Text>
                                    {milestoneProgress ? (
                                        <XStack justifyContent='space-between'>
                                            <Text color='$textSecondary' fontSize='$3'>
                                                {validationCount} / {nextMilestone.threshold} validations
                                            </Text>
                                            <Text color='$primary' fontSize='$3' fontWeight='bold'>
                                                Next: {formatCents(nextMilestone.amountCents)}
                                            </Text>
                                        </XStack>
                                    ) : null}
                                    <MilestoneRoadmap rules={rules} validationCount={validationCount} theme={theme} />
                                    <YStack bg='$secondary' rounded overflow='hidden' mt='$2'>
                                        {rules.map((rule, index) => {
                                            const isMilestone = rule.ruleType === 'milestone';
                                            const earned = isMilestone && validationCount >= rule.threshold;
                                            const isNext = isMilestone && nextMilestone && rule.threshold === nextMilestone.threshold;
                                            const locked = isMilestone && !earned && !isNext;
                                            const rowIcon = !isMilestone ? faUserGroup : earned ? faCircleCheck : isNext ? faTrophy : faLock;
                                            const rowTone = !isMilestone ? 'info' : earned ? 'success' : isNext ? 'primary' : 'default';

                                            return (
                                                <YStack key={`${rule.ruleType}-${rule.triggerKey}-${rule.threshold}`}>
                                                    {index > 0 ? <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' /> : null}
                                                    <XStack
                                                        justifyContent='space-between'
                                                        alignItems='center'
                                                        p='$4'
                                                        space='$3'
                                                        opacity={locked ? 0.5 : 1}
                                                        borderLeftWidth={earned || isNext ? 4 : 0}
                                                        borderLeftColor={earned ? '$successBorder' : isNext ? '$primaryBorder' : 'transparent'}
                                                    >
                                                        <FontAwesomeIcon
                                                            icon={rowIcon}
                                                            size={16}
                                                            color={rowTone === 'primary' ? theme.primary.val : rowTone === 'default' ? theme.textSecondary.val : theme[rowTone].val}
                                                        />
                                                        <Text color={locked ? '$textSecondary' : '$textPrimary'} flex={1} fontWeight={earned || isNext ? 'bold' : '400'}>
                                                            {rule.description || describeRule(rule)}
                                                        </Text>
                                                        <Text color={earned ? '$success' : locked ? '$textSecondary' : '$textPrimary'} fontWeight='bold'>
                                                            {formatCents(rule.amountCents)}
                                                        </Text>
                                                    </XStack>
                                                </YStack>
                                            );
                                        })}
                                    </YStack>
                                </YStack>

                                <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                                    Payout history
                                </Text>
                            </YStack>
                        }
                        renderItem={({ item }) => {
                            const meta = LEDGER_STATUS_META[item.status] ?? { label: item.status, tone: 'default', icon: faClock };
                            return (
                                <XStack justifyContent='space-between' alignItems='center' py='$3' pl='$3' space='$3' borderLeftWidth={4} borderLeftColor={`$${meta.tone}Border`}>
                                    <FontAwesomeIcon icon={meta.icon} size={16} color={theme[meta.tone].val} />
                                    <YStack flex={1}>
                                        <Text color='$textPrimary' fontWeight='bold'>
                                            {item.description}
                                        </Text>
                                        <Text color={`$${meta.tone}`} fontSize='$3' fontWeight='600'>
                                            {meta.label}
                                        </Text>
                                    </YStack>
                                    <Text color='$textPrimary' fontWeight='bold'>
                                        {formatCents(item.amountCents)}
                                    </Text>
                                </XStack>
                            );
                        }}
                        ItemSeparatorComponent={() => <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' />}
                        ListEmptyComponent={
                            <YStack alignItems='center' justifyContent='center' py='$8'>
                                <Text color='$textSecondary'>No payouts yet. Complete a validation to earn your first bonus.</Text>
                            </YStack>
                        }
                    />
                )}
            </YStack>
        </SafeAreaView>
    );
};

export default PaymentsScreen;

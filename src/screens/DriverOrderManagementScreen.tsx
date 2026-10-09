import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { Label, Separator, Switch, Text, XStack, YStack, useTheme } from 'tamagui';
import AdhocOrderCard from '../components/AdhocOrderCard';
import OrderCard from '../components/OrderCard';
import PastOrderCard from '../components/PastOrderCard';
import Spacer from '../components/Spacer';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { useOrderManager } from '../contexts/OrderManagerContext';
import useAppTheme from '../hooks/use-app-theme';
import useSocketClusterClient from '../hooks/use-socket-cluster-client';
import useStorage from '../hooks/use-storage';
import { formatDuration, formatMeters } from '../utils/format';
import { SHOW_FINISHED_LABEL, buildOrderList, countHiddenFinishedOrders, dismissalKeysFor, hiddenFinishedMessage, listShownHeldOrders } from '../utils/order-groups';

const countStops = (orders = []) =>
    orders.reduce((total, order) => {
        const { pickup, dropoff, waypoints = [] } = order.getAttribute('payload') || {};
        const stops = [pickup, dropoff, ...waypoints].filter(Boolean);
        return total + stops.length;
    }, 0);

const sumDuration = (orders = []) =>
    orders.reduce((total, order) => {
        return total + order.getAttribute('time');
    }, 0);

const sumDistance = (orders = []) =>
    orders.reduce((total, order) => {
        return total + order.getAttribute('distance');
    }, 0);

const REFRESH_NEARBY_ORDERS_MS = 6000 * 5; // 5 mins
const REFRESH_ORDERS_MS = 6000 * 15; // 15 mins

const DriverOrderManagementScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const listenerRef = useRef();
    const { isDarkMode } = useAppTheme();
    const { driver } = useAuth();
    const {
        allActiveOrders,
        currentOrders,
        reloadCurrentOrders,
        reloadActiveOrders,
        isFetchingCurrentOrders,
        nearbyOrders,
        isFetchingNearbyOrders,
        reloadNearbyOrders,
        dismissedOrders,
        setDimissedOrders,
    } = useOrderManager();
    const { listen } = useSocketClusterClient();
    const { addNotificationListener, removeNotificationListener } = useNotification();
    const activeCurrentOrders = currentOrders.filter((order) => !['completed', 'created', 'canceled'].includes(order.getAttribute('status')));
    const stops = countStops(activeCurrentOrders);
    const distance = sumDistance(activeCurrentOrders);
    const duration = sumDuration(activeCurrentOrders);

    // Finished orders are hidden unless the driver turns them on. The choice is kept per driver across app restarts (see FINISHED_ORDER_STATUSES in utils/order-groups.js)
    const [showFinishedOrders, setShowFinishedOrders] = useStorage(`${driver?.id}_show_finished_orders`, false);

    // The unassigned nearby orders collapse to one item per report; every order assigned to the driver stays its own item (see utils/order-groups.js)
    const displayItems = useMemo(() => buildOrderList(nearbyOrders, currentOrders, dismissedOrders, showFinishedOrders), [nearbyOrders, currentOrders, dismissedOrders, showFinishedOrders]);

    // What the header counts: the assigned orders the list shows, and how many finished ones it leaves out
    const shownOrderCount = useMemo(() => listShownHeldOrders(currentOrders, dismissedOrders, showFinishedOrders).length, [currentOrders, dismissedOrders, showFinishedOrders]);
    const hiddenFinishedCount = useMemo(() => countHiddenFinishedOrders(currentOrders, dismissedOrders, showFinishedOrders), [currentOrders, dismissedOrders, showFinishedOrders]);

    useEffect(() => {
        const handlePushNotification = async (notification, action) => {
            const { payload } = notification;
            const id = payload.id;
            const type = payload.type;

            // If any order related push notification comes just reload current orders
            if (typeof id === 'string' && id.startsWith('order_')) {
                reloadCurrentOrders();
            }
        };

        addNotificationListener(handlePushNotification);

        return () => {
            removeNotificationListener(handlePushNotification);
        };
    }, [addNotificationListener, removeNotificationListener]);

    useFocusEffect(
        useCallback(() => {
            const handleReloadNearbyOrders = () => {
                reloadNearbyOrders({}, { setLoadingFlag: false });
            };

            const interval = setInterval(handleReloadNearbyOrders, REFRESH_NEARBY_ORDERS_MS);
            return () => clearInterval(interval);
        }, [])
    );

    useFocusEffect(
        useCallback(() => {
            const handleReloadCurrentOrders = () => {
                reloadCurrentOrders({}, { setLoadingFlag: false });
            };
            reloadActiveOrders();
            handleReloadCurrentOrders();

            const interval = setInterval(handleReloadCurrentOrders, REFRESH_ORDERS_MS);
            return () => clearInterval(interval);
        }, [])
    );

    useFocusEffect(
        useCallback(() => {
            const listenForOrderUpdates = async () => {
                const listener = await listen(`driver.${driver.id}`, ({ event }) => {
                    if (typeof event === 'string' && event === 'order.ready') {
                        reloadCurrentOrders();
                    }
                    if (typeof event === 'string' && event === 'order.ping') {
                        reloadNearbyOrders();
                    }
                });
                if (listener) {
                    listenerRef.current = listener;
                }
            };

            listenForOrderUpdates();

            return () => {
                if (listenerRef.current) {
                    listenerRef.current.stop();
                }
            };
        }, [listen, driver.id])
    );

    const handleAdhocDismissal = useCallback(
        (order) => {
            const keys = dismissalKeysFor(order);
            setDimissedOrders((prevDismissedOrders) => [...new Set([...prevDismissedOrders, ...keys])]);
        },
        [setDimissedOrders]
    );

    const handleAdhocAccept = useCallback(() => {
        reloadNearbyOrders();
        reloadCurrentOrders();
    }, [reloadNearbyOrders, reloadCurrentOrders]);

    const handleAdhocUnavailable = useCallback(() => {
        reloadNearbyOrders();
    }, [reloadNearbyOrders]);

    const renderOrder = ({ item }) => {
        const { order, siblings } = item;
        const isAdhocOrder = order.getAttribute('adhoc') === true && order.getAttribute('driver_assigned') === null;
        if (isAdhocOrder) {
            return (
                <YStack px='$2' py='$4'>
                    <AdhocOrderCard
                        order={order}
                        siblings={siblings}
                        onPress={() => navigation.navigate('OrderModal', { order: order.serialize() })}
                        onDismiss={handleAdhocDismissal}
                        onAccept={handleAdhocAccept}
                        onUnavailable={handleAdhocUnavailable}
                    />
                </YStack>
            );
        }

        return (
            <YStack px='$2' py='$4'>
                <OrderCard order={order} onPress={() => navigation.navigate('Order', { order: order.serialize() })} />
            </YStack>
        );
    };

    const ActiveOrders = () => {
        if (!allActiveOrders.length) return;

        return (
            <YStack>
                <YStack px='$1'>
                    <Text color='$textPrimary' fontSize={18} fontWeight='bold'>
                        Active Orders: {allActiveOrders.length}
                    </Text>
                </YStack>
                <YStack>
                    <FlatList
                        data={allActiveOrders}
                        keyExtractor={(order) => order.id.toString()}
                        renderItem={({ item: order }) => (
                            <YStack py='$3'>
                                <PastOrderCard order={order} onPress={() => navigation.navigate('Order', { order: order.serialize() })} />
                            </YStack>
                        )}
                        showsVerticalScrollIndicator={false}
                        showsHorizontalScrollIndicator={false}
                        ItemSeparatorComponent={() => <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' />}
                        initialNumToRender={3}
                        maxToRenderPerBatch={3}
                        windowSize={5}
                        removeClippedSubviews
                    />
                </YStack>
            </YStack>
        );
    };

    const NoOrders = () => {
        return (
            <YStack py='$5' px='$3' space='$6' flex={1} height='100%'>
                <YStack alignItems='center'>
                    <XStack alignItems='center' bg='$info' borderWidth={1} borderColor='$infoBorder' space='$2' px='$3' py='$2' borderRadius='$5' width='100%' flexWrap='wrap'>
                        <FontAwesomeIcon icon={faInfoCircle} color={theme['$infoText'].val} />
                        <Text color='$infoText' fontSize={16}>
                            No current orders available
                        </Text>
                    </XStack>
                </YStack>
                <ActiveOrders />
            </YStack>
        );
    };

    return (
        <YStack flex={1} bg='$surface'>
            <YStack bg='$surface' px='$3' py='$4' borderBottomWidth={1} borderTopWidth={0} borderColor={isDarkMode ? '$borderColor' : '$borderColorWithShadow'}>
                <Text color='$textPrimary' fontSize='$8' fontWeight='bold' mb='$1'>
                    Available orders
                </Text>
                <XStack space='$2' alignItems='center'>
                    <Text color='$textSecondary' fontSize='$5'>
                        {shownOrderCount} {shownOrderCount > 1 ? 'orders' : 'order'}
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        •
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        {stops} {stops > 1 ? 'stops' : 'stop'} left
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        •
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        {formatDuration(duration)}
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        •
                    </Text>
                    <Text color='$textSecondary' fontSize='$5'>
                        {formatMeters(distance)}
                    </Text>
                </XStack>
                <XStack space='$2' alignItems='center' flexWrap='wrap' mt='$2'>
                    <Switch
                        id='showFinishedOrders'
                        checked={showFinishedOrders}
                        onCheckedChange={(checked) => setShowFinishedOrders(checked)}
                        bg={showFinishedOrders ? '$green-600' : '$gray-500'}
                        borderWidth={1}
                        borderColor={isDarkMode ? '$gray-700' : '$white'}
                    >
                        <Switch.Thumb animation='quick' bg={isDarkMode ? '$gray-200' : '$white'} borderColor={isDarkMode ? '$gray-700' : '$gray-500'} borderWidth={1} />
                    </Switch>
                    <Label htmlFor='showFinishedOrders' color='$textSecondary' size='$2' lineHeight='$4'>
                        {SHOW_FINISHED_LABEL}
                    </Label>
                    {hiddenFinishedCount > 0 && (
                        <Text color='$textSecondary' fontSize='$4'>
                            {hiddenFinishedMessage(hiddenFinishedCount)}
                        </Text>
                    )}
                </XStack>
            </YStack>
            <FlatList
                data={displayItems}
                keyExtractor={(item) => item.key}
                renderItem={renderOrder}
                refreshControl={<RefreshControl refreshing={isFetchingCurrentOrders} onRefresh={reloadCurrentOrders} tintColor={theme['$blue-500'].val} />}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                ItemSeparatorComponent={() => <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' />}
                ListFooterComponent={<Spacer height={200} />}
                ListEmptyComponent={<NoOrders />}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={5}
                removeClippedSubviews
            />
        </YStack>
    );
};

export default DriverOrderManagementScreen;

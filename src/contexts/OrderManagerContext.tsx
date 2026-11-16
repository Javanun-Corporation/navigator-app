import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { format } from 'date-fns';
import { Order } from '@fleetbase/sdk';
import { useAuth } from './AuthContext';
import { useNotification } from './NotificationContext';
import useFleetbase from '../hooks/use-fleetbase';
import useStorage from '../hooks/use-storage';
import { isArray } from '../utils';
import { isOrderNotification, isReturnToForeground } from '../utils/order-refresh';

function serializeCollection(collection) {
    return collection.map((resource) => resource.serialize());
}

function restoreCollection(collection, adapter) {
    return collection.map((json) => new Order(json, adapter));
}

const OrderManagerContext = createContext(null);

export const OrderManagerProvider: React.FC = ({ children }) => {
    const { driver } = useAuth();
    const { fleetbase, adapter } = useFleetbase();
    const { addNotificationListener, removeNotificationListener } = useNotification();
    const today = format(new Date(), 'yyyy-MM-dd HH:mm:ssXXX');

    // Local storage for caching orders
    const [allRecentOrders, setAllRecentOrders] = useStorage(`${driver?.id}_all_recent_orders`, []);
    const [allActiveOrders, setAllActiveOrders] = useStorage(`${driver?.id}_all_active_orders`, []);
    // These are adhoc orders available
    const [nearbyOrders, setNearbyOrders] = useStorage(`${driver?.id}_nearby_orders`, []);
    // All orders currently assigned to the driver, unfiltered by date.
    const [currentOrders, setCurrentOrders] = useStorage(`${driver?.id}_current_orders`, []);
    const [ordersToday, setOrdersToday] = useStorage(`${driver?.id}_${today.replaceAll('-', '')}_orders`, []);
    // Dismissed adhoc orders
    const [dismissedOrders, setDimissedOrders] = useState([]);
    // Paginated history of completed orders for the Past Orders screen
    const [pastOrders, setPastOrders] = useStorage(`${driver?.id}_past_orders`, []);
    const [pastOrdersPage, setPastOrdersPage] = useState(1);
    const [hasMorePastOrders, setHasMorePastOrders] = useState(true);

    const [isFetchingActiveOrders, setIsFetchingActiveOrders] = useState(false);
    const [isFetchingRecentOrders, setIsFetchingRecentOrders] = useState(false);
    const [isFetchingNearbyOrders, setIsFetchingNearbyOrders] = useState(false);
    const [isFetchingCurrentOrders, setIsFetchingCurrentOrders] = useState(false);
    const [isFetchingPastOrders, setIsFetchingPastOrders] = useState(false);

    // Define statuses to exclude from active orders
    const nonActiveOrderStatuses = useMemo(() => new Set(['completed', 'created', 'canceled', 'order_canceled']), []);

    // Derive active orders from all recent orders
    const recentActiveOrders = useMemo(() => {
        return allRecentOrders.filter((order) => !nonActiveOrderStatuses.has(order.status));
    }, [allRecentOrders, nonActiveOrderStatuses]);

    // Generic function to query orders from Fleetbase API
    const queryOrders = useCallback(
        async (params = {}, setIsFetching) => {
            if (!fleetbase) return;
            if (setIsFetching) setIsFetching(true);
            // params.with_tracker_data = true;
            params.sort = '-created_at';
            try {
                const orders = await fleetbase.orders.query(params);
                return orders;
            } catch (error) {
                console.warn('Error fetching orders:', error);
                throw error;
            } finally {
                if (setIsFetching) setIsFetching(false);
            }
        },
        [fleetbase]
    );

    // Refs to ensure orders are loaded only once per driver session
    const hasLoadedActiveRef = useRef(false);
    const hasLoadedRecentRef = useRef(false);
    const hasLoadedNearbyRef = useRef(false);
    const hasLoadedCurrentRef = useRef(false);

    // Refs to hold in-flight promises to guard against duplicate requests
    const activeOrdersPromiseRef = useRef<Promise<any> | null>(null);
    const recentOrdersPromiseRef = useRef<Promise<any> | null>(null);
    const nearbyOrdersPromiseRef = useRef<Promise<any> | null>(null);
    const currentOrdersPromiseRef = useRef<Promise<any> | null>(null);
    const pastOrdersPromiseRef = useRef<Promise<any> | null>(null);

    // Fetch active orders
    const fetchActiveOrders = useCallback(
        async (params = {}, options = {}) => {
            if (!driver || !fleetbase || hasLoadedActiveRef.current || activeOrdersPromiseRef.current) return;
            const setLoadingFlag = options.setLoadingFlag ?? true;
            try {
                activeOrdersPromiseRef.current = queryOrders({ driver_assigned: driver.id, active: true, limit: -1, ...params }, setLoadingFlag ? setIsFetchingActiveOrders : null);
                const fetchedOrders = await activeOrdersPromiseRef.current;
                setAllActiveOrders(serializeCollection(fetchedOrders));
                hasLoadedActiveRef.current = true;
            } catch (error) {
                console.warn('Unable to load active orders for driver:', error);
                setAllActiveOrders([]);
            } finally {
                activeOrdersPromiseRef.current = null;
            }
        },
        [fleetbase, driver, queryOrders, setAllActiveOrders]
    );

    // Fetch recent orders
    const fetchRecentOrders = useCallback(
        async (params = {}, options = {}) => {
            if (!driver || !fleetbase || hasLoadedRecentRef.current || recentOrdersPromiseRef.current) return;
            const setLoadingFlag = options.setLoadingFlag ?? true;
            try {
                recentOrdersPromiseRef.current = queryOrders({ driver_assigned: driver.id, limit: 30, ...params }, setLoadingFlag ? setIsFetchingRecentOrders : null);
                const fetchedOrders = await recentOrdersPromiseRef.current;
                setAllRecentOrders(serializeCollection(fetchedOrders));
                hasLoadedRecentRef.current = true;
            } catch (error) {
                console.warn('Unable to load recent orders for driver:', error);
                setAllRecentOrders([]);
            } finally {
                recentOrdersPromiseRef.current = null;
            }
        },
        [fleetbase, driver, queryOrders, setAllRecentOrders]
    );

    // Fetch recent orders
    const fetchNearbyOrders = useCallback(
        async (params = {}, options = {}) => {
            if (!driver || !fleetbase || hasLoadedNearbyRef.current || nearbyOrdersPromiseRef.current) return;
            const setLoadingFlag = options.setLoadingFlag ?? true;
            try {
                nearbyOrdersPromiseRef.current = queryOrders(
                    { nearby: driver.id, adhoc: 1, unassigned: 1, dispatched: 1, limit: -1, ...params },
                    setLoadingFlag ? setIsFetchingNearbyOrders : null
                );
                const fetchedOrders = await nearbyOrdersPromiseRef.current;
                setNearbyOrders(serializeCollection(fetchedOrders));
                hasLoadedNearbyRef.current = true;
            } catch (error) {
                console.warn('Unable to load nearby orders for driver:', error);
                setNearbyOrders([]);
            } finally {
                nearbyOrdersPromiseRef.current = null;
            }
        },
        [fleetbase, driver, queryOrders, setNearbyOrders]
    );

    // Fetch all orders currently assigned to the driver, unfiltered by date.
    const fetchCurrentOrders = useCallback(
        async (params = {}, options = {}) => {
            if (!driver || !fleetbase || hasLoadedCurrentRef.current || currentOrdersPromiseRef.current) return;
            const setLoadingFlag = options.setLoadingFlag ?? true;
            try {
                currentOrdersPromiseRef.current = queryOrders({ driver_assigned: driver.id, limit: -1, ...params }, setLoadingFlag ? setIsFetchingCurrentOrders : null);
                const fetchedOrders = await currentOrdersPromiseRef.current;
                setCurrentOrders(serializeCollection(fetchedOrders));
                hasLoadedCurrentRef.current = true;
            } catch (error) {
                console.warn('Unable to load current orders for driver:', error);
                setCurrentOrders([]);
            } finally {
                currentOrdersPromiseRef.current = null;
            }
        },
        [fleetbase, driver, queryOrders, setCurrentOrders]
    );

    // Fetch a page of completed order history for the Past Orders screen.
    const fetchPastOrders = useCallback(
        async (params = {}, options = {}) => {
            if (!driver || !fleetbase || pastOrdersPromiseRef.current) return;
            const page = options.page ?? 1;
            const setLoadingFlag = options.setLoadingFlag ?? true;
            try {
                pastOrdersPromiseRef.current = queryOrders({ driver_assigned: driver.id, status: 'completed', page, limit: 20, ...params }, setLoadingFlag ? setIsFetchingPastOrders : null);
                const fetchedOrders = await pastOrdersPromiseRef.current;
                const serialized = serializeCollection(fetchedOrders);
                setPastOrders(page === 1 ? serialized : [...pastOrders, ...serialized]);
                setHasMorePastOrders(serialized.length > 0);
                setPastOrdersPage(page);
            } catch (error) {
                console.warn('Unable to load past orders for driver:', error);
                if (page === 1) setPastOrders([]);
            } finally {
                pastOrdersPromiseRef.current = null;
            }
        },
        [fleetbase, driver, queryOrders, pastOrders, setPastOrders]
    );

    // Reset paging and refetch the first page of past orders.
    const reloadPastOrders = useCallback(
        (params = {}, options = {}) => {
            setHasMorePastOrders(true);
            pastOrdersPromiseRef.current = null;
            fetchPastOrders(params, { ...options, page: 1 });
        },
        [fetchPastOrders]
    );

    // Fetch the next page of past orders, appending to the existing list.
    const loadMorePastOrders = useCallback(
        (params = {}) => {
            if (!hasMorePastOrders || isFetchingPastOrders || pastOrdersPromiseRef.current) return;
            fetchPastOrders(params, { page: pastOrdersPage + 1 });
        },
        [fetchPastOrders, hasMorePastOrders, isFetchingPastOrders, pastOrdersPage]
    );

    // Allows an update of a sigle order in the storage
    const updateStorageOrder = (order, storageKey = 'current') => {
        const storageMap = {
            current: { storage: currentOrders, update: setCurrentOrders },
            recent: { storage: allRecentOrders, update: setAllRecentOrders },
            active: { storage: allActiveOrders, update: setAllActiveOrders },
        };

        if (isArray(storageKey)) {
            storageKey.forEach((key) => updateStorageOrder(order, key));
            return;
        }

        const { storage, update } = storageMap[storageKey] || storageMap.current;
        const updatedStorage = storage.map((storedOrder) => (storedOrder.id === order.id ? { ...order, tracker_data: order.tracker_data ?? storedOrder.tracker_data } : storedOrder));

        update(updatedStorage);
    };

    // Trigger active and recent order fetches when driver and fleetbase are available.
    useEffect(() => {
        if (driver && fleetbase) {
            fetchActiveOrders();
        }
    }, [driver, fleetbase, fetchActiveOrders]);

    // Trigger to load nearby available orders.
    useEffect(() => {
        if (driver && fleetbase) {
            fetchNearbyOrders();
        }
    }, [driver, fleetbase, fetchNearbyOrders]);

    // Fetch current orders once driver and fleetbase are available.
    useEffect(() => {
        if (driver && fleetbase) {
            fetchCurrentOrders();
        }
    }, [driver, fleetbase, fetchCurrentOrders]);

    // Manual reload functions.
    const reloadOrders = useCallback(
        (params = {}, options = {}) => {
            hasLoadedActiveRef.current = false;
            hasLoadedRecentRef.current = false;
            hasLoadedNearbyRef.current = false;
            activeOrdersPromiseRef.current = null;
            recentOrdersPromiseRef.current = null;
            nearbyOrdersPromiseRef.current = null;
            fetchActiveOrders(params, options);
            fetchRecentOrders(params, options);
            fetchNearbyOrders(params, options);
        },
        [fetchActiveOrders, fetchRecentOrders]
    );

    const reloadRecentOrders = useCallback(
        (params = {}, options = {}) => {
            hasLoadedRecentRef.current = false;
            recentOrdersPromiseRef.current = null;
            fetchRecentOrders(params, options);
        },
        [fetchRecentOrders]
    );

    const reloadActiveOrders = useCallback(
        (params = {}, options = {}) => {
            hasLoadedActiveRef.current = false;
            activeOrdersPromiseRef.current = null;
            fetchActiveOrders(params, options);
        },
        [fetchActiveOrders]
    );

    const reloadCurrentOrders = useCallback(
        (params = {}, options = {}) => {
            hasLoadedCurrentRef.current = false;
            currentOrdersPromiseRef.current = null;
            fetchCurrentOrders(params, options);
        },
        [fetchCurrentOrders]
    );

    const reloadNearbyOrders = useCallback(
        (params = {}, options = {}) => {
            hasLoadedNearbyRef.current = false;
            nearbyOrdersPromiseRef.current = null;
            fetchNearbyOrders(params);
        },
        [fetchNearbyOrders]
    );

    // Fetch the driver's orders again after the server may have changed one, so a cancelled or finished order does not stay on the Dash and the Orders badge. The ref keeps the listeners below on the latest reload functions without re-subscribing them.
    const reloadChangedOrdersRef = useRef(() => {});
    reloadChangedOrdersRef.current = () => {
        reloadActiveOrders({}, { setLoadingFlag: false });
        reloadCurrentOrders({}, { setLoadingFlag: false });
    };

    // A push notification about an order means the order changed on the server.
    useEffect(() => {
        const handlePushNotification = (notification) => {
            if (isOrderNotification(notification)) {
                reloadChangedOrdersRef.current();
            }
        };

        addNotificationListener(handlePushNotification);

        return () => {
            removeNotificationListener(handlePushNotification);
        };
    }, [addNotificationListener, removeNotificationListener]);

    // Orders may have changed while the app was in the background.
    useEffect(() => {
        let previousState = AppState.currentState;
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (isReturnToForeground(previousState, nextState)) {
                reloadChangedOrdersRef.current();
            }
            previousState = nextState;
        });

        return () => {
            subscription.remove();
        };
    }, []);

    const value = useMemo(
        () => ({
            queryOrders,
            allRecentOrders: restoreCollection(allRecentOrders, adapter),
            recentActiveOrders: restoreCollection(recentActiveOrders, adapter),
            allActiveOrders: restoreCollection(allActiveOrders, adapter),
            ordersToday: restoreCollection(ordersToday, adapter),
            currentOrders: restoreCollection(currentOrders, adapter),
            nearbyOrders: restoreCollection(nearbyOrders, adapter),
            pastOrders: restoreCollection(pastOrders, adapter),
            reloadOrders,
            reloadRecentOrders,
            reloadActiveOrders,
            reloadCurrentOrders,
            isFetchingActiveOrders,
            isFetchingRecentOrders,
            isFetchingCurrentOrders,
            isFetchingPastOrders,
            hasMorePastOrders,
            updateStorageOrder,
            fetchNearbyOrders,
            reloadNearbyOrders,
            fetchPastOrders,
            reloadPastOrders,
            loadMorePastOrders,
            dismissedOrders,
            setDimissedOrders,
        }),
        [
            queryOrders,
            allRecentOrders,
            recentActiveOrders,
            allActiveOrders,
            ordersToday,
            currentOrders,
            nearbyOrders,
            pastOrders,
            adapter,
            reloadOrders,
            isFetchingActiveOrders,
            isFetchingRecentOrders,
            isFetchingCurrentOrders,
            isFetchingPastOrders,
            hasMorePastOrders,
            fetchNearbyOrders,
            reloadNearbyOrders,
            fetchPastOrders,
            reloadPastOrders,
            loadMorePastOrders,
            dismissedOrders,
            setDimissedOrders,
        ]
    );

    return <OrderManagerContext.Provider value={value}>{children}</OrderManagerContext.Provider>;
};

export const useOrderManager = () => {
    const context = useContext(OrderManagerContext);
    if (!context) {
        throw new Error('useOrderManager must be used within an OrderManagerProvider');
    }
    return context;
};

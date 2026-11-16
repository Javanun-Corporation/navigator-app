import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import MapView, { Callout, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { Spinner, Text, YStack, useTheme } from 'tamagui';
import { useLocation } from '../contexts/LocationContext';
import { useOrderManager } from '../contexts/OrderManagerContext';
import useAppTheme from '../hooks/use-app-theme';
import { get } from '../utils';

const WidgetContainer = ({ px = '$4', py = '$4', children, ...props }) => {
    const { isDarkMode } = useAppTheme();
    return (
        <YStack
            borderRadius='$6'
            bg='$surface'
            px={px}
            py={py}
            borderWidth={1}
            borderColor={isDarkMode ? '$transparent' : '$gray-300'}
            shadowColor='#000'
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.15}
            shadowRadius={4}
            elevation={4}
            {...props}
        >
            {children}
        </YStack>
    );
};

const getOrderCoordinates = (order) => {
    if (!order) return null;

    const orderId = order.id || order?.attributes?.id;

    let place = null;
    if (typeof order.getAttribute === 'function') {
        //If it's a Fleetbase SDK Model
        place = order.getAttribute('payload.pickup') || order.getAttribute('payload.dropoff') || order.getAttribute('pickup') || order.getAttribute('dropoff');
    } else {
        //If it's Raw JSON
        place = order?.attributes?.payload?.pickup || order?.attributes?.payload?.dropoff || order?.payload?.pickup || order?.payload?.dropoff;
    }

    let lat = null;
    let lng = null;

    if (place) {
        if (typeof place.getAttribute === 'function') {
            const coords = place.getAttribute('location.coordinates');
            if (coords && Array.isArray(coords)) {
                lng = coords[0]; // GeoJSON is always [longitude, latitude]
                lat = coords[1];
            } else {
                lat = place.getAttribute('latitude');
                lng = place.getAttribute('longitude');
            }
        } else {
            if (place?.location?.coordinates && Array.isArray(place.location.coordinates)) {
                lng = place.location.coordinates[0];
                lat = place.location.coordinates[1];
            } else {
                lat = place?.latitude;
                lng = place?.longitude;
            }
        }
    } else {
        if (typeof order.getAttribute === 'function') {
            const coords = order.getAttribute('location.coordinates');
            if (coords && Array.isArray(coords)) {
                lng = coords[0];
                lat = coords[1];
            }
        } else if (order?.attributes?.location?.coordinates && Array.isArray(order.attributes.location.coordinates)) {
            lng = order.attributes.location.coordinates[0];
            lat = order.attributes.location.coordinates[1];
        }
    }

    if (lat && lng) {
        return { latitude: Number(lat), longitude: Number(lng) };
    }

    return null;
};

const DriverDashboardScreen = () => {
    const { isDarkMode } = useAppTheme();
    const theme = useTheme();
    const navigation = useNavigation();

    const { location } = useLocation();
    const { allActiveOrders, nearbyOrders, reloadActiveOrders } = useOrderManager();

    const mapRef = useRef(null);
    const [isFollowingUser, setIsFollowingUser] = useState(true);
    const [isOrdersMenuOpen, setIsOrdersMenuOpen] = useState(false);
    const [mapCenter, setMapCenter] = useState(null);
    const [isMapMounted, setIsMapMounted] = useState(false);

    // Defer the native MapView mount until this tab is actually focused, so switching
    // into this tab doesn't stall on native map initialization mid-transition.
    useFocusEffect(
        useCallback(() => {
            setIsMapMounted(true);
            return () => setIsMapMounted(false);
        }, [])
    );

    // The accepted orders are a saved list, so fetch it again each time the Dash is shown in case an order changed on the server. The ref holds the latest reload function, so the fetch runs once per focus and not again when the list it loads re-renders the screen.
    const reloadActiveOrdersRef = useRef(reloadActiveOrders);
    reloadActiveOrdersRef.current = reloadActiveOrders;
    useFocusEffect(
        useCallback(() => {
            reloadActiveOrdersRef.current({}, { setLoadingFlag: false });
        }, [])
    );

    useEffect(() => {
        if (location?.coords && isFollowingUser && mapRef.current) {
            mapRef.current.animateToRegion(
                {
                    latitude: Number(location.coords.latitude),
                    longitude: Number(location.coords.longitude),
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                },
                1000
            );
        }
    }, [location?.coords, isFollowingUser]);

    const handleRecenter = () => {
        setIsFollowingUser(true);
        if (location?.coords && mapRef.current) {
            mapRef.current.animateToRegion(
                {
                    latitude: Number(location.coords.latitude),
                    longitude: Number(location.coords.longitude),
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                },
                500
            );
        }
    };

    const hasCoords = !!location?.coords;
    const lat = hasCoords ? Number(location.coords.latitude) : 0;
    const lng = hasCoords ? Number(location.coords.longitude) : 0;

    // React.useEffect(() => {
    //     console.log('DEBUG - Current Location:', {
    //         hasCoords,
    //         latitude: lat,
    //         longitude: lng,
    //         rawObject: location,
    //     });
    // }, [lat, lng, location]);

    return (
        <YStack flex={1} bg='$background' position='relative' pointerEvents='box-none'>
            {hasCoords && isMapMounted ? (
                <MapView
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={StyleSheet.absoluteFillObject}
                    showsUserLocation={false}
                    showsMyLocationButton={false}
                    initialRegion={{
                        latitude: lat,
                        longitude: lng,
                        latitudeDelta: 0.005,
                        longitudeDelta: 0.005,
                    }}
                    onRegionChangeComplete={(region, details) => {
                        setMapCenter(region);

                        if (details?.isGesture === false) return;

                        const latDiff = Math.abs(region.latitude - lat);
                        const lngDiff = Math.abs(region.longitude - lng);

                        if (isFollowingUser && (latDiff > 0.00002 || lngDiff > 0.00002)) {
                            setIsFollowingUser(false);
                        }
                    }}
                >
                    <Marker key='driver-location-marker' coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={999}>
                        <View style={styles.driverDotWrapper}>
                            <View collapsable={false} style={styles.driverDot} />
                        </View>
                    </Marker>

                    {/* Assigned Active Orders - Green Markers */}
                    {allActiveOrders?.map((order) => {
                        const coords = getOrderCoordinates(order);
                        if (!coords) return null;

                        return (
                            <Marker
                                key={`active-order-${order.id}`}
                                coordinate={coords}
                                pinColor='green'
                                zIndex={100}
                                onCalloutPress={() =>
                                    navigation.navigate('DriverTaskTab', {
                                        screen: 'OrderModal',
                                        params: {
                                            order: order.attributes || order,
                                        },
                                    })
                                }
                            >
                                <Callout tooltip>
                                    <YStack bg='$surface' p='$3' borderRadius='$4' borderWidth={1} borderColor='$borderColor' minWidth={200}>
                                        <Text fontWeight='bold' color='$textPrimary' mb='$1'>
                                            Assigned Order #{order.id?.split('_')[1] || order.id}
                                        </Text>
                                        <Text color='$textSecondary' fontSize={12} mb='$2' numberOfLines={2}>
                                            {get(order, 'attributes.payload.pickup.address') || get(order, 'attributes.pickup.address') || 'Assigned Order'}
                                        </Text>

                                        <YStack bg='$info' py='$2' borderRadius='$2' alignItems='center'>
                                            <Text color='$infoText' fontWeight='bold' fontSize={12}>
                                                View Order
                                            </Text>
                                        </YStack>
                                    </YStack>
                                </Callout>
                            </Marker>
                        );
                    })}

                    {/* Available Nearby Orders - Red Markers */}
                    {nearbyOrders?.map((order) => {
                        const coords = getOrderCoordinates(order);
                        if (!coords) return null;

                        return (
                            <Marker
                                key={`nearby-order-${order.id}`}
                                coordinate={coords}
                                pinColor='red'
                                zIndex={90}
                                onCalloutPress={() =>
                                    navigation.navigate('DriverTaskTab', {
                                        screen: 'OrderModal',
                                        params: {
                                            order: order.attributes || order,
                                        },
                                    })
                                }
                            >
                                <Callout tooltip>
                                    <YStack bg='$surface' p='$3' borderRadius='$4' borderWidth={1} borderColor='$borderColor' minWidth={200}>
                                        <Text fontWeight='bold' color='$textPrimary' mb='$1'>
                                            Nearby Order #{order.id?.split('_')[1] || order.id}
                                        </Text>
                                        <Text color='$textSecondary' fontSize={12} mb='$2' numberOfLines={2}>
                                            {get(order, 'attributes.payload.pickup.address') || get(order, 'attributes.pickup.address') || 'Available Order'}
                                        </Text>

                                        <YStack bg='$success' py='$2' borderRadius='$2' alignItems='center'>
                                            <Text color='$successText' fontWeight='bold' fontSize={12}>
                                                View Order
                                            </Text>
                                        </YStack>
                                    </YStack>
                                </Callout>
                            </Marker>
                        );
                    })}
                </MapView>
            ) : (
                <YStack flex={1} alignItems='center' justifyContent='center' gap='$3'>
                    <Spinner size='large' color='$textPrimary' />
                    <Text color='$textSecondary'>{isMapMounted ? 'Acquiring location...' : 'Loading map...'}</Text>
                </YStack>
            )}

            {hasCoords && (
                <WidgetContainer position='absolute' top='$4' right='$4' zIndex={10} py='$2' px='$3' bg='rgba(0,0,0,0.7)'>
                    <Text color='white' fontSize={10}>
                        Lat: {(mapCenter?.latitude || lat).toFixed(5)}
                    </Text>
                    <Text color='white' fontSize={10}>
                        Lng: {(mapCenter?.longitude || lng).toFixed(5)}
                    </Text>
                </WidgetContainer>
            )}

            {/* Accepted Orders Toggle Button */}
            <TouchableOpacity style={{ position: 'absolute', top: 16, left: 16, zIndex: 110 }} activeOpacity={0.8} onPress={() => setIsOrdersMenuOpen(!isOrdersMenuOpen)}>
                <WidgetContainer py='$2' px='$3' flexDirection='row' alignItems='center' gap='$3' position='relative'>
                    <Text color='$textPrimary' fontWeight='bold'>
                        Accepted Orders:
                    </Text>
                    <Text color={theme['$textSecondary'].val} fontSize={18} fontWeight='bold'>
                        {allActiveOrders?.length || 0}
                    </Text>
                    <MaterialIcons name={isOrdersMenuOpen ? 'expand-less' : 'expand-more'} size={20} color={theme['$textPrimary']?.val || '#000'} />
                </WidgetContainer>
            </TouchableOpacity>

            {/* Dropdown Menu List */}
            {isOrdersMenuOpen && (
                <WidgetContainer position='absolute' top={75} left={16} zIndex={110} width={260} maxHeight={300} p={0} overflow='hidden'>
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {!allActiveOrders || allActiveOrders.length === 0 ? (
                            <YStack p='$4' alignItems='center' justifyContent='center'>
                                <Text color='$textSecondary'>No accepted orders.</Text>
                            </YStack>
                        ) : (
                            allActiveOrders.map((order, index) => (
                                <TouchableOpacity
                                    key={`menu-order-${order.id}`}
                                    style={{
                                        padding: 12,
                                        borderBottomWidth: index === allActiveOrders.length - 1 ? 0 : 1,
                                        borderBottomColor: isDarkMode ? '#333' : '#eee',
                                    }}
                                    onPress={() => {
                                        setIsOrdersMenuOpen(false);
                                        navigation.navigate('DriverTaskTab', {
                                            screen: 'OrderModal',
                                            params: { order: order.attributes || order },
                                        });
                                    }}
                                >
                                    <Text fontWeight='bold' color='$textPrimary'>
                                        #{order.id?.split('_')[1] || order.id}
                                    </Text>
                                    <Text fontSize={12} color='$textSecondary' numberOfLines={1} mt='$1'>
                                        {get(order, 'attributes.payload.pickup.address') || get(order, 'attributes.pickup.address') || 'Tap to view details'}
                                    </Text>
                                </TouchableOpacity>
                            ))
                        )}
                    </ScrollView>
                </WidgetContainer>
            )}

            {/* Recenter Button */}
            {!isFollowingUser && hasCoords && (
                <TouchableOpacity style={{ position: 'absolute', bottom: 32, left: 16, zIndex: 100 }} onPress={handleRecenter} activeOpacity={0.7}>
                    <YStack width={52} height={52} borderRadius={26} alignItems='center' justifyContent='center' bg='rgba(150, 150, 150, 0.75)'>
                        <MaterialIcons name='near-me' size={28} color={theme['$textPrimary']?.val || '#000'} />
                    </YStack>
                </TouchableOpacity>
            )}
        </YStack>
    );
};

const styles = StyleSheet.create({
    driverDotWrapper: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    driverDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#007AFF',
        borderWidth: 3,
        borderColor: 'white',
        elevation: 5,
    },
});

export default DriverDashboardScreen;

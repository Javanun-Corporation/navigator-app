// When the saved order lists must be fetched again, so an order the server changed (cancelled, completed, reassigned) does not linger on the phone.

// A push notification about an order carries the order's public id (order_...) on payload.id.
export const isOrderNotification = (notification) => {
    const id = notification?.payload?.id;
    return typeof id === 'string' && id.startsWith('order_');
};

// The app came back to the foreground, where it may have missed order changes while it was away.
export const isReturnToForeground = (previousState, nextState) => previousState !== 'active' && previousState !== nextState && nextState === 'active';

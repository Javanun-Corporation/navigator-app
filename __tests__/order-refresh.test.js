import { isOrderNotification, isReturnToForeground } from '../src/utils/order-refresh';

describe('isOrderNotification', () => {
    it('is true for a push about an order', () => {
        expect(isOrderNotification({ payload: { id: 'order_li0eibjiit', type: 'order_canceled' } })).toBe(true);
    });

    it('is false for a push about something else', () => {
        expect(isOrderNotification({ payload: { id: 'chat_abc123', type: 'chat_message' } })).toBe(false);
    });

    it('is false when the push has no id', () => {
        expect(isOrderNotification({ payload: { type: 'order_canceled' } })).toBe(false);
        expect(isOrderNotification({ payload: { id: 42 } })).toBe(false);
        expect(isOrderNotification({})).toBe(false);
        expect(isOrderNotification(null)).toBe(false);
        expect(isOrderNotification(undefined)).toBe(false);
    });
});

describe('isReturnToForeground', () => {
    it('is true when the app comes back from the background', () => {
        expect(isReturnToForeground('background', 'active')).toBe(true);
        expect(isReturnToForeground('inactive', 'active')).toBe(true);
    });

    it('is false when the app stays active or leaves the foreground', () => {
        expect(isReturnToForeground('active', 'active')).toBe(false);
        expect(isReturnToForeground('active', 'background')).toBe(false);
        expect(isReturnToForeground('active', 'inactive')).toBe(false);
        expect(isReturnToForeground('background', 'inactive')).toBe(false);
    });
});

import Config from 'react-native-config';

const PAYOUTS_API_BASE_URL = Config.PAYOUTS_API_BASE_URL;

async function request(path, { driver, authToken, method = 'GET', body } = {}) {
    if (!PAYOUTS_API_BASE_URL) {
        throw new Error('PAYOUTS_API_BASE_URL is not configured.');
    }

    const response = await fetch(`${PAYOUTS_API_BASE_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
            'X-Fleetbase-Driver-Id': driver?.id,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || data.message || 'Payouts request failed.');
    }

    return data;
}

export function getPayoutHistory({ driver, authToken }) {
    return request('/payouts/history', { driver, authToken });
}

export function getConnectStatus({ driver, authToken }) {
    return request('/payouts/connect/status', { driver, authToken });
}

export function getPayoutRules({ driver, authToken }) {
    return request('/payouts/rules', { driver, authToken });
}

export function createOnboardingLink({ driver, authToken }) {
    return request('/payouts/connect/onboarding-link', { driver, authToken, method: 'POST' });
}

export function getReferralInfo({ driver, authToken }) {
    return request('/referrals/me', { driver, authToken });
}

export function redeemReferral({ driver, authToken, referralCode }) {
    return request('/referrals/redeem', { driver, authToken, method: 'POST', body: { referralCode } });
}

export function formatCents(amountCents = 0) {
    return `$${(amountCents / 100).toFixed(2)}`;
}

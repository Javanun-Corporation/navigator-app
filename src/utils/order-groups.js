// Groups the sibling orders of one BeeSure report (the three LVA orders dispatched for it) so a driver sees one card per report and never holds two of them.
// Fleetbase echoes the report id on meta.report_id since javanun a17446c (16 Aug 2026). Orders created before that carry it as meta.validation_id, and the older navigator-app builds also read meta.reportId, meta.validationId and custom_fields.validation_id.
export const REPORT_KEY_PATHS = ['meta.report_id', 'meta.reportId', 'meta.validation_id', 'meta.validationId', 'custom_fields.validation_id'];

const NO_CHILD_INDEX = Number.MAX_SAFE_INTEGER;

export const UNAVAILABLE_TITLE = 'Order Unavailable';
export const UNAVAILABLE_MESSAGE = 'Other drivers have already accepted every open order of this validation.';
export const FAILED_TITLE = 'Could not accept the order';
export const FAILED_MESSAGE = 'Check your connection and try again.';
export const HELD_TITLE = 'Already assigned';

// The visible label of the Orders list's switch for finished orders. The e2e harness never taps it; it reads the hidden-count text below.
export const SHOW_FINISHED_LABEL = 'Show finished orders';

export const getReportKey = (order) => {
    for (const path of REPORT_KEY_PATHS) {
        const value = order.getAttribute(path);
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim().toLowerCase();
        }
    }
    return null;
};

export const getChildIndex = (order) => {
    const value = Number(order.getAttribute('meta.child_index'));
    return Number.isInteger(value) && value > 0 ? value : NO_CHILD_INDEX;
};

export const isUnassigned = (order) => order.getAttribute('driver_assigned') === null;

export const toDismissalKey = (reportKey) => `report:${reportKey}`;

// What a dismissal adds to OrderManagerContext's dismissedOrders: the order id, plus the report key so every unassigned sibling disappears with it.
export const dismissalKeysFor = (order) => {
    const reportKey = getReportKey(order);
    return reportKey === null ? [order.id] : [order.id, toDismissalKey(reportKey)];
};

export const heldMessage = (held) => `You already have order ${held.getAttribute('tracking_number.tracking_number') ?? held.id} from this validation. A validation needs three different drivers.`;

// Shown next to the switch while finished orders are hidden and there is at least one. The e2e harness reads it in check 9 as a weaker sign that the driver's current-order list has loaded (it counts any finished order, including cached ones from earlier runs).
export const hiddenFinishedMessage = (count) => `${count} hidden`;

export const dismissMessage = (otherOpenSiblings) => `By dimissing this ad-hoc order it will no longer display as an available order.${otherOpenSiblings > 0 ? ` The other ${otherOpenSiblings} open ${otherOpenSiblings === 1 ? 'order' : 'orders'} of this validation will be hidden too.` : ''}`;

// A released order: a driver accepted it (Fleetbase sets started) and then cancelled the assignment, which clears the driver but not the flag. Fleetbase refuses to start it again, so nobody can accept it.
export const isStartedUnassigned = (order) => order.getAttribute('driver_assigned') === null && order.getAttribute('started') === true;

// Released siblings go last whatever their child index, so a free sibling is always the displayed order and the first one tried.
const sortSiblings = (members) => members.slice().sort((a, b) => Number(isStartedUnassigned(a.order)) - Number(isStartedUnassigned(b.order)) || getChildIndex(a.order) - getChildIndex(b.order) || a.position - b.position).map((member) => member.order);

// An assigned order is finished, and counts as history, in these statuses. They are the app's non-active statuses (DriverOrderManagementScreen.tsx:92, OrderManagerContext.tsx:46) without 'created', which is an order not yet dispatched.
// Fleetbase's cancel() sets the order config's canceled-activity code, so a cancelled order is 'canceled' or 'order_canceled'.
export const FINISHED_ORDER_STATUSES = ['completed', 'canceled', 'order_canceled'];

export const isFinishedOrder = (order) => FINISHED_ORDER_STATUSES.includes(order.getAttribute('status'));

// The orders assigned to the driver that the Orders list shows: never a dismissed one (a cancelled assignment), and a finished one only when showFinished is true.
export const listShownHeldOrders = (currentOrders, dismissed = [], showFinished = true) => currentOrders.filter((order) => !dismissed.includes(order.id) && (showFinished || !isFinishedOrder(order)));

// How many finished orders the list leaves out: 0 while they are shown.
export const countHiddenFinishedOrders = (currentOrders, dismissed = [], showFinished = true) => (showFinished ? 0 : currentOrders.filter((order) => !dismissed.includes(order.id) && isFinishedOrder(order)).length);

// Builds the Orders list: one item per report for the unassigned (nearby) orders, then the orders assigned to the driver.
// An item is { key, order, siblings }: `order` is the card's order and `siblings` are the orders the card may claim, `order` first.
// Assigned orders are never merged, and the grouping rules never hide one, so a driver who somehow holds two siblings still sees both (a finished one only while showFinished is true).
// A report the driver already holds an order of (any status) shows no nearby card. A dismissed order id hides that order; a dismissed report key hides the report's unassigned orders.
// showFinished only decides which assigned orders get an item. The hiding rules above always read every order of currentOrders, finished or not, and nearby items are never filtered, so hiding history never brings a report's siblings back.
export const buildOrderList = (nearbyOrders, currentOrders, dismissed = [], showFinished = true) => {
    const dismissedSet = new Set(dismissed);
    const currentIds = new Set(currentOrders.map((order) => order.id));
    const heldOrders = currentOrders.filter((order) => !dismissedSet.has(order.id));
    const heldReports = new Set(heldOrders.map(getReportKey).filter((key) => key !== null));
    const seenIds = new Set();
    const groups = new Map();
    const nearbyItems = [];
    nearbyOrders.forEach((order, position) => {
        if (seenIds.has(order.id) || currentIds.has(order.id) || dismissedSet.has(order.id)) {
            return;
        }
        seenIds.add(order.id);
        const reportKey = getReportKey(order);
        if (reportKey === null) {
            nearbyItems.push({ key: order.id, order, siblings: [order] });
            return;
        }
        if (heldReports.has(reportKey) || dismissedSet.has(toDismissalKey(reportKey))) {
            return;
        }
        const group = groups.get(reportKey);
        if (group) {
            group.members.push({ order, position });
            return;
        }
        const created = { key: toDismissalKey(reportKey), members: [{ order, position }] };
        groups.set(reportKey, created);
        nearbyItems.push(created);
    });
    const items = nearbyItems.map((item) => {
        if (!item.members) {
            return item;
        }
        const siblings = sortSiblings(item.members);
        return { key: item.key, order: siblings[0], siblings };
    });
    listShownHeldOrders(currentOrders, dismissed, showFinished).forEach((order) => items.push({ key: order.id, order, siblings: [order] }));
    return items;
};

// The order of this report the driver already holds (not counting dismissed ones, which are cancelled assignments), or null.
export const findHeldSibling = (order, currentOrders, dismissed = []) => {
    const reportKey = getReportKey(order);
    if (reportKey === null) {
        return null;
    }
    return currentOrders.find((held) => held.id !== order.id && !dismissed.includes(held.id) && getReportKey(held) === reportKey) ?? null;
};

// The other unassigned orders of this report in the nearby feed, lowest child index first.
export const listOpenSiblings = (order, nearbyOrders) => {
    const reportKey = getReportKey(order);
    if (reportKey === null) {
        return [];
    }
    const members = nearbyOrders.map((candidate, position) => ({ order: candidate, position })).filter((member) => member.order.id !== order.id && isUnassigned(member.order) && getReportKey(member.order) === reportKey);
    return sortSiblings(members);
};

// 'free' (no driver and never started), 'mine' or 'taken' (another driver holds it, or it is released: started with no driver, which Fleetbase refuses to start again). Fleetbase's driver_assigned is the driver resource, so its id is the driver's public id (legacy/utils/Helper.js:618 compares driver_assigned.id with driver.id).
export const assignmentOf = (order, driverId) => {
    if (order.getAttribute('driver_assigned') === null) {
        return isStartedUnassigned(order) ? 'taken' : 'free';
    }
    return order.getAttribute('driver_assigned.id') === driverId ? 'mine' : 'taken';
};

const reloadWithState = async (order, driverId) => {
    const reloaded = await order.reload();
    return { order: reloaded, state: assignmentOf(reloaded, driverId) };
};

// Claims the first candidate nobody has taken. Each candidate is re-read first, so a taken or released order is skipped without calling start.
// Outcomes: accepted (order is the started order), unavailable (every candidate was taken) and error (a call failed and the candidate is still free or unknown).
// It stops at the first error and never moves on to another candidate after one, because start may have succeeded on the server.
export const claimFirstAvailable = async (candidates, driverId) => {
    const takenIds = [];
    for (const candidate of candidates) {
        let current;
        try {
            current = await reloadWithState(candidate, driverId);
        } catch (error) {
            return { outcome: 'error', order: null, error, takenIds };
        }
        if (current.state === 'mine') {
            return { outcome: 'accepted', order: current.order, takenIds };
        }
        if (current.state === 'taken') {
            takenIds.push(candidate.id);
            continue;
        }
        try {
            const started = await current.order.start({ assign: driverId });
            return { outcome: 'accepted', order: started, takenIds };
        } catch (startError) {
            let after = null;
            try {
                after = await reloadWithState(current.order, driverId);
            } catch (reloadError) {
                after = null;
            }
            if (after && after.state === 'mine') {
                return { outcome: 'accepted', order: after.order, takenIds };
            }
            if (after && after.state === 'taken') {
                takenIds.push(candidate.id);
                continue;
            }
            return { outcome: 'error', order: null, error: startError, takenIds };
        }
    }
    return { outcome: 'unavailable', order: null, takenIds };
};

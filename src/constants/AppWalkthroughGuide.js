// Local, bundled training module that walks a new driver through the order
// lifecycle using real screenshots of this app. Unlike the other training
// modules (fetched from TRAINING_MODULES_API_URL), this one ships with the
// app so it never depends on the training CMS being updated.
export const APP_WALKTHROUGH_MODULE = {
    id: 'local-app-walkthrough',
    title: 'App Walkthrough: Accept, Navigate & Validate an Order',
    intro: "Here's what the order lifecycle actually looks like in the app, step by step.",
    sections: [
        {
            heading: '1. Accept the order',
            body: 'New orders show up on your Orders tab marked "Dispatched". Tap an order to open its details.',
            image: require('../../assets/images/training/guide-1-incoming-order.png'),
        },
        {
            heading: '',
            body: "Review the order details, then tap Accept Order to take it (or Dismiss Order if you can't). Accepting assigns the order to you and starts it immediately.",
            image: require('../../assets/images/training/guide-2-accept-order.png'),
        },
        {
            heading: '2. Navigate to the customer',
            body: 'Once accepted, the order shows "Started". Tap Start Navigation to get directions to the pickup or delivery location.',
            image: require('../../assets/images/training/guide-3-start-navigation.png'),
        },
        {
            heading: '',
            body: "Pick the maps app you'd like to use for turn-by-turn directions.",
            image: require('../../assets/images/training/guide-4-navigation-chooser.png'),
        },
        {
            heading: '3. Keep your activity updated',
            body: 'As you make progress, tap Update Activity and select the status that matches what you\'re doing, e.g. "Driver Enroute" when you\'re on your way.',
            image: require('../../assets/images/training/guide-5-update-activity.png'),
        },
        {
            heading: '4. Perform validation on arrival',
            body: "When you arrive and start validation, show the customer your BeeSure code and scan or type theirs to confirm you're on the right order.",
            image: require('../../assets/images/training/guide-6-qr-handshake.png'),
        },
        {
            heading: '',
            body: 'Then follow the validation steps — taking photos, recording scores, and completing the checklist — to finish the order.',
            image: require('../../assets/images/training/guide-7-take-photo.png'),
        },
    ],
};

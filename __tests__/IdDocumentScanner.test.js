import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import DocumentScanner from 'react-native-document-scanner-plugin';
import IdDocumentScanner from '../src/components/IdDocumentScanner';

jest.mock('react-native-document-scanner-plugin', () => ({
    __esModule: true,
    default: { scanDocument: jest.fn() },
    ResponseType: { Base64: 'base64', ImageFilePath: 'imageFilePath' },
    ScanDocumentResponseStatus: { Success: 'success', Cancel: 'cancel' },
}));

jest.mock('tamagui', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    const Button = host('Button');
    Button.Text = host('ButtonText');
    Button.Icon = host('ButtonIcon');
    return { Button, Spinner: host('Spinner'), Text: host('Text'), XStack: host('XStack'), YStack: host('YStack') };
});

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@fortawesome/react-native-fontawesome', () => ({ FontAwesomeIcon: () => null }));
jest.mock('@fortawesome/free-solid-svg-icons', () => ({ faIdCard: {}, faTriangleExclamation: {} }));

describe('IdDocumentScanner', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        DocumentScanner.scanDocument.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // The full scanner mode applies Google's Enhance filter by default, which posterised the ID front's portrait so the phone's face check found no face (harness run 20261110-153052); base mode has no filters.
    it("opens Google's scanner in base mode, so no Enhance filter changes the ID photo", async () => {
        DocumentScanner.scanDocument.mockResolvedValue({ status: 'success', scannedImages: ['file:///scan.jpg'] });
        const onComplete = jest.fn();
        await act(async () => {
            TestRenderer.create(React.createElement(IdDocumentScanner, { side: 'front', onComplete }));
        });
        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        expect(DocumentScanner.scanDocument).toHaveBeenCalledTimes(1);
        expect(DocumentScanner.scanDocument).toHaveBeenCalledWith({ maxNumDocuments: 1, responseType: 'imageFilePath', scannerMode: 'base' });
        expect(onComplete).toHaveBeenCalledWith('file:///scan.jpg');
    });
});

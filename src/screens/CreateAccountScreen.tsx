import { toast } from '@backpackapp-io/react-native-toast';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Keyboard, Pressable, SafeAreaView, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Button, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import BackButton from '../components/BackButton';
import Input from '../components/Input';
import PhoneInput from '../components/PhoneInput';
import { useAuth } from '../contexts/AuthContext';
import { useConfig } from '../contexts/ConfigContext';
import { isValidPhoneNumber } from '../utils';
import { storage } from '../hooks/use-storage';

const CreateAccountScreen = ({ route }) => {
    const { resolveConnectionConfig } = useConfig();
    const FLEETBASE_KEY = resolveConnectionConfig('FLEETBASE_KEY');
    const params = route.params || {};
    const navigation = useNavigation();
    const theme = useTheme();
    const { requestCreationCode, isSendingCode, phone: phoneState } = useAuth();

    const [name, setName] = useState(params.name || '');
    const [email, setEmail] = useState(''); // Added email state
    const [phone, setPhone] = useState(phoneState);
    const [referralCode, setReferralCode] = useState('');

    // Stash the referral code locally as the user types it so it survives past
    // this screen regardless of which navigation path account creation takes;
    // AuthContext redeems it once the new driver's session is created.
    const handleReferralCodeChange = (text) => {
        setReferralCode(text);
        if (text) {
            storage.setString('pending_referral_code', text.trim().toUpperCase());
        } else {
            storage.removeItem('pending_referral_code');
        }
    };

    const handleSendVerificationCode = async () => {
        if (isSendingCode) {
            return;
        }

        if (!isValidPhoneNumber(phone)) {
            return toast.error('Invalid phone number provided.');
        }

        if (!name || !email) {
            return toast.error('Name and email are required.');
        }

        try {
            // 1. Create the Driver in Fleetbase
            const response = await fetch('https://api.fleetbase.io/v1/drivers', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${FLEETBASE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name,
                    email: email,
                    phone: phone,
                }),
            });

            const fleetbaseData = await response.json();
            console.log('Fleetbase Raw Response:', fleetbaseData);

            // If Fleetbase returns an error, catch it before navigating
            if (!response.ok) {
                const errorMessage = fleetbaseData.errors ? fleetbaseData.errors[0] : 'Failed to create driver.';
                throw new Error(errorMessage);
            }

            // 2. Proceed with your original Auth flow
            navigation.navigate('PhoneLogin');
        } catch (error) {
            toast.error(error.message);
        }
    };

    const handleLogin = () => {
        navigation.navigate('Login');
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <LinearGradient colors={['rgba(0, 0, 0, 0.0)', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.8)']} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />
            <YStack flex={1} alignItems='center' space='$3'>
                <YStack width='100%' padding='$5'>
                    <XStack space='$3' alignItems='center' mb='$5'>
                        <BackButton size={40} />
                        <Text color='$textPrimary' fontWeight='bold' fontSize='$8'>
                            Create Account
                        </Text>
                    </XStack>
                    <YStack space='$3'>
                        <Input value={name} onChangeText={(text) => setName(text)} placeholder='Enter your name' />
                        {/* Added Email Input */}
                        <Input value={email} onChangeText={(text) => setEmail(text)} placeholder='Enter your email address' autoCapitalize='none' keyboardType='email-address' />
                        <PhoneInput value={phone} onChange={(phoneNumber) => setPhone(phoneNumber)} />
                        <Input value={referralCode} onChangeText={handleReferralCodeChange} placeholder='Referral code (optional)' autoCapitalize='characters' />
                    </YStack>
                    <Button size='$5' mt='$2' onPress={handleSendVerificationCode} bg='$primary' width='100%' opacity={isSendingCode ? 0.75 : 1} disabled={isSendingCode} rounded>
                        <Button.Icon>{isSendingCode ? <Spinner color='$white' /> : <FontAwesomeIcon icon={faPaperPlane} color={theme.white.val} />}</Button.Icon>
                        <Button.Text color='$white' fontWeight='bold'>
                            Send Verification Code
                        </Button.Text>
                    </Button>
                </YStack>

                <YStack flex={1} position='relative' width='100%'>
                    <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} pointerEvents='box-only' />
                </YStack>

                <YStack space='$3' width='100%' padding='$5'>
                    <Button size='$5' onPress={handleLogin} bg='$secondary' width='100%' opacity={isSendingCode ? 0.75 : 1} disabled={isSendingCode} rounded>
                        <Button.Text color='$textPrimary' fontWeight='bold'>
                            Have an account already? Login
                        </Button.Text>
                    </Button>
                </YStack>
            </YStack>
        </SafeAreaView>
    );
};

export default CreateAccountScreen;

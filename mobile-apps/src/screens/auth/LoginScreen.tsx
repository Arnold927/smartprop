/**
 * LoginScreen.tsx  (upgraded error handling)
 *
 * Changes:
 *  - Per-field inline errors (email, password) instead of Alert
 *  - Login error uses the specific userMessage from api.ts
 *  - Network-down vs wrong-password are visually distinct
 *  - Error fades in under the relevant field
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Animated,
  ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useAuth } from '../../services/auth';
import { validateLoginForm } from '../../services/errors';
import { C, R, shadow, haptic } from '../../components/DesignSystem';

const Icon = MaterialIcons as any;
const { width } = Dimensions.get('window');

const LoginScreen: React.FC<{ navigation: any }> = () => {
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [emailFocus, setEmailFocus]     = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);
  // Per-field errors
  const [fieldErrors, setFieldErrors]   = useState<{ email?: string; password?: string }>({});
  // Global auth error (wrong password, server down, etc.)
  const [authError, setAuthError]       = useState<string | null>(null);
  const { login } = useAuth();

  const shakeX     = useRef(new Animated.Value(0)).current;
  const btnScale   = useRef(new Animated.Value(1)).current;
  const heroFade   = useRef(new Animated.Value(0)).current;
  const heroSlide  = useRef(new Animated.Value(-20)).current;
  const formFade   = useRef(new Animated.Value(0)).current;
  const formSlide  = useRef(new Animated.Value(30)).current;
  const errorFade  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.parallel([
        Animated.timing(heroFade,  { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(heroSlide, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }),
      ]),
      Animated.parallel([
        Animated.timing(formFade,  { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(formSlide, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 8 }),
      ]),
    ]).start();
  }, []);

  const showAuthError = (msg: string) => {
    setAuthError(msg);
    errorFade.setValue(0);
    Animated.timing(errorFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    haptic.medium();
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue:  6,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0,   duration: 55, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    // Client-side validation first
    const validation = validateLoginForm(email, password);
    if (!validation.valid) {
      setFieldErrors(validation.errors as any);
      haptic.medium();
      return;
    }
    setFieldErrors({});
    setAuthError(null);

    haptic.light();
    Animated.spring(btnScale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
    setIsLoading(true);
    try {
      const result = await login(email.trim().toLowerCase(), password);
      if (!result.success) {
        // Use the specific userMessage from api.ts — it's context-aware
        showAuthError(result.userMessage ?? result.error ?? 'Sign-in failed. Please try again.');
      }
    } catch {
      showAuthError('Could not connect to SmartProp. Check your internet connection and try again.');
    } finally {
      setIsLoading(false);
      Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
    }
  };

  const inputStyle = (focused: boolean, hasError: boolean) => [
    styles.inputWrap,
    focused && styles.inputFocused,
    hasError && styles.inputErrorBorder,
  ];

  return (
    <KeyboardAvoidingView style={styles.outer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <Animated.View style={[styles.hero, { opacity: heroFade, transform: [{ translateY: heroSlide }] }]}>
          <View style={styles.logoRing}>
            <Icon name="home-work" size={44} color="white" />
          </View>
          <Text style={styles.brand}>SmartProp</Text>
          <Text style={styles.heroSub}>Nairobi Property Management</Text>
          <View style={styles.trustRow}>
            {[{ icon: 'lock', label: 'Secure' }, { icon: 'cloud-done', label: 'Synced' }, { icon: 'offline-bolt', label: 'Works Offline' }].map((b) => (
              <View key={b.icon} style={styles.trustBadge}>
                <Icon name={b.icon} size={12} color="rgba(255,255,255,0.7)" />
                <Text style={styles.trustLabel}>{b.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* Form card */}
        <Animated.View style={[styles.card, shadow(4), { opacity: formFade, transform: [{ translateY: formSlide }, { translateX: shakeX }] }]}>
          <Text style={styles.welcomeTitle}>Welcome back</Text>
          <Text style={styles.welcomeSub}>Sign in to your account</Text>

          {/* Global auth error banner */}
          {authError && (
            <Animated.View style={[styles.authErrorBanner, { opacity: errorFade }]}>
              <Icon name="error" size={16} color="#991B1B" />
              <Text style={styles.authErrorText}>{authError}</Text>
            </Animated.View>
          )}

          {/* Email */}
          <View style={inputStyle(emailFocus, !!fieldErrors.email)}>
            <Icon name="email" size={18} color={fieldErrors.email ? C.red : emailFocus ? C.blue : C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={C.textMuted}
              value={email}
              onChangeText={(v) => { setEmail(v); setFieldErrors((e) => ({ ...e, email: undefined })); setAuthError(null); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setEmailFocus(true)}
              onBlur={() => setEmailFocus(false)}
            />
          </View>
          {fieldErrors.email && <Text style={styles.fieldError}>{fieldErrors.email}</Text>}

          {/* Password */}
          <View style={[inputStyle(passwordFocus, !!fieldErrors.password), { marginTop: 12 }]}>
            <Icon name="lock" size={18} color={fieldErrors.password ? C.red : passwordFocus ? C.blue : C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={C.textMuted}
              value={password}
              onChangeText={(v) => { setPassword(v); setFieldErrors((e) => ({ ...e, password: undefined })); setAuthError(null); }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              onFocus={() => setPasswordFocus(true)}
              onBlur={() => setPasswordFocus(false)}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Icon name={showPassword ? 'visibility' : 'visibility-off'} size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          {fieldErrors.password && <Text style={styles.fieldError}>{fieldErrors.password}</Text>}

          <TouchableOpacity style={styles.forgotRow}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity style={[styles.loginBtn, isLoading && styles.loginBtnLoading]} onPress={handleLogin} disabled={isLoading} activeOpacity={0.9}>
              {isLoading
                ? <ActivityIndicator color="white" size="small" />
                : <><Text style={styles.loginBtnText}>Sign In</Text><Icon name="arrow-forward" size={18} color="white" /></>
              }
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        <Text style={styles.footer}>Contact your administrator to get access</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  outer:            { flex: 1, backgroundColor: '#0F172A' },
  scroll:           { flexGrow: 1, paddingBottom: 40 },
  hero:             { alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 72 : 56, paddingBottom: 40, paddingHorizontal: 32 },
  logoRing:         { width: 88, height: 88, borderRadius: 44, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: C.blue, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 10 },
  brand:            { fontSize: 30, fontWeight: '800', color: 'white', letterSpacing: -0.5, marginBottom: 4 },
  heroSub:          { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 },
  trustRow:         { flexDirection: 'row', gap: 12 },
  trustBadge:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill },
  trustLabel:       { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
  card:             { marginHorizontal: 20, backgroundColor: C.surface, borderRadius: 24, padding: 24 },
  welcomeTitle:     { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 4, textAlign: 'center' },
  welcomeSub:       { fontSize: 14, color: C.textSub, textAlign: 'center', marginBottom: 20 },
  authErrorBanner:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: R.md, padding: 12, marginBottom: 16 },
  authErrorText:    { fontSize: 13, color: '#991B1B', flex: 1, lineHeight: 18 },
  inputWrap:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.border, borderRadius: R.md, backgroundColor: C.bg, height: 52 },
  inputFocused:     { borderColor: C.blue, backgroundColor: `${C.blueLight}60` },
  inputErrorBorder: { borderColor: C.red, backgroundColor: '#FEF2F2' },
  inputIcon:        { marginLeft: 14, marginRight: 10 },
  input:            { flex: 1, fontSize: 15, color: C.ink, height: '100%', paddingRight: 12 },
  eyeBtn:           { paddingHorizontal: 14 },
  fieldError:       { fontSize: 12, color: C.red, marginTop: 5, marginLeft: 2, marginBottom: 4 },
  forgotRow:        { alignItems: 'flex-end', marginTop: 12, marginBottom: 20 },
  forgotText:       { fontSize: 13, color: C.blue, fontWeight: '600' },
  loginBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue, borderRadius: R.md, height: 52, gap: 8, shadowColor: C.blue, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  loginBtnLoading:  { backgroundColor: C.textSub },
  loginBtnText:     { color: 'white', fontSize: 16, fontWeight: '700' },
  footer:           { textAlign: 'center', marginTop: 28, fontSize: 13, color: 'rgba(255,255,255,0.25)', paddingHorizontal: 32 },
});

export default LoginScreen;
